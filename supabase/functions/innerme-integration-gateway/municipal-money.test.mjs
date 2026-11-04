import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PAGE_SIZE,
  MUNICIPAL_MONEY_API_ORIGIN,
  MUNICIPAL_MONEY_API_PATH,
  MunicipalMoneyError,
  buildMunicipalMoneyFactsUrl,
  clearMunicipalMoneyMemberCacheForTests,
  fetchMunicipalMoneyFacts,
  normalizeMunicipalMoneyResponse,
  validateMunicipalMoneyParameters,
  validateMunicipalMoneyMembership,
} from "./municipal-money.mjs";

const validParameters = {
  municipality_code: "JHB",
  financial_year: 2026,
  financial_period: 3,
  amount_type_code: "ACT",
  item_code: "0200",
  page: 1,
  page_size: 25,
};

test("accepts the narrow documented capability parameters and applies safe defaults", () => {
  const value = validateMunicipalMoneyParameters({
    municipality_code: "JHB",
    financial_year: 2026,
    financial_period: 3,
    amount_type_code: "ACT",
  });

  assert.deepEqual(value, {
    municipality_code: "JHB",
    financial_year: 2026,
    financial_period: 3,
    amount_type_code: "ACT",
    page: 1,
    page_size: 50,
  });
});

test("caps financial year end at the current UTC calendar year", () => {
  const currentYear = new Date().getUTCFullYear();
  assert.equal(
    validateMunicipalMoneyParameters({
      ...validParameters,
      financial_year: currentYear,
    }).financial_year,
    currentYear,
  );
  assert.throws(
    () => validateMunicipalMoneyParameters({
      ...validParameters,
      financial_year: currentYear + 1,
    }),
    (error) => error instanceof MunicipalMoneyError &&
      error.code === "invalid_parameter",
  );
});

test("rejects arbitrary parameters and model-supplied URL controls", () => {
  assert.throws(
    () => validateMunicipalMoneyParameters({ ...validParameters, url: "https://attacker.test" }),
    (error) => error instanceof MunicipalMoneyError && error.code === "unsupported_parameter",
  );
  assert.throws(
    () => validateMunicipalMoneyParameters({ ...validParameters, host: "127.0.0.1" }),
    (error) => error instanceof MunicipalMoneyError && error.code === "unsupported_parameter",
  );
  assert.throws(
    () => validateMunicipalMoneyParameters({ ...validParameters, cut: "x:y" }),
    (error) => error instanceof MunicipalMoneyError && error.code === "unsupported_parameter",
  );
});

test("rejects malformed and out-of-range values before any provider request", () => {
  const cases = [
    [{ ...validParameters, municipality_code: "JHB|x:y" }, "municipality_code"],
    [{ ...validParameters, municipality_code: "jhb" }, "municipality_code"],
    [{ ...validParameters, financial_year: 2019 }, "financial_year"],
    [{ ...validParameters, financial_period: 13 }, "financial_period"],
    [{ ...validParameters, amount_type_code: "ACT|x:y" }, "amount_type_code"],
    [{ ...validParameters, item_code: "20|x" }, "item_code"],
    [{ ...validParameters, page_size: MAX_PAGE_SIZE + 1 }, "page_size"],
    [{ ...validParameters, page: 0 }, "page"],
  ];

  for (const [input, field] of cases) {
    assert.throws(
      () => validateMunicipalMoneyParameters(input),
      (error) => error instanceof MunicipalMoneyError &&
        error.code === "invalid_parameter" &&
        error.message.includes(field),
    );
  }
});

test("builds a fixed HTTPS provider URL and encodes filter delimiters as query data", () => {
  const url = buildMunicipalMoneyFactsUrl(validParameters);

  assert.equal(url.origin, MUNICIPAL_MONEY_API_ORIGIN);
  assert.equal(url.pathname, MUNICIPAL_MONEY_API_PATH);
  assert.equal(url.protocol, "https:");
  assert.equal(
    url.searchParams.get("cut"),
    'demarcation.code:"JHB"|financial_year_end.year:2026|financial_period.period:3|amount_type.code:"ACT"|item.code:"0200"',
  );
  assert.equal(url.searchParams.get("pagesize"), "25");
  assert.equal(url.searchParams.get("format"), "json");
});

