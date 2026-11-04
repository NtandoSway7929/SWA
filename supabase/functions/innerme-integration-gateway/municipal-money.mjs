import { requestPinnedMunicipalMoney } from "./pinned-http.mjs";

export const MUNICIPAL_MONEY_PROVIDER = "national_treasury_municipal_money";
export const MUNICIPAL_MONEY_CAPABILITY = "za.municipal_money.income_expenditure.read";
export const MUNICIPAL_MONEY_API_ORIGIN = "https://municipaldata.treasury.gov.za";
export const MUNICIPAL_MONEY_API_PATH = "/api/cubes/incexp_v2/facts";
export const MUNICIPAL_MONEY_SOURCE_URL = "https://municipaldata.treasury.gov.za";
export const MUNICIPAL_MONEY_TERMS_URL = "https://municipalmoney.gov.za/terms";
export const MUNICIPAL_MONEY_DOCS_URL = "https://municipaldata.treasury.gov.za/docs";
export const MAX_PAGE_SIZE = 100;
export const MAX_PAGE = 1000;
export const MAX_RESPONSE_BYTES = 512 * 1024;
export const REQUEST_TIMEOUT_MS = 8_000;

const ALLOWED_PARAMETERS = new Set([
  "municipality_code",
  "financial_year",
  "financial_period",
  "amount_type_code",
  "item_code",
  "page",
  "page_size",
]);

export class MunicipalMoneyError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "MunicipalMoneyError";
    this.code = code;
    this.status = status;
  }
}

function getProviderFetch(options = {}) {
  if (typeof options.fetchImpl === "function") return options.fetchImpl;

  // The pinned transport is the production default. Fetch remains injectable
  // solely as a provider-free test seam.
  const requestPinned = options.requestPinnedImpl || requestPinnedMunicipalMoney;
  return async (url, init = {}) => {
    if (init.method !== "GET" || init.redirect !== "manual") {
      throw new MunicipalMoneyError(
        "provider_request_rejected",
        "Only the approved manual-redirect GET request is supported.",
        500,
      );
    }

    const result = await requestPinned(url, {
      timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
      maxResponseBytes: options.maxResponseBytes ?? MAX_RESPONSE_BYTES,
      ...(options.transportRuntime ? { runtime: options.transportRuntime } : {}),
      ...(options.transportAddressPolicy
        ? { addressPolicy: options.transportAddressPolicy }
        : {}),
    });

    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    });
  };
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredString(
  value,
  field,
  pattern,
  description,
) {
  if (typeof value !== "string") {
    throw new MunicipalMoneyError("invalid_parameter", `${field} must be a string.`);
  }
  const normalized = value.trim();
  if (!pattern.test(normalized)) {
    throw new MunicipalMoneyError("invalid_parameter", `${field} ${description}`);
  }
  return normalized;
}

function boundedInteger(
  value,
  field,
  min,
  max,
  fallback,
) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isInteger(candidate) || Number(candidate) < min || Number(candidate) > max) {
    throw new MunicipalMoneyError(
      "invalid_parameter",
      `${field} must be an integer between ${min} and ${max}.`,
    );
  }
  return Number(candidate);
}

export function validateMunicipalMoneyParameters(input) {
  if (!isPlainObject(input)) {
    throw new MunicipalMoneyError("invalid_parameters", "parameters must be a JSON object.");
  }

  for (const key of Object.keys(input)) {
    if (!ALLOWED_PARAMETERS.has(key)) {
      throw new MunicipalMoneyError("unsupported_parameter", `Unsupported parameter: ${key}.`);
    }
  }

  const municipalityCode = requiredString(
    input.municipality_code,
    "municipality_code",
    /^[A-Z0-9]{2,8}$/,
    "must use 2-8 uppercase letters or digits.",
  );
  const amountTypeCode = requiredString(
    input.amount_type_code,
    "amount_type_code",
    /^[A-Z0-9_-]{1,16}$/,
    "must use 1-16 uppercase letters, digits, underscores or hyphens.",
  );

  const financialYear = boundedInteger(input.financial_year, "financial_year", 2020, 2035);
  const financialPeriod = boundedInteger(input.financial_period, "financial_period", 1, 12);
  const page = boundedInteger(input.page, "page", 1, MAX_PAGE, 1);
  const pageSize = boundedInteger(input.page_size, "page_size", 1, MAX_PAGE_SIZE, 50);

  let itemCode;
  if (input.item_code !== undefined) {
    itemCode = requiredString(
      input.item_code,
      "item_code",
      /^\d{4}$/,
      "must be a four-digit item code.",
    );
  }

  return {
    municipality_code: municipalityCode,
    financial_year: financialYear,
    financial_period: financialPeriod,
    amount_type_code: amountTypeCode,
    ...(itemCode ? { item_code: itemCode } : {}),
    page,
    page_size: pageSize,
  };
}

