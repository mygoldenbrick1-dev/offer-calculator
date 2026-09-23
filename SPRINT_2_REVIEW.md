# Sprint 2 Review: Anchor Price Report

Date: 2026-09-22
Scope: Missouri Due Diligence Engine Agile Workflow, Sprint 2

## Summary

The Anchor Price Report works as a sandbox prototype, but it is not production-ready. The missing production comps route and missing production UI integration are release blockers.

## Findings

### Critical: Production comps endpoint is missing

The sandbox frontend calls `/api/housecanary/comps` from `src/propertyApi.js`. The production Express routes in `server/routes.ts` implement HouseCanary valuation and property-insights routes, but not the comps route. The comps endpoint exists only in the Vite middleware in `vite.config.js`.

Impact: production requests for the Anchor Price Report comps will fail.

Required follow-up: port the comps handler, normalization, caching, rate limiting, validation, and error handling into `server/routes.ts`, then add production route tests.

### Critical: Anchor Price Report is sandbox-only

`offer-calculator-sandbox/src/App.jsx` renders `AnchorPriceReport`, but no production `client` component imports or renders it.

Impact: Sprint 2 is not available in the main application workflow.

Required follow-up: integrate the report into the production application and preserve tenant/domain behavior.

### High: Comp matching is incomplete

The workflow requires closed comps matched by beds, baths, and square footage. `offer-calculator-sandbox/src/anchorReport.js` filters by radius, sale date, and bedroom tolerance only. Bath and square-footage matching are absent.

Impact: the report can include comps that do not satisfy the Sprint 2 acceptance criteria.

Required follow-up: add explicit bath and sqft tolerance/filter rules, and test them.

### Medium: Broker identity is hardcoded

`offer-calculator-sandbox/src/AnchorPriceReport.jsx` hardcodes Josh Smith and Stone Street Revive, LLC.

Impact: the report is not tenant-configurable and may show the wrong identity for another agent or office.

Required follow-up: source broker/company identity from tenant configuration or component props.

### Medium: Production routing is not tested

`offer-calculator-sandbox/test/api.integration.test.js` tests the Vite `localApi` plugin, not the Express route registration in `server/routes.ts`.

Impact: sandbox tests can pass while the production endpoint remains absent or broken.

Required follow-up: add an integration test for the production Express route.

## Verified Baseline

Focused Anchor/HouseCanary tests: 13 passed, 0 failed.

Those tests validate sandbox behavior only. They do not prove production readiness.

## Sprint 2 Requirements Checklist

- Real closed comps: sandbox normalization/filtering exists; production route missing.
- Radius/date/bed filters: implemented in sandbox.
- Condition, DOM, sale/list ratio, and price/sqft: displayed in sandbox.
- Seller PDF view and broker footer: implemented in sandbox, with hardcoded broker identity.
- PDF export: implemented in sandbox.
- HouseCanary attribution and IDX disclaimer: implemented in sandbox.
- Production integration: missing.
- Production comps endpoint: missing.
- Beds/baths/sqft matching: incomplete.
