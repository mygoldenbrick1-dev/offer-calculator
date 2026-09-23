import { useEffect, useId, useRef, useState } from "react";
import { anchorSummary, filterComps, initialCompFilters } from "./anchorReport.js";
import { downloadAnchorPdf, HOUSECANARY_DISCLOSURE, IDX_DISCLOSURE } from "./anchorExport.js";
import { getHouseCanaryComps } from "./propertyApi.js";

const DEFAULT_FILTERS = { radius: 0.3, months: 6, bedTolerance: 0, condition: "all" };
const BROKER = { name: "Josh Smith", company: "Stone Street Revive, LLC" };

const money = (value) => Number.isFinite(value)
  ? `$${Math.round(value).toLocaleString("en-US")}`
  : "-";
const number = (value, digits = 0) => Number.isFinite(value)
  ? value.toLocaleString("en-US", { maximumFractionDigits: digits })
  : "-";
const date = (value) => value
  ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`))
  : "-";

export default function AnchorPriceReport() {
  const addressId = useId();
  const [address, setAddress] = useState("");
  const [report, setReport] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [view, setView] = useState("analysis");
  const [downloading, setDownloading] = useState(false);
  const requestRef = useRef(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  async function loadReport(event) {
    event.preventDefault();
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus("loading");
    setError("");
    try {
      const nextReport = await getHouseCanaryComps(address, controller.signal);
      setReport(nextReport);
      const reportDate = nextReport.effectiveDate ? new Date(nextReport.effectiveDate) : new Date();
      setFilters(initialCompFilters(nextReport.comps, nextReport.subject, DEFAULT_FILTERS, reportDate));
      setStatus("ready");
    } catch (requestError) {
      if (requestError.name !== "AbortError") {
        setError(requestError.message);
        setStatus("error");
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  const reportDate = report?.effectiveDate ? new Date(report.effectiveDate) : new Date();
  const filteredComps = report
    ? filterComps(report.comps, report.subject, filters, reportDate)
      .filter((comp) => filters.condition === "all" || comp.condition === filters.condition)
    : [];
  const summary = anchorSummary(filteredComps);
  const conditions = report ? [...new Set(report.comps.map((comp) => comp.condition))].sort() : [];

  async function exportPdf() {
    setDownloading(true);
    try {
      await downloadAnchorPdf({ report, comps: filteredComps, filters, broker: BROKER });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main className={`anchor-report ${view === "seller" ? "seller-view" : ""}`}>
      <header className="anchor-header">
        <div>
          <p className="anchor-eyebrow">Stone Street Revive</p>
          <h1>Anchor Price Report</h1>
          <p className="anchor-subtitle">Closed sales that establish a defensible market baseline.</p>
        </div>
        {report && (
          <div className="anchor-actions">
            <div className="anchor-segmented" aria-label="Report view">
              <button className={view === "analysis" ? "active" : ""} onClick={() => setView("analysis")}>Analysis</button>
              <button className={view === "seller" ? "active" : ""} onClick={() => setView("seller")}>Seller</button>
            </div>
            <button className="anchor-export" onClick={exportPdf} disabled={downloading || !filteredComps.length}>
              {downloading ? "Preparing..." : "Download PDF"}
            </button>
          </div>
        )}
      </header>

      <form className="anchor-search" onSubmit={loadReport}>
        <label htmlFor={addressId}>Property address</label>
        <div className="anchor-search-row">
          <input
            id={addressId}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="1100 Main St, Kansas City, MO 64105"
            autoComplete="street-address"
            required
          />
          <button disabled={status === "loading"}>{status === "loading" ? "Loading comps..." : "Build report"}</button>
        </div>
        {error && <p className="anchor-error" role="alert">{error}</p>}
      </form>

      {!report && status !== "loading" && (
        <section className="anchor-empty">
          <span>Live comparable sales</span>
          <h2>Enter a complete address with ZIP code.</h2>
          <p>The first report loads from HouseCanary. Every filter after that is instant.</p>
        </section>
      )}

      {status === "loading" && <div className="anchor-loading" role="status">Analyzing closed sales...</div>}

      {report && (
        <>
          <section className="anchor-subject">
            <div>
              <p className="anchor-kicker">Subject property</p>
              <h2>{report.subject.address}</h2>
              <p>{number(report.subject.beds)} bed · {number(report.subject.baths, 1)} bath · {number(report.subject.sqft)} sqft</p>
            </div>
            <p className="anchor-effective">Data effective {date(report.effectiveDate)}</p>
          </section>

          <section className="anchor-filters" aria-label="Comparable filters">
            <label>Radius
              <select value={filters.radius} onChange={(event) => setFilters({ ...filters, radius: Number(event.target.value) })}>
                <option value="0.3">0.3 mile</option><option value="0.5">0.5 mile</option><option value="1">1 mile</option>
              </select>
            </label>
            <label>Sale date
              <select value={filters.months} onChange={(event) => setFilters({ ...filters, months: Number(event.target.value) })}>
                <option value="3">3 months</option><option value="6">6 months</option><option value="12">12 months</option>
              </select>
            </label>
            <label>Bedrooms
              <select value={filters.bedTolerance ?? "any"} onChange={(event) => setFilters({ ...filters, bedTolerance: event.target.value === "any" ? null : Number(event.target.value) })}>
                <option value="0">Exact match</option><option value="1">Within 1 bed</option><option value="any">Any</option>
              </select>
            </label>
            <label>Condition
              <select value={filters.condition} onChange={(event) => setFilters({ ...filters, condition: event.target.value })}>
                <option value="all">All conditions</option>
                {conditions.map((condition) => <option key={condition} value={condition}>{condition}</option>)}
              </select>
            </label>
          </section>

          <section className="anchor-summary">
            <div className="anchor-price">
              <p>Median anchor price</p>
              <strong>{money(summary.anchorPrice)}</strong>
              <span>Based on {filteredComps.length} qualifying closed sale{filteredComps.length === 1 ? "" : "s"}</span>
            </div>
            <dl>
              <div><dt>Avg. price / sqft</dt><dd>{money(summary.averagePricePerSqft)}</dd></div>
              <div><dt>HouseCanary value</dt><dd>{money(report.subject.estimatedValue)}</dd></div>
              <div><dt>Available closed comps</dt><dd>{report.comps.length}</dd></div>
            </dl>
          </section>

          <section className="anchor-comps">
            <div className="anchor-section-heading">
              <div><p className="anchor-kicker">Comparable sales</p><h2>Evidence behind the price</h2></div>
              <span>{filteredComps.length} shown</span>
            </div>
            {!filteredComps.length && <p className="anchor-no-results">No closed sales match these filters. Widen the radius or sale date.</p>}
            {filteredComps.map((comp) => (
              <article className="anchor-comp" key={comp.id}>
                <div className="anchor-comp-address"><h3>{comp.address}</h3><p>{date(comp.saleDate)} · {number(comp.distance, 2)} mi away</p></div>
                <div className="anchor-comp-price"><strong>{money(comp.salePrice)}</strong><span>{money(comp.pricePerSqft)}/sqft</span></div>
                <dl>
                  <div><dt>Property</dt><dd>{number(comp.beds)} bd · {number(comp.baths, 1)} ba · {number(comp.sqft)} sqft</dd></div>
                  <div><dt>Condition</dt><dd>{comp.condition}</dd></div>
                  <div><dt>Days on market</dt><dd>{comp.daysOnMarket ?? "-"}</dd></div>
                  <div><dt>Sale / list</dt><dd>{comp.saleToListRatio ? `${number(comp.saleToListRatio * 100, 1)}%` : "-"}</dd></div>
                </dl>
              </article>
            ))}
          </section>

          <footer className="anchor-footer">
            <strong>Prepared by {BROKER.name} · {BROKER.company}</strong>
            <p>{HOUSECANARY_DISCLOSURE}</p>
            <p>{IDX_DISCLOSURE}</p>
          </footer>
        </>
      )}
    </main>
  );
}