/**
 * OfferCalculator.jsx
 * Missouri Due Diligence Engine — Module 1
 * Client: Josh Smith / Stone Street Revive, LLC
 * Built by: My Golden Brick, LLC
 *
 * Standalone React component. No external dependencies beyond React
 * (uses the browser's native `fetch`). Drop into any React app.
 * Pass optional `property` prop to pre-fill address/meta.
 *
 * Sprint 1 — US-01 (live address lookup):
 *   As the investor types a property address, the field debounces and
 *   queries the U.S. Census Bureau's public Geocoder API
 *   (geocoding.geo.census.gov — no API key, no cost, no rate-limit
 *   agreement needed). Matches are shown as a picklist; selecting one
 *   snaps `address` to the standardized/verified form and captures
 *   lat/lng in `coords`. This intentionally does NOT depend on
 *   HouseCanary or ATTOM — those stay scoped to Sprint 2 / Sprint 4 per
 *   the build plan, and Module 1 was always meant to run API-free.
 *   Free-text entry still works with zero verification if the address
 *   isn't found (new construction, off-market parcels, typos, etc.).
 *
 * Props:
 *   property: {
 *     address: string,
 *     meta: string,       // e.g. "3 bed · 2 bath · 1,420 sqft"
 *     arv: number,        // pre-filled ARV from HouseCanary (Module 2+)
 *     coords: { lat: number, lng: number },  // optional, pre-verified
 *   }
 *   onSave: (summary) => void   // called with the complete deal summary
 */

import { useState, useCallback, useEffect, useId } from "react";
import { calculateOffer, priceAdjustments } from "./calculateOffer.js";
import { dealSummaryLines, downloadDealPdf } from "./dealExport.js";
import { formatPropertyMeta, geocodeAddress, getHouseCanaryInsights, getHouseCanaryValue } from "./propertyApi.js";

const fmt = (n) => {
  const rounded = Math.round(Number.isFinite(n) ? n : 0);
  return `${rounded < 0 ? "-" : ""}$${Math.abs(rounded).toLocaleString("en-US")}`;
};

const pct = (n) =>
  (Math.round(n * 10) / 10).toFixed(1) + "%";

const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

const INSIGHT_LABELS = {
  "property/details": "Property Details",
  "property/details_advanced": "Advanced Details",
  "property/mortgage_lien": "Mortgage Lien",
  "property/owner_occupied": "Owner Occupancy",
  "property/sales_history": "Sales History",
  "block/rental_value_distribution": "Block Rental Distribution",
  "block/value_distribution": "Block Value Distribution",
  "property/rental_report": "Rental Report",
  "property/rental_value": "Rental Value",
  "property/rental_value_forecast": "Rental Forecast",
  "property/rental_value_within_block": "Rental Value Within Block",
};

// ─── Live address lookup (US Census Geocoder — free, no API key) ─────────────
// https://geocoding.geo.census.gov — public benchmark, no credentialing.
// Kept isolated from HouseCanary/ATTOM so Sprint 1 has zero API-key dependency.
// Census returns ALL-CAPS ("123 MAPLE ST, KANSAS CITY, MO, 64111").
// Title-case it for display, but keep short tokens (state codes, direction
// abbreviations, unit/zip numbers) as-is rather than guessing at them.
const KEEP_UPPER = /^[A-Z]{2}$/; // MO, NE, SW, etc.
function titleCaseAddress(str) {
  return str
    .split(" ")
    .map((word) => {
      const clean = word.replace(/,$/, "");
      if (/\d/.test(clean) || KEEP_UPPER.test(clean)) return word;
      const cased = clean.charAt(0) + clean.slice(1).toLowerCase();
      return word.endsWith(",") ? cased + "," : cased;
    })
    .join(" ");
}

// Falls back to a hidden-textarea + execCommand copy when the async
// Clipboard API is unavailable (non-HTTPS origins, some in-app browsers).
function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (ok) resolve(); else reject(new Error("execCommand copy failed"));
  });
}

