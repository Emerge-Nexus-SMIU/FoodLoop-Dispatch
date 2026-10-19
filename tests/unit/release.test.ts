import { describe, it, expect } from 'vitest';
import { releaseIssues } from '../../src/server/release';
describe('commercial release gate', () => {
  it('blocks missing owner/provider/legal inputs instead of inventing readiness', () => {
    const issues = releaseIssues({});
    expect(issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        'SUPPORT_EMAIL',
        'BUSINESS_NAME',
        'MAIL_PROVIDER',
        'LEGAL_APPROVAL',
        'AUTH_ENCRYPTION_KEY',
      ]),
    );
  });
  it('rejects demo and insecure public settings', () => {
    const issues = releaseIssues({ APP_ORIGIN: 'http://localhost:3000', ALLOW_DEMO_SEED: 'true' });
    expect(issues.map((i) => i.code)).toContain('DEMO_CONFIG');
    expect(issues.map((i) => i.code)).toContain('APP_ORIGIN');
  });
  it('validates complete configuration without claiming manual launch gates passed', () =>
    expect(
      releaseIssues({
        APP_ORIGIN: 'https://foodloop.example.org',
        AUTH_ENCRYPTION_KEY: 'a'.repeat(64),
        MAIL_TRANSPORT: 'resend',
        RESEND_API_KEY: 'test-only-key',
        MAIL_FROM: 'mail@example.org',
        SUPPORT_EMAIL: 'support@example.org',
        BUSINESS_NAME: 'Fixture Entity',
        OPERATING_COUNTRY: 'PK',
        LEGAL_APPROVED: 'true',
        RETENTION_DAYS: '90',
        NODE_ENV: 'production',
      }),
    ).toEqual([]));
});
