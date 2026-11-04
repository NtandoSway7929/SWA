import assert from "node:assert/strict";
import test from "node:test";

import {
  MUNICIPAL_MONEY_HOST,
  MUNICIPAL_MONEY_PORT,
  PinnedHttpError,
  readBoundedHttp1Response,
  requestPinnedMunicipalMoney,
} from "./pinned-http.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const FACTS_URL =
  "https://municipaldata.treasury.gov.za/api/cubes/incexp_v2/facts" +
  "?cut=demarcation.code%3A%22JHB%22%7Cfinancial_year_end.year%3A2026" +
  "%7Cfinancial_period.period%3A3%7Camount_type.code%3A%22ACT%22" +
  "&page=1&pagesize=25&format=json";

class FakeConnection {
  constructor(response, options = {}) {
    this.remoteAddr = {
      transport: "tcp",
      hostname: options.peerAddress ?? "8.8.8.8",
      port: 443,
    };
    this.chunks = response === null ? [] : chunkBytes(response, options.readChunkSize ?? 7);
    this.writes = [];
    this.closed = false;
    this.handshakeCalls = 0;
    this.hangOnRead = options.hangOnRead ?? false;
    this.pendingRead = null;
    this.maxWriteSize = options.maxWriteSize ?? 13;
  }

  async read(buffer) {
    if (this.hangOnRead && this.chunks.length === 0 && !this.closed) {
      return await new Promise((resolve) => {
        this.pendingRead = () => resolve(null);
      });
    }

    if (this.chunks.length === 0) return null;
    const next = this.chunks.shift();
    const length = Math.min(buffer.length, next.length);
    buffer.set(next.subarray(0, length));
    if (length < next.length) this.chunks.unshift(next.subarray(length));
    return length;
  }

  async write(bytes) {
    const length = Math.min(bytes.length, this.maxWriteSize);
    this.writes.push(bytes.slice(0, length));
    return length;
  }

  async handshake() {
    this.handshakeCalls += 1;
    return { alpnProtocol: "http/1.1" };
  }

  close() {
    this.closed = true;
    this.pendingRead?.();
  }

  writtenText() {
    return decoder.decode(concat(this.writes));
  }
}

function chunkBytes(value, chunkSize) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(bytes.slice(offset, offset + chunkSize));
  }
  return chunks;
}

