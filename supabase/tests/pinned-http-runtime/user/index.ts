import {
  clearMunicipalMoneyMemberCacheForTests,
  fetchMunicipalMoneyFacts,
} from "./lib/municipal-money.mjs";
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
  let localMockIpv6 = "";
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
      let addresses: string[];
      try {
        addresses = await Deno.resolveDns("mock-pinned-http", recordType as "A" | "AAAA", { signal });
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return [];
        throw error;
      }
      if (recordType === "A") {
        assert(addresses.length === 1, "local mock DNS alias must resolve to exactly one A record");
        localMockIp = addresses[0];
      } else {
        assert(addresses.length === 1, "local mock DNS alias must resolve to exactly one AAAA record");
        localMockIpv6 = addresses[0];
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
    allowed: addresses.length === 2 &&
      addresses.includes(localMockIp) &&
      addresses.includes(localMockIpv6) &&
      localMockIp.length > 0 &&
      localMockIpv6.length > 0,
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

  // Run the complete adapter a second time with A deliberately empty so
  // the real transport must connect over the mock's IPv6 literal address.
  clearMunicipalMoneyMemberCacheForTests();
  let ipv6AQueries = 0;
  let ipv6AAAAQueries = 0;
  let ipv6TcpConnections = 0;
  let ipv6TlsConnections = 0;
  let ipv6MockAddress = "";

  const ipv6Runtime = {
    async resolveDns(hostname: string, recordType: string, signal?: AbortSignal) {
      assert(hostname === MUNICIPAL_MONEY_HOST, "IPv6 test queried an unexpected hostname");
      if (recordType === "A") {
        ipv6AQueries += 1;
        return [];
      }
      if (recordType !== "AAAA") throw new Error("unexpected IPv6 test DNS record type");
      ipv6AAAAQueries += 1;
      const addresses = await Deno.resolveDns("mock-pinned-http", "AAAA", { signal });
      assert(addresses.length === 1, "IPv6 mock alias must resolve to exactly one AAAA record");
      ipv6MockAddress = addresses[0];
      return addresses;
    },
    connect(args: { hostname: string; port: number; signal?: AbortSignal }) {
      ipv6TcpConnections += 1;
      return Deno.connect(args);
    },
    startTls(connection: Deno.Conn, options: Deno.StartTlsOptions) {
      ipv6TlsConnections += 1;
      return Deno.startTls(connection, { ...options, caCerts: [caCert] });
    },
  };
  const ipv6OnlyTestPolicy = (addresses: string[]) => ({
    allowed: addresses.length === 1 &&
      addresses[0] === ipv6MockAddress &&
      ipv6MockAddress.includes(":"),
  });

  const ipv6Result = await fetchMunicipalMoneyFacts(PARAMETERS, {
    transportRuntime: ipv6Runtime,
    transportAddressPolicy: ipv6OnlyTestPolicy,
    timeoutMs: 5_000,
    maxResponseBytes: 8 * 1024,
    now: () => new Date("2026-11-04T12:00:00.000Z"),
  });
  assert(ipv6Result.status === "ok", "IPv6-only adapter request should succeed");
  assert(ipv6Result.records.length === 1, "IPv6-only adapter should return one facts record");
  assert(ipv6Result.records[0].amount === 1250, "IPv6-only adapter returned unexpected amount");
  const ipv6Probe = ipv6Result.records[0].transport_probe;
  assert(ipv6Probe?.servername === MUNICIPAL_MONEY_HOST, "IPv6 TLS SNI mismatch");
  assert(ipv6Probe?.hostHeader === MUNICIPAL_MONEY_HOST, "IPv6 HTTP Host mismatch");
  assert(ipv6Probe?.method === "GET", "IPv6 adapter sent a non-GET request");
  assert(ipv6AQueries === 4, "IPv6 run should query A once per request");
  assert(ipv6AAAAQueries === 4, "IPv6 run should query AAAA once per request");
  assert(ipv6TcpConnections === 4, "IPv6 run should open four pinned TCP connections");
  assert(ipv6TlsConnections === 4, "IPv6 run should complete four TLS sessions");

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
    ipv6MemberCataloguesValidated: 3,
    ipv6FactsRequests: 1,
    ipv6DnsAQueries: ipv6AQueries,
    ipv6DnsAAAAQueries: ipv6AAAAQueries,
    ipv6LiteralIpConnections: ipv6TcpConnections,
    ipv6TlsConnections: ipv6TlsConnections,
    ipv6ConnectedToMock: ipv6MockAddress,
    ipv6TlsSniObservedByServer: ipv6Probe.servername,
    ipv6HttpHostObservedByServer: ipv6Probe.hostHeader,
  });
});
