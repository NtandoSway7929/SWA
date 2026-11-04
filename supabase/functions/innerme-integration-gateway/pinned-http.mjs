import {
  sameOutboundAddress,
  validateOutboundAddressSet,
} from "./egress-policy.mjs";

export const MUNICIPAL_MONEY_ORIGIN = "https://municipaldata.treasury.gov.za";
export const MUNICIPAL_MONEY_HOST = "municipaldata.treasury.gov.za";
export const MUNICIPAL_MONEY_PORT = 443;
export const MAX_HTTP_HEADER_BYTES = 16 * 1024;
export const MAX_HTTP_HEADER_COUNT = 64;
export const MAX_HTTP_RESPONSE_BYTES = 512 * 1024;
export const HTTP_REQUEST_TIMEOUT_MS = 8_000;
const MAX_HTTP_WIRE_OVERHEAD = 64 * 1024;
const encoder = new TextEncoder();

export class PinnedHttpError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = "PinnedHttpError";
    this.code = code;
    this.status = status;
  }
}

function assertLimit(value, field, max) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new PinnedHttpError("invalid_transport_limit", field + " is outside its allowed range.", 500);
  }
}

function safeClose(connection) {
  try {
    connection?.close?.();
  } catch {
    // The peer/runtime may already have closed the connection.
  }
}

function validateRequestTarget(input) {
  if (typeof input !== "string" && !(input instanceof URL)) {
    throw new PinnedHttpError("invalid_provider_target", "Provider request target must be a URL or string.");
  }

  const raw = input instanceof URL ? input.href : input;
  if (raw.length > 4096 || /[\r\n\0]/.test(raw)) {
    throw new PinnedHttpError("invalid_provider_target", "Provider request target is malformed.");
  }

  let url;
  try {
    url = new URL(raw, MUNICIPAL_MONEY_ORIGIN);
  } catch {
    throw new PinnedHttpError("invalid_provider_target", "Provider request target is malformed.");
  }

  if (
    url.protocol !== "https:" ||
    url.origin !== MUNICIPAL_MONEY_ORIGIN ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new PinnedHttpError("destination_rejected", "Provider destination is not approved.");
  }

  const factsRoute = url.pathname === "/api/cubes/incexp_v2/facts";
  const memberMatch = url.pathname.match(
    /^\/api\/cubes\/incexp_v2\/members\/(demarcation|amount_type|item)$/,
  );
  if (!factsRoute && !memberMatch) {
    throw new PinnedHttpError("provider_path_rejected", "Provider path is not approved.");
  }

  const allowedKeys = factsRoute
    ? new Set(["cut", "page", "pagesize", "format"])
    : new Set(["page", "pagesize", "format"]);
  const params = new Map();

  for (const [key, value] of url.searchParams) {
    if (!allowedKeys.has(key) || params.has(key)) {
      throw new PinnedHttpError("provider_query_rejected", "Provider query parameters are not approved.");
    }
    params.set(key, value);
  }

  const requiredKeys = factsRoute
    ? ["cut", "page", "pagesize", "format"]
    : ["page", "pagesize", "format"];
  if (requiredKeys.some((key) => !params.has(key)) || params.size !== requiredKeys.length) {
    throw new PinnedHttpError("provider_query_rejected", "Provider query parameters are incomplete.");
  }

  const page = params.get("page");
  const pageSize = params.get("pagesize");
  const maxPageSize = factsRoute ? 100 : 1000;
  if (
    !/^[1-9][0-9]{0,3}$/.test(page) ||
    Number(page) > 1000 ||
    !/^[1-9][0-9]{0,3}$/.test(pageSize) ||
    Number(pageSize) > maxPageSize ||
    params.get("format") !== "json"
  ) {
    throw new PinnedHttpError("provider_query_rejected", "Provider pagination or format is not approved.");
  }

  if (factsRoute) {
    const cutPattern = /^demarcation\.code:"[A-Z0-9]{2,8}"\|financial_year_end\.year:20(?:2[0-9]|3[0-5])\|financial_period\.period:(?:[1-9]|1[0-2])\|amount_type\.code:"[A-Z0-9_-]{1,16}"(?:\|item\.code:"[0-9]{4}")?$/;
    if (!cutPattern.test(params.get("cut"))) {
      throw new PinnedHttpError("provider_query_rejected", "Provider cut expression is not approved.");
    }
  } else if (page !== "1" || pageSize !== "1000") {
    throw new PinnedHttpError("provider_query_rejected", "Provider member catalogue pagination is not approved.");
  }

  return url.pathname + url.search;
}

