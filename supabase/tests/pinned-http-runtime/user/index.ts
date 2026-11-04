import { fetchMunicipalMoneyFacts } from "./lib/municipal-money.mjs";
import {
  MUNICIPAL_MONEY_HOST,
  requestPinnedMunicipalMoney,
} from "./lib/pinned-http.mjs";

const PARAMETERS = {
  municipality_code: "JHB",
  financial_year: 2026,
  financial_period: 3,
  amount_type_code: "ACT",
  item_code: "0200",
  page: 1,
  page_size: 25,
};

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
  let aLookups = 0;
  let aaaaLookups = 0;
  let tcpConnections = 0;
  let tlsConnections = 0;

  const runtime = {
    async resolveDns(hostname: string, recordType: string, signal?: AbortSignal) {
      assert(hostname === MUNICIPAL_MONEY_HOST, "adapter attempted DNS resolution for an unexpected hostname");
      if (recordType === "A") aLookups += 1;
      else if (recordType === "AAAA") aaaaLookups += 1;
      else throw new Error("unexpected DNS record type");

      // Resolve the local mock alias rather than contacting Treasury.
      const addresses = await Deno.resolveDns("mock-pinned-http", recordType, { signal });
      if (recordType === "A") {
        assert(addresses.length === 1, "local mock DNS alias must resolve to exactly one A record");
        localMockIp = addresses[0];
      }
      return addresses;
    },
    connect(args: { hostname: string; port: number; signal?: AbortSignal }) {
      tcpConnections += 1;
      return Deno.connect(args);
    },
    startTls(connection: Deno.Conn, options: Deno.StartTlsOptions) {
      tlsConnections += 1;
      return Deno.startTls(connection, { ...options, caCerts: [caCert] });
    },
  };

  // The only exception is this local CI fixture's private Docker IP. It is
  // derived from the mock DNS alias and cannot be changed by request data.
  const testOnlyAddressPolicy = (addresses: string[]) => ({
    allowed: addresses.length === 1 &&
      addresses[0] === localMockIp &&
      localMockIp.length > 0,
  });

  let lastTransportErrorCode: string | null = null;
  let lastTransportTarget = "";

  const requestPinnedImpl = async (target: string | URL, options: Record<string, unknown>) => {
    lastTransportTarget = new URL(target.toString()).pathname;
    try {
      return await requestPinnedMunicipalMoney(target, options);
    } catch (error) {
      lastTransportErrorCode = typeof error?.code === "string"
        ? error.code
        : error instanceof Error
        ? error.name
        : "unknown_transport_error";
      throw error;
    }
  };

  let result;
  try {
    result = await fetchMunicipalMoneyFacts(PARAMETERS, {
      requestPinnedImpl,
      transportRuntime: runtime,
      transportAddressPolicy: testOnlyAddressPolicy,
      timeoutMs: 5_000,
      maxResponseBytes: 8 * 1024,
      now: () => new Date("2026-11-04T12:00:00.000Z"),
    });
  } catch (error) {
    return Response.json({
      errorCode: typeof error?.code === "string" ? error.code : "unknown_adapter_error",
      lastTransportErrorCode,
      lastTransportTarget,
      aLookups,
      aaaaLookups,
      tcpConnections,
      tlsConnections,
      localMockIpResolved: localMockIp.length > 0,
    }, { status: 500 });
  }

  assert(result.status === "ok", "adapter should return normalized provider data");
  assert(result.records.length === 1, "expected one normalized facts record");
  assert(result.records[0].amount === 1250, "unexpected normalized provider amount");
  assert(result.records[0].amount_source_value === 1250, "source amount must be preserved");

  const probe = result.records[0].transport_probe;
  assert(probe?.servername === MUNICIPAL_MONEY_HOST, "mock server observed the wrong TLS SNI");
  assert(probe?.hostHeader === MUNICIPAL_MONEY_HOST, "mock server observed the wrong HTTP Host");
  assert(probe?.method === "GET", "adapter sent a non-GET request");
  assert(probe?.path.startsWith("/api/cubes/incexp_v2/facts?"), "adapter sent an unexpected facts path");
  assert(probe?.acceptEncoding === "identity", "transport must request identity encoding");

  assert(aLookups === 4, "expected A lookup for three catalogues and one facts request");
  assert(aaaaLookups === 4, "expected AAAA lookup for three catalogues and one facts request");
  assert(tcpConnections === 4, "expected four literal-IP TCP connections");
  assert(tlsConnections === 4, "expected four pinned TLS connections");

  return Response.json({
    status: result.status,
    memberCataloguesValidated: 3,
    factsRequests: 1,
    dnsAQueries: aLookups,
    dnsAAAAQueries: aaaaLookups,
    literalIpConnections: tcpConnections,
    tlsConnections,
    connectedToMockIp: localMockIp,
    tlsSniObservedByServer: probe.servername,
    httpHostObservedByServer: probe.hostHeader,
    factsPathRestricted: true,
    identityEncodingRequested: true,
    normalizedAmount: result.records[0].amount,
    providerSourceAmountPreserved: true,
    testOnlyPrivateDestination: true,
  });
});
