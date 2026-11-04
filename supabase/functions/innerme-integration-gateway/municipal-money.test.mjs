import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PAGE_SIZE,
  MUNICIPAL_MONEY_API_ORIGIN,
  MUNICIPAL_MONEY_API_PATH,
  MunicipalMoneyError,
  buildMunicipalMoneyFactsUrl,
  fetchMunicipalMoneyFacts,
  normalizeMunicipalMoneyResponse,
  validateMunicipalMoneyParameters,
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

test("rejects malformed provider payloads and excessive provider rows", () => {
  assert.throws(
    () => normalizeMunicipalMoneyResponse({ status: "error", data: [] }, validParameters, "https://source.test"),
    (error) => error instanceof MunicipalMoneyError && error.code === "invalid_provider_response",
  );
  assert.throws(
    () => normalizeMunicipalMoneyResponse(
      { status: "ok", data: Array.from({ length: 26 }, () => ({ amount: 1 })) },
      validParameters,
      "https://source.test",
    ),
    (error) => error instanceof MunicipalMoneyError && error.code === "provider_page_limit_exceeded",
  );
});

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
    { fetchImpl, now: () => new Date("2026-11-04T12:00:00.000Z") },
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
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/" },
      }),
    }),
    (error) => error instanceof MunicipalMoneyError && error.code === "provider_redirect_rejected",
  );
});

test("rejects non-JSON provider responses and non-success HTTP statuses", async () => {
  await assert.rejects(
    fetchMunicipalMoneyFacts(validParameters, {
      fetchImpl: async () => new Response("upstream error", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    }),
    (error) => error instanceof MunicipalMoneyError && error.code === "provider_content_type_rejected",
  );

  await assert.rejects(
    fetchMunicipalMoneyFacts(validParameters, {
      fetchImpl: async () => new Response("unavailable", { status: 503 }),
    }),
    (error) => error instanceof MunicipalMoneyError && error.code === "provider_http_error",
  );
});

test("rejects oversized provider bodies", async () => {
  const largeBody = JSON.stringify({ status: "ok", data: [{ amount: "x".repeat(2048) }] });
  await assert.rejects(
    fetchMunicipalMoneyFacts(validParameters, {
      maxResponseBytes: 128,
      fetchImpl: async () => new Response(largeBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    (error) => error instanceof MunicipalMoneyError && error.code === "provider_response_too_large",
  );
});

test("provider errors are returned as sanitized integration errors", async () => {
  await assert.rejects(
    fetchMunicipalMoneyFacts(validParameters, {
      fetchImpl: async () => {
        throw new Error("secret upstream hostname and token");
      },
    }),
    (error) => error instanceof MunicipalMoneyError &&
      error.code === "provider_unavailable" &&
      !error.message.includes("secret"),
  );
});
