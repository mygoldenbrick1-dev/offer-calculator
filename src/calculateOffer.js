export function priceAdjustments(adjustments, rates, propertySqft) {
  return adjustments.map((adjustment) => {
    if (!adjustment.rateKey) return adjustment;
    const rate = Math.max(0, Number(rates[adjustment.rateKey]) || 0);
    const quantity = adjustment.unit === "sqft"
      ? Math.max(0, Number(propertySqft) || 0)
      : Number(adjustment.quantity) || 0;
    const amount = Math.round(quantity * rate);
    return {
      ...adjustment,
      quantity,
      rate,
      value: adjustment.costType === "rehab" ? Math.abs(amount) : amount,
    };
  });
}

export function calculateOffer({
  arv,
  adjustments = [],
  rehab,
  holdCost,
  closeCost,
  mode,
  marginPct,
  joshRehabBufferPct,
  joshPurchaseCosts,
  joshFlipperProfit,
  offerOverride = null,
}) {
  const totalAdjustments = adjustments.reduce(
    (sum, adjustment) => sum + (adjustment.costType === "rehab" ? 0 : adjustment.value || 0),
    0,
  );
  const rehabAdjustments = adjustments.reduce(
    (sum, adjustment) => sum + (adjustment.costType === "rehab" ? Math.abs(adjustment.value || 0) : 0),
    0,
  );
  const adjustedArv = Math.max(0, arv + totalAdjustments);
  const effectiveRehab = rehab + rehabAdjustments;
  const totalCosts = effectiveRehab + holdCost + closeCost;
  const bufferedRehab = Math.round(effectiveRehab * (1 + joshRehabBufferPct / 100));

  let mao;
  let targetProfit;
  let formulaStr;
  if (mode === "70") {
    mao = adjustedArv * 0.7 - effectiveRehab;
    targetProfit = Math.round(adjustedArv - mao - totalCosts);
    formulaStr = `ARV (${adjustedArv}) x 70% - Rehab (${effectiveRehab})`;
  } else if (mode === "josh") {
    targetProfit = joshFlipperProfit;
    mao = adjustedArv * 0.9 - bufferedRehab - joshFlipperProfit - joshPurchaseCosts;
    formulaStr = `ARV (${adjustedArv}) x 90% - Buffered Rehab (${bufferedRehab}) - Flipper Profit (${joshFlipperProfit}) - Purchase Costs (${joshPurchaseCosts})`;
  } else {
    targetProfit = Math.round(adjustedArv * (marginPct / 100));
    mao = adjustedArv - totalCosts - targetProfit;
    formulaStr = `ARV - All Costs - Target Profit (${marginPct}% of ARV)`;
  }

  mao = Math.round(mao);
  const offer = offerOverride !== null ? offerOverride : mao;
  const calculationCosts = mode === "josh" ? bufferedRehab + joshPurchaseCosts : totalCosts;
  const sellingAllowance = mode === "josh" ? Math.round(adjustedArv * 0.1) : 0;
  const adjProfit = Math.round(adjustedArv - sellingAllowance - offer - calculationCosts);

  return {
    totalAdjustments,
    rehabAdjustments,
    adjustedArv,
    effectiveRehab,
    totalCosts,
    bufferedRehab,
    mao,
    targetProfit,
    formulaStr,
    offer,
    calculationCosts,
    sellingAllowance,
    adjProfit,
    adjMarginPct: adjustedArv > 0 ? (adjProfit / adjustedArv) * 100 : 0,
    targetMarginPct: adjustedArv > 0 ? (targetProfit / adjustedArv) * 100 : 0,
    vsMAO: offer - mao,
  };
}