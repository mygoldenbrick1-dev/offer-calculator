# Production Integration

## Component

Render `OfferCalculator` from `src/OfferCalculator.jsx` in the production property workflow.

```jsx
<OfferCalculator
  property={{
    address: property.address,
    meta: `${property.beds} bed · ${property.baths} bath · ${property.sqft} sqft`,
    arv: property.arv,
    purchasePrice: property.purchasePrice,
    coords: property.coords,
  }}
  onSave={(summary) => saveOfferCalculation(property.id, summary)}
/>
```

`onSave` receives the complete calculation summary. In this sandbox it writes to local storage. In production, replace `saveDeal` in `src/App.jsx` with the application's authenticated API mutation.

## Save API

Recommended endpoint:

```text
POST /api/properties/:propertyId/offer-calculations
Content-Type: application/json
```

Persist the summary fields supplied by `onSave`, plus server-owned `id`, `propertyId`, `userId`, `createdAt`, and `updatedAt`. Validate all numeric values and authorization server-side.

## Provider APIs

Production must implement these server-side routes:

```text
GET /api/geocode?address=...
GET /api/housecanary/value?address=...&zipcode=...
GET /api/housecanary/property-insights?address=...&zipcode=...
```

The geocode response is `{ "matches": [] }`. The valuation response is:

```json
{
  "arv": 210000,
  "priceLow": 195000,
  "priceHigh": 225000,
  "confidence": 0.12,
  "source": "HouseCanary"
}
```

Keep `HOUSECANARY_API_KEY` and `HOUSECANARY_API_SECRET` in the production secret manager. Never expose them with a `VITE_` prefix.

The sandbox middleware applies input validation, per-IP request limits, 8-second upstream timeouts, request IDs, and structured metadata-only logs. Property insights are cached in memory for 15 minutes with concurrent-request deduplication, so repeat refreshes do not trigger another set of 11 provider calls.

For multi-instance production deployment, replace the in-memory cache and rate-limit maps with shared infrastructure such as Redis. Preserve the response headers (`X-Request-Id`, `X-Cache`, and `Retry-After`) when porting the routes.

## Export

The calculator supports clipboard export and client-side PDF download. PDF generation is lazy-loaded, so the `jsPDF` bundle is fetched only when the user downloads a report.

## Validation

```text
npm test
npm run test:api
npm run test:e2e
npm run build
```

API and browser tests mock upstream providers and do not consume HouseCanary points.

## Migration Checklist

1. Copy `OfferCalculator.jsx`, `calculateOffer.js`, and `propertyApi.js` into the production frontend.
2. Copy the relevant rules from `responsive.css` into the production stylesheet.
3. Mount the calculator in the property route or tab.
4. Map the production property model to the `property` prop.
5. Replace local storage `onSave` with the authenticated save mutation.
6. Move the Vite development middleware behavior to production backend routes.
7. Port the tests and run production integration tests before removing this sandbox.