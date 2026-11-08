import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const ALLOWED_ORIGIN = "https://swayphics.co.za";
const BUCKET = "swayphics-client-files";
const SIGNED_URL_TTL_SECONDS = 300;
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Disposition, Content-Type",
  "Vary": "Origin"
};

const BRAND = rgb(0 / 255, 32 / 255, 150 / 255);
const DARK = rgb(8 / 255, 21 / 255, 51 / 255);
const MUTED = rgb(86 / 255, 98 / 255, 122 / 255);
const LIGHT = rgb(247 / 255, 250 / 255, 255 / 255);
const BORDER = rgb(224 / 255, 230 / 255, 240 / 255);

interface InvoiceRequest {
  invoice_id?: string;
  action?: "pdf" | "send";
}

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

function money(value: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function shortDate(value: string | null | undefined) {
  if (!value) return "—";

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function wrapText(
  text: string,
  font: any,
  size: number,
  maxWidth: number,
) {
  const words = String(text || "").split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current
      ? current + " " + word
      : word;

    if (
      font.widthOfTextAtSize(
        candidate,
        size,
      ) <= maxWidth
    ) {
      current = candidate;
    } else if (current) {
      lines.push(current);
      current = word;
    } else {
      lines.push(word);
      current = "";
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [""];
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;

  for (
    let index = 0;
    index < bytes.length;
    index += chunkSize
  ) {
    binary += String.fromCharCode(
      ...bytes.subarray(
        index,
        Math.min(
          index + chunkSize,
          bytes.length,
        ),
      ),
    );
  }

  return btoa(binary);
}

async function loadLogo() {
  try {
    const response = await fetch(
      "https://swayphics.co.za/swayphics-logo.png",
    );

    if (!response.ok) {
      return null;
    }

    return new Uint8Array(
      await response.arrayBuffer(),
    );
  } catch {
    return null;
  }
}


async function buildPdf(
  invoice: any,
  items: LineItem[],
  settings: any,
) {
  const pdfDoc = await PDFDocument.create();

  const regular =
    await pdfDoc.embedFont(
      StandardFonts.Helvetica,
    );

  const bold =
    await pdfDoc.embedFont(
      StandardFonts.HelveticaBold,
    );

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 42;

  const logoBytes = await loadLogo();

  let logo: any = null;

  if (logoBytes) {
    try {
      logo =
        await pdfDoc.embedPng(
          logoBytes,
        );
    } catch {
      logo = null;
    }
  }

  function drawWatermark(targetPage: any) {
    if (!logo) return;

    const maxWatermarkSize = 260;
    const watermarkScale = Math.min(
      maxWatermarkSize / logo.width,
      maxWatermarkSize / logo.height,
    );

    const watermarkWidth =
      logo.width * watermarkScale;

    const watermarkHeight =
      logo.height * watermarkScale;

    targetPage.drawImage(logo, {
      x:
        (pageWidth - watermarkWidth) / 2,
      y:
        (pageHeight - watermarkHeight) / 2,
      width: watermarkWidth,
      height: watermarkHeight,
      opacity: 0.075,
    });
  }

  let page = pdfDoc.addPage([
    pageWidth,
    pageHeight,
  ]);

  drawWatermark(page);

  let y = pageHeight - margin;

  if (logo) {
    const maxWidth = 145;
    const maxHeight = 55;
    const scale = Math.min(
      maxWidth / logo.width,
      maxHeight / logo.height,
    );

    page.drawImage(logo, {
      x: margin,
      y:
        y -
        logo.height *
          scale,
      width:
        logo.width *
        scale,
      height:
        logo.height *
        scale,
    });

    y -=
      logo.height *
        scale +
      24;
  } else {
    page.drawText(

      settings.business_name ||
        "SWAYPHICS",
      {
        x: margin,
        y,
        size: 24,
        font: bold,
        color: BRAND,
      },
    );

    y -= 34;
  }

  page.drawText(
    "INVOICE",
    {
      x:
        pageWidth -
        margin -
        bold.widthOfTextAtSize(
          "INVOICE",
          22,
        ),
      y:
        pageHeight -
        margin -
        8,
      size: 22,
      font: bold,
      color: BRAND,
    },
  );

  y -= 36;

  page.drawLine({
    start: {
      x: margin,
      y,
    },
    end: {
      x: pageWidth - margin,
      y,
    },
    thickness: 1.2,
    color: BORDER,
  });

  y -= 24;

  const rightX = 390;

  page.drawText(
    invoice.invoice_number,
    {
      x: rightX,
      y,
      size: 10,
      font: bold,
      color: DARK,
    },
  );

  page.drawText(
    "Issue date",
    {
      x: rightX,
      y: y - 18,
      size: 7.5,
      font: regular,
      color: MUTED,
    },
  );

  page.drawText(
    shortDate(invoice.issue_date),
    {
      x: rightX + 70,
      y: y - 18,
      size: 7.5,
      font: bold,
      color: DARK,
    },
  );

  page.drawText(
    "Due date",
    {
      x: rightX,
      y: y - 34,
      size: 7.5,
      font: regular,
      color: MUTED,
    },
  );

  page.drawText(
    shortDate(invoice.due_date),
    {
      x: rightX + 70,
      y: y - 34,
      size: 7.5,
      font: bold,
      color: DARK,
    },
  );

  page.drawText(
    "BILL TO",
    {
      x: margin,
      y,
      size: 7,
      font: bold,
      color: BRAND,
    },
  );

  page.drawText(
    invoice.client?.business_name ||
      "Client",
    {
      x: margin,
      y: y - 18,
      size: 13,
      font: bold,
      color: DARK,
    },
  );

  let clientY = y - 34;

  if (invoice.client?.contact_name) {
    page.drawText(
      invoice.client.contact_name,
      {
        x: margin,
        y: clientY,
        size: 8,
        font: regular,
        color: MUTED,
      },
    );

    clientY -= 13;
  }

  if (invoice.client?.email) {
    page.drawText(
      invoice.client.email,
      {
        x: margin,
        y: clientY,
        size: 8,
        font: regular,
        color: MUTED,
      },
    );
  }

  y -= 88;

  const tableTop = y;
  const colDescription = margin;
  const colQty = 390;
  const colPrice = 450;
  const colTotal = 515;

  page.drawRectangle({
    x: margin,
    y: tableTop - 21,
    width:
      pageWidth -
      margin * 2,
    height: 21,
    color: BRAND,
  });

  page.drawText(
    "DESCRIPTION",
    {
      x: colDescription + 8,
      y: tableTop - 14,
      size: 7,
      font: bold,
      color: rgb(1, 1, 1),
    },
  );

  page.drawText(
    "QTY",
    {
      x: colQty,
      y: tableTop - 14,
      size: 7,
      font: bold,
      color: rgb(1, 1, 1),
    },
  );

  page.drawText(
    "PRICE",
    {
      x: colPrice,
      y: tableTop - 14,
      size: 7,
      font: bold,
      color: rgb(1, 1, 1),
    },
  );

  page.drawText(
    "TOTAL",
    {
      x: colTotal,
      y: tableTop - 14,
      size: 7,
      font: bold,
      color: rgb(1, 1, 1),
    },
  );

  y = tableTop - 36;

  for (const item of items) {
    const descriptionLines =
      wrapText(
        item.description,
        regular,
        8,
        320,
      );

    const rowHeight = Math.max(
      30,
      descriptionLines.length *
        11 +
        13,
    );

    if (y - rowHeight < 150) {
      page = pdfDoc.addPage([
        pageWidth,
        pageHeight,
      ]);

      drawWatermark(page);

      y = pageHeight - margin;

      page.drawText(
        invoice.invoice_number,
        {
          x: margin,
          y,
          size: 9,
          font: bold,
          color: BRAND,
        },
      );

      y -= 30;
    }

    if (
      Math.round(
        (tableTop - y) /
          30,
      ) %
        2 ===
      0
    ) {
      page.drawRectangle({
        x: margin,
        y:
          y -
          rowHeight +
          5,
        width:
          pageWidth -
          margin * 2,
        height: rowHeight,
        color: LIGHT,
      });
    }

    descriptionLines.forEach(
      (line, index) => {
        page.drawText(line, {
          x: colDescription + 8,
          y:
            y -
            index * 11,
          size: 8,
          font: regular,
          color: DARK,
        });
      },
    );

    page.drawText(
      String(item.quantity),
      {
        x: colQty,
        y:
          y -
          2,
        size: 8,
        font: regular,
        color: DARK,
      },
    );

    page.drawText(
      money(item.unit_price),
      {
        x: colPrice,
        y:
          y -
          2,
        size: 8,
        font: regular,
        color: DARK,
      },
    );

    page.drawText(
      money(item.line_total),
      {
        x: colTotal,
        y:
          y -
          2,
        size: 8,
        font: bold,
        color: DARK,
      },
    );

    page.drawLine({
      start: {
        x: margin,
        y:
          y -
          rowHeight +
          2,
      },
      end: {
        x:
          pageWidth -
          margin,
        y:
          y -
          rowHeight +
          2,
      },
      thickness: 0.5,
      color: BORDER,
    });

    y -= rowHeight;
  }

  y -= 22;

  const summaryX = 380;
  const valueX = 515;
  const totalRightX = pageWidth - margin - 12;

  page.drawText(
    "Subtotal",
    {
      x: summaryX,
      y,
      size: 8,
      font: regular,
      color: MUTED,
    },
  );

  page.drawText(
    money(invoice.subtotal),
    {
      x: valueX,
      y,
      size: 8,
      font: bold,
      color: DARK,
    },
  );

  if (Number(invoice.discount || 0) > 0) {
    y -= 17;

    page.drawText(
      "Discount",
      {
        x: summaryX,
        y,
        size: 8,
        font: regular,
        color: MUTED,
      },
    );

    page.drawText(
      "-" +
        money(invoice.discount),
      {
        x: valueX,
        y,
        size: 8,
        font: bold,
        color: DARK,
      },
    );
  }

  if (Number(invoice.vat_amount || 0) > 0) {
    y -= 17;

    page.drawText(
      "VAT (" +
        Number(invoice.vat_rate || 0) +
        "%)",
      {
        x: summaryX,
        y,
        size: 8,
        font: regular,
        color: MUTED,
      },
    );

    page.drawText(
      money(invoice.vat_amount),
      {
        x: valueX,
        y,
        size: 8,
        font: bold,
        color: DARK,
      },
    );
  }

  y -= 40;

  const totalBoxX = summaryX - 12;
  const totalBoxWidth =
    pageWidth -
    margin -
    totalBoxX;
  const totalBoxY = y - 10;
  const totalBoxHeight = 34;

  page.drawRectangle({
    x: totalBoxX,
    y: totalBoxY,
    width: totalBoxWidth,
    height: totalBoxHeight,
    color: BRAND,
  });

  page.drawText(
    "TOTAL",
    {
      x: summaryX,
      y: y + 1,
      size: 9,
      font: bold,
      color: rgb(1, 1, 1),
    },
  );

  const totalAmount =
    money(invoice.total);

  page.drawText(
    totalAmount,
    {
      x:
        totalRightX -
        bold.widthOfTextAtSize(
          totalAmount,
          10,
        ),
      y: y + 1,
      size: 10,
      font: bold,
      color: rgb(1, 1, 1),
    },
  );

  y -= 62;

  const notes =
    invoice.notes ||
    "Thank you for choosing Swayphics.";

  page.drawText(
    "NOTES",
    {
      x: margin,
      y,
      size: 7,
      font: bold,
      color: BRAND,
    },
  );

  y -= 15;

  for (const line of wrapText(
    notes,
    regular,
    8,
    480,
  )) {
    page.drawText(line, {
      x: margin,
      y,
      size: 8,
      font: regular,
      color: MUTED,
    });

    y -= 11;
  }

  if (
    settings.payment_instructions ||
    settings.bank_name ||
    settings.account_number
  ) {
    y -= 12;

    page.drawText(
      "PAYMENT DETAILS",
      {
        x: margin,
        y,
        size: 7,
        font: bold,
        color: BRAND,
      },
    );

    y -= 15;

    const paymentLines = [
      settings.bank_name
        ? "Bank: " +
          settings.bank_name
        : "",
      settings.account_name
        ? "Account holder: " +
          settings.account_name
        : "",
      settings.account_type
        ? "Account type: " +
          settings.account_type
        : "",
      settings.branch_code
        ? "Branch code: " +
          settings.branch_code
        : "",
      settings.swift_bic
        ? "SWIFT / BIC: " +
          settings.swift_bic
        : "",
      settings.payment_instructions ||
        "",
    ].filter(Boolean);

    for (const line of paymentLines) {
      for (const wrapped of wrapText(
        line,
        regular,
        8,
        480,
      )) {
        page.drawText(wrapped, {
          x: margin,
          y,
          size: 8,
          font: regular,
          color: MUTED,
        });

        y -= 11;
      }
    }

    if (settings.account_number) {
      y -= 6;

      page.drawText("ACCOUNT NUMBER", {
        x: margin,
        y,
        size: 7,
        font: bold,
        color: BRAND,
      });

      y -= 16;

      page.drawRectangle({
        x: margin,
        y: y - 8,
        width: 220,
        height: 24,
        color: rgb(0.97, 0.98, 1),
        borderColor: BORDER,
        borderWidth: 0.7,
      });

      page.drawText(String(settings.account_number), {
        x: margin + 10,
        y: y - 1,
        size: 10,
        font: bold,
        color: DARK,
      });

      y -= 30;
    }
  }

  const footerY = 28;

  page.drawLine({
    start: {
      x: margin,
      y: footerY + 18,
    },
    end: {
      x: pageWidth - margin,
      y: footerY + 18,
    },
    thickness: 0.6,
    color: BORDER,
  });

  page.drawText(
    settings.business_name ||
      "Swayphics",
    {
      x: margin,
      y: footerY,
      size: 7,
      font: bold,
      color: BRAND,
    },
  );

  const footerRight =
    settings.email ||
    "info@swayphics.co.za";

  page.drawText(
    footerRight,
    {
      x:
        pageWidth -
        margin -
        regular.widthOfTextAtSize(
          footerRight,
          7,
        ),
      y: footerY,
      size: 7,
      font: regular,
      color: MUTED,
    },
  );

  return await pdfDoc.save();
}



function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isClientOwnedStoragePath(storagePath: unknown, clientId: string) {
  if (typeof storagePath !== "string" || !storagePath || storagePath.includes(String.fromCharCode(92)) || storagePath.includes(String.fromCharCode(0))) return false;
  const parts = storagePath.split("/");
  return parts.length === 2 &&
    parts[0] === clientId &&
    !!parts[1] &&
    parts[1] !== "." &&
    parts[1] !== ".." &&
    !parts[1].includes("..");
}

function isInvoiceAvailableToClient(status: unknown) {
  return ["sent", "partially paid", "paid", "overdue"].includes(String(status || "").toLowerCase());
}

function documentCategory(mimeType: unknown, fileName: unknown) {
  const mime = String(mimeType || "").toLowerCase();
  const name = String(fileName || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  return "other";
}

function safeDownloadName(value: unknown, fallback = "document") {
  const name = String(value || fallback)
    .replaceAll(String.fromCharCode(13), "")
    .replaceAll(String.fromCharCode(10), "")
    .replaceAll(String.fromCharCode(0), "")
    .replaceAll('"', "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .trim()
    .slice(0, 140);
  return name && name !== "." && name !== ".." ? name : fallback;
}

async function createAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) throw new Error("Server configuration is unavailable.");
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
}

async function resolvePortalToken(admin: any, rawToken: string) {
  if (rawToken.length < 32 || rawToken.length > 512) return null;
  const tokenHash = await sha256Hex(rawToken);
  const { data, error } = await admin
    .from("client_portal_tokens")
    .select("id,client_id,active,expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data || data.active !== true) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null;
  await admin.from("client_portal_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);
  return data;
}

async function listClientDocuments(admin: any, clientId: string) {
  const { data: rows, error } = await admin
    .from("client_documents")
    .select("id,client_id,project_id,file_name,storage_path,mime_type,size_bytes,created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("The document list could not be loaded.");

  const safeRows = (rows || []).filter((row: any) =>
    row.client_id === clientId && isClientOwnedStoragePath(row.storage_path, clientId)
  );
  const { data: projects, error: projectError } = await admin
    .from("client_projects")
    .select("id,name")
    .eq("client_id", clientId);
  if (projectError) throw new Error("Project labels could not be loaded.");

  const projectNames = new Map((projects || []).map((project: any) => [String(project.id), String(project.name || "Project")]));
  return safeRows.map((row: any) => ({
    id: row.id,
    file_name: row.file_name,
    mime_type: row.mime_type || "application/octet-stream",
    size_bytes: Number(row.size_bytes || 0),
    created_at: row.created_at,
    project_name: row.project_id ? (projectNames.get(String(row.project_id)) || "Project file") : "General files",
    category: documentCategory(row.mime_type, row.file_name)
  }));
}

async function createClientDocumentUrl(
  admin: any,
  clientId: string,
  documentId: string,
  download: boolean
) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId)) {
    return { ok: false, status: 404, error: "Document not found." };
  }

  const { data: row, error } = await admin
    .from("client_documents")
    .select("id,client_id,file_name,storage_path,mime_type")
    .eq("id", documentId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (error || !row || row.client_id !== clientId || !isClientOwnedStoragePath(row.storage_path, clientId)) {
    return { ok: false, status: 404, error: "Document not found." };
  }

  const { data, error: signingError } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS, download ? { download: true } : {});

  if (signingError || !data?.signedUrl) {
    return { ok: false, status: 404, error: "This file is not currently available." };
  }

  return {
    ok: true,
    signed_url: data.signedUrl,
    expires_in: SIGNED_URL_TTL_SECONDS,
    file_name: row.file_name,
    mime_type: row.mime_type || "application/octet-stream"
  };
}

async function createClientInvoicePdf(admin: any, clientId: string, invoiceId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId)) {
    return json({ ok: false, error: "Invoice not found." }, 404);
  }

  const { data: invoice, error: invoiceError } = await admin
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (invoiceError || !invoice || invoice.client_id !== clientId || !isInvoiceAvailableToClient(invoice.status)) {
    return json({ ok: false, error: "Invoice not found." }, 404);
  }

  const [clientResult, itemsResult, settingsResult] = await Promise.all([
    admin.from("clients").select("id,business_name,contact_name,email,phone").eq("id", clientId).maybeSingle(),
    admin.from("invoice_items").select("description,quantity,unit_price,line_total")
      .eq("invoice_id", invoiceId).order("created_at", { ascending: true }),
    admin.from("invoice_settings").select("*").eq("id", 1).single()
  ]);

  if (clientResult.error || !clientResult.data || itemsResult.error || settingsResult.error || !settingsResult.data) {
    return json({ ok: false, error: "The invoice PDF could not be prepared." }, 500);
  }
  if (!itemsResult.data?.length) {
    return json({ ok: false, error: "This invoice does not have any line items to display." }, 409);
  }

  invoice.client = clientResult.data;
  const lineItems: LineItem[] = itemsResult.data.map((item: any) => ({
    description: String(item.description || ""),
    quantity: Number(item.quantity || 0),
    unit_price: Number(item.unit_price || 0),
    line_total: Number(item.line_total || 0)
  }));
  const pdfBytes = await buildPdf(invoice, lineItems, settingsResult.data);
  const filename = safeDownloadName(String(invoice.invoice_number || "invoice") + ".pdf", "invoice.pdf");

  const pdfBody = new ArrayBuffer(pdfBytes.byteLength);
  new Uint8Array(pdfBody).set(pdfBytes);
  return new Response(pdfBody, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="' + filename + '"',
      "Content-Length": String(pdfBytes.byteLength),
      "Cache-Control": "private, no-store, max-age=0"
    }
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  try {
    const origin = req.headers.get("origin");
    if (origin && origin !== ALLOWED_ORIGIN) return json({ ok: false, error: "Origin not allowed." }, 403);

    const body = await req.json().catch(() => null);
    const action = String(body?.action || "list");
    const token = String(body?.token || "").trim();
    if (!token) return json({ ok: false, error: "Private portal token required." }, 400);

    const admin = await createAdminClient();
    const portalToken = await resolvePortalToken(admin, token);
    if (!portalToken) return json({ ok: false, error: "This portal link is invalid or has expired." }, 403);

    if (action === "list") {
      const documents = await listClientDocuments(admin, String(portalToken.client_id));
      return json({ ok: true, documents, count: documents.length });
    }

    if (action === "preview" || action === "download") {
      const result = await createClientDocumentUrl(
        admin,
        String(portalToken.client_id),
        String(body?.document_id || ""),
        action === "download"
      );
      return result.ok ? json(result) : json(result, result.status);
    }

    if (action === "invoice-pdf") {
      return await createClientInvoicePdf(admin, String(portalToken.client_id), String(body?.invoice_id || ""));
    }

    return json({ ok: false, error: "Unsupported document action." }, 400);
  } catch (error) {
    console.error("Client portal document request failed:", error instanceof Error ? error.message : "Unknown error.");
    return json({ ok: false, error: "The document service is temporarily unavailable." }, 500);
  }
});
