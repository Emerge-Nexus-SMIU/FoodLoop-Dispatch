import { z } from 'zod';
export const unit = z.enum(['MEAL', 'KG', 'ITEM']);
export const category = z.enum(['PREPARED', 'BAKERY', 'PRODUCE', 'DAIRY', 'PANTRY']);
export const handling = z.enum(['AMBIENT', 'CHILLED', 'FROZEN']);
const positive = z.coerce.number().positive().max(1000000).multipleOf(0.001);
export const lotSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    category,
    description: z.string().max(2000).default(''),
    quantityValue: positive,
    quantityUnit: unit,
    declaredWeightKg: positive.optional(),
    packaging: z.string().trim().min(3).max(200),
    allergensNote: z.string().max(500).default(''),
    handlingDeclaration: z.string().trim().min(12).max(2000),
    storageRequirements: handling,
    locationId: z.string().min(1),
    pickupStart: z.iso.datetime(),
    pickupEnd: z.iso.datetime(),
  })
  .refine((x) => new Date(x.pickupEnd) > new Date(x.pickupStart), {
    message: 'Pickup end must follow start',
    path: ['pickupEnd'],
  });
export const orgSchema = z.object({
  name: z.string().trim().min(3).max(120),
  type: z.enum(['DONOR', 'RECIPIENT', 'LOGISTICS']),
  contact: z.string().trim().min(3).max(200),
  timezone: z
    .string()
    .refine((x) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: x });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid timezone')
    .default('Asia/Karachi'),
  address: z.string().trim().min(5).max(300),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});
export const profileSchema = z
  .object({
    capacityValue: positive,
    capacityUnit: unit,
    serviceRadiusKm: z.coerce.number().positive().max(1000),
    acceptedCategories: z.array(category).min(1),
    specialHandlingCapabilities: z.array(handling).min(1),
    availableFrom: z.iso.datetime(),
    availableUntil: z.iso.datetime(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
  })
  .refine(
    (x) => new Date(x.availableUntil) > new Date(x.availableFrom),
    'Availability end must follow start',
  );
export const challengeSchema = z.object({
  quantity: positive,
  weightKg: positive.optional(),
  discrepancyReason: z.string().max(500).optional(),
});
