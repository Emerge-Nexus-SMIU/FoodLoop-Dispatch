export const POLICY = 'rules-v1.0';
export type MatchLot = {
  category: string;
  storageRequirements: string;
  quantityValue: unknown;
  quantityUnit: string;
  pickupStart: Date;
  pickupEnd: Date;
  location: { latitude: number | null; longitude: number | null };
};
export type MatchRecipient = {
  verificationStatus: string;
  profile: {
    capacityValue: unknown;
    capacityUnit: string;
    serviceRadiusKm: number;
    acceptedCategories: string[];
    specialHandlingCapabilities: string[];
    availableFrom: Date;
    availableUntil: Date;
    latitude: number | null;
    longitude: number | null;
  } | null;
};
export function haversine(a: number, b: number, c: number, d: number) {
  const r = Math.PI / 180;
  const x =
    Math.sin(((c - a) * r) / 2) ** 2 +
    Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
export type Weights = {
  capacityWeight: number;
  windowWeight: number;
  distanceWeight: number;
  version: number;
};
export const DEFAULT_WEIGHTS: Weights = {
  capacityWeight: 35,
  windowWeight: 35,
  distanceWeight: 30,
  version: 1,
};
export function evaluate(
  lot: MatchLot,
  recipient: MatchRecipient,
  now = new Date(),
  weights: Weights = DEFAULT_WEIGHTS,
) {
  const p = recipient.profile,
    reasons: string[] = [];
  if (recipient.verificationStatus !== 'VERIFIED') reasons.push('RECIPIENT_NOT_VERIFIED');
  if (
    !p ||
    !p.acceptedCategories.includes(lot.category) ||
    !p.specialHandlingCapabilities.includes(lot.storageRequirements)
  )
    reasons.push('INCOMPATIBLE_CATEGORY_OR_HANDLING');
  if (lot.pickupEnd <= now) reasons.push('LOT_EXPIRED');
  if (
    !p ||
    p.capacityUnit !== lot.quantityUnit ||
    Number(p.capacityValue) < Number(lot.quantityValue)
  )
    reasons.push('INSUFFICIENT_CAPACITY_OR_UNIT');
  let distanceKm: number | null = null;
  if (
    p &&
    lot.location.latitude !== null &&
    lot.location.longitude !== null &&
    p.latitude !== null &&
    p.longitude !== null
  ) {
    distanceKm = haversine(lot.location.latitude, lot.location.longitude, p.latitude, p.longitude);
    if (distanceKm > p.serviceRadiusKm) reasons.push('OUTSIDE_SERVICE_RADIUS');
  }
  const overlap = p
    ? Math.max(
        0,
        Math.min(+lot.pickupEnd, +p.availableUntil) -
          Math.max(+lot.pickupStart, +p.availableFrom, +now),
      )
    : 0;
  if (!overlap) reasons.push('NO_PICKUP_AVAILABILITY');
  const factors = {
    weights,
    capacityFit: p ? Math.min(1, Number(lot.quantityValue) / Number(p.capacityValue)) : 0,
    windowFit: Math.min(
      1,
      overlap / Math.max(1, +lot.pickupEnd - Math.max(+lot.pickupStart, +now)),
    ),
    distanceFit: distanceKm === null ? null : Math.max(0, 1 - distanceKm / p!.serviceRadiusKm),
    distanceBasis:
      distanceKm === null
        ? 'Distance not assessed; capacity/window weights re-normalized'
        : 'Straight-line Haversine; road time unavailable',
  };
  const eligible = !reasons.length;
  const score = eligible
    ? Math.round(
        (100 *
          (weights.capacityWeight * factors.capacityFit +
            weights.windowWeight * factors.windowFit +
            (factors.distanceFit === null ? 0 : weights.distanceWeight * factors.distanceFit))) /
          (weights.capacityWeight +
            weights.windowWeight +
            (factors.distanceFit === null ? 0 : weights.distanceWeight)),
      )
    : null;
  return {
    eligible,
    reasonCodes: reasons,
    factors,
    score,
    policyVersion: weights.version === 1 ? POLICY : `${POLICY}+policy-${weights.version}`,
    computedAt: now.toISOString(),
    distanceKm,
  };
}
