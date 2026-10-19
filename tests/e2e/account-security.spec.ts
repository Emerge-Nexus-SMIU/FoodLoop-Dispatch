import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/server/db';
import { decrypt, totp } from '../../src/server/crypto';
import AxeBuilder from '@axe-core/playwright';
async function link(email: string, kind: string) {
  const rows = await db.mailOutbox.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const mail = rows
    .map((row) => JSON.parse(decrypt(row.payload)) as { to: string; subject: string; text: string })
    .find((m) => m.to === email && m.subject.toLowerCase().includes(kind));
  expect(mail).toBeDefined();
  return mail!.text.match(/https?:\/\/[^\s]+/)![0];
}
test('registration, verified email, encrypted authenticator enrollment, recovery login and password reset UI', async ({
  page,
}) => {
  const email = `security-ui-${randomUUID().slice(0, 8)}@example.invalid`,
    password = 'SecurityBrowser!2026';
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Security Browser');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Register your organization' })).toBeVisible();
  await page.goto(await link(email, 'verify'));
  await page.getByRole('button', { name: 'Verify email address' }).click();
  await expect(page.getByRole('status')).toContainText('verified');
  await page.goto('/app/account');
  await expect(page.getByText(email + ' · Email verified')).toBeVisible();
  await page.getByLabel('Confirm current password').fill(password);
  await page.getByRole('button', { name: 'Set up authenticator' }).click();
  const secret = await page.locator('code.secret').innerText();
  await page
    .getByLabel('Authenticator code', { exact: true })
    .fill(totp(secret, Math.floor(Date.now() / 30000)));
  await page.getByRole('button', { name: 'Enable authenticator', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Save your one-time recovery codes' }),
  ).toBeVisible();
  const recovery = (await page.locator('pre.secret').innerText()).split('\n');
  expect(recovery).toHaveLength(10);
  const protectedAxe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    protectedAxe.violations,
    JSON.stringify(
      protectedAxe.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ),
  ).toEqual([]);
  const sessionList = await db.session.findMany({ where: { user: { email } } });
  expect(sessionList).toHaveLength(1);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Authenticator or recovery code (if enabled)').fill(recovery[0]);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Register your organization' })).toBeVisible();
  await page.goto('/forgot-password');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Request reset link' }).click();
  await expect(page.getByRole('status')).toContainText('If the account');
  await page.goto(await link(email, 'reset'));
  await page.getByLabel('New password').fill('ResetBrowserSecure!2026');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('status')).toContainText('Password updated');
  expect(await db.session.count({ where: { user: { email } } })).toBe(0);
});
test('public and account pages satisfy automated WCAG A/AA checks and keyboard focus visibility', async ({
  page,
}) => {
  for (const path of ['/', '/login', '/register', '/forgot-password', '/privacy', '/terms']) {
    await page.goto(path);
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      result.violations,
      JSON.stringify(
        result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      ),
    ).toEqual([]);
  }
  await page.goto('/login');
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return false;
    const css = getComputedStyle(el);
    return css.outlineStyle !== 'none' && css.outlineWidth !== '0px';
  });
  expect(focus).toBe(true);
});

test('team invitation acceptance, editable settings and scoped member removal work in the browser', async ({
  browser,
}) => {
  const managerContext = await browser.newContext(),
    memberContext = await browser.newContext();
  const manager = await managerContext.newPage(),
    member = await memberContext.newPage();
  await manager.goto('/login');
  await manager.getByLabel('Email address').fill('donor@demo.foodloop.test');
  await manager.getByLabel('Password', { exact: true }).fill('DemoFoodLoop!2026');
  await manager.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(manager.getByRole('heading', { name: 'Operations overview' })).toBeVisible();
  const email = `team-ui-${randomUUID().slice(0, 8)}@example.invalid`;
  await member.goto('/register');
  await member.getByLabel('Full name').fill('Invited Browser Member');
  await member.getByLabel('Email address').fill(email);
  await member.getByLabel('Password', { exact: true }).fill('InvitedBrowser!2026');
  await member.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(member.getByRole('heading', { name: 'Register your organization' })).toBeVisible();
  await member.goto(await link(email, 'verify'));
  await member.getByRole('button', { name: 'Verify email address' }).click();
  await expect(member.getByRole('status')).toContainText('verified');
  await manager.goto('/app/team');
  await manager.getByLabel('Invitee email').fill(email);
  await manager.getByRole('combobox', { name: 'Member role' }).selectOption('DONOR_MANAGER');
  await manager.getByRole('button', { name: 'Invite member', exact: true }).click();
  await expect(manager.getByRole('status')).toContainText('Invitation queued');
  await member.goto(await link(email, 'invitation'));
  await member.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(member.getByRole('heading', { name: 'Operations overview' })).toBeVisible();
  await member.goto('/app/lots');
  await expect(member.getByRole('heading', { name: 'Surplus inventory' })).toBeVisible();
  await manager.goto('/app/settings');
  await manager.getByLabel('Operational contact').fill('updated-fixture@example.invalid');
  await manager.getByRole('button', { name: 'Save organization settings' }).click();
  await expect(manager.getByRole('status')).toHaveText('Saved successfully');
  expect((await db.organization.findUniqueOrThrow({ where: { id: 'demo-campus' } })).contact).toBe(
    'updated-fixture@example.invalid',
  );
  await manager.setViewportSize({ width: 375, height: 812 });
  await manager.getByRole('button', { name: 'Toggle navigation' }).click();
  await manager.getByRole('button', { name: 'Sign out', exact: true }).scrollIntoViewIfNeeded();
  await expect(manager.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await manager.setViewportSize({ width: 1440, height: 1000 });
  await manager.goto('/app/team');
  const row = manager.locator('.record').filter({ hasText: email });
  await row.getByRole('button', { name: 'Remove member' }).click();
  await expect(row).toHaveCount(0);
  await member.reload();
  await expect(member.getByRole('heading', { name: 'Sign in to your workspace' })).toBeVisible();
  await Promise.all([managerContext.close(), memberContext.close()]);
});
