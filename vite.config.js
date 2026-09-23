import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { randomUUID } from "node:crypto";
import { normalizeAnchorReport } from "./src/anchorReport.js";

const HOUSECANARY_VALUE_URL = "https://api.housecanary.com/v2/property/value";
const HOUSECANARY_COMPS_URL = "https://api.housecanary.com/v3/property/agile_insights_static";
const CENSUS_GEOCODE_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const UPSTREAM_TIMEOUT_MS = 8000;
const INSIGHTS_CACHE_TTL_MS = 15 * 60 * 1000;
const COMPS_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_INSIGHTS_CACHE_ENTRIES = 100;

const HOUSECANARY_INSIGHTS = [
  { endpoint: "property/details", path: "v2/property/details", payloadKey: "property/details" },
  { endpoint: "property/details_advanced", path: "v3/property/details_advanced", responseType: "unwrapped" },
  { endpoint: "property/mortgage_lien", path: "v2/property/mortgage_lien", payloadKey: "property/mortgage_lien" },
  { endpoint: "property/owner_occupied", path: "v2/property/owner_occupied", payloadKey: "property/owner_occupied" },
  { endpoint: "property/sales_history", path: "v2/property/sales_history", payloadKey: "property/sales_history" },
  { endpoint: "block/rental_value_distribution", path: "v2/property/block_rental_value_distribution", payloadKey: "property/block_rental_value_distribution" },
  { endpoint: "block/value_distribution", path: "v2/property/block_value_distribution", payloadKey: "property/block_value_distribution" },
  { endpoint: "property/rental_report", path: "v2/property/rental_report", responseType: "binary" },
  { endpoint: "property/rental_value", path: "v2/property/rental_value", payloadKey: "property/rental_value" },
  { endpoint: "property/rental_value_forecast", path: "v2/property/rental_value_forecast", payloadKey: "property/rental_value_forecast" },
  { endpoint: "property/rental_value_within_block", path: "v2/property/rental_value_within_block", payloadKey: "property/rental_value_within_block" },
];

export function insightFields(value, prefix = "", fields = []) {
  if (fields.length >= 12 || value == null) return fields;
  if (typeof value !== "object") {
    fields.push({
      label: prefix.split(".").at(-1).replaceAll("_", " "),
      value,
    });
    return fields;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (fields.length >= 12) break;
    insightFields(nestedValue, prefix ? `${prefix}.${key}` : key, fields);
  }
  return fields;
}

export function validAddress(address) {
  return typeof address === "string"
    && address.length >= 3
    && address.length <= 200
    && !/[\u0000-\u001f\u007f]/.test(address);
}

