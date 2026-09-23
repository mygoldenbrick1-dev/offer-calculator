import { test, expect } from "@playwright/test";

function daysAgo(days) {
  const value = new Date();
  value.setDate(value.getDate() - days);
  return value.toISOString().slice(0, 10);
}

const report = {
  source: "HouseCanary",
  effectiveDate: new Date().toISOString().slice(0, 10),
  subject: { address: "1100 Main St, Kansas City, MO, 64105", beds: 3, baths: 2, sqft: 1500, estimatedValue: 250000 },
  comps: [
    { id: "near", address: "1200 Main St, Kansas City, MO, 64105", distance: 0.2, saleDate: daysAgo(30), salePrice: 240000, listPrice: 250000, saleToListRatio: 0.96, daysOnMarket: 18, beds: 3, baths: 2, sqft: 1500, pricePerSqft: 160, condition: "Average" },
    { id: "wide", address: "1300 Oak St, Kansas City, MO, 64105", distance: 0.4, saleDate: daysAgo(45), salePrice: 260000, listPrice: 260000, saleToListRatio: 1, daysOnMarket: 9, beds: 3, baths: 2, sqft: 1600, pricePerSqft: 162.5, condition: "Good" },
    { id: "bed", address: "1400 Walnut St, Kansas City, MO, 64105", distance: 0.1, saleDate: daysAgo(20), salePrice: 220000, listPrice: 230000, saleToListRatio: 0.9565, daysOnMarket: 24, beds: 2, baths: 1, sqft: 1200, pricePerSqft: 183.33, condition: "Fair" },
  ],
};

async function openReport(page) {
  await page.route("**/api/housecanary/comps**", (route) => route.fulfill({ json: report }));
  await page.goto("/");
  await page.getByRole("button", { name: "Anchor Report" }).click();
  await page.getByRole("textbox", { name: "Property address" }).fill("1100 Main St, Kansas City, MO 64105");
  const started = Date.now();
  await page.getByRole("button", { name: "Build report" }).click();
  await expect(page.getByText("$240,000").first()).toBeVisible();
  expect(Date.now() - started).toBeLessThan(3000);
}

test("filters closed comps locally and downloads the seller report", async ({ page }) => {
  await openReport(page);
  await expect(page.getByText("1 shown")).toBeVisible();
  await expect(page.getByText("1200 Main St", { exact: false })).toBeVisible();

  await page.getByLabel("Radius").selectOption("0.5");
  await expect(page.getByText("2 shown")).toBeVisible();
  await expect(page.getByText("$250,000").first()).toBeVisible();
  await page.getByRole("button", { name: "Seller" }).click();
  await expect(page.getByLabel("Radius")).toBeHidden();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("1100-main-st-kansas-city-mo-64105-anchor-price-report.pdf");
});

test("report remains within a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openReport(page);
  await page.getByLabel("Bedrooms").selectOption("any");
  await expect(page.getByText("2 shown")).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasHorizontalOverflow).toBe(false);
});