test("normalizes records while preserving the provider's original amount value", () => {
  const result = normalizeMunicipalMoneyResponse(
    {
      status: "ok",
      page: 1,
      page_size: 2,
      total_fact_count: 2,
      fields: ["demarcation.code", "amount"],
      data: [
        { "demarcation.code": "JHB", amount: null },
        { "demarcation.code": "JHB", amount: 1250 },
      ],
    },
    validParameters,
    "https://municipaldata.treasury.gov.za/api/cubes/incexp_v2/facts?pagesize=25",
    "2026-11-04T12:00:00.000Z",
  );

  assert.equal(result.provider, "national_treasury_municipal_money");
  assert.equal(result.dataset, "incexp_v2");
  assert.equal(result.records[0].amount, 0);
  assert.equal(result.records[0].amount_source_value, null);
  assert.match(result.records[0].amount_interpretation, /null or zero/);
  assert.equal(result.records[1].amount, 1250);
  assert.equal(result.records[1].amount_source_value, 1250);
  assert.equal(result.pagination.total_fact_count, 2);
  assert.equal(result.retrieved_at, "2026-11-04T12:00:00.000Z");
  assert.equal(result.attribution.source, "National Treasury, Municipal Money");
});


test("rejects missing, fractional and unsafe provider monetary values", () => {
  for (const record of [
    { "demarcation.code": "JHB" },
    { amount: 1.25 },
    { amount: Number.MAX_SAFE_INTEGER + 1 },
    { amount: "123" },
    { amount: { value: 123 } },
  ]) {
    assert.throws(
      () => normalizeMunicipalMoneyResponse(
        { status: "ok", fields: ["amount"], data: [record] },
        validParameters,
        "https://municipaldata.treasury.gov.za/api/cubes/incexp_v2/facts",
      ),
      (error) => error instanceof MunicipalMoneyError &&
        error.code === "invalid_provider_amount",
    );
  }
});

test("rejects invalid provider pagination metadata", () => {
  assert.throws(
    () => normalizeMunicipalMoneyResponse(
      { status: "ok", fields: ["amount"], page: 0, data: [] },
      validParameters,
      "https://municipaldata.treasury.gov.za/api/cubes/incexp_v2/facts",
    ),
    (error) => error instanceof MunicipalMoneyError &&
      error.code === "invalid_provider_pagination",
  );
});

test("rejects malformed provider payloads and excessive provider rows", () => {
  assert.throws(
    () => normalizeMunicipalMoneyResponse({ status: "error", data: [] }, validParameters, "https://source.test"),
    (error) => error instanceof MunicipalMoneyError && error.code === "invalid_provider_response",
  );
  assert.throws(
    () => normalizeMunicipalMoneyResponse(
      { status: "ok", fields: ["amount"], data: Array.from({ length: 26 }, () => ({ amount: 1 })) },
      validParameters,
      "https://source.test",
    ),
    (error) => error instanceof MunicipalMoneyError && error.code === "provider_page_limit_exceeded",
  );
});

function withValidMemberCatalogues(factsFetch) {
  return async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/members/demarcation")) return memberResponse("demarcation.code", "JHB");
    if (parsed.pathname.endsWith("/members/amount_type")) return memberResponse("amount_type.code", "ACT");
    if (parsed.pathname.endsWith("/members/item")) return memberResponse("item.code", "0200");
    return factsFetch(url, options);
  };
}

test("fetch uses GET, the fixed URL, manual redirects and JSON accept header", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({
      status: "ok",
      page: 1,
      page_size: 1,
      total_fact_count: 1,
      fields: ["amount"],
      data: [{ amount: 10 }],
    }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  };

  const result = await fetchMunicipalMoneyFacts(
    { ...validParameters, page_size: 1 },
    { fetchImpl: withValidMemberCatalogues(fetchImpl), now: () => new Date("2026-11-04T12:00:00.000Z") },
  );

  assert.equal(captured.options.method, "GET");
  assert.equal(captured.options.redirect, "manual");
  assert.equal(captured.options.headers.Accept, "application/json");
  assert.equal(new URL(captured.url).hostname, "municipaldata.treasury.gov.za");
  assert.equal(result.records[0].amount, 10);
});

test("does not follow provider redirects", async () => {
  await assert.rejects(
    fetchMunicipalMoneyFacts(validParameters, {
      fetchImpl: withValidMemberCatalogues(async () => new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/" },
      })),
    }),
    (error) => error instanceof MunicipalMoneyError && error.code === "provider_redirect_rejected",
  );
});

test("rejects non-JSON provider responses and non-success HTTP statuses", async () => {
  await assert.rejects(
    fetchMunicipalMoneyFacts(validParameters, {
      fetchImpl: withValidMemberCatalogues(async () => new Response("upstream error", {
        status: 200,
        headers: { "content-type": "text/html" },
      })),
    }),
    (error) => error instanceof MunicipalMoneyError && error.code === "provider_content_type_rejected",
  );

  await assert.rejects(
    fetchMunicipalMoneyFacts(validParameters, {
      fetchImpl: withValidMemberCatalogues(async () => new Response("unavailable", { status: 503 })),
    }),
    (error) => error instanceof MunicipalMoneyError && error.code === "provider_http_error",
  );
});