export function createRateLimiter({ max, windowMs }) {
  const clients = new Map();
  return (clientId, now = Date.now()) => {
    const current = clients.get(clientId);
    if (!current || now >= current.resetAt) {
      clients.set(clientId, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfter: 0 };
    }
    current.count += 1;
    return {
      allowed: current.count <= max,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  };
}

function json(res, status, payload) {
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

function validatePropertyRequest(req) {
  const requestUrl = new URL(req.url, "http://localhost");
  const address = requestUrl.searchParams.get("address")?.trim();
  const zipcode = requestUrl.searchParams.get("zipcode")?.trim();
  if (!validAddress(address) || !/^\d{5}(?:-\d{4})?$/.test(zipcode || "")) return null;
  return { address, zipcode };
}

function rateLimit(req, res, limiter) {
  const clientId = req.socket?.remoteAddress || "unknown";
  const result = limiter(clientId);
  if (result.allowed) return true;
  res.setHeader("Retry-After", String(result.retryAfter));
  json(res, 429, { error: "Too many requests" });
  return false;
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  return fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

function logged(endpoint, logger, handler) {
  return async (req, res, next) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    res.setHeader("X-Request-Id", requestId);
    res.on("finish", () => logger.info(JSON.stringify({
      timestamp: new Date().toISOString(),
      requestId,
      endpoint,
      method: req.method,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      cache: res.getHeader("X-Cache") || undefined,
    })));
    try {
      await handler(req, res, next);
    } catch (error) {
      logger.error(JSON.stringify({ timestamp: new Date().toISOString(), requestId, endpoint, error: error.name }));
      if (!res.headersSent) json(res, 500, { error: "Internal server error" });
    }
  };
}

async function requestInsight(config, address, zipcode, authorization, fetchImpl) {
  try {
    const upstreamUrl = new URL(`https://api.housecanary.com/${config.path}`);
    upstreamUrl.searchParams.set("address", address);
    upstreamUrl.searchParams.set("zipcode", zipcode);
    const upstream = await fetchWithTimeout(fetchImpl, upstreamUrl, {
      headers: { Authorization: `Basic ${authorization}` },
    });

    if (upstream.status === 401 || upstream.status === 403) {
      return { endpoint: config.endpoint, status: "access-denied", fields: [] };
    }
    if (!upstream.ok) {
      return { endpoint: config.endpoint, status: "error", fields: [], description: `HouseCanary HTTP ${upstream.status}` };
    }
    if (config.responseType === "binary") {
      return {
        endpoint: config.endpoint,
        status: "available",
        fields: [{ label: "report", value: "ZIP report available" }],
      };
    }

    const payload = await upstream.json();
    if (config.responseType === "unwrapped") {
      const { subject_address: subjectAddress, ...result } = payload;
      return {
        endpoint: config.endpoint,
        status: Object.keys(result).length ? "available" : "no-data",
        fields: insightFields(result),
        description: Object.keys(result).length ? undefined : "No advanced details returned",
      };
    }

    const chunk = Array.isArray(payload) ? payload[0] : payload;
    const insight = chunk?.[config.payloadKey];
    if (!insight || insight.api_code === 204 || insight.result == null) {
      return {
        endpoint: config.endpoint,
        status: "no-data",
        fields: [],
        description: insight?.api_code_description,
      };
    }
    if (insight.api_code && insight.api_code !== 0) {
      return {
        endpoint: config.endpoint,
        status: "error",
        fields: [],
        description: insight.api_code_description || `HouseCanary API code ${insight.api_code}`,
      };
    }

    const response = { endpoint: config.endpoint, status: "available", fields: insightFields(insight.result) };
    if (config.endpoint === "property/details") {
      const property = insight.result.property ?? {};
      response.propertyMeta = {
        beds: property.number_of_bedrooms,
        baths: property.total_bath_count,
        sqft: property.building_area_sq_ft,
      };
    }
    return response;
  } catch {
    return { endpoint: config.endpoint, status: "error", fields: [], description: "HouseCanary request failed" };
  }
}

export function localApi(env, { fetchImpl = fetch, logger = console } = {}) {
  const geocodeLimit = createRateLimiter({ max: 60, windowMs: 60_000 });
  const valueLimit = createRateLimiter({ max: 30, windowMs: 60_000 });
  const insightsLimit = createRateLimiter({ max: 12, windowMs: 60_000 });
  const compsLimit = createRateLimiter({ max: 6, windowMs: 60_000 });
  const insightsCache = new Map();
  const insightsInflight = new Map();
  const compsCache = new Map();
  const compsInflight = new Map();

  async function loadInsights(address, zipcode, authorization) {
    const cacheKey = `${address.toLowerCase()}|${zipcode}`;
    const cached = insightsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { payload: cached.payload, cache: "HIT" };
    if (cached) insightsCache.delete(cacheKey);
    if (insightsInflight.has(cacheKey)) return { payload: await insightsInflight.get(cacheKey), cache: "COALESCED" };

    const request = Promise.all(
      HOUSECANARY_INSIGHTS.map((config) => requestInsight(config, address, zipcode, authorization, fetchImpl)),
    ).then((insights) => {
      const property = insights.find((insight) => insight.propertyMeta)?.propertyMeta;
      const payload = { source: "HouseCanary", property, insights };
      if (insightsCache.size >= MAX_INSIGHTS_CACHE_ENTRIES) {
        insightsCache.delete(insightsCache.keys().next().value);
      }
      insightsCache.set(cacheKey, { payload, expiresAt: Date.now() + INSIGHTS_CACHE_TTL_MS });
      return payload;
    }).finally(() => insightsInflight.delete(cacheKey));

    insightsInflight.set(cacheKey, request);
    return { payload: await request, cache: "MISS" };
  }

  async function loadComps(address, zipcode, authorization) {
    const cacheKey = `${address.toLowerCase()}|${zipcode}`;
    const cached = compsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { payload: cached.payload, cache: "HIT" };
    if (cached) compsCache.delete(cacheKey);
    if (compsInflight.has(cacheKey)) return { payload: await compsInflight.get(cacheKey), cache: "COALESCED" };

    const request = (async () => {
      const upstreamUrl = new URL(HOUSECANARY_COMPS_URL);
      upstreamUrl.searchParams.set("address", address);
      upstreamUrl.searchParams.set("zipcode", zipcode);
      upstreamUrl.searchParams.set("include_report_json", "true");
      const upstream = await fetchWithTimeout(fetchImpl, upstreamUrl, {
        headers: { Authorization: `Basic ${authorization}` },
      }, 20_000);
      const payload = await upstream.json();
      if (!upstream.ok) throw Object.assign(new Error("HouseCanary comp request failed"), { status: upstream.status });
      const report = normalizeAnchorReport(payload);
      if (compsCache.size >= MAX_INSIGHTS_CACHE_ENTRIES) compsCache.delete(compsCache.keys().next().value);
      compsCache.set(cacheKey, { payload: report, expiresAt: Date.now() + COMPS_CACHE_TTL_MS });
      return report;
    })().finally(() => compsInflight.delete(cacheKey));

    compsInflight.set(cacheKey, request);
    return { payload: await request, cache: "MISS" };
  }

  const configureApi = (server) => {
      server.middlewares.use("/api/geocode", logged("geocode", logger, async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "private, max-age=300");
        if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
        if (!rateLimit(req, res, geocodeLimit)) return;
        const requestUrl = new URL(req.url, "http://localhost");
        const address = requestUrl.searchParams.get("address")?.trim();
        if (!validAddress(address)) return json(res, 400, { error: "A valid address is required" });

        try {
          const upstreamUrl = new URL(CENSUS_GEOCODE_URL);
          upstreamUrl.searchParams.set("address", address);
          upstreamUrl.searchParams.set("benchmark", "Public_AR_Current");
          upstreamUrl.searchParams.set("format", "json");
          const upstream = await fetchWithTimeout(fetchImpl, upstreamUrl);
          if (!upstream.ok) {
            return json(res, 502, { error: "Census geocoder request failed" });
          }
          const payload = await upstream.json();
          json(res, 200, { matches: payload?.result?.addressMatches ?? [] });
        } catch (error) {
          json(res, error.name === "TimeoutError" ? 504 : 502, { error: "Census geocoder is currently unavailable" });
        }
      }));

      server.middlewares.use("/api/housecanary/value", logged("housecanary-value", logger, async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");

        if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
        if (!rateLimit(req, res, valueLimit)) return;

        const apiKey = env.HOUSECANARY_API_KEY;
        const apiSecret = env.HOUSECANARY_API_SECRET;
        if (!apiKey || !apiSecret) {
          return json(res, 503, { error: "HouseCanary credentials are not configured" });
        }

        const propertyRequest = validatePropertyRequest(req);
        if (!propertyRequest) return json(res, 400, { error: "A valid street address and ZIP code are required" });
        const { address, zipcode } = propertyRequest;

        try {
          const upstreamUrl = new URL(HOUSECANARY_VALUE_URL);
          upstreamUrl.searchParams.set("address", address);
          upstreamUrl.searchParams.set("zipcode", zipcode);
          const authorization = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
          const upstream = await fetchWithTimeout(fetchImpl, upstreamUrl, {
            headers: { Authorization: `Basic ${authorization}` },
          });
          const payload = await upstream.json();

          if (!upstream.ok) {
            return json(res, upstream.status, { error: "HouseCanary request failed" });
          }

          const value = Array.isArray(payload) ? payload[0]?.["property/value"] : payload?.["property/value"];
          const result = value?.result?.value;
          if (!result?.price_mean) {
            return json(res, 404, { error: "No HouseCanary valuation found for this address" });
          }

          json(res, 200, {
            arv: result.price_mean,
            priceLow: result.price_lwr,
            priceHigh: result.price_upr,
            confidence: result.fsd,
            source: "HouseCanary",
          });
        } catch (error) {
          json(res, error.name === "TimeoutError" ? 504 : 502, { error: "HouseCanary is currently unavailable" });
        }
      }));

      server.middlewares.use("/api/housecanary/property-insights", logged("housecanary-insights", logger, async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "private, max-age=900");

        if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
        if (!rateLimit(req, res, insightsLimit)) return;

        const apiKey = env.HOUSECANARY_API_KEY;
        const apiSecret = env.HOUSECANARY_API_SECRET;
        if (!apiKey || !apiSecret) {
          return json(res, 503, { error: "HouseCanary credentials are not configured" });
        }

        const propertyRequest = validatePropertyRequest(req);
        if (!propertyRequest) return json(res, 400, { error: "A valid street address and ZIP code are required" });
        const { address, zipcode } = propertyRequest;

        const authorization = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
        const result = await loadInsights(address, zipcode, authorization);
        res.setHeader("X-Cache", result.cache);
        json(res, 200, result.payload);
      }));

      server.middlewares.use("/api/housecanary/comps", logged("housecanary-comps", logger, async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "private, max-age=1800");
        if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
        if (!rateLimit(req, res, compsLimit)) return;

        const apiKey = env.HOUSECANARY_API_KEY;
        const apiSecret = env.HOUSECANARY_API_SECRET;
        if (!apiKey || !apiSecret) return json(res, 503, { error: "HouseCanary credentials are not configured" });
        const propertyRequest = validatePropertyRequest(req);
        if (!propertyRequest) return json(res, 400, { error: "A valid street address and ZIP code are required" });

        const authorization = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
        try {
          const result = await loadComps(propertyRequest.address, propertyRequest.zipcode, authorization);
          res.setHeader("X-Cache", result.cache);
          json(res, 200, result.payload);
        } catch (error) {
          const status = error.name === "TimeoutError" ? 504 : error.status || 502;
          json(res, status, { error: status === 504 ? "HouseCanary comp request timed out" : "HouseCanary comps are currently unavailable" });
        }
      }));
  };

  return {
    name: "offer-calculator-api",
    configureServer: configureApi,
    configurePreviewServer: configureApi,
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), localApi(env)],
  };
});
