import test from "node:test";
import assert from "node:assert/strict";

import { formatPropertyMeta, geocodeAddress, getHouseCanaryComps, getHouseCanaryInsights, getHouseCanaryValue } from "../src/propertyApi.js";

test("maps geocoder matches", async () => {
  const matches = [{ matchedAddress: "1100 MAIN ST, KANSAS CITY, MO, 64105" }];
  const fetchMock = async (url) => {
    assert.match(url, /^\/api\/geocode\?address=/);
    return { ok: true, json: async () => ({ matches }) };
  };

  assert.deepEqual(await geocodeAddress("1100 Main St", undefined, fetchMock), matches);
});

test("maps a successful HouseCanary valuation", async () => {
  const valuation = { arv: 210000, priceLow: 195000, priceHigh: 225000, source: "HouseCanary" };
  const fetchMock = async (url) => {
    assert.equal(url, "/api/housecanary/value?address=1100+Main+St&zipcode=64105");
    return { ok: true, json: async () => valuation };
  };

  assert.deepEqual(
    await getHouseCanaryValue("1100 Main St, Kansas City, MO, 64105", undefined, fetchMock),
    valuation,
  );
});

test("surfaces HouseCanary provider errors", async () => {
  const fetchMock = async () => ({ ok: false, status: 404, json: async () => ({ error: "no content" }) });

  await assert.rejects(
    getHouseCanaryValue("1100 Main St, Kansas City, MO, 64105", undefined, fetchMock),
    /no content/,
  );
});

test("requires a ZIP code before requesting valuation", async () => {
  await assert.rejects(getHouseCanaryValue("1100 Main St"), /ZIP code/);
});

test("maps HouseCanary property insights", async () => {
  const insights = [{ endpoint: "property/details", status: "available", fields: [] }];
  const fetchMock = async (url) => {
    assert.equal(url, "/api/housecanary/property-insights?address=1100+Main+St&zipcode=64105");
    return { ok: true, json: async () => ({ source: "HouseCanary", insights }) };
  };

  assert.deepEqual(
    await getHouseCanaryInsights("1100 Main St, Kansas City, MO, 64105", undefined, fetchMock),
    { source: "HouseCanary", insights },
  );
});

test("uses the final ZIP when the street number has five digits", async () => {
  const fetchMock = async (url) => {
    assert.equal(url, "/api/housecanary/value?address=17130+Valley+Dr&zipcode=68130");
    return { ok: true, json: async () => ({ arv: 250000 }) };
  };

  await getHouseCanaryValue("17130 Valley Dr, Omaha, NE, 68130", undefined, fetchMock);
});

test("extracts the street from an address without commas", async () => {
  const fetchMock = async (url) => {
    assert.equal(url, "/api/housecanary/comps?address=17130+valley+Dr&zipcode=68130");
    return { ok: true, json: async () => ({ comps: [] }) };
  };

  await getHouseCanaryComps("17130 valley Dr Omaha Nebraska 68130", undefined, fetchMock);
});

test("formats HouseCanary beds, baths, and square footage", () => {
  assert.equal(
    formatPropertyMeta({ beds: 4, baths: 2.5, sqft: 2841 }),
    "4 bed · 2.5 bath · 2,841 sqft",
  );
  assert.equal(formatPropertyMeta({ beds: 3, baths: null, sqft: 1500 }), "3 bed · 1,500 sqft");
});