function concat(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function response(status = 200, headers = {}, body = "{\"ok\":true}") {
  const bodyBytes = encoder.encode(body);
  const headerLines = Object.entries({
    "Content-Type": "application/json",
    "Content-Length": String(bodyBytes.length),
    Connection: "close",
    ...headers,
  }).map(([name, value]) => name + ": " + value);
  return concat([
    encoder.encode(
      "HTTP/1.1 " + status + " " + (status === 200 ? "OK" : "Test") +
      "\r\n" + headerLines.join("\r\n") + "\r\n\r\n",
    ),
    bodyBytes,
  ]);
}

function makeRuntime(rawResponse, options = {}) {
  const addresses = options.addresses ?? {
    A: ["8.8.8.8"],
    AAAA: ["2001:4860:4860::8888"],
  };
  const peerAddress = options.peerAddress ?? "8.8.8.8";
  const tls = new FakeConnection(rawResponse, {
    peerAddress,
    readChunkSize: options.readChunkSize ?? 7,
    hangOnRead: options.hangOnRead,
  });
  const tcp = {
    remoteAddr: { transport: "tcp", hostname: peerAddress, port: 443 },
    closed: false,
    close() { this.closed = true; },
  };
  const calls = {
    dns: [],
    connect: [],
    tls: [],
    tcp,
    connection: tls,
  };

  const runtime = {
    async resolveDns(hostname, type, signal) {
      calls.dns.push({ hostname, type, aborted: signal?.aborted ?? false });
      return addresses[type] ?? [];
    },
    async connect(args) {
      calls.connect.push(args);
      return tcp;
    },
    async startTls(connection, tlsOptions) {
      calls.tls.push({ sameTcp: connection === tcp, options: tlsOptions });
      return tls;
    },
  };
  return { runtime, calls, tls };
}

test("pins a validated address, checks the peer and sends a fixed HTTP/1.1 GET", async () => {
  const raw = response();
  const { runtime, calls, tls } = makeRuntime(raw);
  const result = await requestPinnedMunicipalMoney(FACTS_URL, { runtime });

  assert.equal(result.status, 200);
  assert.equal(decoder.decode(result.body), "{\"ok\":true}");
  assert.equal(result.connectedAddress, "8.8.8.8");
  assert.equal(result.tlsHostname, MUNICIPAL_MONEY_HOST);
  assert.equal(result.redirectFollowed, false);
  assert.deepEqual(calls.dns.map((call) => call.type).sort(), ["A", "AAAA"]);
  assert.equal(calls.dns.every((call) => call.hostname === MUNICIPAL_MONEY_HOST), true);
  assert.equal(calls.connect.length, 1);
  assert.equal(calls.connect[0].hostname, "8.8.8.8");
  assert.equal(calls.connect[0].port, MUNICIPAL_MONEY_PORT);
  assert.equal(calls.tls[0].sameTcp, true);
  assert.equal(calls.tls[0].options.hostname, MUNICIPAL_MONEY_HOST);
  assert.deepEqual(calls.tls[0].options.alpnProtocols, ["http/1.1"]);
  assert.equal(tls.handshakeCalls, 1);
  assert.match(tls.writtenText(), /^GET \/api\/cubes\/incexp_v2\/facts\?/);
  assert.match(tls.writtenText(), /Host: municipaldata\.treasury\.gov\.za\r\n/);
  assert.match(tls.writtenText(), /Accept-Encoding: identity\r\n/);
  assert.match(tls.writtenText(), /Connection: close\r\n/);
  assert.equal(tls.closed, true);
});

test("normalizes equivalent IPv6 peer spelling before accepting the socket", async () => {
  const { runtime, calls } = makeRuntime(response(), {
    addresses: { A: [], AAAA: ["2001:4860:4860::8888"] },
    peerAddress: "2001:4860:4860:0:0:0:0:8888",
  });
  const result = await requestPinnedMunicipalMoney(FACTS_URL, { runtime });
  assert.equal(result.connectedAddress, "2001:4860:4860::8888");
  assert.equal(calls.connect[0].hostname, "[2001:4860:4860::8888]");
});

test("rejects a mixed public/private DNS answer set before opening a socket", async () => {
  const { runtime, calls } = makeRuntime(response(), {
    addresses: { A: ["8.8.8.8", "10.0.0.1"], AAAA: [] },
  });
  await assert.rejects(
    requestPinnedMunicipalMoney(FACTS_URL, { runtime }),
    (error) => error instanceof PinnedHttpError && error.code === "provider_address_rejected",
  );
  assert.equal(calls.connect.length, 0);
});

test("rejects empty DNS answers and does not connect", async () => {
  const { runtime, calls } = makeRuntime(response(), {
    addresses: { A: [], AAAA: [] },
  });
  await assert.rejects(
    requestPinnedMunicipalMoney(FACTS_URL, { runtime }),
    (error) => error.code === "provider_address_rejected",
  );
  assert.equal(calls.connect.length, 0);
});

test("rejects a peer address that differs from the validated DNS answer", async () => {
  const { runtime, calls, tls } = makeRuntime(response(), {
    peerAddress: "1.1.1.1",
  });
  await assert.rejects(
    requestPinnedMunicipalMoney(FACTS_URL, { runtime }),
    (error) => error.code === "provider_peer_mismatch",
  );
  assert.equal(calls.tls.length, 0);
  assert.equal(calls.tcp.closed, true);
  assert.equal(tls.closed, false);
});

test("rejects a TLS negotiation that selects HTTP/2", async () => {
  const { runtime, tls } = makeRuntime(response());
  runtime.startTls = async () => ({
    ...tls,
    async handshake() { return { alpnProtocol: "h2" }; },
  });
  await assert.rejects(
    requestPinnedMunicipalMoney(FACTS_URL, { runtime }),
    (error) => error.code === "provider_alpn_rejected",
  );
});

test("returns redirect status without following the Location header", async () => {
  const redirect = response(302, { Location: "https://example.com/other" }, "moved");
  const { runtime, calls } = makeRuntime(redirect);
  const result = await requestPinnedMunicipalMoney(FACTS_URL, { runtime });
  assert.equal(result.status, 302);
  assert.equal(result.headers.location, "https://example.com/other");
  assert.equal(result.redirectFollowed, false);
  assert.equal(calls.connect.length, 1);
});

test("accepts a valid bounded chunked response", async () => {
  const raw =
    "HTTP/1.1 200 OK\r\n" +
    "Content-Type: application/json\r\n" +
    "Transfer-Encoding: chunked\r\n" +
    "Connection: close\r\n\r\n" +
    "B\r\n{\"ok\":true}\r\n" +
    "0\r\nX-Trace: ci\r\n\r\n";
  const { runtime } = makeRuntime(raw);
  const result = await requestPinnedMunicipalMoney(FACTS_URL, { runtime });
  assert.equal(decoder.decode(result.body), "{\"ok\":true}");
});

test("reads a close-delimited response only until EOF", async () => {
  const raw = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"ok\":true}";
  const { runtime } = makeRuntime(raw);
  const result = await requestPinnedMunicipalMoney(FACTS_URL, { runtime });
  assert.equal(decoder.decode(result.body), "{\"ok\":true}");
});

test("rejects conflicting content-length and transfer-encoding", async () => {
  const raw = response(200, { "Transfer-Encoding": "chunked" });
  const { runtime } = makeRuntime(raw);
  await assert.rejects(
    requestPinnedMunicipalMoney(FACTS_URL, { runtime }),
    (error) => error.code === "provider_http_malformed",
  );
});

test("rejects duplicate response headers", async () => {
  const raw =
    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}";
  const { runtime } = makeRuntime(raw);
  await assert.rejects(
    requestPinnedMunicipalMoney(FACTS_URL, { runtime }),
    (error) => error.code === "provider_http_malformed",
  );
});