class SocketReader {
  constructor(connection, maxWireBytes) {
    this.connection = connection;
    this.maxWireBytes = maxWireBytes;
    this.totalWireBytes = 0;
    this.buffer = new Uint8Array(0);
    this.offset = 0;
    this.eof = false;
  }

  get available() {
    return this.buffer.length - this.offset;
  }

  async fill() {
    if (this.eof) return;

    const chunk = new Uint8Array(8192);
    let count;
    do {
      count = await this.connection.read(chunk);
    } while (count === 0);

    if (count === null) {
      this.eof = true;
      return;
    }

    if (!Number.isInteger(count) || count < 0 || count > chunk.length) {
      throw new PinnedHttpError("provider_transport_read_failed", "Provider connection returned an invalid read result.");
    }

    this.totalWireBytes += count;
    if (this.totalWireBytes > this.maxWireBytes) {
      throw new PinnedHttpError("provider_wire_limit_exceeded", "Provider response framing exceeded the transport limit.");
    }

    const remaining = this.buffer.subarray(this.offset);
    const next = new Uint8Array(remaining.length + count);
    next.set(remaining, 0);
    next.set(chunk.subarray(0, count), remaining.length);
    this.buffer = next;
    this.offset = 0;
  }

  async readLine(maxLineBytes) {
    while (true) {
      for (let index = this.offset; index < this.buffer.length; index += 1) {
        if (this.buffer[index] === 0x0a) {
          if (index === this.offset || this.buffer[index - 1] !== 0x0d) {
            throw new PinnedHttpError("provider_http_malformed", "Provider response contained an invalid line ending.");
          }

          const lineBytes = this.buffer.subarray(this.offset, index - 1);
          if (lineBytes.length > maxLineBytes) {
            throw new PinnedHttpError("provider_header_limit_exceeded", "Provider response line exceeded the header limit.");
          }
          for (const byte of lineBytes) {
            if (byte !== 0x09 && (byte < 0x20 || byte > 0x7e)) {
              throw new PinnedHttpError("provider_http_malformed", "Provider response contained invalid header characters.");
            }
          }

          this.offset = index + 1;
          return new TextDecoder("ascii").decode(lineBytes);
        }
      }

      if (this.available > maxLineBytes + 1) {
        throw new PinnedHttpError("provider_header_limit_exceeded", "Provider response line exceeded the header limit.");
      }
      if (this.eof) {
        throw new PinnedHttpError("provider_http_truncated", "Provider response ended before a complete line was received.");
      }
      await this.fill();
    }
  }

  async readExactly(length) {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.maxWireBytes) {
      throw new PinnedHttpError("provider_http_malformed", "Provider response declared an invalid byte length.");
    }

    while (this.available < length && !this.eof) {
      await this.fill();
    }
    if (this.available < length) {
      throw new PinnedHttpError("provider_http_truncated", "Provider response ended before the declared body was complete.");
    }

    const output = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return output;
  }

  async readToEof(maxBodyBytes) {
    const chunks = [];
    let total = 0;

    while (true) {
      if (this.available > 0) {
        const chunk = this.buffer.slice(this.offset);
        this.offset = this.buffer.length;
        total += chunk.byteLength;
        if (total > maxBodyBytes) {
          throw new PinnedHttpError("provider_response_too_large", "Provider response exceeded the size limit.");
        }
        chunks.push(chunk);
      }

      if (this.eof) break;
      await this.fill();
    }

    return concatenate(chunks, total);
  }
}

