import test from "node:test";
import assert from "node:assert/strict";

import { calculateOffer, priceAdjustments } from "../src/calculateOffer.js";

const defaults = {
  arv: 185000,
  adjustments: [],
  rehab: 28000,
  holdCost: 4500,
  closeCost: 5000,
  marginPct: 20,
  joshRehabBufferPct: 10,
  joshPurchaseCosts: 1500,
  joshFlipperProfit: 40000,
};

test("calculates the 70% rule", () => {
  const result = calculateOffer({ ...defaults, mode: "70" });

  assert.equal(result.mao, 101500);
  assert.equal(result.targetProfit, 46000);
  assert.equal(result.adjProfit, 46000);
  assert.equal(result.totalCosts, 37500);
});

test("calculates the Josh method with rehab buffer", () => {
  const result = calculateOffer({ ...defaults, mode: "josh" });

  assert.equal(result.bufferedRehab, 30800);
  assert.equal(result.sellingAllowance, 18500);
  assert.equal(result.mao, 94200);
  assert.equal(result.adjProfit, 40000);
});

test("calculates a custom target margin", () => {
  const result = calculateOffer({ ...defaults, mode: "margin" });

  assert.equal(result.targetProfit, 37000);
  assert.equal(result.mao, 110500);
  assert.equal(result.adjProfit, 37000);
  assert.equal(result.targetMarginPct, 20);
});

test("recalculates profit for an overridden offer", () => {
  const result = calculateOffer({ ...defaults, mode: "70", offerOverride: 90000 });

  assert.equal(result.offer, 90000);
  assert.equal(result.vsMAO, -11500);
  assert.equal(result.adjProfit, 57500);
});

test("never allows adjustments to make ARV negative", () => {
  const result = calculateOffer({
    ...defaults,
    arv: 5000,
    adjustments: [{ label: "Condition", value: -8000 }],
    mode: "margin",
  });

  assert.equal(result.adjustedArv, 0);
  assert.equal(result.adjMarginPct, 0);
  assert.equal(result.targetMarginPct, 0);
  assert.ok(Number.isFinite(result.mao));
});

test("adds paint and roof adjustments to rehab without changing ARV", () => {
  const result = calculateOffer({
    ...defaults,
    adjustments: [
      { label: "Paint", value: 15000, costType: "rehab" },
      { label: "Roof condition", value: 20000, costType: "rehab" },
    ],
    mode: "70",
  });

  assert.equal(result.totalAdjustments, 0);
  assert.equal(result.rehabAdjustments, 35000);
  assert.equal(result.effectiveRehab, 63000);
  assert.equal(result.adjustedArv, 185000);
  assert.equal(result.mao, 66500);
});

test("prices quantity and square-foot adjustments from editable rates", () => {
  const adjustments = priceAdjustments([
    { label: "Rooms", rateKey: "rooms", unit: "room", quantity: -2, costType: "arv" },
    { label: "Paint", rateKey: "paint", unit: "sqft", costType: "rehab" },
  ], { rooms: 5000, paint: 3 }, 2000);

  assert.equal(adjustments[0].value, -10000);
  assert.equal(adjustments[1].value, 6000);
  assert.equal(adjustments[1].quantity, 2000);
});