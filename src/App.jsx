import OfferCalculator from "./OfferCalculator.jsx";

export default function App() {
  return (
    <OfferCalculator
      onExport={(summary) => {
        // Sprint 1 smoke test: confirm addressVerified/coords come through
        // once the Census geocoder match is selected in the browser.
        console.log("Deal summary exported:", summary);
      }}
    />
  );
}
