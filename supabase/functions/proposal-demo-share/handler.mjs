export const PROPOSAL_DEMO_BUCKET = "swayphics-proposal-demos";
export const SIGNED_FILE_URL_SECONDS = 60;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".wasm", "application/wasm"],
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(body, status, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function withHeaders(response, additions = {}) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(additions)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function cleanRelativePath(value, { decode = false } = {}) {
  const raw = String(value ?? "");
  if (!raw || raw.length > 1024 || raw.startsWith("/") || raw.includes("\\")) {
    throw new HttpError(400, "A safe relative asset path is required.");
  }

  const parts = raw.split("/").map((part) => {
    let decoded = part;
    if (decode) {
      try {
        decoded = decodeURIComponent(part);
      } catch {
        throw new HttpError(400, "The asset path is malformed.");
      }
    }

    if (
      !decoded || decoded === "." || decoded === ".." ||
      decoded.includes("/") || decoded.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(decoded)
    ) {
      throw new HttpError(400, "The asset path is not allowed.");
    }

    return decoded;
  });

  const normalized = parts.join("/");
  if (normalized.length > 512) {
    throw new HttpError(400, "The asset path is too long.");
  }
  return normalized;
}

function validateDraftInput(body) {
  const leadId = String(body?.lead_id ?? "").trim();
  const proposalId = String(body?.proposal_id ?? "").trim();
  const title = String(body?.title ?? "").trim();
  const assetKind = String(body?.asset_kind ?? "").trim();

  if (!UUID_PATTERN.test(leadId) || !UUID_PATTERN.test(proposalId)) {
    throw new HttpError(400, "A valid lead and proposal are required.");
  }
  if (!title || title.length > 160) {
    throw new HttpError(400, "The demo title must be between 1 and 160 characters.");
  }
  if (!["file", "static_site", "hybrid"].includes(assetKind)) {
    throw new HttpError(400, "Choose a supported demo asset type.");
  }

  const fileName = body?.file_name == null
    ? null
    : String(body.file_name).trim();
  const entryPath = body?.entry_path == null
    ? null
    : cleanRelativePath(body.entry_path);

  if (assetKind === "file" || assetKind === "hybrid") {
    if (
      !fileName || fileName.length > 180 ||
      fileName === "." || fileName === ".." ||
      /[\\/\u0000-\u001f\u007f]/.test(fileName)
    ) {
      throw new HttpError(400, "A safe demo file name is required.");
    }
  } else if (fileName !== null) {
    throw new HttpError(400, "This demo type cannot include a separate file.");
  }

  if (assetKind === "static_site" || assetKind === "hybrid") {
    if (!entryPath) {
      throw new HttpError(400, "A safe static-site entry path is required.");
    }
  } else if (entryPath !== null) {
    throw new HttpError(400, "A file-only demo cannot include a site entry path.");
  }

  return {
    lead_id: leadId,
    proposal_id: proposalId,
    title,
    asset_kind: assetKind,
    file_name: fileName,
    entry_path: entryPath,
  };
}

function versionHasTarget(version, targetType) {
  if (targetType === "file") {
    return ["file", "hybrid"].includes(version?.asset_kind) && Boolean(version?.file_name);
  }
  if (targetType === "static_site") {
    return ["static_site", "hybrid"].includes(version?.asset_kind) && Boolean(version?.entry_path);
  }
  return false;
}

function isShareActive(share, now) {
  const expiry = Date.parse(share?.expires_at ?? "");
  return Boolean(
    share &&
    !share.revoked_at &&
    Number.isFinite(expiry) &&
    now.getTime() < expiry
  );
}

function validateVersionRecord(version) {
  if (!version || !UUID_PATTERN.test(String(version.id ?? ""))) {
    throw new HttpError(404, "Demo version not found.");
  }
  const expectedPrefix = `proposal-demos/${version.id}/`;
  if (
    !UUID_PATTERN.test(String(version.lead_id ?? "")) ||
    !UUID_PATTERN.test(String(version.proposal_id ?? ""))
  ) {
    throw new HttpError(404, "Demo version not found.");
  }
  return expectedPrefix;
}

async function loadLinkedVersion(deps, versionId) {
  const version = await deps.findVersion(versionId);
  const prefix = validateVersionRecord(version);
  const proposal = await deps.findProposal(version.proposal_id);
  if (!proposal || proposal.lead_id !== version.lead_id) {
    throw new HttpError(404, "Demo version not found.");
  }
  return { version, prefix };
}

function shareBaseUrl(publicFunctionUrl, token) {
  let root;
  try {
    root = new URL(publicFunctionUrl);
  } catch {
    throw new HttpError(500, "The share route is not configured.");
  }
  if (root.protocol !== "https:" || root.username || root.password || root.search || root.hash) {
    throw new HttpError(500, "The share route is not configured.");
  }
  return `${root.toString().replace(/\/+$/, "")}/${token}/`;
}

function rewriteSiteHtml(html, baseUrl) {
  const safeBase = baseUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  let source = String(html)
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/(\b(?:src|href|poster)\s*=\s*["'])\/(?!\/)/gi, `$1${safeBase}`)
    .replace(/url\(\s*(["']?)\/(?!\/)/gi, `url($1${safeBase}`);

  const baseTag = `<base href="${safeBase}">`;
  if (/<head\b[^>]*>/i.test(source)) {
    source = source.replace(/<head\b[^>]*>/i, (head) => head + baseTag);
  } else {
    source = baseTag + source;
  }
  return source;
}

function staticSiteHeaders(contentType) {
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Content-Security-Policy": [
      "sandbox allow-scripts",
      "default-src 'self' data: blob:",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "media-src 'self' data: blob:",
      "connect-src 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "form-action 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

function extensionOf(path) {
  const leaf = path.slice(path.lastIndexOf("/") + 1);
  const dot = leaf.lastIndexOf(".");
  return dot < 0 ? "" : leaf.slice(dot).toLowerCase();
}

export function contentTypeForAsset(path) {
  return CONTENT_TYPES.get(extensionOf(path)) ?? "application/octet-stream";
}

export function createProposalDemoShareHandler(deps) {
  const now = deps.now ?? (() => new Date());

  async function requireAdmin(request) {
    const result = await deps.authenticateAdmin(request);
    if (!result?.ok || !result.userId) {
      throw new HttpError(result?.status === 403 ? 403 : 401, result?.message || "Admin authentication is required.");
    }
    return result.userId;
  }

  async function createVersion(body, createdBy) {
    const input = validateDraftInput(body);
    const proposal = await deps.findProposal(input.proposal_id);
    if (!proposal) {
      throw new HttpError(404, "Proposal not found.");
    }
    if (proposal.lead_id !== input.lead_id) {
      throw new HttpError(409, "The proposal does not belong to the selected lead.");
    }
    const version = await deps.insertDraftVersion({ ...input, created_by: createdBy });
    if (!version?.id || version.lead_id !== input.lead_id || version.proposal_id !== input.proposal_id) {
      throw new HttpError(409, "The linked demo version could not be created safely.");
    }
    return jsonResponse({
      version: {
        ...version,
        upload_prefix: `proposal-demos/${version.id}/`,
        upload_site_prefix: `proposal-demos/${version.id}/site/`,
        upload_file_path: version.file_name
          ? `proposal-demos/${version.id}/file/${version.file_name}`
          : null,
      },
    }, 201);
  }

  async function publishVersion(body) {
    const versionId = String(body?.demo_version_id ?? "").trim();
    if (!UUID_PATTERN.test(versionId)) {
      throw new HttpError(400, "A valid demo version is required.");
    }
    const { version, prefix } = await loadLinkedVersion(deps, versionId);
    if (version.status !== "draft") {
      throw new HttpError(409, "Only a draft demo version can be published.");
    }

    if (version.file_name) {
      const filePath = `${prefix}file/${version.file_name}`;
      if (!await deps.privateObjectExists(filePath)) {
        throw new HttpError(409, "Upload the demo file before publishing this version.");
      }
    }
    if (version.entry_path) {
      const entryPath = cleanRelativePath(version.entry_path);
      if (!await deps.privateObjectExists(`${prefix}site/${entryPath}`)) {
        throw new HttpError(409, "Upload the static-site entry file before publishing this version.");
      }
    }

    const published = await deps.publishDraftVersion(versionId);
    if (!published || published.status !== "published" || published.id !== versionId) {
      throw new HttpError(409, "The demo version was not published.");
    }
    return jsonResponse({ version: published }, 200);
  }

  async function createShare(body, createdBy) {
    const versionId = String(body?.demo_version_id ?? "").trim();
    const targetType = String(body?.target_type ?? "").trim();
    const expiresAt = String(body?.expires_at ?? "").trim();
    const expiryMs = Date.parse(expiresAt);
    if (!UUID_PATTERN.test(versionId)) {
      throw new HttpError(400, "A valid demo version is required.");
    }
    if (!["file", "static_site"].includes(targetType)) {
      throw new HttpError(400, "Choose a supported share target.");
    }
    if (!expiresAt || !Number.isFinite(expiryMs) || expiryMs <= now().getTime()) {
      throw new HttpError(400, "Choose an explicit expiry time in the future.");
    }

    const { version } = await loadLinkedVersion(deps, versionId);
    if (version.status !== "published" || !versionHasTarget(version, targetType)) {
      throw new HttpError(409, "This published version does not contain that share target.");
    }

    const token = await deps.createToken();
    if (!TOKEN_PATTERN.test(token)) {
      throw new HttpError(500, "A secure share token could not be created.");
    }
    const tokenHash = await deps.hashToken(token);
    const share = await deps.insertShare({
      demo_version_id: versionId,
      target_type: targetType,
      token_hash: tokenHash,
      expires_at: new Date(expiryMs).toISOString(),
      created_by: createdBy,
    });
    if (!share?.id || share.demo_version_id !== versionId || share.target_type !== targetType) {
      throw new HttpError(409, "The scoped share could not be created safely.");
    }

    return jsonResponse({
      share: {
        id: share.id,
        demo_version_id: versionId,
        target_type: targetType,
        expires_at: share.expires_at,
        share_url: shareBaseUrl(deps.publicFunctionUrl, token),
      },
    }, 201);
  }

  async function revokeShare(body, revokedBy) {
    const shareId = String(body?.share_id ?? "").trim();
    const versionId = String(body?.demo_version_id ?? "").trim();
    if (!UUID_PATTERN.test(shareId) || !UUID_PATTERN.test(versionId)) {
      throw new HttpError(400, "A valid share and demo version are required.");
    }
    const share = await deps.findShare(shareId);
    if (!share || share.demo_version_id !== versionId) {
      throw new HttpError(404, "Share link not found for this demo version.");
    }
    if (share.revoked_at) {
      return jsonResponse({ ok: true, revoked_at: share.revoked_at }, 200);
    }
    const revoked = await deps.revokeShare(shareId, revokedBy, now().toISOString());
    if (!revoked?.revoked_at || revoked.id !== shareId) {
      throw new HttpError(409, "The share link could not be revoked.");
    }
    return jsonResponse({ ok: true, revoked_at: revoked.revoked_at }, 200);
  }

  async function serveShare(request) {
    const url = new URL(request.url);
    const match = url.pathname.match(/\/functions\/v1\/proposal-demo-share\/([^/]+)(?:\/(.*))?\/?$/);
    const token = match?.[1] ?? "";
    if (!TOKEN_PATTERN.test(token)) {
      throw new HttpError(404, "Share link not found.");
    }

    const hash = await deps.hashToken(token);
    const share = await deps.findShareByTokenHash(hash);
    if (!isShareActive(share, now())) {
      throw new HttpError(404, "Share link not found.");
    }

    const { version, prefix } = await loadLinkedVersion(deps, share.demo_version_id);
    if (
      version.status !== "published" ||
      !versionHasTarget(version, share.target_type)
    ) {
      throw new HttpError(404, "Share link not found.");
    }

    const remainingPath = match?.[2] ?? "";
    if (share.target_type === "file") {
      if (remainingPath) {
        throw new HttpError(404, "Share link not found.");
      }
      const path = `${prefix}file/${version.file_name}`;
      const signedUrl = await deps.createSignedFileUrl(
        PROPOSAL_DEMO_BUCKET,
        path,
        SIGNED_FILE_URL_SECONDS,
      );
      if (!signedUrl) {
        throw new HttpError(503, "The private demo file could not be prepared.");
      }
      return new Response(null, {
        status: 302,
        headers: {
          "Cache-Control": "no-store",
          "Location": signedUrl,
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const requestedPath = remainingPath.endsWith("/")
      ? `${remainingPath}index.html`
      : remainingPath;
    const relativePath = requestedPath
      ? cleanRelativePath(requestedPath, { decode: true })
      : cleanRelativePath(version.entry_path);
    const objectPath = `${prefix}site/${relativePath}`;
    const file = await deps.downloadPrivateObject(PROPOSAL_DEMO_BUCKET, objectPath);
    if (!file?.data) {
      throw new HttpError(404, "Demo page not found.");
    }

    const extension = extensionOf(relativePath);
    const contentType = contentTypeForAsset(relativePath);
    let data = file.data;
    if (extension === ".html" || extension === ".htm") {
      const html = typeof data === "string"
        ? data
        : new TextDecoder().decode(data instanceof Blob ? await data.arrayBuffer() : data);
      const baseUrl = shareBaseUrl(deps.publicFunctionUrl, token);
      data = rewriteSiteHtml(html, baseUrl);
    } else if (data instanceof Blob) {
      data = await data.arrayBuffer();
    }

    return new Response(data, {
      status: 200,
      headers: {
        ...staticSiteHeaders(contentType),
        ...(file.cacheControl ? { "Cache-Control": "no-store" } : {}),
      },
    });
  }

  return async function handle(request) {
    const requestHeaders = deps.corsHeaders?.(request) ?? {};
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: requestHeaders });
    }

    try {
      if (request.method === "GET") {
        return await serveShare(request);
      }
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed." }, 405, requestHeaders);
      }

      const userId = await requireAdmin(request);
      const text = await request.text();
      if (text.length > 20_000) {
        throw new HttpError(413, "The request is too large.");
      }
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new HttpError(400, "A valid JSON request is required.");
      }

      switch (String(body?.action ?? "")) {
        case "create_version":
          return withHeaders(await createVersion(body, userId), requestHeaders);
        case "publish_version":
          return withHeaders(await publishVersion(body), requestHeaders);
        case "create_share":
          return withHeaders(await createShare(body, userId), requestHeaders);
        case "revoke_share":
          return withHeaders(await revokeShare(body, userId), requestHeaders);
        default:
          throw new HttpError(400, "Choose a supported demo action.");
      }
    } catch (error) {
      const status = Number(error?.status) || 500;
      const message = status >= 500
        ? "The demo-sharing request could not be completed."
        : String(error?.message || "The request could not be completed.");
      return jsonResponse({ error: message, message }, status, requestHeaders);
    }
  };
}
