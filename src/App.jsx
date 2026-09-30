import { useState } from "react";
import AnchorPriceReport from "./AnchorPriceReport.jsx";
import OfferCalculator from "./OfferCalculator.jsx";
import { saveDeal } from "./dealStorage.js";

export default function App() {
  const [view, setView] = useState("calculator");
  const [anchorContext, setAnchorContext] = useState(null);

  function useAnchorComps(context) {
    setAnchorContext(context);
    setView("calculator");
  }

  return (
    <div className="workspace-shell">
      <nav className="workspace-nav" aria-label="Workspace">
        <strong>Stone Street Revive</strong>
        <div>
          <button className={view === "calculator" ? "active" : ""} onClick={() => setView("calculator")}>Offer Calculator</button>
          <button className={view === "anchor" ? "active" : ""} onClick={() => setView("anchor")}>Anchor Report</button>
        </div>
      </nav>
      {view === "calculator" ? <OfferCalculator property={anchorContext?.subject ? {
        address: anchorContext.subject.address,
        meta: `${anchorContext.subject.beds ?? "-"} bed · ${anchorContext.subject.baths ?? "-"} bath · ${anchorContext.subject.sqft ?? "-"} sqft`,
        arv: anchorContext.averagePricePerSqft && anchorContext.subject.sqft
          ? Math.round(anchorContext.averagePricePerSqft * anchorContext.subject.sqft)
          : undefined,
        sqft: anchorContext.subject.sqft,
        anchorComps: anchorContext.comps,
        anchorAveragePricePerSqft: anchorContext.averagePricePerSqft,
      } : {}} onSave={saveDeal} /> : <AnchorPriceReport onUseComps={useAnchorComps} />}
    </div>
  );
}
