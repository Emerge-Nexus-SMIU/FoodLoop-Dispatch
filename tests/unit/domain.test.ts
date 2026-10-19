import { describe, it, expect } from 'vitest';
import { evaluate, haversine, type MatchLot, type MatchRecipient } from '../../src/server/matching';
import { lotSchema, profileSchema } from '../../src/server/schemas';
const now = new Date('2026-10-19T10:00:00Z');
const lot: MatchLot = {
  category: 'PREPARED',
  storageRequirements: 'AMBIENT',
  quantityValue: 25,
  quantityUnit: 'MEAL',
  pickupStart: new Date(+now - 60000),
  pickupEnd: new Date(+now + 90 * 60000),
  location: { latitude: 24.86, longitude: 67.01 },
};
const recipient: MatchRecipient = {
  verificationStatus: 'VERIFIED',
  profile: {
    capacityValue: 50,
    capacityUnit: 'MEAL',
    serviceRadiusKm: 20,
    acceptedCategories: ['PREPARED'],
    specialHandlingCapabilities: ['AMBIENT'],
    availableFrom: new Date(+now - 3600000),
    availableUntil: new Date(+now + 86400000),
    latitude: 24.87,
    longitude: 67.02,
  },
};
describe('versioned deterministic matching', () => {
  it('ranks eligible declared capability without claiming road time', () => {
    const r = evaluate(lot, recipient, now);
    expect(r.eligible).toBe(true);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.factors.distanceBasis).toContain('road time unavailable');
  });
  it('normalizes unknown distance over remaining weights', () => {
    const r = evaluate({ ...lot, location: { latitude: null, longitude: null } }, recipient, now);
    expect(r.distanceKm).toBeNull();
    expect(r.score).toBe(75);
    expect(r.factors.distanceBasis).toContain('not assessed');
  });
  it.each(['PENDING', 'SUSPENDED'])('excludes %s organizations', (verificationStatus) =>
    expect(evaluate(lot, { ...recipient, verificationStatus }, now).reasonCodes).toContain(
      'RECIPIENT_NOT_VERIFIED',
    ),
  );
  it('rejects incompatible handling and category', () =>
    expect(
      evaluate({ ...lot, category: 'DAIRY', storageRequirements: 'FROZEN' }, recipient, now)
        .reasonCodes,
    ).toContain('INCOMPATIBLE_CATEGORY_OR_HANDLING'));
  it('rejects different units without conversion', () =>
    expect(evaluate({ ...lot, quantityUnit: 'KG' }, recipient, now).eligible).toBe(false));
  it('rejects missing capacity profile', () =>
    expect(evaluate(lot, { ...recipient, profile: null }, now).reasonCodes).toContain(
      'INSUFFICIENT_CAPACITY_OR_UNIT',
    ));
  it('rejects overcapacity', () =>
    expect(evaluate({ ...lot, quantityValue: 51 }, recipient, now).eligible).toBe(false));
  it('rejects out-of-range recipients', () =>
    expect(
      evaluate({ ...lot, location: { latitude: 0, longitude: 0 } }, recipient, now).reasonCodes,
    ).toContain('OUTSIDE_SERVICE_RADIUS'));
  it('uses an exact non-accepting expiry boundary', () =>
    expect(evaluate({ ...lot, pickupEnd: now }, recipient, now).reasonCodes).toContain(
      'LOT_EXPIRED',
    ));
  it('rejects disjoint availability', () =>
    expect(
      evaluate(
        lot,
        {
          ...recipient,
          profile: { ...recipient.profile!, availableFrom: new Date(+now + 86400000) },
        },
        now,
      ).reasonCodes,
    ).toContain('NO_PICKUP_AVAILABILITY'));
  it('compares instants irrespective of time zone offsets', () =>
    expect(
      evaluate({ ...lot, pickupEnd: new Date('2026-10-19T15:00:00+05:00') }, recipient, now)
        .eligible,
    ).toBe(false));
  it('calculates Haversine consistently', () => {
    expect(haversine(0, 0, 0, 0)).toBe(0);
    expect(haversine(0, 0, 0, 1)).toBeCloseTo(111.195, 2);
  });
});
describe('input boundaries', () => {
  const input = {
    title: 'Campus surplus',
    category: 'PREPARED',
    quantityValue: 25,
    quantityUnit: 'MEAL',
    packaging: 'Sealed trays',
    handlingDeclaration: 'Held in labeled containers for collection',
    storageRequirements: 'AMBIENT',
    locationId: 'loc',
    pickupStart: now.toISOString(),
    pickupEnd: new Date(+now + 60000).toISOString(),
  };
  it('accepts a complete declaration', () => expect(lotSchema.safeParse(input).success).toBe(true));
  it.each([0, -1, 1000001, 1.0001])('rejects invalid quantity %s', (quantityValue) =>
    expect(lotSchema.safeParse({ ...input, quantityValue }).success).toBe(false),
  );
  it('requires complete handling declaration', () =>
    expect(lotSchema.safeParse({ ...input, handlingDeclaration: 'safe' }).success).toBe(false));
  it('rejects a reversed pickup window', () =>
    expect(lotSchema.safeParse({ ...input, pickupEnd: input.pickupStart }).success).toBe(false));
  it('rejects incomplete receiving profile', () =>
    expect(profileSchema.safeParse({ capacityValue: 20 }).success).toBe(false));
});
