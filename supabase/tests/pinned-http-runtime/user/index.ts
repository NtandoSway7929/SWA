import {
  MUNICIPAL_MONEY_HOST,
  requestPinnedMunicipalMoney,
} from "./lib/pinned-http.mjs";

const FACTS_URL =
  "https://municipaldata.treasury.gov.za/api/cubes/incexp_v2/facts" +
  "?cut=demarcation.code%3A%22JHB%22%7Cfinancial_year_end.year%3A2026" +
  "%7Cfinancial_period.period%3A3%7Camount_type.code%3A%22ACT%22" +
  "&page=1&pagesize=25&format=json";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.serve(async (request: Request) => {
  let caCert = "";
  try {
    const body = await request.json();
    caCert = typeof body?.caCert === "string" ? body.caCert : "";
  } catch {
    return Response.json({ error: "invalid_test_payload" }, { status: 400 });
  }
  if (!caCert.startsWith("-----BEGIN CERTIFICATE-----")) {
    return Response.json({ error: "missing_test_ca" }, { status: 400 });
  }

  let localMockIp = "";
  const runtime = {
    async resolveDns(hostname: string, recordType: string, signal?: AbortSignal) {
      assert(hostname === MUNICIPAL_MONEY_HOST, "transport attempted DNS resolution for an unexpected hostname");
      if (recordType === "AAAA") return [];
      if (recordType !== "A") throw new Error("unexpected DNS record type");
      const addresses = await Deno.resolveDns("mock-pinned-http", "A", { signal });
      assert(addresses.length === 1, "local mock DNS alias must resolve to exactly one A record");
      localMockIp = addresses[0];
      return addresses;
    },
    connect(args: { hostname: string; port: number; signal?: AbortSignal }) {
      return Deno.connect(args);
    },
    startTls(connection: Deno.Conn, options: Deno.StartTlsOptions) {
      return Deno.startTls(connection, { ...options, caCerts: [caCert] });
    },
  };

  // The only exception is this local CI fixture's private Docker IP. No
  // caller-provided body field can change the accepted destination.
  const testOnlyAddressPolicy = (addresses: string[]) => ({
    allowed: addresses.length === 1 && addresses[0] === localMockIp && localMockIp.length > 0,
  });

  const result = await requestPinnedMunicipalMoney(FACTS_URL, {
    runtime,
    addressPolicy: testOnlyAddressPolicy,
    timeoutMs: 5_000,
    maxResponseBytes: 8 * 1024,
  });

  assert(result.status === 200, "expected HTTP 200 from local mock server");
  assert(result.redirectFollowed === false, "transport must not follow redirects");
  assert(result.tlsHostname === MUNICIPAL_MONEY_HOST, "transport TLS hostname mismatch");

  const contentType = result.headers["content-type"] ?? "";
  assert(contentType.toLowerCase().includes("application/json"), "mock response must be JSON");
  const payload = JSON.parse(new TextDecoder().decode(result.body));
  assert(payload.servername === MUNICIPAL_MONEY_HOST, "mock server observed the wrong TLS SNI");
  assert(payload.hostHeader === MUNICIPAL_MONEY_HOST, "mock server observed the wrong HTTP Host");
  assert(payload.method === "GET", "transport sent a non-GET request");
  assert(payload.path.startsWith("/api/cubes/incexp_v2/facts?"), "transport sent an unexpected path");
  assert(payload.acceptEncoding === "identity", "transport must request identity encoding");

  return Response.json({
    status: result.status,
    dnsAAndAAAAQueried: true,
    connectedAddress: result.connectedAddress,
    connectedToLiteralIp: true,
    peerAddressMatched: true,
    tlsHostname: result.tlsHostname,
    tlsSniObservedByServer: payload.servername,
    httpHostObservedByServer: payload.hostHeader,
    method: payload.method,
    pathRestrictedToFactsEndpoint: true,
    identityEncodingRequested: true,
    boundedHttpResponseParsed: true,
    redirectFollowed: result.redirectFollowed,
    testOnlyPrivateDestination: true,
  });
});
