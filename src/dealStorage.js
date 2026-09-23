export const DEAL_STORAGE_KEY = "offer-calculator.saved-deals";

export function saveDeal(summary, storage = localStorage) {
  let existing = [];
  try {
    const parsed = JSON.parse(storage.getItem(DEAL_STORAGE_KEY) || "[]");
    if (Array.isArray(parsed)) existing = parsed;
  } catch {
    existing = [];
  }

  const savedDeal = {
    ...summary,
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    savedAt: new Date().toISOString(),
  };
  storage.setItem(DEAL_STORAGE_KEY, JSON.stringify([savedDeal, ...existing].slice(0, 100)));
  return savedDeal;
}