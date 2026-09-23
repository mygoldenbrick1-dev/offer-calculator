import test from "node:test";
import assert from "node:assert/strict";

import { anchorSummary, filterComps, initialCompFilters, normalizeAnchorReport } from "../src/anchorReport.js";

function compDocument(overrides = {}) {
  return {
    role: "closed_top_4_comp",
    schemaId: "comp",
    data: {
      compID: overrides.id || "comp-1",
      distance: overrides.distance ?? 0.2,
      adjustedSalePrice: overrides.salePrice ?? 240000,
      adjustedListPrice: overrides.listPrice ?? 250000,
      similarity: { scoreAdjusted: 0.91 },
      propertyState: {
        location: { address: "1200 Main St", city: "Kansas City", state: "MO", zipcode: "64105" },
        propertyDetails: { bedrooms: overrides.beds ?? 3, bathrooms: { totalProjected: 2 }, livingArea: 1500 },
        complexFieldsSale: {
          currentStatus: "Closed",
          currentStatusDate: overrides.saleDate || "2026-08-01",
          currentDaysOnMarketCumulative: 18,
        },
        propertyValue: { valueAtSixConditions: { conditionClass: 3 } },
      },
    },
  };
}

const payload = {
  "property/agile_insights_static_data": {
    data: {
      effectiveDate: "2026-09-01",
      documents: [
        {
          role: "subject",
          schemaId: "subject",
          data: { propertyState: {
            location: { address: "1100 Main St", city: "Kansas City", state: "MO", zipcode: "64105" },
            propertyDetails: { bedrooms: 3, bathrooms: { totalProjected: 2 }, livingArea: 1450 },
            propertyValue: { value: 245000 },
          } },
        },
        compDocument(),
        compDocument(),
        compDocument({ id: "comp-2", distance: 0.4, beds: 4, saleDate: "2026-02-01", salePrice: 260000 }),
      ],
    },
  },
};

test("normalizes and deduplicates closed HouseCanary comps", () => {
  const report = normalizeAnchorReport(payload);
  assert.equal(report.subject.beds, 3);
  assert.equal(report.comps.length, 2);
  assert.equal(report.comps[0].condition, "Average");
  assert.equal(report.comps[0].daysOnMarket, 18);
  assert.equal(report.comps[0].saleToListRatio, 0.96);
  assert.equal(report.comps[0].pricePerSqft, 160);
});

test("filters comps by radius, date, and subject bed count", () => {
  const report = normalizeAnchorReport(payload);
  assert.equal(filterComps(report.comps, report.subject, {
    radius: 0.3,
    months: 6,
    bedTolerance: 0,
  }, new Date("2026-09-10")).length, 1);
  assert.equal(filterComps(report.comps, report.subject, {
    radius: 0.5,
    months: 12,
    bedTolerance: 1,
  }, new Date("2026-09-10")).length, 2);
});

test("widens initial filters only when strict defaults return no comps", () => {
  const report = normalizeAnchorReport(payload);
  const defaults = { radius: 0.3, months: 6, bedTolerance: 0, condition: "all" };

  assert.deepEqual(initialCompFilters(report.comps, report.subject, defaults, new Date("2026-09-10")), defaults);
  assert.deepEqual(
    initialCompFilters([report.comps[1]], report.subject, defaults, new Date("2026-09-10")),
    { ...defaults, radius: 1, months: 12, bedTolerance: 1 },
  );
});

test("calculates median anchor price and average price per sqft", () => {
  assert.deepEqual(anchorSummary([
    { salePrice: 200000, pricePerSqft: 150 },
    { salePrice: 240000, pricePerSqft: 170 },
  ]), { anchorPrice: 220000, averagePricePerSqft: 160 });
});