function concatenate(chunks, total) {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function parseHeaderLine(line) {
  if (line.length === 0 || /^[ \t]/.test(line)) {
    throw new PinnedHttpError("provider_http_malformed", "Provider response contained an invalid header line.");
  }
  const colon = line.indexOf(":");
  if (colon <= 0) {
    throw new PinnedHttpError("provider_http_malformed", "Provider response contained an invalid header line.");
  }

  const name = line.slice(0, colon);
  const value = line.slice(colon + 1).trim();
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\x00-\x08\x0a-\x1f\x7f]/.test(value)) {
    throw new PinnedHttpError("provider_http_malformed", "Provider response contained an invalid header value.");
  }
  return [name.toLowerCase(), value];
}

async function readChunkedBody(reader, maxBodyBytes) {
  const chunks = [];
  let total = 0;
  let trailerBytes = 0;
  let trailerCount = 0;

  while (true) {
    const line = await reader.readLine(128);
    const match = line.match(/^([0-9A-Fa-f]{1,12})$/);
    if (!match) {
      throw new PinnedHttpError("provider_http_malformed", "Provider returned an invalid chunk size.");
    }

    const chunkSize = Number.parseInt(match[1], 16);
    if (!Number.isSafeInteger(chunkSize) || total + chunkSize > maxBodyBytes) {
      throw new PinnedHttpError("provider_response_too_large", "Provider response exceeded the size limit.");
    }

    if (chunkSize === 0) {
      while (true) {
        const trailer = await reader.readLine(8192);
        trailerBytes += trailer.length + 2;
        if (trailerBytes > MAX_HTTP_HEADER_BYTES) {
          throw new PinnedHttpError("provider_header_limit_exceeded", "Provider response trailers exceeded the header limit.");
        }
        if (trailer === "") break;
        trailerCount += 1;
        if (trailerCount > MAX_HTTP_HEADER_COUNT) {
          throw new PinnedHttpError("provider_header_limit_exceeded", "Provider response contained too many trailers.");
        }
        const [name] = parseHeaderLine(trailer);
        if (["content-length", "transfer-encoding", "host"].includes(name)) {
          throw new PinnedHttpError("provider_http_malformed", "Provider response contained a prohibited trailer.");
        }
      }
      break;
    }

    const chunk = await reader.readExactly(chunkSize);
    const terminator = await reader.readExactly(2);
    if (terminator[0] !== 0x0d || terminator[1] !== 0x0a) {
      throw new PinnedHttpError("provider_http_malformed", "Provider response contained an invalid chunk terminator.");
    }
    chunks.push(chunk);
    total += chunkSize;
  }

  return concatenate(chunks, total);
}

