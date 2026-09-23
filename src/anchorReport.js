const CONDITION_LABELS = {
  1: "Excellent",
  2: "Good",
  3: "Average",
  4: "Fair",
  5: "Poor",
  6: "Needs major work",
};

function propertyAddress(location = {}) {
  return [location.address, location.city, location.state, location.zipcode].filter(Boolean).join(", ");
}

function normalizeComp(document) {
  const data = document.data || {};
  const state = data.propertyState || {};
  const sale = state.complexFieldsSale || {};
  const details = state.propertyDetails || {};
  const location = state.location || {};
  const status = String(sale.currentStatus || "").toLowerCase();
  const isClosed = document.role.startsWith("closed_") || status.includes("closed") || status.includes("sold");
  const salePrice = data.adjustedSalePrice || (isClosed ? sale.currentPrice : sale.lastClosePrice);
  const listPrice = data.adjustedListPrice || sale.currentListingPrice;
  const saleDate = isClosed ? sale.currentStatusDate : sale.lastCloseDate;
  const sqft = details.livingArea;
  const conditionClass = state.propertyValue?.valueAtSixConditions?.conditionClass;

  if (!isClosed || !salePrice || !saleDate) return null;
  return {
    id: data.compID || `${location.addressSlug}-${saleDate}`,
    address: propertyAddress(location),
    distance: Number(data.distance) || 0,
    saleDate,
    salePrice,
    listPrice: listPrice || null,
    saleToListRatio: listPrice ? salePrice / listPrice : null,
    daysOnMarket: sale.currentDaysOnMarketCumulative ?? sale.currentDaysOnMarket ?? null,
    beds: details.bedrooms ?? null,
    baths: details.bathrooms?.totalProjected ?? null,
    sqft: sqft || null,
    pricePerSqft: sqft ? salePrice / sqft : null,
    condition: CONDITION_LABELS[conditionClass] || "Not reported",
    conditionClass: conditionClass || null,
    similarity: data.similarity?.scoreAdjusted ?? data.similarity?.score ?? null,
  };
}

export function normalizeAnchorReport(payload) {
  const report = payload?.["property/agile_insights_static_data"]?.data;
  if (!report?.documents) throw new Error("HouseCanary comp report is unavailable");

  const subjectData = report.documents.find((document) => document.role === "subject")?.data;
  const subjectState = subjectData?.propertyState || {};
  const subjectDetails = subjectState.propertyDetails || {};
  const subject = {
    address: propertyAddress(subjectState.location),
    beds: subjectDetails.bedrooms ?? null,
    baths: subjectDetails.bathrooms?.totalProjected ?? null,
    sqft: subjectDetails.livingArea ?? null,
    estimatedValue: subjectState.propertyValue?.value ?? null,
  };

  const seen = new Set();
  const comps = report.documents
    .filter((document) => document.schemaId === "comp")
    .map(normalizeComp)
    .filter((comp) => {
      if (!comp || seen.has(comp.id)) return false;
      seen.add(comp.id);
      return true;
    })
    .sort((left, right) => new Date(right.saleDate) - new Date(left.saleDate));

  return {
    source: "HouseCanary",
    effectiveDate: report.effectiveDate || report.updatedAt || null,
    subject,
    comps,
  };
}

export function filterComps(comps, subject, filters, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - filters.months);
  return comps.filter((comp) => {
    const withinRadius = comp.distance <= filters.radius;
    const withinDate = new Date(comp.saleDate) >= cutoff;
    const bedsMatch = filters.bedTolerance == null
      || subject.beds == null
      || comp.beds == null
      || Math.abs(comp.beds - subject.beds) <= filters.bedTolerance;
    return withinRadius && withinDate && bedsMatch;
  });
}

export function initialCompFilters(comps, subject, defaults, now = new Date()) {
  const candidates = [
    defaults,
    { ...defaults, radius: 0.5 },
    { ...defaults, radius: 1 },
    { ...defaults, radius: 1, months: 12 },
    { ...defaults, radius: 1, months: 12, bedTolerance: 1 },
    { ...defaults, radius: 1, months: 12, bedTolerance: null },
  ];
  return candidates.find((filters) => filterComps(comps, subject, filters, now).length) || defaults;
}

export function anchorSummary(comps) {
  if (!comps.length) return { anchorPrice: null, averagePricePerSqft: null };
  const prices = comps.map((comp) => comp.salePrice).sort((left, right) => left - right);
  const middle = Math.floor(prices.length / 2);
  const anchorPrice = prices.length % 2 ? prices[middle] : Math.round((prices[middle - 1] + prices[middle]) / 2);
  const perSqft = comps.map((comp) => comp.pricePerSqft).filter(Number.isFinite);
  return {
    anchorPrice,
    averagePricePerSqft: perSqft.length ? perSqft.reduce((sum, value) => sum + value, 0) / perSqft.length : null,
  };
}
