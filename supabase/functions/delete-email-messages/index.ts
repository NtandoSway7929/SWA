import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@2.0.5";
import {
  resolveEmailAttachmentStoragePaths,
  resolveInboxDeleteTargets,
} from "./delete-helpers.mjs";

const MAILBOX = "info@swayphics.co.za";
const MAX_DELETE_MESSAGES = 150;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://swayphics.co.za",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function describeError(error: unknown) {
  const value = error as { message?: string; code?: string } | null;
  const message = String(value?.message || "The email inbox operation failed.");
  return message.length > 500 ? message.slice(0, 500) : message;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  let mailboxClient: any = null;
  let mailboxLock: any = null;

  try {
    const authorization = req.headers.get("Authorization") || "";
    const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) {
      return jsonResponse({ error: "Authentication required." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const publicApiKey = req.headers.get("apikey") ||
      Deno.env.get("SUPABASE_ANON_KEY") ||
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

    if (!supabaseUrl || !serviceRoleKey || !publicApiKey) {
      return jsonResponse({ error: "The email deletion service is not configured." }, 503);
    }

    const authClient = createClient(supabaseUrl, publicApiKey);
    const userResult = await authClient.auth.getUser(accessToken);
    const user = userResult.data?.user;
    if (userResult.error || !user?.id) {
      return jsonResponse({ error: "Your admin session is invalid or expired." }, 401);
    }

    // Verify active workspace membership before using the server-side service role.
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const adminResult = await serviceClient
      .from("admin_users")
      .select("user_id,role,active")
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();

    if (adminResult.error) {
      throw adminResult.error;
    }
    if (!adminResult.data || !["owner", "team_member"].includes(String(adminResult.data.role || ""))) {
      return jsonResponse({ error: "An active Swayphics admin account is required." }, 403);
    }

    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "A valid JSON request body is required." }, 400);
    }

    const suppliedIds = Array.isArray(payload.message_ids) ? payload.message_ids : [];
    const messageIds = [...new Set(suppliedIds.map((id) => String(id || "").trim()))];
    if (!messageIds.length || messageIds.length > MAX_DELETE_MESSAGES ||
        messageIds.some((id) => !UUID_PATTERN.test(id))) {
      return jsonResponse({
        error: "Select between 1 and 150 valid inbox message records.",
      }, 400);
    }

    const storedResult = await serviceClient
      .from("email_messages")
      .select("id,direction,mailbox,imap_uid,imap_uid_validity,message_id,source_key,attachments")
      .eq("mailbox", MAILBOX)
      .in("id", messageIds);

    if (storedResult.error) {
      throw storedResult.error;
    }

    const records = storedResult.data || [];
    if (records.length !== messageIds.length ||
        records.some((record: any) => record.mailbox !== MAILBOX)) {
      return jsonResponse({
        error: "One or more selected email messages are no longer available in this inbox. Refresh and try again.",
      }, 409);
    }

    if (records.some((record: any) => !["inbound", "outbound"].includes(String(record.direction || "")))) {
      return jsonResponse({ error: "The selection contains an unsupported message type." }, 400);
    }

    const inboundRecords = records.filter((record: any) => record.direction === "inbound");
    let mailboxMessagesNotFound = 0;
    let mailboxUidsReconciled = 0;
    if (inboundRecords.length) {
      const imapPassword = Deno.env.get("EMAIL_IMAP_PASSWORD");
      if (!imapPassword) {
        return jsonResponse({
          error: "The connected mailbox is not configured for permanent inbox deletion.",
        }, 503);
      }

      const folder = Deno.env.get("EMAIL_IMAP_FOLDER") || "INBOX";
      const imapHost = Deno.env.get("EMAIL_IMAP_HOST") || "imap.hmailplus.com";
      const imapPort = Number(Deno.env.get("EMAIL_IMAP_PORT") || "993");
      const imapUser = Deno.env.get("EMAIL_IMAP_USER") || MAILBOX;

      mailboxClient = new ImapFlow({
        host: imapHost,
        port: imapPort,
        secure: true,
        logger: false,
        disableCompression: true,
        disableAutoIdle: true,
        auth: { user: imapUser, pass: imapPassword },
      });

      await mailboxClient.connect();
      mailboxLock = await mailboxClient.getMailboxLock(folder, {
        readOnly: false,
        description: "Swayphics selected inbox conversation deletion",
      });

      const requestedUids = inboundRecords.map((record: any) => Number(record.imap_uid));
      if (requestedUids.some((uid: number) => !Number.isSafeInteger(uid) || uid <= 0)) {
        return jsonResponse({
          error: "An incoming message is missing its mailbox identity and cannot be safely deleted.",
        }, 409);
      }

      const currentMessages = await mailboxClient.fetchAll(
        requestedUids,
        { envelope: true },
        { uid: true },
      );
      if (!Array.isArray(currentMessages)) {
        throw new Error("The connected mailbox could not verify selected message identities.");
      }

      const currentUidValidity = Number(mailboxClient.mailbox?.uidValidity || 0);
      if (!Number.isSafeInteger(currentUidValidity) || currentUidValidity <= 0) {
        throw new Error("The connected mailbox did not provide a valid UIDVALIDITY value.");
      }

      const deleteTargets = resolveInboxDeleteTargets(
        inboundRecords,
        currentMessages,
        folder,
        currentUidValidity,
      );
      const uidsToDelete = new Set(deleteTargets.uids);
      // UIDs are unique only within an IMAP UIDVALIDITY generation. If a mailbox
      // was rebuilt, an old UID may now point to a different message. Search by
      // the stored RFC Message-ID, then verify the exact envelope ID before
      // deleting the message at its current UID.
      for (const lookup of deleteTargets.messageIdLookups) {
        const searchResult = await mailboxClient.search(
          { header: { "Message-ID": lookup.messageId } },
          { uid: true },
        );
        if (!Array.isArray(searchResult)) {
          throw new Error("The connected mailbox could not safely search for a selected message by Message-ID.");
        }

        if (!searchResult.length) {
          // The original message is no longer in this mailbox folder. Its dashboard
          // mirror can still be removed without touching another mailbox message.
          mailboxMessagesNotFound += 1;
          continue;
        }

        const matchedMessages = await mailboxClient.fetchAll(
          searchResult,
          { envelope: true },
          { uid: true },
        );
        if (!Array.isArray(matchedMessages)) {
          throw new Error("The connected mailbox could not verify a Message-ID search result.");
        }

        const exactMatches = [...new Set(
          matchedMessages
            .filter((message: any) =>
              String(message?.envelope?.messageId || "").trim() === lookup.messageId
            )
            .map((message: any) => Number(message?.uid))
            .filter((uid: number) => Number.isSafeInteger(uid) && uid > 0)
        )].sort((a, b) => a - b);

        if (exactMatches.length > 1) {
          throw new Error("Multiple mailbox messages share a selected Message-ID. No ambiguous mailbox deletion was attempted.");
        }
        if (!exactMatches.length) {
          mailboxMessagesNotFound += 1;
          continue;
        }

        uidsToDelete.add(exactMatches[0]);
        mailboxUidsReconciled += 1;
      }

      const verifiedUidsToDelete = [...uidsToDelete].sort((a, b) => a - b);
      if (verifiedUidsToDelete.length) {
        const deleteResult = await mailboxClient.messageDelete(verifiedUidsToDelete, { uid: true });
        if (deleteResult !== true) {
          throw new Error("The connected mailbox did not confirm the selected message deletion.");
        }
      }
    }

    // Remove the database mirrors only after the mailbox deletion succeeds.
    const dbDeleteResult = await serviceClient
      .from("email_messages")
      .delete()
      .in("id", messageIds)
      .eq("mailbox", MAILBOX)
      .select("id");

    if (dbDeleteResult.error) {
      throw dbDeleteResult.error;
    }

    const deletedIds = (dbDeleteResult.data || []).map((record: any) => String(record.id));
    const deletedSet = new Set(deletedIds);
    if (deletedIds.length !== messageIds.length ||
        messageIds.some((id) => !deletedSet.has(id))) {
      throw new Error("The mailbox was updated, but the dashboard could not verify every selected message record.");
    }

    const attachmentPaths = resolveEmailAttachmentStoragePaths(records);
    let attachmentsRemoved = 0;
    let attachmentCleanupWarning = false;
    if (attachmentPaths.length) {
      try {
        const attachmentRemoval = await serviceClient.storage
          .from("swayphics-email-attachments")
          .remove(attachmentPaths);
        if (attachmentRemoval.error) {
          attachmentCleanupWarning = true;
          console.error("Email rows were deleted, but private attachment cleanup failed:", attachmentRemoval.error);
        } else {
          attachmentsRemoved = attachmentPaths.length;
        }
      } catch (cleanupError) {
        attachmentCleanupWarning = true;
        console.error("Email rows were deleted, but private attachment cleanup failed:", cleanupError);
      }
    }

    return jsonResponse({
      success: true,
      deleted_ids: deletedIds,
      attachments_removed: attachmentsRemoved,
      attachment_cleanup_warning: attachmentCleanupWarning,
      mailbox_messages_removed: inboundRecords.length - mailboxMessagesNotFound,
      mailbox_messages_not_found: mailboxMessagesNotFound,
      mailbox_uids_reconciled: mailboxUidsReconciled,
      dashboard_records_removed: deletedIds.length,
    });
  } catch (error) {
    console.error("Swayphics selected email deletion failed:", error);
    return jsonResponse({ error: describeError(error) }, 500);
  } finally {
    try {
      mailboxLock?.release();
    } catch {
      // The mailbox may already have been closed after an IMAP error.
    }
    try {
      mailboxClient?.close();
    } catch {
      // The mailbox connection may already be closed.
    }
  }
});
