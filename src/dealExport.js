export function dealSummaryLines(summary) {
  const money = (value) => {
    const rounded = Math.round(Number.isFinite(value) ? value : 0);
    return `${rounded < 0 ? "-" : ""}$${Math.abs(rounded).toLocaleString("en-US")}`;
  };

  return [
    `Deal Summary - ${summary.address}${summary.addressVerified ? " (Verified)" : ""}`,
    summary.meta || null,
    `Date: ${new Date(summary.generatedAt).toLocaleDateString()}`,
    "",
    `ARV: ${money(summary.arv)}`,
    `Purchase Price: ${money(summary.purchasePrice)}`,
    summary.totalAdjustments ? `Appraiser Adjustments: ${money(summary.totalAdjustments)}` : null,
    summary.totalAdjustments ? `Adjusted ARV: ${money(summary.adjustedArv)}` : null,
    `Base Rehab: ${money(summary.rehab)}`,
    summary.rehabAdjustments ? `Paint / Roof Additions: ${money(summary.rehabAdjustments)}` : null,
    summary.rehabAdjustments ? `Effective Rehab: ${money(summary.effectiveRehab)}` : null,
    summary.mode === "josh" ? `Buffered Rehab: ${money(summary.bufferedRehab)}` : null,
    summary.mode === "josh" ? `Purchase Costs: ${money(summary.purchaseCosts)}` : null,
    summary.mode === "josh" ? `Flipper Profit: ${money(summary.flipperProfit)}` : null,
    `Holding Costs: ${money(summary.holdCost)}`,
    `Closing Costs: ${money(summary.closeCost)}`,
    `Formula: ${summary.formulaStr}`,
    "",
    `Max Allowable Offer: ${money(summary.mao)}`,
    `Target Profit: ${money(summary.targetProfit)}`,
    `Your Offer: ${money(summary.offer)}`,
    `Adjusted Profit: ${money(summary.adjProfit)}`,
    `Profit Margin: ${summary.adjMarginPct.toFixed(1)}%`,
  ].filter((line) => line !== null);
}

export async function downloadDealPdf(summary) {
  const { jsPDF } = await import("jspdf");
  const document = new jsPDF({ unit: "pt", format: "letter" });
  const lines = dealSummaryLines(summary);

  document.setFont("helvetica", "bold");
  document.setFontSize(18);
  document.text("Offer Calculator", 48, 52);
  document.setFont("helvetica", "normal");
  document.setFontSize(10);
  document.text(lines, 48, 78, { lineHeightFactor: 1.5 });

  const filenameAddress = (summary.address || "deal")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  document.save(`${filenameAddress || "deal"}-offer.pdf`);
}