test("rejects non-identity content encoding", async () => {
  const raw = response(200, { "Content-Encoding": "gzip" });
  const { runtime } = makeRuntime(raw);
  await assert.rejects(
    requestPinnedMunicipalMoney(FACTS_URL, { runtime }),
    (error) => error.code === "provider_content_encoding_rejected",
  );
});

test("rejects body lengths above the configured response cap", async () => {
  const raw = "HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n0123456789";
  const { runtime } = makeRuntime(raw);
  await assert.rejects(
    requestPinnedMunicipalMoney(FACTS_URL, { runtime, maxResponseBytes: 5 }),
    (error) => error.code === "provider_response_too_large",
  );
});

test("rejects chunked responses that exceed the configured response cap", async () => {
  const raw =
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n" +
    "A\r\n0123456789\r\n0\r\n\r\n";
  const { runtime } = makeRuntime(raw);
  await assert.rejects(
    requestPinnedMunicipalMoney(FACTS_URL, { runtime, maxResponseBytes: 5 }),
    (error) => error.code === "provider_response_too_large",
  );
});

test("rejects malformed HTTP status and truncated body framing", async () => {
  for (const raw of [
    "200 OK\r\nContent-Length: 0\r\n\r\n",
    "HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nabc",
  ]) {
    const { runtime } = makeRuntime(raw);
    await assert.rejects(requestPinnedMunicipalMoney(FACTS_URL, { runtime }));
  }
});

test("rejects unsupported path, extra query controls and invalid provider cuts before DNS", async () => {
  const { runtime, calls } = makeRuntime(response());
  const invalid = [
    "https://example.com/api/cubes/incexp_v2/facts?page=1&pagesize=25&format=json&cut=x",
    "https://municipaldata.treasury.gov.za/api/cubes/other/facts?page=1&pagesize=25&format=json&cut=x",
    FACTS_URL + "&url=https%3A%2F%2Fexample.com",
    FACTS_URL + "#fragment",
    "https://municipaldata.treasury.gov.za/api/cubes/incexp_v2/facts?page=1&page=2&pagesize=25&format=json&cut=x",
    "https://municipaldata.treasury.gov.za/api/cubes/incexp_v2/facts?page=1&pagesize=25&format=json&cut=arbitrary",
  ];
  for (const target of invalid) {
    await assert.rejects(requestPinnedMunicipalMoney(target, { runtime }));
  }
  assert.equal(calls.dns.length, 0);
  assert.equal(calls.connect.length, 0);
});

test("aborts and closes the active TLS socket when the whole request times out", async () => {
  const { runtime, tls } = makeRuntime(null, { hangOnRead: true });
  await assert.rejects(
    requestPinnedMunicipalMoney(FACTS_URL, { runtime, timeoutMs: 20 }),
    (error) => error.code === "provider_timeout",
  );
  assert.equal(tls.closed, true);
});

test("readBoundedHttp1Response rejects an oversized header block", async () => {
  const header = "HTTP/1.1 200 OK\r\nX-Large: " + "a".repeat(100) + "\r\n\r\n";
  const conn = new FakeConnection(header, { readChunkSize: 10 });
  await assert.rejects(
    readBoundedHttp1Response(conn, { maxHeaderBytes: 40 }),
    (error) => error.code === "provider_header_limit_exceeded",
  );
});
