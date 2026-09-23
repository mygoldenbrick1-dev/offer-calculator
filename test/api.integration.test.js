import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

import { createRateLimiter, localApi } from "../vite.config.js";

const credentials = { HOUSECANARY_API_KEY: "test-key", HOUSECANARY_API_SECRET: "test-secret" };

function providerResponse(url, calls) {
  calls.push(url.pathname);
  if (url.pathname.endsWith("/agile_insights_static")) {
    return Response.json({
      "property/agile_insights_static_data": { data: { effectiveDate: "2026-09-01", documents: [
        { role: "subject", schemaId: "subject", data: { propertyState: {
          location: { address: "1100 Main St", city: "Kansas City", state: "MO", zipcode: "64105" },
          propertyDetails: { bedrooms: 3, bathrooms: { totalProjected: 2 }, livingArea: 1500 },
          propertyValue: { value: 250000 },
        } } },
        { role: "closed_top_4_comp", schemaId: "comp", data: {
          compID: "comp-1",
          distance: 0.2,
          adjustedSalePrice: 240000,
          adjustedListPrice: 250000,
          propertyState: {
            location: { address: "1200 Main St", city: "Kansas City", state: "MO", zipcode: "64105" },
            propertyDetails: { bedrooms: 3, bathrooms: { totalProjected: 2 }, livingArea: 1500 },
            complexFieldsSale: { currentStatus: "Closed", currentStatusDate: "2026-08-01", currentDaysOnMarketCumulative: 18 },
            propertyValue: { valueAtSixConditions: { conditionClass: 3 } },
          },
        } },
      ] } },
    });
  }
  if (url.pathname.endsWith("/rental_report")) {
    return new Response("PK", { status: 200, headers: { "Content-Type": "application/zip" } });
  }
  if (url.pathname.startsWith("/v3/")) {
    return Response.json({ subject_address: {}, public_records: { year_built: 2001 } });
  }

  const payloadKey = url.pathname.replace(/^\/v2\//, "");
  const result = payloadKey === "property/details"
    ? { property: { number_of_bedrooms: 3, total_bath_count: 2, building_area_sq_ft: 1500 } }
    : payloadKey === "property/value"
      ? { value: { price_mean: 250000, price_lwr: 230000, price_upr: 270000, fsd: 0.08 } }
      : { sample: true };
  return Response.json([{ [payloadKey]: { api_code: 0, api_code_description: "ok", result } }]);
}

async function startApi(fetchImpl) {
  const logs = [];
  const logger = {
    info: (message) => logs.push(message),
    error: (message) => logs.push(message),
  };
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
    plugins: [localApi(credentials, { fetchImpl, logger })],
  });
  await server.listen();
  const address = server.httpServer.address();
  return {
    server,
    logs,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

test("validates requests before calling HouseCanary", async (context) => {
  let upstreamCalls = 0;
  const api = await startApi(async () => {
    upstreamCalls += 1;
    return Response.json({});
  });
  context.after(() => api.server.close());

  const response = await fetch(`${api.baseUrl}/api/housecanary/value?address=x&zipcode=bad`);
  assert.equal(response.status, 400);
  assert.equal(upstreamCalls, 0);
  assert.ok(response.headers.get("x-request-id"));
});

test("maps valuation and returns a timeout status", async (context) => {
  const calls = [];
  const api = await startApi((url) => providerResponse(new URL(url), calls));
  context.after(() => api.server.close());

  const response = await fetch(`${api.baseUrl}/api/housecanary/value?address=1100+Main+St&zipcode=64105`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.arv, 250000);

  await api.server.close();
  const timeoutApi = await startApi(async () => {
    const error = new Error("timed out");
    error.name = "TimeoutError";
    throw error;
  });
  context.after(() => timeoutApi.server.close());
  const timeoutResponse = await fetch(`${timeoutApi.baseUrl}/api/housecanary/value?address=1100+Main+St&zipcode=64105`);
  assert.equal(timeoutResponse.status, 504);
});

test("caches all insight products after the first request", async (context) => {
  const calls = [];
  const api = await startApi((url) => providerResponse(new URL(url), calls));
  context.after(() => api.server.close());
  const url = `${api.baseUrl}/api/housecanary/property-insights?address=1100+Main+St&zipcode=64105`;

  const first = await fetch(url);
  const second = await fetch(url);
  const payload = await second.json();

  assert.equal(first.headers.get("x-cache"), "MISS");
  assert.equal(second.headers.get("x-cache"), "HIT");
  assert.equal(calls.length, 11);
  assert.equal(payload.property.sqft, 1500);
  assert.equal(payload.insights.length, 11);
  assert.ok(api.logs.some((entry) => entry.includes('"cache":"HIT"')));
  assert.ok(api.logs.every((entry) => !entry.includes("1100 Main")));
});

test("rate limiter returns a retry window", () => {
  const limit = createRateLimiter({ max: 2, windowMs: 1000 });
  assert.equal(limit("client", 0).allowed, true);
  assert.equal(limit("client", 1).allowed, true);
  assert.deepEqual(limit("client", 2), { allowed: false, retryAfter: 1 });
  assert.equal(limit("client", 1000).allowed, true);
});

test("mounted insights route enforces its request limit", async (context) => {
  const calls = [];
  const api = await startApi((url) => providerResponse(new URL(url), calls));
  context.after(() => api.server.close());
  const url = `${api.baseUrl}/api/housecanary/property-insights?address=1200+Main+St&zipcode=64105`;

  let response;
  for (let request = 0; request < 13; request += 1) response = await fetch(url);

  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("retry-after")) > 0);
  assert.equal(calls.length, 11);
});

test("returns normalized comps and caches the Agile report", async (context) => {
  const calls = [];
  const api = await startApi((url) => providerResponse(new URL(url), calls));
  context.after(() => api.server.close());
  const url = `${api.baseUrl}/api/housecanary/comps?address=1100+Main+St&zipcode=64105`;

  const first = await fetch(url);
  const payload = await first.json();
  const second = await fetch(url);

  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-cache"), "MISS");
  assert.equal(second.headers.get("x-cache"), "HIT");
  assert.equal(calls.filter((path) => path.endsWith("agile_insights_static")).length, 1);
  assert.equal(payload.subject.beds, 3);
  assert.equal(payload.comps[0].condition, "Average");
  assert.equal(payload.comps[0].daysOnMarket, 18);
  assert.equal(payload.comps[0].pricePerSqft, 160);
  assert.equal(JSON.stringify(payload).includes("data_link"), false);
});