// Debounced live lookup. Only fires once the query is long enough to be a
// real address, and cancels in-flight requests on every keystroke.
function useAddressLookup(query, { minLength = 8, debounceMs = 550, enabled = true } = {}) {
  const [status, setStatus] = useState("idle"); // idle | searching | matched | no-match | error
  const [matches, setMatches] = useState([]);

  useEffect(() => {
    if (!enabled || !query || query.trim().length < minLength) {
      setStatus("idle");
      setMatches([]);
      return;
    }
    const controller = new AbortController();
    setStatus("searching");
    const timer = setTimeout(() => {
      geocodeAddress(query, controller.signal)
        .then((results) => {
          setMatches(results);
          setStatus(results.length ? "matched" : "no-match");
        })
        .catch((err) => {
          if (err.name !== "AbortError") setStatus("error");
        });
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, minLength, debounceMs, enabled]);

  return { status, matches };
}

// ─── Appraiser adjustment line item ───────────────────────────────────────────
const ADJUSTMENT_PRESETS = [
  { label: "Condition — needs work vs updated", value: -8000 },
  { label: "Garage — no garage vs 1-car", value: -5000 },
  { label: "Garage — 1-car vs 2-car", value: -4000 },
  { label: "Sqft — per 100 sqft difference", value: -2500 },
  { label: "Rooms", rateKey: "rooms", unit: "room", quantity: -1, costType: "arv" },
  { label: "Windows", rateKey: "windows", unit: "window", quantity: -1, costType: "arv" },
  { label: "Roof condition", rateKey: "roof", unit: "sqft", costType: "rehab" },
  { label: "Paint", rateKey: "paint", unit: "sqft", costType: "rehab" },
  { label: "Basement — no basement vs finished", value: -7500 },
  { label: "Lot size — smaller lot", value: -3000 },
  { label: "Location — inferior street/block", value: -5000 },
  { label: "Custom adjustment", value: 0 },
];

const DEFAULT_ADJUSTMENT_RATES = { rooms: 10, windows: 10, roof: 10, paint: 10 };
const ADJUSTMENT_RATES_KEY = "offer-calculator.adjustment-rates";

function loadAdjustmentRates() {
  try {
    return { ...DEFAULT_ADJUSTMENT_RATES, ...JSON.parse(localStorage.getItem(ADJUSTMENT_RATES_KEY) || "{}") };
  } catch {
    return DEFAULT_ADJUSTMENT_RATES;
  }
}

function AdjustmentRow({ item, index, onChange, onRemove }) {
  return (
    <div className="adjustment-row" style={styles.adjRow}>
      <select
        value={item.label}
        onChange={(e) => {
          const preset = ADJUSTMENT_PRESETS.find((p) => p.label === e.target.value);
          onChange(index, {
            ...preset,
            label: e.target.value,
            value: preset?.value ?? 0,
          });
        }}
        style={styles.adjSelect}
        aria-label="Adjustment type"
      >
        {ADJUSTMENT_PRESETS.map((p) => (
          <option key={p.label} value={p.label}>{p.label}</option>
        ))}
      </select>
      {item.rateKey && item.unit !== "sqft" ? (
        <input
          type="number"
          value={item.quantity ?? 0}
          step={1}
          onChange={(e) => onChange(index, { ...item, quantity: Number(e.target.value) || 0 })}
          style={styles.adjInput}
          aria-label={`${item.label} quantity`}
          title="Use a negative quantity when the subject has fewer than the comparable"
        />
      ) : item.rateKey ? (
        <span style={styles.adjCalculated}>{fmt(item.value)}</span>
      ) : (
        <input
          type="number"
          value={item.value}
          step={500}
          onChange={(e) => onChange(index, { ...item, value: parseInt(e.target.value) || 0 })}
          style={{ ...styles.adjInput, color: item.value < 0 ? "#B91C1C" : item.value > 0 ? "#15803D" : "#374151" }}
          aria-label="Adjustment value"
        />
      )}
      <button
        type="button"
        onClick={() => onRemove(index)}
        style={styles.adjRemove}
        aria-label="Remove adjustment"
      >×</button>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function OfferCalculator({ property = {}, onSave }) {
  // Inputs
  const [address, setAddress] = useState(property.address || "");
  const [addressVerified, setAddressVerified] = useState(!!property.coords);
  const [coords, setCoords] = useState(property.coords || null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [meta, setMeta] = useState(property.meta || "");
  const [arv, setArv] = useState(property.arv || 185000);
  const [purchasePrice, setPurchasePrice] = useState(property.purchasePrice || 0);
  const [valuation, setValuation] = useState(null);
  const [valuationStatus, setValuationStatus] = useState("idle");
  const [valuationError, setValuationError] = useState("");
  const [insights, setInsights] = useState([]);
  const [insightsStatus, setInsightsStatus] = useState("idle");
  const [insightsError, setInsightsError] = useState("");
  const [rehab, setRehab] = useState(28000);
  const [holdCost, setHoldCost] = useState(4500);
  const [closeCost, setCloseCost] = useState(5000);
  const [mode, setMode] = useState("70"); // "70" | "josh" | "margin"
  const [marginPct, setMarginPct] = useState(20);
  const [joshRehabBufferPct, setJoshRehabBufferPct] = useState(10);
  const [joshPurchaseCosts, setJoshPurchaseCosts] = useState(1500);
  const [joshFlipperProfit, setJoshFlipperProfit] = useState(40000);
  const [adjustments, setAdjustments] = useState([]);
  const [adjustmentRates, setAdjustmentRates] = useState(loadAdjustmentRates);
  const [propertySqft, setPropertySqft] = useState(0);
  const [showAdjustmentSettings, setShowAdjustmentSettings] = useState(false);
  const [offerOverride, setOfferOverride] = useState(null);
  const [activeTab, setActiveTab] = useState("calculator"); // "calculator" | "breakdown"
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [pdfStatus, setPdfStatus] = useState("idle");

  // Sync prop changes (e.g. ARV wired in from Module 2/3)
  useEffect(() => {
    if (property.arv) setArv(property.arv);
    if (property.purchasePrice) setPurchasePrice(property.purchasePrice);
    if (property.address) setAddress(property.address);
    if (property.meta) setMeta(property.meta);
    if (property.coords) { setCoords(property.coords); setAddressVerified(true); }
  }, [property.arv, property.purchasePrice, property.address, property.meta, property.coords]);

  useEffect(() => {
    localStorage.setItem(ADJUSTMENT_RATES_KEY, JSON.stringify(adjustmentRates));
  }, [adjustmentRates]);

  useEffect(() => {
    if (!addressVerified || !address) {
      setValuationStatus("idle");
      setValuation(null);
      setValuationError("");
      return;
    }

    const controller = new AbortController();
    setValuationStatus("loading");
    setValuationError("");
    getHouseCanaryValue(address, controller.signal)
      .then((result) => {
        setArv(Math.round(result.arv));
        setValuation(result);
        setValuationStatus("loaded");
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setValuationStatus("error");
          setValuationError(error.message);
        }
      });

    return () => controller.abort();
  }, [address, addressVerified]);

  // ─── Live address lookup ─────────────────────────────────────────────────────
  const { status: addressStatus, matches: addressMatches } = useAddressLookup(address, {
    enabled: !addressVerified, // don't keep querying once a match is picked
  });

  const handleAddressChange = (val) => {
    setAddress(val);
    setAddressVerified(false);
    setCoords(null);
    setMeta("");
    setPropertySqft(0);
    setShowSuggestions(true);
    setInsights([]);
    setInsightsStatus("idle");
    setInsightsError("");
  };

  const selectAddressMatch = (match) => {
    setAddress(titleCaseAddress(match.matchedAddress));
    setCoords({ lat: match.coordinates.y, lng: match.coordinates.x });
    setAddressVerified(true);
    setShowSuggestions(false);
  };

  // ─── Calculations ────────────────────────────────────────────────────────────
  const pricedAdjustments = priceAdjustments(adjustments, adjustmentRates, propertySqft);
  const calculation = calculateOffer({
    arv, adjustments: pricedAdjustments, rehab, holdCost, closeCost, mode, marginPct,
    joshRehabBufferPct, joshPurchaseCosts, joshFlipperProfit, offerOverride,
  });
  const {
    totalAdjustments, rehabAdjustments, effectiveRehab, adjustedArv, totalCosts, bufferedRehab, mao,
    targetProfit, offer, calculationCosts, sellingAllowance, adjProfit,
    adjMarginPct, targetMarginPct, vsMAO,
  } = calculation;
  const formulaStr = mode === "70"
    ? `ARV (${fmt(adjustedArv)}) × 70% − Rehab (${fmt(effectiveRehab)})`
    : mode === "josh"
      ? `ARV (${fmt(adjustedArv)}) × 90% − Buffered Rehab (${fmt(bufferedRehab)}) − Flipper Profit (${fmt(joshFlipperProfit)}) − Purchase Costs (${fmt(joshPurchaseCosts)})`
      : `ARV − All Costs − Target Profit (${marginPct}% of ARV)`;
  // Bounds must always contain `mao` (a heavily discounted ARV or high
  // rehab can push it well below the nominal $10k floor) and min must
  // stay below max, or the range input silently breaks.
  const offerSliderMin = Math.min(10000, mao - 20000);
  const offerSliderMax = Math.max(adjustedArv, mao + 80000, offerSliderMin + 1000);
  const profitColor =
    adjProfit < 0 ? "#B91C1C" : adjMarginPct < 10 ? "#92400E" : "#15803D";
  const maoStatus = mao > 0 ? "good" : "bad";

  // ─── Handlers ────────────────────────────────────────────────────────────────
  const addAdjustment = () =>
    setAdjustments([...adjustments, { label: ADJUSTMENT_PRESETS[0].label, value: ADJUSTMENT_PRESETS[0].value }]);

  const updateAdjustment = (i, updated) => {
    const next = [...adjustments];
    next[i] = updated;
    setAdjustments(next);
  };

  const removeAdjustment = (i) =>
    setAdjustments(adjustments.filter((_, idx) => idx !== i));

  const loadPropertyInsights = async () => {
    setInsightsStatus("loading");
    setInsightsError("");
    try {
      const result = await getHouseCanaryInsights(address);
      setInsights(result.insights || []);
      const propertyMeta = formatPropertyMeta(result.property);
      if (propertyMeta) setMeta(propertyMeta);
      setPropertySqft(result.property?.sqft || 0);
      setInsightsStatus("loaded");
    } catch (error) {
      setInsights([]);
      setInsightsStatus("error");
      setInsightsError(error.message || "Property insights are unavailable");
    }
  };

  const buildSummary = useCallback(() => ({
      address,
      addressVerified,
      coords,
      meta,
      arv,
      purchasePrice,
      adjustedArv,
      totalAdjustments,
      rehabAdjustments,
      rehab,
      effectiveRehab,
      holdCost,
      closeCost,
      mode,
      marginPct: mode === "margin" ? marginPct : null,
      rehabBufferPct: mode === "josh" ? joshRehabBufferPct : null,
      purchaseCosts: mode === "josh" ? joshPurchaseCosts : null,
      flipperProfit: mode === "josh" ? joshFlipperProfit : null,
      mao,
      targetProfit,
      offer,
      adjProfit,
      adjMarginPct,
      formulaStr,
      adjustments: pricedAdjustments,
      adjustmentRates,
      generatedAt: new Date().toISOString(),
  }), [address, addressVerified, coords, meta, arv, purchasePrice, adjustedArv, totalAdjustments, rehabAdjustments, rehab, effectiveRehab, holdCost, closeCost, mode, marginPct, joshRehabBufferPct, joshPurchaseCosts, joshFlipperProfit, mao, targetProfit, offer, adjProfit, adjMarginPct, formulaStr, pricedAdjustments, adjustmentRates]);

  const handleExport = useCallback(() => {
    const summary = buildSummary();
    try {
      if (onSave) onSave(summary);
      setSaved(true);
      setSaveError(false);
    } catch {
      setSaved(false);
      setSaveError(true);
    }
    const text = dealSummaryLines(summary).join("\n");

    copyText(text).then(() => {
      setCopied(true);
      setCopyError(false);
      setTimeout(() => {
        setCopied(false);
        setSaved(false);
      }, 2000);
    }).catch(() => {
      setCopyError(true);
      setTimeout(() => setCopyError(false), 2500);
    });
  }, [buildSummary, onSave]);

  const handlePdfDownload = useCallback(async () => {
    setPdfStatus("loading");
    try {
      await downloadDealPdf(buildSummary());
      setPdfStatus("done");
      setTimeout(() => setPdfStatus("idle"), 2000);
    } catch {
      setPdfStatus("error");
    }
  }, [buildSummary]);

  const actionLabel = saveError && copyError
    ? "Save and copy failed"
    : saveError && copied
      ? "Save failed - summary copied"
      : saveError
        ? "Save failed"
    : copyError
      ? saved ? "Deal saved - copy failed" : "Copy failed"
      : saved && copied
        ? "Deal saved and copied"
        : saved
          ? "Deal saved"
        : onSave ? "Save Deal & Copy Summary" : "Copy Deal Summary";

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="offer-calculator" style={styles.wrap}>

      {/* Header */}
      <div className="calculator-header" style={styles.header}>
        <div>
          <div style={styles.headerTitle}>Offer Calculator</div>
          <div style={styles.headerMeta}>
            {address || "Enter address below"}{addressVerified ? " ✓" : ""}{meta ? ` · ${meta}` : ""}
          </div>
        </div>
        <div className="mode-toggle" style={styles.modeToggle}>
          <button
            type="button"
            style={{ ...styles.modeBtn, ...(mode === "70" ? styles.modeBtnActive : {}) }}
            onClick={() => setMode("70")}
            aria-pressed={mode === "70"}
          >70% Rule</button>
          <button
            type="button"
            style={{ ...styles.modeBtn, ...(mode === "josh" ? styles.modeBtnActive : {}) }}
            onClick={() => setMode("josh")}
            aria-pressed={mode === "josh"}
          >Josh Method</button>
          <button
            type="button"
            style={{ ...styles.modeBtn, ...(mode === "margin" ? styles.modeBtnActive : {}) }}
            onClick={() => setMode("margin")}
            aria-pressed={mode === "margin"}
          >Custom Margin</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="calculator-tabs" style={styles.tabBar} role="tablist" aria-label="Calculator views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "calculator"}
          style={{ ...styles.tab, ...(activeTab === "calculator" ? styles.tabActive : {}) }}
          onClick={() => setActiveTab("calculator")}
        >Calculator</button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "breakdown"}
          style={{ ...styles.tab, ...(activeTab === "breakdown" ? styles.tabActive : {}) }}
          onClick={() => setActiveTab("breakdown")}
        >Deal Breakdown</button>
      </div>

      {/* ── CALCULATOR TAB ── */}
      {activeTab === "calculator" && (
        <>
          {/* Top stat cards */}
          <div className="stat-grid" style={styles.statGrid}>
            <StatCard label="ARV" value={fmt(adjustedArv)} sub={totalAdjustments !== 0 ? `Base ${fmt(arv)} + adj ${fmt(totalAdjustments)}` : "After-repair value"} />
            <StatCard label="Rehab" value={fmt(mode === "josh" ? bufferedRehab : effectiveRehab)} sub={mode === "josh" ? `Includes ${joshRehabBufferPct}% buffer` : rehabAdjustments ? "Base + paint / roof" : "Estimated cost"} />
            <StatCard
              label={mode === "70" ? "Implied Margin" : mode === "josh" ? "Flipper Profit" : "Target Margin"}
              value={mode === "70" ? pct(targetMarginPct) : mode === "josh" ? fmt(joshFlipperProfit) : pct(marginPct)}
              sub={mode === "70" ? "From 70% rule" : mode === "josh" ? "Workbook default" : "Your target"}
            />
            <StatCard label="Total Costs" value={fmt(mode === "josh" ? calculationCosts + sellingAllowance : totalCosts)} sub={mode === "josh" ? "Sale allowance + rehab + purchase" : "Rehab + hold + close"} />
          </div>

          {/* MAO output */}
          <div style={{
            ...styles.maoCard,
            background: maoStatus === "good" ? "#F0FDF4" : "#FEF2F2",
            borderColor: maoStatus === "good" ? "#86EFAC" : "#FECACA",
          }}>
            <div style={{ ...styles.maoLabel, color: maoStatus === "good" ? "#15803D" : "#B91C1C" }}>
              {mode === "josh" ? "Josh Method Offer" : "Max Allowable Offer"}
            </div>
            <div style={styles.maoValue}>{fmt(mao)}</div>
            <div className="formula-text" style={styles.maoFormula}>{formulaStr}</div>
          </div>

          {/* Inputs */}
          <div style={styles.sectionLabel}>Property</div>
          <div style={styles.card}>
            <div className="input-grid-2" style={styles.inputGrid2}>
              <AddressLookupField
                label="Address"
                value={address}
                onChange={handleAddressChange}
                verified={addressVerified}
                status={addressStatus}
                matches={addressMatches}
                showSuggestions={showSuggestions}
                onSelectMatch={selectAddressMatch}
                onFocus={() => setShowSuggestions(true)}
                onBlurAway={() => setShowSuggestions(false)}
              />
              <InputField label="Beds / bath / sqft" value={meta} onChange={setMeta} type="text" placeholder="3 bed · 2 bath · 1,420 sqft" />
            </div>
            <div style={{ marginTop: 12 }}>
              <InputField label="Purchase Price ($)" value={purchasePrice} onChange={setPurchasePrice} type="number" min={0} />
            </div>
            <div style={{ marginTop: 12 }}>
              <SliderField
                label="ARV"
                value={arv}
                min={0} max={Math.max(800000, arv)} step={1000}
                onChange={setArv}
                display={fmt(arv)}
                editable
              />
              {valuationStatus === "loading" && (
                <div style={styles.addressStatusMuted} role="status">Loading HouseCanary valuation...</div>
              )}
              {valuationStatus === "loaded" && (
                <div style={styles.addressStatusOk} role="status">
                  HouseCanary valuation loaded
                  {valuation.priceLow && valuation.priceHigh
                    ? ` (${fmt(valuation.priceLow)}-${fmt(valuation.priceHigh)})`
                    : ""}
                </div>
              )}
              {valuationStatus === "error" && (
                <div style={styles.addressStatusWarn} role="alert">{valuationError}. ARV remains editable.</div>
              )}
            </div>
          </div>

          <div style={styles.sectionLabel}>Property Insights</div>
          <div style={styles.card}>
            <div style={styles.insightsHeader}>
              <div>
                <div style={styles.insightsTitle}>HouseCanary Data</div>
                <div style={styles.insightsSubtitle}>Details, ownership, sales, liens, and rental analysis</div>
              </div>
              <button
                type="button"
                onClick={loadPropertyInsights}
                disabled={!addressVerified || insightsStatus === "loading"}
                style={{
                  ...styles.insightsBtn,
                  ...(!addressVerified || insightsStatus === "loading" ? styles.insightsBtnDisabled : {}),
                }}
              >
                {insightsStatus === "loading" ? "Loading..." : insightsStatus === "loaded" ? "Refresh Insights" : "Load Insights"}
              </button>
            </div>
            {!addressVerified && (
              <div style={styles.addressStatusMuted}>Select a verified address to load property insights.</div>
            )}
            {insightsStatus === "error" && (
              <div style={styles.addressStatusWarn} role="alert">{insightsError}</div>
            )}
            {insightsStatus === "loaded" && (
              <div className="insights-grid" style={styles.insightsGrid}>
                {insights.map((insight) => (
                  <div key={insight.endpoint} style={styles.insightCard}>
                    <div style={styles.insightHeading}>
                      <span>{INSIGHT_LABELS[insight.endpoint] || insight.endpoint}</span>
                      <span style={{
                        ...styles.insightStatus,
                        ...(insight.status === "available" ? styles.insightStatusAvailable : insight.status === "error" || insight.status === "access-denied" ? styles.insightStatusError : {}),
                      }}>
                        {insight.status === "available"
                          ? "Available"
                          : insight.status === "access-denied"
                            ? "Plan access required"
                            : insight.status === "error"
                              ? "Provider error"
                              : "204 No Content"}
                      </span>
                    </div>
                    {insight.fields?.length > 0 ? (
                      <dl style={styles.insightFields}>
                        {insight.fields.map((field, index) => (
                          <div key={`${field.label}-${index}`} style={styles.insightField}>
                            <dt style={styles.insightFieldLabel}>{field.label}</dt>
                            <dd style={styles.insightFieldValue}>{String(field.value)}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <div style={styles.insightEmpty}>
                        {insight.description || (
                          insight.status === "no-data"
                            ? "HouseCanary has no record for this address and endpoint."
                            : "No result was returned."
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={styles.sectionLabel}>{mode === "josh" ? "Josh Method Assumptions" : "Costs"}</div>
          <div style={styles.card}>
            <SliderField label="Estimated Rehab" value={rehab} min={0} max={Math.max(200000, rehab)} step={1000} onChange={setRehab} display={fmt(rehab)} editable />
            {mode === "josh" ? (
              <div className="input-grid-3" style={styles.inputGrid3}>
                <InputField label="Rehab buffer (%)" value={joshRehabBufferPct} onChange={setJoshRehabBufferPct} type="number" min={0} />
                <InputField label="Purchase costs ($)" value={joshPurchaseCosts} onChange={setJoshPurchaseCosts} type="number" min={0} />
                <InputField label="Flipper profit ($)" value={joshFlipperProfit} onChange={setJoshFlipperProfit} type="number" min={0} />
              </div>
            ) : (
              <div className="input-grid-2" style={{ ...styles.inputGrid2, marginTop: 8 }}>
                <InputField label="Holding Costs ($)" value={holdCost} onChange={setHoldCost} type="number" min={0} />
                <InputField label="Closing Costs ($)" value={closeCost} onChange={setCloseCost} type="number" min={0} />
              </div>
            )}
          </div>

          {mode === "margin" && (
            <>
              <div style={styles.sectionLabel}>Target Margin</div>
              <div style={styles.card}>
                <SliderField
                  label="Profit target"
                  value={marginPct} min={5} max={40} step={1}
                  onChange={setMarginPct}
                  display={`${marginPct}%`}
                />
                <div style={styles.marginNote}>
                  {marginPct < 10 ? "⚠️ Thin margin — high risk"
                    : marginPct < 15 ? "Moderate — acceptable for low rehab deals"
                    : marginPct < 25 ? "Solid target"
                    : "Conservative — strong cushion"}
                </div>
              </div>
            </>
          )}

          {/* Appraiser adjustments */}
          <div style={styles.sectionLabel}>
            Appraiser Adjustments
            <button type="button" onClick={addAdjustment} style={styles.addBtn}>+ Add</button>
            <button type="button" onClick={() => setShowAdjustmentSettings(!showAdjustmentSettings)} style={styles.addBtn}>Rates</button>
          </div>
          {showAdjustmentSettings && (
            <div style={styles.card}>
              <div className="input-grid-2" style={styles.inputGrid2}>
                {[
                  ["rooms", "Rooms ($ / room)"],
                  ["windows", "Windows ($ / window)"],
                  ["paint", "Paint ($ / sqft)"],
                  ["roof", "Roof ($ / sqft)"],
                ].map(([key, label]) => (
                  <InputField
                    key={key}
                    label={label}
                    value={adjustmentRates[key]}
                    onChange={(value) => setAdjustmentRates({ ...adjustmentRates, [key]: Math.max(0, value) })}
                    type="number"
                    min={0}
                  />
                ))}
              </div>
            </div>
          )}
          {adjustments.length > 0 && (
            <div style={styles.card}>
              {pricedAdjustments.map((item, i) => (
                <AdjustmentRow
                  key={i} item={item} index={i}
                  onChange={updateAdjustment}
                  onRemove={removeAdjustment}
                />
              ))}
              <div style={styles.adjTotal}>
                ARV adjustments: <strong style={{ color: totalAdjustments < 0 ? "#B91C1C" : "#15803D" }}>{fmt(totalAdjustments)}</strong>
                {" "}→ Adjusted ARV: <strong>{fmt(adjustedArv)}</strong>
                {rehabAdjustments > 0 && <><br />Rehab additions: <strong style={{ color: "#B91C1C" }}>{fmt(rehabAdjustments)}</strong> → Effective rehab: <strong>{fmt(effectiveRehab)}</strong></>}
              </div>
            </div>
          )}

          {/* Stress test */}
          <div style={styles.sectionLabel}>Stress Test — Adjust Your Offer</div>
          <div style={styles.card}>
            <SliderField
              label="Your offer"
              value={clamp(offer, offerSliderMin, offerSliderMax)}
              min={offerSliderMin}
              max={offerSliderMax}
              step={500}
              onChange={(v) => setOfferOverride(v)}
              display={fmt(offer)}
            />
            <div style={styles.stressBar}>
              <div style={{
                ...styles.stressFill,
                width: `${clamp(adjMarginPct * 5, 0, 100)}%`,
                background: adjProfit < 0 ? "#EF4444" : adjMarginPct < 12 ? "#F59E0B" : "#22C55E",
              }} />
            </div>
            <div className="stress-grid" style={styles.stressGrid}>
              <MiniStat label="Adjusted profit" value={fmt(adjProfit)} color={profitColor} />
              <MiniStat label="Profit margin" value={pct(adjMarginPct)} color={profitColor} />
              <MiniStat
                label="vs MAO"
                value={(vsMAO > 0 ? "+" : "") + fmt(vsMAO)}
                color={vsMAO > 0 ? "#B91C1C" : vsMAO < 0 ? "#15803D" : "#6B7280"}
              />
            </div>
            {vsMAO !== 0 && (
              <div style={styles.stressNote}>
                {vsMAO > 0
                  ? `${fmt(vsMAO)} over MAO — margin reduced by ${pct(Math.abs(vsMAO / adjustedArv * 100))}`
                  : `${fmt(Math.abs(vsMAO))} below MAO — ${pct(Math.abs(vsMAO / adjustedArv * 100))} extra cushion`}
              </div>
            )}
          </div>

          <div style={styles.exportActions}>
            <button type="button" onClick={handleExport} style={{ ...styles.exportBtn, ...(copyError || saveError ? styles.exportBtnError : {}) }}>{actionLabel}</button>
            <button type="button" onClick={handlePdfDownload} disabled={pdfStatus === "loading"} style={{ ...styles.pdfBtn, ...(pdfStatus === "error" ? styles.exportBtnError : {}) }}>
              {pdfStatus === "loading" ? "Generating..." : pdfStatus === "done" ? "PDF Downloaded" : pdfStatus === "error" ? "PDF Failed" : "Download PDF"}
            </button>
          </div>
        </>
      )}

      {/* ── BREAKDOWN TAB ── */}
      {activeTab === "breakdown" && (
        <div style={styles.card}>
          <div style={styles.breakdownTitle}>Deal at MAO</div>
          <table style={styles.bTable} aria-label="Deal breakdown table">
            <tbody>
              <BRow label="ARV" value={fmt(arv)} />
              <BRow label="Purchase Price" value={fmt(purchasePrice)} />
              {totalAdjustments !== 0 && <BRow label="± Appraiser adjustments" value={fmt(totalAdjustments)} neg={totalAdjustments < 0} />}
              {totalAdjustments !== 0 && <BRow label="Adjusted ARV" value={fmt(adjustedArv)} bold />}
              {mode === "josh" && <BRow label="− Selling allowance (10%)" value={`−${fmt(sellingAllowance)}`} neg />}
              <BRow label={mode === "josh" ? `− Rehab + ${joshRehabBufferPct}% buffer` : "− Effective rehab"} value={`−${fmt(mode === "josh" ? bufferedRehab : effectiveRehab)}`} neg />
              {mode === "josh" ? (
                <BRow label="− Purchase costs" value={`−${fmt(joshPurchaseCosts)}`} neg />
              ) : (
                <>
                  <BRow label="− Holding costs" value={`−${fmt(holdCost)}`} neg />
                  <BRow label="− Closing costs" value={`−${fmt(closeCost)}`} neg />
                </>
              )}
              <BRow label="− Target profit" value={`−${fmt(targetProfit)}`} neg />
              <BRow label="Max Allowable Offer" value={fmt(mao)} bold accent />
            </tbody>
          </table>

          {offer !== mao && (
            <>
              <div style={{ ...styles.breakdownTitle, marginTop: 24 }}>Deal at Your Offer ({fmt(offer)})</div>
              <table style={styles.bTable} aria-label="Deal at offer price breakdown">
                <tbody>
                  <BRow label="Adjusted ARV" value={fmt(adjustedArv)} />
                  <BRow label="− Your offer" value={`−${fmt(offer)}`} neg />
                  <BRow label="− Total costs" value={`−${fmt(totalCosts)}`} neg />
                  <BRow label="Net profit" value={fmt(adjProfit)} bold accent={adjProfit >= 0} neg={adjProfit < 0} />
                  <BRow label="Profit margin" value={pct(adjMarginPct)} bold accent={adjMarginPct >= 15} />
                  <BRow
                    label={vsMAO > 0 ? "Over MAO by" : "Under MAO by"}
                    value={fmt(Math.abs(vsMAO))}
                    neg={vsMAO > 0}
                  />
                </tbody>
              </table>
            </>
          )}

          <div style={styles.formulaBox}>
            <div style={styles.formulaLabel}>Formula used</div>
            <div className="formula-text" style={styles.formulaText}>{formulaStr}</div>
          </div>

          <div style={styles.exportActions}>
            <button type="button" onClick={handleExport} style={{ ...styles.exportBtn, ...(copyError || saveError ? styles.exportBtnError : {}) }}>{actionLabel}</button>
            <button type="button" onClick={handlePdfDownload} disabled={pdfStatus === "loading"} style={{ ...styles.pdfBtn, ...(pdfStatus === "error" ? styles.exportBtnError : {}) }}>
              {pdfStatus === "loading" ? "Generating..." : pdfStatus === "done" ? "PDF Downloaded" : pdfStatus === "error" ? "PDF Failed" : "Download PDF"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
      {sub && <div style={styles.statSub}>{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value, color }) {
  return (
    <div>
      <div style={styles.miniLabel}>{label}</div>
      <div style={{ ...styles.miniValue, color }}>{value}</div>
    </div>
  );
}

function InputField({ label, value, onChange, type = "text", placeholder = "", min }) {
  const inputId = useId();
  return (
    <div style={styles.inputRow}>
      <label htmlFor={inputId} style={styles.inputLabel}>{label}</label>
      <input
        id={inputId}
        type={type}
        value={value}
        min={min}
        placeholder={placeholder}
        onChange={(e) => {
          if (type !== "number") {
            onChange(e.target.value);
            return;
          }
          const next = e.target.valueAsNumber;
          onChange(Number.isFinite(next) ? Math.max(min ?? -Infinity, next) : 0);
        }}
        style={styles.input}
      />
    </div>
  );
}

function AddressLookupField({
  label, value, onChange, verified, status, matches, showSuggestions,
  onSelectMatch, onFocus, onBlurAway,
}) {
  const inputId = useId();
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  const statusText = verified
    ? "✓ Verified address"
    : status === "searching" ? "Searching…"
    : status === "no-match" ? "No exact match — you can still use this address"
    : status === "error" ? "Lookup unavailable — continuing with typed address"
    : null;

  const statusStyle = verified
    ? styles.addressStatusOk
    : status === "no-match" || status === "error"
    ? styles.addressStatusWarn
    : styles.addressStatusMuted;

  const openDropdown = showSuggestions && !verified && status === "matched" && matches.length > 0;

  useEffect(() => {
    if (!openDropdown) setActiveIndex(-1);
  }, [openDropdown]);

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      onBlurAway();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (matches.length === 0) return;
      event.preventDefault();
      onFocus();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        const start = current < 0 ? (direction > 0 ? -1 : 0) : current;
        return (start + direction + matches.length) % matches.length;
      });
      return;
    }
    if (event.key === "Enter" && openDropdown && activeIndex >= 0) {
      event.preventDefault();
      onSelectMatch(matches[activeIndex]);
    }
  };

  return (
    <div style={{ ...styles.inputRow, position: "relative" }}>
      <label htmlFor={inputId} style={styles.inputLabel}>{label}</label>
      <input
        id={inputId}
        type="text"
        value={value}
        placeholder="123 Maple St, Kansas City, MO"
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(onBlurAway, 150)} // let onMouseDown on a suggestion fire first
        style={{ ...styles.input, borderColor: verified ? "#86EFAC" : "#D1D5DB" }}
        aria-label="Property address"
        aria-autocomplete="list"
        aria-expanded={openDropdown}
        aria-controls={listboxId}
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        autoComplete="off"
      />
      {statusText && <div style={statusStyle} role="status">{statusText}</div>}
      {openDropdown && (
        <div id={listboxId} style={styles.suggestionsBox} role="listbox">
          {matches.slice(0, 5).map((m, i) => (
            <div
              id={`${listboxId}-${i}`}
              key={i}
              role="option"
              aria-selected={activeIndex === i}
              style={{ ...styles.suggestionItem, ...(activeIndex === i ? styles.suggestionItemActive : {}) }}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={() => onSelectMatch(m)}
            >
              {titleCaseAddress(m.matchedAddress)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SliderField({ label, value, min, max, step, onChange, display, editable = false }) {
  const sliderId = useId();
  return (
    <div style={styles.sliderRow}>
      <div style={styles.sliderHeader}>
        <label htmlFor={sliderId} style={styles.inputLabel}>{label}</label>
        {editable ? (
          <input
            type="number"
            value={value}
            min={min}
            step={step}
            onChange={(e) => {
              const next = e.target.valueAsNumber;
              if (Number.isFinite(next)) onChange(Math.max(min, next));
            }}
            style={styles.sliderInput}
            aria-label={`${label} amount`}
          />
        ) : (
          <span style={styles.sliderValue}>{display}</span>
        )}
      </div>
      <input
        id={sliderId}
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={styles.slider}
        aria-label={label}
      />
    </div>
  );
}

function BRow({ label, value, neg = false, bold = false, accent = false }) {
  return (
    <tr style={styles.bRow}>
      <td style={{ ...styles.bLabel, fontWeight: bold ? 600 : 400 }}>{label}</td>
      <td style={{
        ...styles.bVal,
        color: accent ? "#15803D" : neg ? "#B91C1C" : "#111827",
        fontWeight: bold ? 600 : 400,
      }}>{value}</td>
    </tr>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  wrap: { fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif", maxWidth: 720, margin: "0 auto", padding: "20px 16px", color: "#111827", background: "#FAFAFA", minHeight: "100vh" },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 },
  headerTitle: { fontSize: 20, fontWeight: 600, color: "#111827" },
  headerMeta: { fontSize: 13, color: "#6B7280", marginTop: 2 },
  modeToggle: { display: "flex", border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden" },
  modeBtn: { padding: "6px 14px", fontSize: 13, border: "none", background: "transparent", color: "#6B7280", cursor: "pointer" },
  modeBtnActive: { background: "#185FA5", color: "#fff", fontWeight: 500 },
  tabBar: { display: "flex", borderBottom: "1px solid #E5E7EB", marginBottom: 16 },
  tab: { padding: "8px 16px", fontSize: 14, border: "none", background: "transparent", color: "#6B7280", cursor: "pointer", borderBottom: "2px solid transparent" },
  tabActive: { color: "#185FA5", borderBottom: "2px solid #185FA5", fontWeight: 500 },
  statGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 },
  statCard: { background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "12px 14px" },
  statLabel: { fontSize: 11, color: "#6B7280", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" },
  statValue: { fontSize: 20, fontWeight: 600, color: "#111827" },
  statSub: { fontSize: 11, color: "#9CA3AF", marginTop: 3 },
  maoCard: { border: "1px solid", borderRadius: 10, padding: "16px 20px", marginBottom: 16 },
  maoLabel: { fontSize: 13, fontWeight: 600, marginBottom: 4 },
  maoValue: { fontSize: 34, fontWeight: 700, color: "#111827" },
  maoFormula: { fontSize: 12, color: "#6B7280", marginTop: 4 },
  sectionLabel: { fontSize: 12, fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.05em", margin: "16px 0 8px", display: "flex", alignItems: "center", gap: 10 },
  card: { background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "16px", marginBottom: 12 },
  inputGrid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  inputGrid3: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 8 },
  inputRow: { display: "flex", flexDirection: "column", gap: 4 },
  inputLabel: { fontSize: 13, color: "#6B7280" },
  input: { padding: "8px 10px", fontSize: 15, border: "1px solid #D1D5DB", borderRadius: 6, background: "#fff", color: "#111827", outline: "none", width: "100%", boxSizing: "border-box" },
  suggestionsBox: { position: "absolute", top: "100%", left: 0, right: 0, marginTop: 2, background: "#fff", border: "1px solid #D1D5DB", borderRadius: 6, boxShadow: "0 4px 10px rgba(0,0,0,0.08)", zIndex: 20, maxHeight: 180, overflowY: "auto" },
  suggestionItem: { padding: "8px 10px", fontSize: 13, color: "#111827", cursor: "pointer", borderBottom: "1px solid #F3F4F6" },
  suggestionItemActive: { background: "#EFF6FF", color: "#185FA5" },
  addressStatusOk: { fontSize: 11, color: "#15803D", marginTop: 2 },
  addressStatusWarn: { fontSize: 11, color: "#92400E", marginTop: 2 },
  addressStatusMuted: { fontSize: 11, color: "#9CA3AF", marginTop: 2 },
  sliderRow: { marginBottom: 10 },
  sliderHeader: { display: "flex", justifyContent: "space-between", marginBottom: 5 },
  sliderValue: { fontWeight: 600, color: "#111827", fontSize: 14 },
  sliderInput: { width: 120, padding: "5px 8px", fontSize: 14, fontWeight: 600, textAlign: "right", border: "1px solid #D1D5DB", borderRadius: 6, color: "#111827", background: "#fff", boxSizing: "border-box" },
  slider: { width: "100%", accentColor: "#185FA5" },
  marginNote: { fontSize: 12, color: "#6B7280", marginTop: 6 },
  addBtn: { fontSize: 12, padding: "2px 10px", border: "1px solid #D1D5DB", borderRadius: 6, background: "#fff", cursor: "pointer", color: "#374151" },
  adjRow: { display: "flex", gap: 8, marginBottom: 8, alignItems: "center" },
  adjSelect: { flex: 1, fontSize: 13, padding: "6px 8px", border: "1px solid #D1D5DB", borderRadius: 6, background: "#fff" },
  adjInput: { width: 100, fontSize: 13, padding: "6px 8px", border: "1px solid #D1D5DB", borderRadius: 6, background: "#fff", textAlign: "right" },
  adjCalculated: { width: 100, fontSize: 13, padding: "6px 8px", color: "#B91C1C", textAlign: "right" },
  adjRemove: { fontSize: 16, border: "none", background: "none", cursor: "pointer", color: "#9CA3AF", padding: "0 4px" },
  adjTotal: { fontSize: 13, color: "#374151", paddingTop: 10, borderTop: "1px solid #F3F4F6", marginTop: 6 },
  stressBar: { height: 6, borderRadius: 3, background: "#F3F4F6", marginTop: 8, overflow: "hidden" },
  stressFill: { height: "100%", borderRadius: 3, transition: "width 0.2s, background 0.2s" },
  stressGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 },
  stressNote: { fontSize: 12, color: "#6B7280", marginTop: 6 },
  miniLabel: { fontSize: 11, color: "#9CA3AF", marginBottom: 2 },
  miniValue: { fontSize: 18, fontWeight: 600 },
  exportActions: { display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, marginTop: 8 },
  exportBtn: { width: "100%", padding: "10px", fontSize: 14, fontWeight: 500, background: "#185FA5", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" },
  pdfBtn: { width: "100%", padding: "10px", fontSize: 14, fontWeight: 500, background: "#fff", color: "#185FA5", border: "1px solid #185FA5", borderRadius: 8, cursor: "pointer" },
  exportBtnError: { background: "#B91C1C" },
  breakdownTitle: { fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 10 },
  bTable: { width: "100%", borderCollapse: "collapse" },
  bRow: { borderBottom: "1px solid #F3F4F6" },
  bLabel: { padding: "8px 0", fontSize: 14, color: "#6B7280" },
  bVal: { padding: "8px 0", fontSize: 14, textAlign: "right" },
  formulaBox: { marginTop: 20, padding: "12px 14px", background: "#F9FAFB", borderRadius: 8, border: "1px solid #E5E7EB" },
  formulaLabel: { fontSize: 11, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 },
  formulaText: { fontSize: 13, color: "#374151" },
  insightsHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  insightsTitle: { fontSize: 14, fontWeight: 600, color: "#111827" },
  insightsSubtitle: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  insightsBtn: { flexShrink: 0, padding: "7px 12px", fontSize: 13, fontWeight: 500, border: "none", borderRadius: 6, background: "#185FA5", color: "#fff", cursor: "pointer" },
  insightsBtnDisabled: { background: "#D1D5DB", color: "#6B7280", cursor: "not-allowed" },
  insightsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 },
  insightCard: { border: "1px solid #E5E7EB", borderRadius: 8, padding: "10px 12px", minWidth: 0 },
  insightHeading: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, fontSize: 13, fontWeight: 600, color: "#111827" },
  insightStatus: { flexShrink: 0, fontSize: 10, fontWeight: 600, color: "#6B7280", background: "#F3F4F6", borderRadius: 999, padding: "2px 6px" },
  insightStatusAvailable: { color: "#15803D", background: "#F0FDF4" },
  insightStatusError: { color: "#B91C1C", background: "#FEF2F2" },
  insightFields: { margin: "8px 0 0" },
  insightField: { display: "flex", justifyContent: "space-between", gap: 8, borderTop: "1px solid #F3F4F6", padding: "5px 0" },
  insightFieldLabel: { fontSize: 11, color: "#6B7280" },
  insightFieldValue: { margin: 0, fontSize: 11, fontWeight: 500, color: "#111827", textAlign: "right", overflowWrap: "anywhere" },
  insightEmpty: { fontSize: 11, color: "#9CA3AF", marginTop: 8 },
};