test("rejects oversized provider bodies", async () => {
  const largeBody = JSON.stringify({ status: "ok", data: [{ amount: "x".repeat(2048) }] });
  await assert.rejects(
    fetchMunicipalMoneyFacts(validParameters, {
      maxResponseBytes: 128,
      fetchImpl: withValidMemberCatalogues(async () => new Response(largeBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      })),
    }),
    (error) => error instanceof MunicipalMoneyError && error.code === "provider_response_too_large",
  );
});


function memberResponse(field, code) {
  return new Response(JSON.stringify({
    status: "ok",
    page: 1,
    page_size: 1000,
    total_member_count: 1,
    fields: [field],
    data: [{ [field]: code }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("preflights municipality, amount type and item codes against fixed provider catalogues", async () => {
  clearMunicipalMoneyMemberCacheForTests();
  const requested = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    requested.push(parsed);
    if (parsed.pathname.endsWith("/members/demarcation")) return memberResponse("demarcation.code", "JHB");
    if (parsed.pathname.endsWith("/members/amount_type")) return memberResponse("amount_type.code", "ACT");
    if (parsed.pathname.endsWith("/members/item")) return memberResponse("item.code", "0200");
    throw new Error("Unexpected provider path");
  };

  await validateMunicipalMoneyMembership(validParameters, { fetchImpl });
  assert.deepEqual(requested.map((url) => url.pathname), [
    "/api/cubes/incexp_v2/members/demarcation",
    "/api/cubes/incexp_v2/members/amount_type",
    "/api/cubes/incexp_v2/members/item",
  ]);
  for (const url of requested) {
    assert.equal(url.origin, MUNICIPAL_MONEY_API_ORIGIN);
    assert.equal(url.searchParams.get("pagesize"), "1000");
  }
});

test("rejects unknown municipality codes before requesting facts", async () => {
  clearMunicipalMoneyMemberCacheForTests();
  let factsRequested = false;
  await assert.rejects(
    fetchMunicipalMoneyFacts(validParameters, {
      fetchImpl: async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith("/members/demarcation")) {
          return memberResponse("demarcation.code", "CPT");
        }
        if (parsed.pathname.endsWith("/members/amount_type")) {
          return memberResponse("amount_type.code", "ACT");
        }
        if (parsed.pathname.endsWith("/members/item")) {
          return memberResponse("item.code", "0200");
        }
        factsRequested = true;
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      },
    }),
    (error) => error instanceof MunicipalMoneyError &&
      error.code === "unknown_provider_member" &&
      error.message.includes("municipality_code"),
  );
  assert.equal(factsRequested, false);
});

test("fails closed when provider member metadata is incomplete or malformed", async () => {
  clearMunicipalMoneyMemberCacheForTests();
  await assert.rejects(
    validateMunicipalMoneyMembership(validParameters, {
      fetchImpl: async () => new Response(JSON.stringify({
        status: "ok",
        page: 1,
        page_size: 1,
        total_member_count: 2,
        fields: ["demarcation.code"],
        data: [{ "demarcation.code": "JHB" }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    }),
    (error) => error instanceof MunicipalMoneyError &&
      error.code === "provider_metadata_invalid_response",
  );
});

test("caches validated provider catalogues for ten minutes", async () => {
  clearMunicipalMoneyMemberCacheForTests();
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/members/demarcation")) return memberResponse("demarcation.code", "JHB");
    if (parsed.pathname.endsWith("/members/amount_type")) return memberResponse("amount_type.code", "ACT");
    if (parsed.pathname.endsWith("/members/item")) return memberResponse("item.code", "0200");
    throw new Error("Unexpected provider path");
  };

  await validateMunicipalMoneyMembership(validParameters, { fetchImpl });
  await validateMunicipalMoneyMembership(validParameters, { fetchImpl });
  assert.equal(calls, 3);
});

test("provider errors are returned as sanitized integration errors", async () => {
  await assert.rejects(
    fetchMunicipalMoneyFacts(validParameters, {
      fetchImpl: withValidMemberCatalogues(async () => {
        throw new Error("upstream request details");
      }),
    }),
    (error) => error instanceof MunicipalMoneyError &&
      error.code === "provider_unavailable" &&
      !error.message.includes("secret"),
  );
});


test("uses the pinned transport by default for member catalogues and facts", async () => {
  clearMunicipalMoneyMemberCacheForTests();
  const requests = [];
  const requestPinnedImpl = async (url, options) => {
    const parsed = new URL(url);
    requests.push({ url: parsed, options });

    let payload;
    if (parsed.pathname.endsWith("/members/demarcation")) {
      payload = {
        status: "ok",
        total_member_count: 1,
        data: [{ "demarcation.code": "JHB" }],
      };
    } else if (parsed.pathname.endsWith("/members/amount_type")) {
      payload = {
        status: "ok",
        total_member_count: 1,
        data: [{ "amount_type.code": "ACT" }],
      };
    } else if (parsed.pathname.endsWith("/members/item")) {
      payload = {
        status: "ok",
        total_member_count: 1,
        data: [{ "item.code": "0200" }],
      };
    } else if (parsed.pathname === MUNICIPAL_MONEY_API_PATH) {
      payload = {
        status: "ok",
        page: 1,
        page_size: 25,
        total_fact_count: 1,
        fields: ["amount"],
        data: [{ amount: 1250 }],
      };
    } else {
      throw new Error("Unexpected pinned provider route");
    }

    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode(JSON.stringify(payload)),
    };
  };

  const result = await fetchMunicipalMoneyFacts(validParameters, {
    requestPinnedImpl,
    now: () => new Date("2026-11-04T12:00:00.000Z"),
  });

  assert.deepEqual(
    requests.map(({ url }) => url.pathname),
    [
      "/api/cubes/incexp_v2/members/demarcation",
      "/api/cubes/incexp_v2/members/amount_type",
      "/api/cubes/incexp_v2/members/item",
      MUNICIPAL_MONEY_API_PATH,
    ],
  );
  assert.equal(requests.every(({ url }) => url.origin === MUNICIPAL_MONEY_API_ORIGIN), true);
  assert.equal(requests.every(({ options }) => options.timeoutMs === 8_000), true);
  assert.equal(requests.every(({ options }) => options.maxResponseBytes === 512 * 1024), true);
  assert.equal(result.records[0].amount, 1250);
});

test("combines caller cancellation with the adapter's request timeout signal", async () => {
  clearMunicipalMoneyMemberCacheForTests();
  const caller = new AbortController();
  let observedSignal;

  const requestPinnedImpl = async (_url, options) => {
    observedSignal = options.signal;
    assert.ok(observedSignal, "pinned transport must receive an abort signal");
    assert.equal(observedSignal.aborted, false);
    caller.abort(new DOMException("Client disconnected", "AbortError"));
    assert.equal(observedSignal.aborted, true, "caller abort must reach the transport signal");

    const error = new Error("cancelled");
    error.code = "provider_aborted";
    throw error;
  };

  await assert.rejects(
    validateMunicipalMoneyMembership(validParameters, {
      signal: caller.signal,
      requestPinnedImpl,
    }),
    (error) => error instanceof MunicipalMoneyError &&
      error.code === "provider_metadata_unavailable",
  );
  assert.equal(observedSignal.aborted, true);
});

test("maps pinned transport timeouts to sanitized metadata and provider errors", async () => {
  clearMunicipalMoneyMemberCacheForTests();
  const metadataTimeout = async () => {
    const error = new Error("sensitive socket details");
    error.code = "provider_timeout";
    throw error;
  };

  await assert.rejects(
    validateMunicipalMoneyMembership(validParameters, {
      requestPinnedImpl: metadataTimeout,
    }),
    (error) => error instanceof MunicipalMoneyError &&
      error.code === "provider_metadata_timeout" &&
      !error.message.includes("sensitive"),
  );

  clearMunicipalMoneyMemberCacheForTests();
  let calls = 0;
  const requestPinnedImpl = async (url) => {
    const parsed = new URL(url);
    calls += 1;
    if (parsed.pathname.endsWith("/members/demarcation")) {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: new TextEncoder().encode(JSON.stringify({
          status: "ok",
          total_member_count: 1,
          data: [{ "demarcation.code": "JHB" }],
        })),
      };
    }
    if (parsed.pathname.endsWith("/members/amount_type")) {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: new TextEncoder().encode(JSON.stringify({
          status: "ok",
          total_member_count: 1,
          data: [{ "amount_type.code": "ACT" }],
        })),
      };
    }
    if (parsed.pathname.endsWith("/members/item")) {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: new TextEncoder().encode(JSON.stringify({
          status: "ok",
          total_member_count: 1,
          data: [{ "item.code": "0200" }],
        })),
      };
    }
    const error = new Error("sensitive socket details");
    error.code = "provider_timeout";
    throw error;
  };

  await assert.rejects(
    fetchMunicipalMoneyFacts(validParameters, { requestPinnedImpl }),
    (error) => error instanceof MunicipalMoneyError &&
      error.code === "provider_timeout" &&
      !error.message.includes("sensitive"),
  );
  assert.equal(calls, 4);
});
