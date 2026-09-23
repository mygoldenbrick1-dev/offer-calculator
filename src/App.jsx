import { useState } from "react";
import AnchorPriceReport from "./AnchorPriceReport.jsx";
import OfferCalculator from "./OfferCalculator.jsx";
import { saveDeal } from "./dealStorage.js";

export default function App() {
  const [view, setView] = useState("calculator");

  return (
    <div className="workspace-shell">
      <nav className="workspace-nav" aria-label="Workspace">
        <strong>Stone Street Revive</strong>
        <div>
          <button className={view === "calculator" ? "active" : ""} onClick={() => setView("calculator")}>Offer Calculator</button>
          <button className={view === "anchor" ? "active" : ""} onClick={() => setView("anchor")}>Anchor Report</button>
        </div>
      </nav>
      {view === "calculator" ? <OfferCalculator onSave={saveDeal} /> : <AnchorPriceReport />}
    </div>
  );
}