export function buildMunicipalMoneyFactsUrl(input) {
  const parameters = validateMunicipalMoneyParameters(input);
  const url = new URL(MUNICIPAL_MONEY_API_PATH, MUNICIPAL_MONEY_API_ORIGIN);
  const cuts = [
    `demarcation.code:"${parameters.municipality_code}"`,
    `financial_year_end.year:${parameters.financial_year}`,
    `financial_period.period:${parameters.financial_period}`,
    `amount_type.code:"${parameters.amount_type_code}"`,
  ];

  if (parameters.item_code) cuts.push(`item.code:"${parameters.item_code}"`);

  url.searchParams.set("cut", cuts.join("|"));
  url.searchParams.set("page", String(parameters.page));
  url.searchParams.set("pagesize", String(parameters.page_size));
  url.searchParams.set("format", "json");

  if (
    url.protocol !== "https:" ||
    url.hostname !== "municipaldata.treasury.gov.za" ||
    url.pathname !== MUNICIPAL_MONEY_API_PATH
  ) {
    throw new MunicipalMoneyError("destination_rejected", "Provider destination is not approved.", 500);
  }

  return url;
}

const MEMBER_CATALOGUES = Object.freeze({
  municipality_code: { member: "demarcation", field: "demarcation.code" },
  amount_type_code: { member: "amount_type", field: "amount_type.code" },
  item_code: { member: "item", field: "item.code" },
});
const MEMBER_CATALOGUE_PAGE_SIZE = 1000;
const MEMBER_CATALOGUE_CACHE_TTL_MS = 10 * 60 * 1000;
const memberCatalogueCache = new Map();

export function clearMunicipalMoneyMemberCacheForTests() {
  memberCatalogueCache.clear();
}

async function fetchMunicipalMoneyMemberCodes(parameterName, options = {}) {
  const definition = MEMBER_CATALOGUES[parameterName];
  if (!definition) {
    throw new MunicipalMoneyError("unsupported_member_catalogue", "The requested provider catalogue is not approved.", 500);
  }

  const nowMs = options.nowMs || Date.now;
  const cached = memberCatalogueCache.get(definition.member);
  if (cached && cached.expiresAt > nowMs()) return cached.codes;

  const fetchImpl = getProviderFetch(options);
  const url = new URL(
    `/api/cubes/incexp_v2/members/${definition.member}`,
    MUNICIPAL_MONEY_API_ORIGIN,
  );
  url.searchParams.set("page", "1");
  url.searchParams.set("pagesize", String(MEMBER_CATALOGUE_PAGE_SIZE));
  url.searchParams.set("format", "json");

  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "InnerMe-ReadOnly-Integration/1.0",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const isTimeout = (error instanceof DOMException && error.name === "TimeoutError") ||
      error?.code === "provider_timeout";
    const isRedirect = error?.code === "provider_redirect_rejected";
    throw new MunicipalMoneyError(
      isTimeout
        ? "provider_metadata_timeout"
        : isRedirect
        ? "provider_metadata_redirect_rejected"
        : "provider_metadata_unavailable",
      isTimeout
        ? "Provider metadata lookup timed out."
        : isRedirect
        ? "Provider metadata redirects are not accepted."
        : "Provider metadata is temporarily unavailable.",
      502,
    );
  }

  if (response.status >= 300 && response.status < 400) {
    throw new MunicipalMoneyError("provider_metadata_redirect_rejected", "Provider metadata redirects are not accepted.", 502);
  }
  if (!response.ok) {
    throw new MunicipalMoneyError("provider_metadata_http_error", "Provider metadata lookup failed.", 502);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new MunicipalMoneyError("provider_metadata_content_type_rejected", "Provider metadata was not JSON.", 502);
  }

  let payload;
  try {
    payload = JSON.parse(await readBoundedBody(response, options.maxResponseBytes ?? MAX_RESPONSE_BYTES));
  } catch (error) {
    if (error instanceof MunicipalMoneyError) throw error;
    throw new MunicipalMoneyError("provider_metadata_invalid_json", "Provider metadata was invalid.", 502);
  }

  if (
    !isPlainObject(payload) ||
    payload.status !== "ok" ||
    !Array.isArray(payload.data) ||
    !Number.isInteger(payload.total_member_count) ||
    payload.total_member_count < 0 ||
    payload.total_member_count > MEMBER_CATALOGUE_PAGE_SIZE ||
    payload.data.length !== payload.total_member_count ||
    payload.data.length > MEMBER_CATALOGUE_PAGE_SIZE
  ) {
    throw new MunicipalMoneyError(
      "provider_metadata_invalid_response",
      "Provider metadata could not be validated completely.",
      502,
    );
  }

  const codes = new Set();
  for (const row of payload.data) {
    if (!isPlainObject(row) || typeof row[definition.field] !== "string") {
      throw new MunicipalMoneyError(
        "provider_metadata_invalid_response",
        "Provider metadata contained an invalid member.",
        502,
      );
    }
    codes.add(row[definition.field]);
  }

  memberCatalogueCache.set(definition.member, {
    codes,
    expiresAt: nowMs() + MEMBER_CATALOGUE_CACHE_TTL_MS,
  });
  return codes;
}