export async function readBoundedHttp1Response(connection, options = {}) {
  const maxBodyBytes = options.maxBodyBytes ?? MAX_HTTP_RESPONSE_BYTES;
  const maxHeaderBytes = options.maxHeaderBytes ?? MAX_HTTP_HEADER_BYTES;
  assertLimit(maxBodyBytes, "maxBodyBytes", MAX_HTTP_RESPONSE_BYTES);
  assertLimit(maxHeaderBytes, "maxHeaderBytes", MAX_HTTP_HEADER_BYTES);

  const reader = new SocketReader(connection, maxBodyBytes + maxHeaderBytes + MAX_HTTP_WIRE_OVERHEAD);
  let headerBytes = 0;
  const statusLine = await reader.readLine(8192);
  headerBytes += statusLine.length + 2;

  const statusMatch = statusLine.match(/^HTTP\/1\.[01] ([1-5][0-9]{2})(?: ([\x20-\x7e]*))?$/);
  if (!statusMatch) {
    throw new PinnedHttpError("provider_http_malformed", "Provider returned an invalid HTTP status line.");
  }

  const status = Number(statusMatch[1]);
  if (status < 200 || status === 101) {
    throw new PinnedHttpError("provider_http_status_rejected", "Provider returned an unsupported informational status.");
  }

  const headers = Object.create(null);
  let headerCount = 0;
  while (true) {
    const line = await reader.readLine(8192);
    headerBytes += line.length + 2;
    if (headerBytes > maxHeaderBytes) {
      throw new PinnedHttpError("provider_header_limit_exceeded", "Provider response headers exceeded the size limit.");
    }
    if (line === "") break;
    headerCount += 1;
    if (headerCount > MAX_HTTP_HEADER_COUNT) {
      throw new PinnedHttpError("provider_header_limit_exceeded", "Provider response contained too many headers.");
    }
    const [name, value] = parseHeaderLine(line);
    if (Object.prototype.hasOwnProperty.call(headers, name)) {
      throw new PinnedHttpError("provider_http_malformed", "Provider response contained a duplicate header.");
    }
    headers[name] = value;
  }

  const transferEncoding = headers["transfer-encoding"]?.toLowerCase();
  const contentLength = headers["content-length"];
  if (transferEncoding && contentLength !== undefined) {
    throw new PinnedHttpError("provider_http_malformed", "Provider response combined transfer-encoding and content-length.");
  }
  if (transferEncoding && transferEncoding !== "chunked") {
    throw new PinnedHttpError("provider_http_malformed", "Provider response used an unsupported transfer encoding.");
  }
  if (headers["content-encoding"] && headers["content-encoding"].toLowerCase() !== "identity") {
    throw new PinnedHttpError("provider_content_encoding_rejected", "Compressed provider responses are not accepted.");
  }

  let body;
  if (status === 204 || status === 304) {
    if (transferEncoding || (contentLength !== undefined && contentLength !== "0")) {
      throw new PinnedHttpError("provider_http_malformed", "Provider returned body framing for a no-body response.");
    }
    body = new Uint8Array(0);
  } else if (transferEncoding === "chunked") {
    body = await readChunkedBody(reader, maxBodyBytes);
  } else if (contentLength !== undefined) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
      throw new PinnedHttpError("provider_http_malformed", "Provider returned an invalid content-length.");
    }
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length > maxBodyBytes) {
      throw new PinnedHttpError("provider_response_too_large", "Provider response exceeded the size limit.");
    }
    body = await reader.readExactly(length);
  } else {
    body = await reader.readToEof(maxBodyBytes);
  }

  if (reader.available > 0) {
    throw new PinnedHttpError("provider_http_malformed", "Provider response contained unexpected bytes after the body.");
  }

  return Object.freeze({
    status,
    statusText: statusMatch[2] ?? "",
    headers: Object.freeze({ ...headers }),
    body,
  });
}

function getDefaultRuntime() {
  const deno = globalThis.Deno;
  if (!deno) throw new PinnedHttpError("runtime_unavailable", "Pinned transport requires the Deno network runtime.", 500);

  return {
    resolveDns: (hostname, recordType, signal) =>
      deno.resolveDns(hostname, recordType, { signal }),
    connect: ({ hostname, port, signal }) =>
      deno.connect({ hostname, port, transport: "tcp", signal }),
    startTls: (connection, options) =>
      deno.startTls(connection, options),
  };
}

async function writeAll(connection, bytes) {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = await connection.write(bytes.subarray(offset));
    if (!Number.isInteger(written) || written < 1) {
      throw new PinnedHttpError("provider_transport_write_failed", "Provider connection could not accept the request.");
    }
    offset += written;
  }
}

