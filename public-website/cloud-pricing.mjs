export function cloudSeatEstimate(seats) {
  if (!Number.isSafeInteger(seats) || seats < 1 || seats > 1000) return null;
  return { annualUsd: seats * 30, twoYearUsd: seats * 60 };
}
