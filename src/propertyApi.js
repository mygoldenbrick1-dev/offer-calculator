const CENSUS_GEOCODE_URL = "/api/geocode";

function zipcodeFromAddress(address) {
  return [...address.matchAll(/\b\d{5}(?:-\d{4})?\b/g)].at(-1)?.[0];
}

function streetFromAddress(address, zipcode) {
  const beforeZip = zipcode ? address.slice(0, address.lastIndexOf(zipcode)).trim() : address.trim();
  const commaStreet = beforeZip.split(",")[0]?.trim();
  if (beforeZip.includes(",")) return commaStreet;

  const streetMatch = beforeZip.match(/^(.+?\b(?:aly|ave|blvd|cir|ct|dr|hwy|ln|pkwy|pl|rd|st|ter|trl|way)\b)/i);
  return streetMatch?.[1].trim() || commaStreet;
}

export function formatPropertyMeta(property) {
  if (!property) return "";
  const parts = [];
  if (Number.isFinite(property.beds)) parts.push(`${property.beds} bed`);
  if (Number.isFinite(property.baths)) parts.push(`${property.baths} bath`);
  if (Number.isFinite(property.sqft)) parts.push(`${property.sqft.toLocaleString("en-US")} sqft`);
  return parts.join(" · ");
}

export async function geocodeAddress(query, signal, fetchImpl = fetch) {
  const params = new URLSearchParams({ address: query });
  const response = await fetchImpl(`${CENSUS_GEOCODE_URL}?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`Geocoder HTTP ${response.status}`);
  const data = await response.json();
  return data.matches ?? [];
}

export async function getHouseCanaryValue(address, signal, fetchImpl = fetch) {
  const zipcode = zipcodeFromAddress(address);
  const streetAddress = streetFromAddress(address, zipcode);
  if (!streetAddress || !zipcode) throw new Error("Select an address with a ZIP code");

  const params = new URLSearchParams({ address: streetAddress, zipcode });
  const response = await fetchImpl(`/api/housecanary/value?${params.toString()}`, { signal, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HouseCanary HTTP ${response.status}`);
  return data;
}

export async function getHouseCanaryInsights(address, signal, fetchImpl = fetch) {
  const zipcode = zipcodeFromAddress(address);
  const streetAddress = streetFromAddress(address, zipcode);
  if (!streetAddress || !zipcode) throw new Error("Select an address with a ZIP code");

  const params = new URLSearchParams({ address: streetAddress, zipcode });
  const response = await fetchImpl(`/api/housecanary/property-insights?${params.toString()}`, { signal, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HouseCanary HTTP ${response.status}`);
  return data;
}

export async function getHouseCanaryComps(address, signal, fetchImpl = fetch) {
  const zipcode = zipcodeFromAddress(address);
  const streetAddress = streetFromAddress(address, zipcode);
  if (!streetAddress || !zipcode) throw new Error("Select an address with a ZIP code");

  const params = new URLSearchParams({ address: streetAddress, zipcode });
  const response = await fetchImpl(`/api/housecanary/comps?${params.toString()}`, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HouseCanary HTTP ${response.status}`);
  return data;
}