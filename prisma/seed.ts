import 'dotenv/config';
import { hash } from 'bcryptjs';
import { db } from '../src/server/db';
async function main() {
  if (process.env.ALLOW_DEMO_SEED !== 'true' || process.env.NODE_ENV === 'production')
    throw new Error('Demo seed requires ALLOW_DEMO_SEED=true outside production.');
  const passwordHash = await hash('DemoFoodLoop!2026', 12);
  const accounts = [
    ['admin', 'Demo Administrator', true],
    ['donor', 'Aisha · Campus Kitchen', false],
    ['recipient', 'Omar · Community Table', false],
    ['recipient2', 'Sara · Neighborhood Pantry', false],
    ['dispatcher', 'Bilal · Collection Team', false],
  ] as const;
  for (const [key, name, platformAdmin] of accounts)
    await db.user.upsert({
      where: { email: `${key}@demo.foodloop.test` },
      create: {
        id: `demo-${key}`,
        email: `${key}@demo.foodloop.test`,
        name,
        passwordHash,
        emailVerifiedAt: new Date(),
        platformAdmin,
      },
      update: { emailVerifiedAt: new Date() },
    });
  for (const [id, name, type, user, role] of [
    ['demo-campus', 'Demo Campus Kitchen', 'DONOR', 'donor', 'DONOR_MANAGER'],
    ['demo-table', 'Demo Community Table', 'RECIPIENT', 'recipient', 'RECIPIENT_MANAGER'],
    ['demo-pantry', 'Demo Neighborhood Pantry', 'RECIPIENT', 'recipient2', 'RECIPIENT_MANAGER'],
    ['demo-logistics', 'Demo Collection Team', 'LOGISTICS', 'dispatcher', 'DISPATCHER'],
  ]) {
    await db.organization.upsert({
      where: { id },
      create: {
        id,
        name,
        type,
        contact: 'training@example.invalid',
        demo: true,
        verificationStatus: 'VERIFIED',
        locations: {
          create: {
            id: `${id}-location`,
            label: 'Campus collection desk',
            address: 'Fictional Campus, Karachi (demo)',
            latitude: 24.8607,
            longitude: 67.0011,
          },
        },
        memberships: { create: { userId: `demo-${user}`, role } },
      },
      update: {},
    });
    if (type === 'RECIPIENT')
      await db.recipientProfile.upsert({
        where: { organizationId: id },
        create: {
          organizationId: id,
          capacityValue: 50,
          capacityUnit: 'MEAL',
          serviceRadiusKm: 20,
          acceptedCategories: ['PREPARED', 'BAKERY', 'PRODUCE'],
          specialHandlingCapabilities: ['AMBIENT', 'CHILLED'],
          availableFrom: new Date(Date.now() - 3600000),
          availableUntil: new Date(Date.now() + 7 * 86400000),
          latitude: 24.87,
          longitude: 67.01,
        },
        update: {
          availableFrom: new Date(Date.now() - 3600000),
          availableUntil: new Date(Date.now() + 7 * 86400000),
        },
      });
  }
  for (const [key, title, quantityValue, quantityUnit, category, end] of [
    ['meals', '25 packed campus meals', 25, 'MEAL', 'PREPARED', 90],
    ['bakery', 'Bakery surplus — 12 kg', 12, 'KG', 'BAKERY', 120],
    ['urgent', 'Collection closing soon', 10, 'MEAL', 'PREPARED', 15],
    ['expired', 'Expired example — never impact', 8, 'MEAL', 'PREPARED', -10],
    ['capacity', 'Large lot — capacity exclusion', 500, 'MEAL', 'PREPARED', 120],
  ] as const) {
    await db.lot.upsert({
      where: { id: `demo-lot-${key}` },
      create: {
        id: `demo-lot-${key}`,
        title,
        quantityValue,
        quantityUnit,
        category,
        donorOrganizationId: 'demo-campus',
        locationId: 'demo-campus-location',
        createdById: 'demo-donor',
        packaging: 'Individually sealed demo containers',
        handlingDeclaration:
          'Demo declaration: packaged and held for collection; operators must assess suitability.',
        storageRequirements: 'AMBIENT',
        pickupStart: new Date(Date.now() - 3600000),
        pickupEnd: new Date(Date.now() + end * 60000),
        status: end < 0 ? 'EXPIRED' : 'OPEN',
      },
      update: {},
    });
  }
  console.log(
    'Demo fixtures ready. Five fictional accounts; existing lots preserved. See README for login details.',
  );
}
main().finally(() => db.$disconnect());
