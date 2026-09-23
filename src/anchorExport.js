const money = (value) => Number.isFinite(value)
  ? `$${Math.round(value).toLocaleString("en-US")}`
  : "Not available";

const number = (value, digits = 0) => Number.isFinite(value)
  ? value.toLocaleString("en-US", { maximumFractionDigits: digits })
  : "-";

export const HOUSECANARY_DISCLOSURE = "HouseCanary data and analytics. Comparable information may include public-record and licensed listing data. This report is an estimate, not an appraisal.";
export const IDX_DISCLOSURE = "Not an IDX display. Listing information may not be redistributed and should be independently verified with the applicable MLS and broker.";

export async function downloadAnchorPdf({ report, comps, filters, broker }) {
  const { jsPDF } = await import("jspdf");
  const document = new jsPDF({ unit: "pt", format: "letter" });
  const width = document.internal.pageSize.getWidth();
  const margin = 44;
  let y = 48;

  document.setFont("helvetica", "bold");
  document.setFontSize(20);
  document.text("Anchor Price Report", margin, y);
  y += 23;
  document.setFont("helvetica", "normal");
  document.setFontSize(10);
  document.setTextColor(75, 85, 99);
  document.text(report.subject.address, margin, y);
  y += 30;

  document.setFillColor(240, 247, 244);
  document.roundedRect(margin, y, width - margin * 2, 68, 4, 4, "F");
  document.setTextColor(21, 128, 61);
  document.setFont("helvetica", "bold");
  document.setFontSize(10);
  document.text("MARKET ANCHOR", margin + 16, y + 20);
  document.setTextColor(17, 24, 39);
  document.setFontSize(24);
  const sorted = comps.map((comp) => comp.salePrice).sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const anchor = sorted.length ? (sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)) : null;
  document.text(money(anchor), margin + 16, y + 49);
  y += 90;

  document.setFontSize(10);
  document.setTextColor(75, 85, 99);
  document.setFont("helvetica", "normal");
  document.text(`${comps.length} closed comparable sale${comps.length === 1 ? "" : "s"} · ${filters.months} months · ${filters.radius} mile radius`, margin, y);
  y += 23;

  for (const comp of comps) {
    if (y > 660) {
      document.addPage();
      y = 48;
    }
    document.setDrawColor(229, 231, 235);
    document.line(margin, y, width - margin, y);
    y += 16;
    document.setTextColor(17, 24, 39);
    document.setFont("helvetica", "bold");
    document.setFontSize(11);
    document.text(comp.address, margin, y, { maxWidth: 315 });
    document.text(money(comp.salePrice), width - margin, y, { align: "right" });
    y += 16;
    document.setTextColor(75, 85, 99);
    document.setFont("helvetica", "normal");
    document.setFontSize(9);
    const details = `${number(comp.beds)} bed · ${number(comp.baths, 1)} bath · ${number(comp.sqft)} sqft · ${comp.condition}`;
    document.text(details, margin, y);
    y += 14;
    const market = `${comp.daysOnMarket ?? "-"} DOM · ${comp.saleToListRatio ? `${number(comp.saleToListRatio * 100, 1)}% sale/list` : "sale/list unavailable"} · ${money(comp.pricePerSqft)}/sqft · ${number(comp.distance, 2)} mi`;
    document.text(market, margin, y);
    y += 22;
  }

  if (y > 620) {
    document.addPage();
    y = 48;
  }
  document.setDrawColor(209, 213, 219);
  document.line(margin, y, width - margin, y);
  y += 16;
  document.setFont("helvetica", "bold");
  document.setTextColor(17, 24, 39);
  document.text(`Prepared by ${broker.name} · ${broker.company}`, margin, y);
  y += 16;
  document.setFont("helvetica", "normal");
  document.setTextColor(107, 114, 128);
  document.setFontSize(8);
  for (const disclosure of [HOUSECANARY_DISCLOSURE, IDX_DISCLOSURE]) {
    const lines = document.splitTextToSize(disclosure, width - margin * 2);
    document.text(lines, margin, y);
    y += lines.length * 10 + 4;
  }

  const filename = (report.subject.address || "property")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  document.save(`${filename}-anchor-price-report.pdf`);
}
