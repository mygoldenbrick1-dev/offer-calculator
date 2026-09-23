import test from "node:test";
import assert from "node:assert/strict";

import { dealSummaryLines } from "../src/dealExport.js";

test("builds a complete PDF and clipboard summary", () => {
  const lines = dealSummaryLines({
    address: "1100 Main St, Kansas City, MO 64105",
    addressVerified: true,
    meta: "3 bed · 2 bath · 1,500 sqft",
    generatedAt: "2026-09-09T12:00:00.000Z",
    arv: 250000,
    purchasePrice: 100000,
    totalAdjustments: -5000,
    adjustedArv: 245000,
    rehab: 30000,
    rehabAdjustments: 15000,
    effectiveRehab: 45000,
    holdCost: 5000,
    closeCost: 5000,
    formulaStr: "ARV x 70% - Rehab",
    mao: 126500,
    targetProfit: 68500,
    offer: 125000,
    adjProfit: 70000,
    adjMarginPct: 28.57,
    mode: "70",
  });

  assert.ok(lines.includes("3 bed · 2 bath · 1,500 sqft"));
  assert.ok(lines.includes("Paint / Roof Additions: $15,000"));
  assert.ok(lines.includes("Max Allowable Offer: $126,500"));
});
