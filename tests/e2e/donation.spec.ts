import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/server/db';
import { decrypt } from '../../src/server/crypto';
const origin = 'http://localhost:3000';
async function request(c: BrowserContext, path: string, body: unknown = {}, method = 'POST') {
  const r = await c.request.fetch(`${origin}/api/v1/${path}`, {
    method,
    headers: { Origin: origin, 'Idempotency-Key': randomUUID() },
    ...(method === 'GET' ? {} : { data: body }),
  });
  return { status: r.status(), body: await r.json() };
}
async function login(page: Page, who: string) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(`${who}@demo.foodloop.test`);
  await page.getByLabel('Password', { exact: true }).fill('DemoFoodLoop!2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible();
}
async function account(c: BrowserContext, type: string, name: string) {
  const id = randomUUID().slice(0, 10);
  let r = await request(c, 'auth/register', {
    name,
    email: `e2e-${id}@example.invalid`,
    password: 'BrowserTest!2026',
  });
  expect(r.status).toBe(200);
  const user = await db.user.findFirstOrThrow({ where: { email: `e2e-${id}@example.invalid` } });
  const outbox = await db.mailOutbox.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const message = outbox
    .map((row) => JSON.parse(decrypt(row.payload)) as { to: string; text: string })
    .find((m) => m.to === user.email);
  expect(message).toBeDefined();
  const verification = new URL(message!.text.match(/https?:\/\/[^\s]+/)![0]);
  expect(
    (await request(c, 'auth/verify-email', { token: verification.searchParams.get('token') }))
      .status,
  ).toBe(200);
  r = await request(c, 'organizations', {
    name: `E2E ${name} ${id}`,
    type,
    contact: 'synthetic@example.invalid',
    address: 'Fictional campus collection desk',
    latitude: 24.86,
    longitude: 67.01,
  });
  expect(r.status).toBe(200);
  await db.organization.update({ where: { id: r.body.data.id }, data: { demo: true } });
  return r.body.data.id as string;
}
function lotBody(locationId: string, title = 'Browser API lot') {
  return {
    locationId,
    title,
    category: 'PREPARED',
    quantityValue: 25,
    quantityUnit: 'MEAL',
    packaging: 'Sealed demo trays',
    handlingDeclaration: 'Demo operator declaration: sealed and labeled for collection',
    storageRequirements: 'AMBIENT',
    pickupStart: new Date(Date.now() - 60000).toISOString(),
    pickupEnd: new Date(Date.now() + 90 * 60000).toISOString(),
  };
}
test('full UI workflow: admin verification → 25 meals → exclusive acceptance → dispatch → two-party receipt', async ({
  browser,
}) => {
  const donorContext = await browser.newContext(),
    recipientContext = await browser.newContext(),
    adminContext = await browser.newContext(),
    dispatchContext = await browser.newContext();
  const donorId = await account(donorContext, 'DONOR', 'Campus Donor'),
    recipientId = await account(recipientContext, 'RECIPIENT', 'Community Recipient');
  const admin = await adminContext.newPage();
  await login(admin, 'admin');
  await admin.goto('/admin/organizations');
  for (const id of [donorId, recipientId]) {
    const org = await db.organization.findUniqueOrThrow({ where: { id } });
    const row = admin
      .locator('.record')
      .filter({ has: admin.getByRole('heading', { name: org.name, exact: true }) });
    await row.getByRole('button', { name: 'Verify organization' }).click();
    await expect(row.getByText('VERIFIED', { exact: true })).toBeVisible();
  }
  const recipient = await recipientContext.newPage();
  await recipient.goto('/app/profile');
  await recipient.getByLabel('Capacity per lot').fill('50');
  await recipient.getByLabel('Latitude (optional)').fill('24.86');
  await recipient.getByLabel('Longitude (optional)').fill('67.01');
  await recipient.getByRole('button', { name: 'Save receiving profile' }).click();
  await expect(recipient.getByRole('status')).toHaveText('Saved successfully');
  const donor = await donorContext.newPage();
  await donor.goto('/app/lots/new');
  await donor.getByLabel('Lot title').fill('Browser verified 25 meals');
  await donor
    .getByLabel('Handling declaration (required)')
    .fill('Prepared in sealed containers; operator must assess collection suitability.');
  await donor.getByRole('button', { name: 'Save draft' }).click();
  await expect(
    donor.getByRole('heading', { name: 'Browser verified 25 meals', exact: true, level: 2 }),
  ).toBeVisible();
  await donor.getByRole('button', { name: 'Publish lot' }).click();
  await expect(donor.getByText('OPEN', { exact: true })).toBeVisible();
  await donor.getByRole('button', { name: 'Evaluate matches' }).click();
  await expect(donor.getByRole('heading', { name: 'Latest evaluation' })).toBeVisible();
  await expect(donor.getByText('Declared requirements met').first()).toBeVisible();
  await donor.getByRole('button', { name: 'Send eligible offers' }).click();
  await expect(donor.getByRole('status')).toContainText('Offers sent');
  await recipient.goto('/app/offers');
  const offer = recipient.locator('.offer-card').filter({ hasText: 'Browser verified 25 meals' });
  await offer.getByRole('button', { name: 'Accept exclusive reservation' }).click();
  await expect(offer.getByText('ACCEPTED', { exact: true })).toBeVisible();
  await donor.goto('/app/pickups');
  const donorPickup = donor
    .locator('.pickup-card')
    .filter({ hasText: 'Browser verified 25 meals' });
  await donorPickup.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(donorPickup.getByText('SCHEDULED', { exact: true })).toBeVisible();
  await donorPickup
    .getByRole('combobox', { name: 'Dispatcher', exact: true })
    .selectOption('demo-dispatcher');
  await donorPickup.getByRole('button', { name: 'Assign dispatcher' }).click();
  await expect(donorPickup.getByText('ASSIGNED', { exact: true })).toBeVisible();
  const dispatcher = await dispatchContext.newPage();
  await login(dispatcher, 'dispatcher');
  await dispatcher.goto('/app/dispatch');
  const dispatchPickup = dispatcher
    .locator('.pickup-card')
    .filter({ hasText: 'Browser verified 25 meals' });
  await dispatchPickup.getByRole('button', { name: 'Start collection' }).click();
  await dispatchPickup.getByRole('button', { name: 'Record arrival' }).click();
  await expect(dispatchPickup.getByText('ARRIVED', { exact: true })).toBeVisible();
  await donor.reload();
  await donorPickup.getByRole('button', { name: 'Generate one-time code' }).click();
  const otp = await donorPickup.locator('.code-box strong').innerText();
  expect(otp).toMatch(/^\d{6}$/);
  await recipient.goto('/app/pickups');
  const recipientPickup = recipient
    .locator('.pickup-card')
    .filter({ hasText: 'Browser verified 25 meals' });
  await recipientPickup.getByLabel('Donor handover code').fill(otp);
  await recipientPickup.getByRole('button', { name: 'Confirm receipt of food' }).click();
  await expect(
    recipientPickup.getByText('Awaiting donor final confirmation.', { exact: false }),
  ).toBeVisible();
  await donor.reload();
  await donorPickup.getByRole('button', { name: 'Finalize verified handover' }).click();
  await expect(donorPickup.getByRole('heading', { name: 'Verified handover' })).toBeVisible();
  await donor.goto('/app/impact');
  await expect(
    donor.locator('.metric').filter({ hasText: 'Confirmed meals' }).locator('strong'),
  ).toHaveText('25');
  await expect(donor.getByRole('heading', { name: 'Browser verified 25 meals' })).toBeVisible();
  const pickupRecord = await db.pickup.findFirstOrThrow({
    where: { lot: { donorOrganizationId: donorId } },
  });
  const downloadPromise = donor.waitForEvent('download');
  await donor.getByRole('link', { name: 'Export verified receipts' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('foodloop-handovers.csv');
  const fs = await import('node:fs/promises');
  const csv = await fs.readFile((await download.path())!, 'utf8');
  expect(csv).toContain('"25","MEAL"');
  await donor.goto('/app/disputes');
  await donor.getByLabel('Pickup reference', { exact: true }).fill(pickupRecord.id);
  await donor
    .getByLabel('Describe the issue')
    .fill('Synthetic review of recorded collection evidence');
  await donor.getByRole('button', { name: 'Open dispute' }).click();
  await expect(donor.getByRole('status')).toContainText('Saved successfully');
  await admin.goto('/admin/disputes');
  const dispute = admin.locator('article.record').filter({ hasText: pickupRecord.id });
  await dispute
    .getByLabel('Resolution')
    .fill('Reviewed training evidence with both parties; receipt remains unchanged');
  await dispute.getByRole('button', { name: 'Record resolution' }).click();
  await expect(dispute).toContainText('RESOLVED');
  await donor.goto('/app/notifications');
  await donor.getByRole('button', { name: 'Mark all read' }).click();
  await expect(donor.getByRole('heading', { name: 'Notifications · 0 unread' })).toBeVisible();
  await donor.goto('/app/dashboard');
  await donor.getByRole('button', { name: 'Generate brief' }).click();
  await expect(donor.locator('.brief')).toContainText('visible open lots');
  await donor.screenshot({ path: 'docs/screenshots/donor-dashboard.png', fullPage: true });
  await donor.setViewportSize({ width: 375, height: 812 });
  await donor.screenshot({ path: 'docs/screenshots/donor-mobile.png', fullPage: true });
  expect(
    await donor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await donor.setViewportSize({ width: 768, height: 1024 });
  expect(
    await donor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await Promise.all([
    donorContext.close(),
    recipientContext.close(),
    adminContext.close(),
    dispatchContext.close(),
  ]);
});
test('HTTP protection, masked tenants, CSRF and unverified organizations', async ({ browser }) => {
  const c = await browser.newContext();
  expect((await request(c, 'me', {}, 'GET')).status).toBe(401);
  const orgId = await account(c, 'RECIPIENT', 'Unverified');
  expect((await request(c, `admin/organizations/${orgId}/verify`)).status).toBe(403);
  expect((await request(c, 'lots/demo-lot-meals', {}, 'GET')).status).toBe(404);
  const csrf = await c.request.post(`${origin}/api/v1/auth/logout`, {
    headers: { Origin: 'https://evil.example' },
    data: {},
  });
  expect(csrf.status()).toBe(403);
  expect((await request(c, 'offers/unknown/accept')).status).toBe(403);
  await c.close();
});
test('HTTP negative paths: concurrency, expiry, capacity and OTP replay', async ({ browser }) => {
  const d = await browser.newContext(),
    r1 = await browser.newContext(),
    r2 = await browser.newContext(),
    dispatch = await browser.newContext();
  for (const [c, who] of [
    [d, 'donor'],
    [r1, 'recipient'],
    [r2, 'recipient2'],
    [dispatch, 'dispatcher'],
  ] as const)
    expect(
      (
        await request(c, 'auth/login', {
          email: `${who}@demo.foodloop.test`,
          password: 'DemoFoodLoop!2026',
        })
      ).status,
    ).toBe(200);
  const make = async () => {
    const l = await request(d, 'lots', lotBody('demo-campus-location'));
    expect(l.status).toBe(200);
    const id = l.body.data.id;
    expect((await request(d, `lots/${id}/publish`)).status).toBe(200);
    await request(d, `lots/${id}/offers`);
    return id;
  };
  const lotId = await make();
  const offers = await db.offer.findMany({
    where: { lotId, recipientOrganizationId: { in: ['demo-table', 'demo-pantry'] } },
  });
  const race = await Promise.all(
    offers.map((o) =>
      request(o.recipientOrganizationId === 'demo-table' ? r1 : r2, `offers/${o.id}/accept`),
    ),
  );
  expect(race.map((x) => x.status).sort()).toEqual([200, 409]);
  const expired = await make();
  await db.lot.update({ where: { id: expired }, data: { pickupEnd: new Date(Date.now() - 1000) } });
  const expOffer = await db.offer.findFirstOrThrow({
    where: { lotId: expired, recipientOrganizationId: 'demo-table' },
  });
  expect((await request(r1, `offers/${expOffer.id}/accept`)).status).toBe(409);
  const tooLarge = await request(d, 'lots', {
    ...lotBody('demo-campus-location', 'Over capacity'),
    quantityValue: 10000,
  });
  await request(d, `lots/${tooLarge.body.data.id}/publish`);
  const matches = await request(d, `lots/${tooLarge.body.data.id}/matches/evaluate`);
  expect(
    matches.body.data.find(
      (x: { recipientOrganizationId: string }) => x.recipientOrganizationId === 'demo-table',
    ).reasonCodes,
  ).toContain('INSUFFICIENT_CAPACITY_OR_UNIT');
  const proofLot = await make();
  const off = await db.offer.findFirstOrThrow({
    where: { lotId: proofLot, recipientOrganizationId: 'demo-table' },
  });
  const accepted = await request(r1, `offers/${off.id}/accept`);
  const pickupId = accepted.body.data.id;
  await request(d, `pickups/${pickupId}/schedule`, {
    scheduledAt: new Date(Date.now() + 60000).toISOString(),
  });
  await request(d, `pickups/${pickupId}/assign`, { dispatcherUserId: 'demo-dispatcher' });
  await request(dispatch, `pickups/${pickupId}/status`, { status: 'EN_ROUTE' });
  await request(dispatch, `pickups/${pickupId}/status`, { status: 'ARRIVED' });
  const proof = await request(d, `pickups/${pickupId}/handover/challenge`, { quantity: 25 });
  const otp = proof.body.data.code;
  expect(
    (
      await request(r1, `pickups/${pickupId}/handover/verify`, {
        code: otp === '111111' ? '222222' : '111111',
      })
    ).status,
  ).toBe(422);
  await db.handover.update({
    where: { pickupId },
    data: { codeExpiresAt: new Date(Date.now() - 1) },
  });
  expect((await request(r1, `pickups/${pickupId}/handover/verify`, { code: otp })).status).toBe(
    422,
  );
  const newProof = await request(d, `pickups/${pickupId}/handover/challenge`, { quantity: 25 });
  expect(
    (await request(r1, `pickups/${pickupId}/handover/verify`, { code: newProof.body.data.code }))
      .status,
  ).toBe(200);
  expect(
    (await request(r1, `pickups/${pickupId}/handover/verify`, { code: newProof.body.data.code }))
      .status,
  ).toBe(409);
  await Promise.all([d.close(), r1.close(), r2.close(), dispatch.close()]);
});
