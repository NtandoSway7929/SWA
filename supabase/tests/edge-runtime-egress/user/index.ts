const TEST_TLS_HOST = "municipaldata.treasury.gov.za";
const MOCK_TLS_HOST = "mocktls";
const MOCK_TLS_PORT = 8443;
const MAX_RESPONSE_BYTES = 8 * 1024;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function safeClose(resource: { close(): void }) {
  try {
    resource.close();
  } catch {
    // The Edge Runtime may already close the resource when the peer sends EOF.
  }
}

async function openPinnedTlsConnection(ip: string, tlsHost: string, caCert: string) {
  const tcp = await Deno.connect({ hostname: ip, port: MOCK_TLS_PORT });
  const peer = tcp.remoteAddr;

  assert(peer.transport === "tcp", "connected peer is not TCP");
  assert(
    peer.hostname === ip,
    "peer IP mismatch: expected " + ip + ", received " + peer.hostname,
  );

  try {
    const tls = await Deno.startTls(tcp, {
      hostname: tlsHost,
      caCerts: [caCert],
    });
    return { tls, peerIp: peer.hostname };
  } catch (error) {
    safeClose(tcp);
    throw error;
  }
}

async function readBoundedResponse(tls: Deno.TlsConn): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  for await (const chunk of tls.readable) {
    total += chunk.byteLength;
    assert(total <= MAX_RESPONSE_BYTES, "mock TLS response exceeded the byte cap");
    chunks.push(chunk);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

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

  let tcpRecords: string[];
  try {
    tcpRecords = await Deno.resolveDns(MOCK_TLS_HOST, "A");
  } catch (error) {
    return Response.json(
      { error: "dns_resolution_failed", message: String(error) },
      { status: 500 },
    );
  }

  assert(tcpRecords.length > 0, "mock TLS hostname resolved to no A records");
  const pinnedIp = tcpRecords[0];

  // The private Docker service IP is deliberately used only by this isolated
  // CI test. Production address validation must reject it.
  const { tls, peerIp } = await openPinnedTlsConnection(
    pinnedIp,
    TEST_TLS_HOST,
    caCert,
  );

  const writer = tls.writable.getWriter();
  try {
    const requestBytes = new TextEncoder().encode(
      "GET / HTTP/1.1\r\nHost: " + TEST_TLS_HOST + "\r\nConnection: close\r\n\r\n",
    );
    await writer.write(requestBytes);
    writer.releaseLock();
  } catch (error) {
    safeClose(tls);
    throw error;
  }

  const rawResponse = await readBoundedResponse(tls);
  safeClose(tls);

  const separator = rawResponse.indexOf("\r\n\r\n");
  assert(separator >= 0, "mock server returned malformed HTTP");
  const responseBody = rawResponse.slice(separator + 4);
  const mockResponse = JSON.parse(responseBody);
  assert(
    mockResponse.servername === TEST_TLS_HOST,
    "TLS SNI mismatch: expected " + TEST_TLS_HOST + ", received " + mockResponse.servername,
  );
  assert(
    mockResponse.hostHeader === TEST_TLS_HOST,
    "HTTP Host header mismatch: received " + mockResponse.hostHeader,
  );

  // A trusted test CA must not make a certificate for another hostname valid.
  const wrongHostTcp = await Deno.connect({
    hostname: pinnedIp,
    port: MOCK_TLS_PORT,
  });
  let wrongHostnameRejected = false;
  try {
    const wrongTls = await Deno.startTls(wrongHostTcp, {
      hostname: "wrong-host.invalid",
      caCerts: [caCert],
    });
    safeClose(wrongTls);
  } catch {
    wrongHostnameRejected = true;
    safeClose(wrongHostTcp);
  }
  assert(wrongHostnameRejected, "TLS accepted a certificate for the wrong hostname");

  return Response.json({
    dnsResolution: true,
    pinnedPeerAddress: peerIp,
    tcpConnectedToLiteralIp: peerIp === pinnedIp,
    tlsCertificateHostnameVerified: true,
    tlsSni: mockResponse.servername,
    httpHostHeader: mockResponse.hostHeader,
    wrongHostnameRejected: true,
    testOnlyPrivateDestination: true,
  });
});