export async function requestPinnedMunicipalMoney(target, options = {}) {
  const requestTarget = validateRequestTarget(target);
  const timeoutMs = options.timeoutMs ?? HTTP_REQUEST_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? MAX_HTTP_RESPONSE_BYTES;
  assertLimit(timeoutMs, "timeoutMs", 30_000);
  assertLimit(maxResponseBytes, "maxResponseBytes", MAX_HTTP_RESPONSE_BYTES);

  const runtime = options.runtime ?? getDefaultRuntime();
  const addressPolicy = options.addressPolicy ?? validateOutboundAddressSet;
  if (typeof addressPolicy !== "function") {
    throw new PinnedHttpError("runtime_unavailable", "Pinned transport address policy is incomplete.", 500);
  }
  for (const name of ["resolveDns", "connect", "startTls"]) {
    if (typeof runtime[name] !== "function") {
      throw new PinnedHttpError("runtime_unavailable", "Pinned transport runtime is incomplete.", 500);
    }
  }

  const controller = new AbortController();
  let activeConnection = null;
  let timedOut = false;
  let timer;

  const operation = async () => {
    const [ipv4, ipv6] = await Promise.all([
      runtime.resolveDns(MUNICIPAL_MONEY_HOST, "A", controller.signal),
      runtime.resolveDns(MUNICIPAL_MONEY_HOST, "AAAA", controller.signal),
    ]);

    if (!Array.isArray(ipv4) || !Array.isArray(ipv6)) {
      throw new PinnedHttpError("provider_dns_invalid", "Provider DNS returned invalid address records.");
    }

    const addresses = [...ipv4, ...ipv6];
    const decision = addressPolicy(addresses);
    if (!decision.allowed) {
      throw new PinnedHttpError("provider_address_rejected", "Provider DNS returned a prohibited destination address.");
    }

    const selectedAddress = addresses[0];
    const connectHostname = selectedAddress.includes(":")
      ? "[" + selectedAddress + "]"
      : selectedAddress;

    const tcp = await runtime.connect({
      hostname: connectHostname,
      port: MUNICIPAL_MONEY_PORT,
      signal: controller.signal,
    });
    activeConnection = tcp;

    if (
      tcp.remoteAddr?.transport !== "tcp" ||
      !sameOutboundAddress(selectedAddress, tcp.remoteAddr.hostname)
    ) {
      throw new PinnedHttpError("provider_peer_mismatch", "Connected peer did not match the validated DNS address.");
    }

    const tls = await runtime.startTls(tcp, {
      hostname: MUNICIPAL_MONEY_HOST,
      alpnProtocols: ["http/1.1"],
    });
    activeConnection = tls;

    const handshake = await tls.handshake();
    if (handshake?.alpnProtocol && handshake.alpnProtocol !== "http/1.1") {
      throw new PinnedHttpError("provider_alpn_rejected", "Provider negotiated an unsupported application protocol.");
    }

    const request = [
      "GET " + requestTarget + " HTTP/1.1",
      "Host: " + MUNICIPAL_MONEY_HOST,
      "Accept: application/json",
      "Accept-Encoding: identity",
      "User-Agent: InnerMe-ReadOnly-Integration/1.0",
      "Connection: close",
      "",
      "",
    ].join("\r\n");

    await writeAll(tls, encoder.encode(request));

    const response = await readBoundedHttp1Response(tls, {
      maxBodyBytes: maxResponseBytes,
    });

    if (response.status >= 300 && response.status < 400) {
      throw new PinnedHttpError(
        "provider_redirect_rejected",
        "Provider redirects are not accepted.",
      );
    }
    if (response.status !== 200) {
      throw new PinnedHttpError(
        "provider_http_status_rejected",
        "Provider returned an unexpected HTTP status.",
      );
    }

    return Object.freeze({
      ...response,
      connectedAddress: selectedAddress,
      tlsHostname: MUNICIPAL_MONEY_HOST,
      redirectFollowed: false,
    });
  };

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      safeClose(activeConnection);
      reject(new PinnedHttpError("provider_timeout", "Provider request timed out."));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([operation(), timeout]);
    if (timedOut) throw new PinnedHttpError("provider_timeout", "Provider request timed out.");
    return result;
  } finally {
    clearTimeout(timer);
    safeClose(activeConnection);
  }
}