export async function validateMunicipalMoneyMembership(input, options = {}) {
  const parameters = validateMunicipalMoneyParameters(input);
  const membersToCheck = [
    ["municipality_code", parameters.municipality_code],
    ["amount_type_code", parameters.amount_type_code],
    ...(parameters.item_code ? [["item_code", parameters.item_code]] : []),
  ];

  for (const [parameterName, value] of membersToCheck) {
    const codes = await fetchMunicipalMoneyMemberCodes(parameterName, options);
    if (!codes.has(value)) {
      throw new MunicipalMoneyError(
        "unknown_provider_member",
        `The supplied ${parameterName} is not present in the current provider catalogue.`,
        400,
      );
    }
  }
}

export function normalizeMunicipalMoneyResponse(
  payload,
  parameters,
  sourceUrl,
  retrievedAt = new Date().toISOString(),
) {
  if (
    !isPlainObject(payload) ||
    payload.status !== "ok" ||
    !Array.isArray(payload.data) ||
    !Array.isArray(payload.fields) ||
    !payload.fields.every((field) => typeof field === "string") ||
    !payload.fields.includes("amount")
  ) {
    throw new MunicipalMoneyError(
      "invalid_provider_response",
      "The provider returned an unexpected response.",
      502,
    );
  }

  if (
    (payload.page !== undefined && (!Number.isInteger(payload.page) || payload.page < 1)) ||
    (payload.page_size !== undefined && (!Number.isInteger(payload.page_size) || payload.page_size < 1 || payload.page_size > 10_000)) ||
    (payload.total_fact_count !== undefined && (!Number.isInteger(payload.total_fact_count) || payload.total_fact_count < 0))
  ) {
    throw new MunicipalMoneyError(
      "invalid_provider_pagination",
      "The provider returned invalid pagination metadata.",
      502,
    );
  }

  if (payload.data.length > parameters.page_size) {
    throw new MunicipalMoneyError(
      "provider_page_limit_exceeded",
      "The provider returned more records than the requested page limit.",
      502,
    );
  }

  const fields = Array.isArray(payload.fields)
    ? payload.fields.filter((field) => typeof field === "string").slice(0, 100)
    : [];

  const records = payload.data.map((record) => {
    if (!isPlainObject(record)) {
      throw new MunicipalMoneyError(
        "invalid_provider_record",
        "The provider returned a malformed record.",
        502,
      );
    }

    const sourceAmount = record.amount;
    if (
      sourceAmount !== null &&
      (!Number.isSafeInteger(sourceAmount) || typeof sourceAmount !== "number")
    ) {
      throw new MunicipalMoneyError(
        "invalid_provider_amount",
        "The provider returned an invalid monetary amount.",
        502,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(record, "amount")) {
      throw new MunicipalMoneyError(
        "invalid_provider_amount",
        "The provider record did not include a monetary amount.",
        502,
      );
    }
    const normalizedAmount = sourceAmount === null ? 0 : sourceAmount;

    return {
      ...record,
      amount: normalizedAmount,
      amount_source_value: sourceAmount === undefined ? null : sourceAmount,
      amount_interpretation:
        sourceAmount === null || sourceAmount === 0
          ? "The source documentation notes that null or zero may indicate no value was submitted; null is treated as zero by the provider's guidance."
          : "Source-reported amount; no independent validation performed.",
    };
  });

  return {
    provider: MUNICIPAL_MONEY_PROVIDER,
    capability: MUNICIPAL_MONEY_CAPABILITY,
    source_url: sourceUrl,
    retrieved_at: retrievedAt,
    dataset: "incexp_v2",
    query: parameters,
    status: "ok",
    trust_boundary: "untrusted_external_data",
    fields,
    records,
    pagination: {
      page: Number.isInteger(payload.page) ? payload.page : parameters.page,
      page_size: Number.isInteger(payload.page_size)
        ? Math.min(payload.page_size, MAX_PAGE_SIZE)
        : parameters.page_size,
      total_fact_count: Number.isInteger(payload.total_fact_count)
        ? payload.total_fact_count
        : null,
    },
    attribution: {
      source: "National Treasury, Municipal Money",
      publication_date: null,
      terms_url: MUNICIPAL_MONEY_TERMS_URL,
      documentation_url: MUNICIPAL_MONEY_DOCS_URL,
      notice: "National Treasury does not endorse this product or any analysis derived from the data.",
    },
    limitations: [
      "Municipal Money is updated quarterly from snapshots of municipal submissions.",
      "Completeness and trustworthiness depend on the information submitted by each municipality.",
      "The provider documentation states that null or zero values may indicate no further value was supplied; null should be treated as zero.",
      "No independent reconciliation against Treasury reports has been performed by this gateway.",
    ],
  };
}

async function readBoundedBody(response, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) {
    throw new MunicipalMoneyError("provider_response_too_large", "Provider response exceeded the size limit.", 502);
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new MunicipalMoneyError(
          "provider_response_too_large",
          "Provider response exceeded the size limit.",
          502,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(joined);
}

export async function fetchMunicipalMoneyFacts(input, options = {}) {
  const parameters = validateMunicipalMoneyParameters(input);
  await validateMunicipalMoneyMembership(parameters, options);
  const url = buildMunicipalMoneyFactsUrl(parameters);
  const fetchImpl = getProviderFetch(options);
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;

  const signal = AbortSignal.timeout(timeoutMs);
  let response;

  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "InnerMe-ReadOnly-Integration/1.0",
      },
      redirect: "manual",
      signal,
    });
  } catch (error) {
    const isTimeout = (error instanceof DOMException && error.name === "TimeoutError") ||
      error?.code === "provider_timeout";
    const isRedirect = error?.code === "provider_redirect_rejected";
    throw new MunicipalMoneyError(
      isTimeout
        ? "provider_timeout"
        : isRedirect
        ? "provider_redirect_rejected"
        : "provider_unavailable",
      isTimeout
        ? "The provider request timed out."
        : isRedirect
        ? "Provider redirects are not accepted."
        : "The provider could not be reached.",
      502,
    );
  }

  if (response.status >= 300 && response.status < 400) {
    throw new MunicipalMoneyError(
      "provider_redirect_rejected",
      "Provider redirects are not accepted.",
      502,
    );
  }

  if (!response.ok) {
    throw new MunicipalMoneyError(
      "provider_http_error",
      `The provider returned HTTP ${response.status}.`,
      502,
    );
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new MunicipalMoneyError(
      "provider_content_type_rejected",
      "The provider did not return JSON.",
      502,
    );
  }

  let payload;
  try {
    payload = JSON.parse(await readBoundedBody(response, maxResponseBytes));
  } catch (error) {
    if (error instanceof MunicipalMoneyError) throw error;
    throw new MunicipalMoneyError(
      "provider_invalid_json",
      "The provider returned invalid JSON.",
      502,
    );
  }

  const sourceUrl = url.toString();
  const now = options.now || (() => new Date());
  return normalizeMunicipalMoneyResponse(payload, parameters, sourceUrl, now().toISOString());
}
