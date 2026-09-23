import { test, expect } from "@playwright/test";

test("loads property data, prices paint, and downloads a PDF", async ({ page }) => {
  await page.route("**/api/geocode**", (route) => route.fulfill({
    json: {
      matches: [{
        matchedAddress: "1100 MAIN ST, KANSAS CITY, MO, 64105",
        coordinates: { x: -94.58, y: 39.1 },
      }],
    },
  }));
  await page.route("**/api/housecanary/value**", (route) => route.fulfill({
    json: { arv: 250000, priceLow: 230000, priceHigh: 270000, source: "HouseCanary" },
  }));
  await page.route("**/api/housecanary/property-insights**", (route) => route.fulfill({
    json: {
      source: "HouseCanary",
      property: { beds: 3, baths: 2, sqft: 1500 },
      insights: [{ endpoint: "property/details", status: "available", fields: [] }],
    },
  }));

  await page.goto("/");
  await page.getByRole("textbox", { name: "Property address" }).fill("1100 Main St, Kansas City, MO 64105");
  await page.getByRole("option").click();
  await expect(page.getByText(/HouseCanary valuation loaded/)).toBeVisible();
  await page.getByRole("button", { name: "Load Insights" }).click();
  await expect(page.getByRole("textbox", { name: "Beds / bath / sqft" })).toHaveValue("3 bed · 2 bath · 1,500 sqft");

  await page.getByRole("button", { name: "+ Add" }).click();
  await page.getByRole("combobox", { name: "Adjustment type" }).selectOption({ label: "Paint" });
  await expect(page.getByText(/Rehab additions:/)).toContainText("$15,000");
  await expect(page.getByText(/Effective rehab:/)).toContainText("$43,000");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("1100-main-st-kansas-city-mo-64105-offer.pdf");
});
