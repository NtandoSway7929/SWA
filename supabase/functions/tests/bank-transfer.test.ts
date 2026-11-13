import {
  bankTransferProofMatchesMime,
  createBankTransferHandler,
  parseBankTransferAmount,
} from "../bank-transfer/index.ts";

Deno.test("bank transfer amounts accept positive decimal values with at most two places", () => {
  const accepted = [["1", 1], ["120.50", 120.5], [
    "9999999999.99",
    9999999999.99,
  ]];
  for (const [input, expected] of accepted) {
    if (parseBankTransferAmount(input) !== expected) {
      throw new Error("Valid amount was rejected: " + input);
    }
  }
  for (
    const input of [
      "",
      "0",
      "-1",
      "1.999",
      "1e3",
      "1,000.00",
      "NaN",
      "Infinity",
      "  ",
    ]
  ) {
    if (parseBankTransferAmount(input) !== null) {
      throw new Error("Invalid amount was accepted: " + input);
    }
  }
});

Deno.test("bank transfer proof validation checks real file signatures, not just MIME labels", () => {
  const cases: Array<[string, number[], boolean]> = [
    ["application/pdf", [37, 80, 68, 70, 45, 49], true],
    ["image/jpeg", [255, 216, 255, 224], true],
    ["image/png", [137, 80, 78, 71, 13, 10, 26, 10], true],
    ["image/webp", [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80], true],
    ["image/png", [37, 80, 68, 70, 45], false],
    ["application/pdf", [137, 80, 78, 71], false],
    ["image/jpeg", [255, 216], false],
    ["image/webp", [82, 73, 70, 70, 0, 0, 0, 0], false],
  ];
  for (const [mime, signature, expected] of cases) {
    if (
      bankTransferProofMatchesMime(mime, new Uint8Array(signature)) !== expected
    ) {
      throw new Error("Proof signature result mismatch for " + mime);
    }
  }
  if (
    !bankTransferProofMatchesMime(
      "IMAGE/PNG",
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  ) {
    throw new Error("Uppercase MIME labels should be normalized before validation.");
  }
});

Deno.test("bank transfer handler rejects methods and cross-origin requests before database access", async () => {
  let calls = 0;
  const handler = createBankTransferHandler({
    createAdmin: () => {
      calls++;
      throw new Error("Unexpected database access");
    },
  });
  const method = await handler(
    new Request("https://functions.test/bank-transfer", { method: "GET" }),
  );
  if (method.status !== 405 || calls !== 0) {
    throw new Error("Unsupported method was not rejected first.");
  }
  const origin = await handler(
    new Request("https://functions.test/bank-transfer", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "details", token: "x".repeat(40) }),
    }),
  );
  if (origin.status !== 403 || calls !== 0) {
    throw new Error("Cross-origin request reached database initialization.");
  }
});

Deno.test("bank transfer detail and upload actions reject invalid private portal tokens", async () => {
  let reads = 0;
  const handler = createBankTransferHandler({
    createAdmin: () => ({
      from: () => {
        reads++;
        throw new Error("No database read expected");
      },
    }),
    resolvePortal: async () => null,
  });
  const details = await handler(
    new Request("https://functions.test/bank-transfer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "details",
        token: "x".repeat(40),
        invoice_id: "123e4567-e89b-42d3-a456-426614174000",
      }),
    }),
  );
  if (details.status !== 403) {
    throw new Error("Invalid portal token could access bank details.");
  }

  const form = new FormData();
  form.append("token", "x".repeat(40));
  form.append("invoice_id", "123e4567-e89b-42d3-a456-426614174000");
  form.append("amount", "100.00");
  form.append("bank_reference", "TEST-REF");
  form.append(
    "proof",
    new File(["%PDF-1.7"], "proof.pdf", { type: "application/pdf" }),
  );
  const upload = await handler(
    new Request("https://functions.test/bank-transfer", {
      method: "POST",
      body: form,
    }),
  );
  if (upload.status !== 403 || reads !== 0) {
    throw new Error(
      "Invalid portal token reached bank-transfer proof storage or data reads.",
    );
  }
});

Deno.test("bank-transfer admin actions return 401 for missing or expired sessions", async () => {
  let authLookups = 0;
  let databaseReads = 0;
  const handler = createBankTransferHandler({
    createAdmin: () => ({
      from: () => {
        databaseReads++;
        throw new Error("Unauthenticated requests must not read protected data");
      },
    }),
    createUserClient: () => ({
      auth: {
        getUser: async () => {
          authLookups++;
          return { data: { user: null }, error: { message: "Invalid JWT" } };
        },
      },
      rpc: async () => {
        throw new Error("Admin authorization must not run without an authenticated user");
      },
    }),
  });

  const missing = await handler(
    new Request("https://functions.test/bank-transfer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "list" }),
    }),
  );
  const expired = await handler(
    new Request("https://functions.test/bank-transfer", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer expired-session-token",
      },
      body: JSON.stringify({ action: "list" }),
    }),
  );

  if (
    missing.status !== 401 ||
    expired.status !== 401 ||
    authLookups !== 1 ||
    databaseReads !== 0
  ) {
    throw new Error("Missing or expired admin sessions must return 401 before protected data is read.");
  }
});

Deno.test("bank-transfer admin authorization service failures return 503", async () => {
  const handler = createBankTransferHandler({
    createAdmin: () => ({ from: () => { throw new Error("No protected read expected"); } }),
    createUserClient: () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: "123e4567-e89b-42d3-a456-426614174000" } },
          error: null,
        }),
      },
      rpc: async () => ({ data: null, error: { message: "RPC unavailable" } }),
    }),
  });

  const response = await handler(
    new Request("https://functions.test/bank-transfer", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer authenticated-session-token",
      },
      body: JSON.stringify({ action: "list" }),
    }),
  );
  if (response.status !== 503) {
    throw new Error("An administrator authorization service failure must not be reported as an ordinary 403.");
  }
});

Deno.test("admin bank-transfer queue rejects users without Swayphics administrator authorization", async () => {
  let reads = 0;
  const handler = createBankTransferHandler({
    createAdmin: () => ({
      from: () => {
        reads++;
        throw new Error("Queue must not be read by non-admins");
      },
    }),
    createUserClient: () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: "123e4567-e89b-42d3-a456-426614174000" } },
          error: null,
        }),
      },
      rpc: async () => ({ data: false, error: null }),
    }),
  });
  const response = await handler(
    new Request("https://functions.test/bank-transfer", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer invalid-but-shaped",
      },
      body: JSON.stringify({ action: "list" }),
    }),
  );
  if (response.status !== 403 || reads !== 0) {
    throw new Error("Non-admin session was able to access the review queue.");
  }
});
