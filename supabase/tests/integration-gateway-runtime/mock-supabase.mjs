import { createServer } from "node:http";

const requests = [];

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

function tokenFrom(request) {
  const authorization = request.headers.authorization ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://mock-supabase:54321");

  if (request.method === "GET" && url.pathname === "/__test/state") {
    return sendJson(response, 200, { requests });
  }

  const token = tokenFrom(request);
  const entry = {
    method: request.method,
    path: url.pathname,
    token,
    apiKey: request.headers.apikey ?? "",
  };

  let requestBody = "";
  for await (const chunk of request) requestBody += chunk.toString("utf8");
  if (requestBody) {
    try {
      entry.body = JSON.parse(requestBody);
    } catch {
      entry.body = "invalid-json";
    }
  }
  requests.push(entry);

  if (request.method === "GET" && url.pathname === "/auth/v1/user") {
    if (!token || token === "invalid-session-token") {
      return sendJson(response, 401, {
        code: 401,
        error_code: "invalid_token",
        msg: "Invalid token",
      });
    }

    return sendJson(response, 200, {
      id: "runtime-test-user",
      aud: "authenticated",
      role: "authenticated",
      email: "runtime-test@example.invalid",
      app_metadata: {},
      user_metadata: {},
    });
  }

  if (request.method === "POST" && url.pathname === "/rest/v1/rpc/is_swayphics_admin") {
    return sendJson(response, 200, token === "non-admin-token" ? false : true);
  }

  if (
    request.method === "POST" &&
    url.pathname === "/rest/v1/rpc/innerme_reserve_integration_quota"
  ) {
    if (token === "quota-error-token") {
      return sendJson(response, 500, {
        code: "P0001",
        message: "test quota backend failure",
      });
    }
    if (token === "quota-denied-token") {
      return sendJson(response, 200, {
        allowed: false,
        retry_after_seconds: 17,
      });
    }
    return sendJson(response, 500, {
      code: "unexpected_test_request",
      message: "The runtime test must not reach an allowed provider request",
    });
  }

  if (
    request.method === "POST" &&
    url.pathname === "/rest/v1/rpc/innerme_release_integration_quota"
  ) {
    return sendJson(response, 500, {
      code: "unexpected_test_request",
      message: "Quota release must not be reached in this provider-free auth test",
    });
  }

  return sendJson(response, 404, {
    code: "mock_route_not_found",
    path: url.pathname,
  });
});

server.listen(54321, "0.0.0.0", () => {
  console.log("InnerMe mock Supabase Auth/PostgREST listening on 54321");
});
