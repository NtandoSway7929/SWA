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
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "MunicipalMoneyError";
    this.code = code;
    this.status = status;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredString(
  value: unknown,
  field: string,
  pattern: RegExp,
  description: string,
): string {
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
  value: unknown,
  field: string,
  min: number,
  max: number,
  fallback?: number,
): number {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isInteger(candidate) || Number(candidate) < min || Number(candidate) > max) {
    throw new MunicipalMoneyError(
      "invalid_parameter",
      `${field} must be an integer between ${min} and ${max}.`,
    );
  }
  return Number(candidate);
}

export function validateMunicipalMoneyParameters(input: unknown) {
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

  let itemCode: string | undefined;
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

export function buildMunicipalMoneyFactsUrl(input: unknown): URL {
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

export function normalizeMunicipalMoneyResponse(
  payload: unknown,
  parameters: ReturnType<typeof validateMunicipalMoneyParameters>,
  sourceUrl: string,
  retrievedAt = new Date().toISOString(),
) {
  if (!isPlainObject(payload) || payload.status !== "ok" || !Array.isArray(payload.data)) {
    throw new MunicipalMoneyError(
      "invalid_provider_response",
      "The provider returned an unexpected response.",
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

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) {
    throw new MunicipalMoneyError("provider_response_too_large", "Provider response exceeded the size limit.", 502);
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
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

export async function fetchMunicipalMoneyFacts(
  input: unknown,
  options: {
    fetchImpl?: typeof fetch;
    now?: () => Date;
    timeoutMs?: number;
    maxResponseBytes?: number;
  } = {},
) {
  const parameters = validateMunicipalMoneyParameters(input);
  const url = buildMunicipalMoneyFactsUrl(parameters);
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;

  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;

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
    const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
    throw new MunicipalMoneyError(
      isTimeout ? "provider_timeout" : "provider_unavailable",
      isTimeout ? "The provider request timed out." : "The provider could not be reached.",
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

  let payload: unknown;
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
