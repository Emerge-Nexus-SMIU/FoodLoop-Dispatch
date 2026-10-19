'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  AccountPanel,
  TeamPanel,
  InboxPanel,
  DisputePanel,
  PolicyPanel,
  BatchDispatchPanel,
  OperationsStatusPanel,
  OrganizationPanel,
} from './operations-panels';
import { AccountActionPage } from './account-action';
import {
  ArrowUpRight,
  Box,
  CheckCircle2,
  ClipboardList,
  Leaf,
  LogOut,
  Menu,
  PackageCheck,
  Plus,
  ShieldCheck,
  Truck,
  Users,
  BarChart3,
  Search,
  Clock,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
type Org = {
  id: string;
  name: string;
  contact: string;
  type: string;
  verificationStatus: string;
  timezone: string;
  demo: boolean;
  locations?: { id: string; label: string; address: string }[];
  profile?: Profile | null;
};
type Profile = {
  capacityValue: string;
  capacityUnit: string;
  serviceRadiusKm: number;
  acceptedCategories: string[];
  specialHandlingCapabilities: string[];
  availableFrom: string;
  availableUntil: string;
  latitude?: number;
  longitude?: number;
};
type Me = {
  id: string;
  name: string;
  email: string;
  platformAdmin: boolean;
  emailVerified: boolean;
  mfaEnabled: boolean;
  memberships: { role: string; organization: Org; organizationId: string }[];
};
type Lot = {
  id: string;
  title: string;
  category: string;
  quantityValue: string;
  quantityUnit: string;
  status: string;
  pickupStart: string;
  pickupEnd: string;
  description: string;
  packaging: string;
  handlingDeclaration: string;
  storageRequirements: string;
  allergensNote: string;
  locationId: string;
  location: { address: string };
  donor: Org;
};
type Offer = { id: string; status: string; expiresAt: string; lot: Lot };
type Handover = {
  discrepancyReason?: string | null;
  status: string;
  receiverConfirmedAt: string | null;
  verifiedQuantityValue: string;
  verifiedQuantityUnit: string;
  verifiedAt: string;
  receiptReference: string;
  verifiedWeightKg: string | null;
};
type Pickup = {
  id: string;
  status: string;
  scheduledAt: string | null;
  dispatcherUserId: string | null;
  pickupStart: string;
  pickupEnd: string;
  lot: Lot;
  recipient: Org;
  handover: Handover | null;
  failureReason: string | null;
};
type Match = {
  id: string;
  recipientName: string;
  eligible: boolean;
  reasonCodes: string[];
  matchScore: number | null;
  scoreBreakdown: {
    capacityFit: number;
    windowFit: number;
    distanceFit: number | null;
    distanceBasis: string;
  };
  policyVersion: string;
};
type Metrics = {
  openLots: number;
  acceptedToday: number;
  verifiedHandovers: number;
  verifiedMeals: number;
  verifiedKgDiverted: number;
  expiredLots: number;
  failedPickups: number;
  medianListingToAcceptanceMinutes: number | null;
};
type Audit = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  actorId: string | null;
};
type Explanation = { summary: string; citations: { id: string; type: string; fact: string }[] };

const iso = (minutes: number) => new Date(Date.now() + minutes * 60000).toISOString();
const localInput = (value: string) => {
  const d = new Date(value);
  return new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const date = (value: string, tz = 'Asia/Karachi') =>
  new Intl.DateTimeFormat('en-PK', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: tz,
  }).format(new Date(value));
function Badge({ value }: { value: string }) {
  return (
    <span
      className={`badge ${['VERIFIED', 'HANDED_OVER', 'COMPLETED', 'ACCEPTED', 'OPEN'].includes(value) ? 'good' : ['EXPIRED', 'FAILED', 'SUSPENDED', 'CANCELED'].includes(value) ? 'bad' : 'neutral'}`}
    >
      {value.replaceAll('_', ' ')}
    </span>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <Box size={30} />
      <h3>{title}</h3>
      <p>
        {children ??
          'Records will appear here as your team moves food through the donation workflow.'}
      </p>
    </div>
  );
}
function Action({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => Promise<unknown>;
  danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={danger ? 'button danger' : 'button secondary'}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? 'Working…' : children}
    </button>
  );
}
export default function Console({ allowDemoAccounts = false }: { allowDemoAccounts?: boolean }) {
  const path = usePathname(),
    router = useRouter();
  const [me, setMe] = useState<Me | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [reload, setReload] = useState(0),
    [menu, setMenu] = useState(false);
  const [lots, setLots] = useState<Lot[]>([]),
    [offers, setOffers] = useState<Offer[]>([]),
    [pickups, setPickups] = useState<Pickup[]>([]),
    [orgs, setOrgs] = useState<Org[]>([]),
    [partners, setPartners] = useState<Org[]>([]),
    [metrics, setMetrics] = useState<Metrics | null>(null),
    [events, setEvents] = useState<Audit[]>([]),
    [explanation, setExplanation] = useState<Explanation | null>(null),
    [search, setSearch] = useState('');
  const pageOffset =
    Number(
      new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get(
        'offset',
      ) ?? 0,
    ) || 0;
  const [matchRows, setMatchRows] = useState<Match[]>([]),
    [code, setCode] = useState<{ id: string; code: string; expiresAt: string } | null>(null),
    [dispatchers, setDispatchers] = useState<{ id: string; name: string }[]>([]);
  const member = me?.memberships[0],
    role = member?.role,
    org = member?.organization,
    admin = me?.platformAdmin;
  const publicPage = [
    '/',
    '/login',
    '/register',
    '/privacy',
    '/terms',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/invite',
  ].includes(path);
  useEffect(() => {
    let alive = true;
    api<Me>('me')
      .then((v) => {
        if (alive) setMe(v);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reload]);
  useEffect(() => {
    if (!me || publicPage) return;
    let alive = true;
    const load = async () => {
      try {
        const [ls, ps, os, ms] = await Promise.all([
          api<Lot[]>(
            `lots?offset=${path.includes('/lots') || path.includes('/matches') ? pageOffset : 0}`,
          ),
          api<Pickup[]>(
            `pickups?offset=${path.includes('/pickups') || path.includes('/dispatch') || path.includes('/impact') || path.includes('/received') ? pageOffset : 0}`,
          ),
          api<Org[]>(`organizations/me?offset=${admin ? pageOffset : 0}`),
          api<Metrics>('impact/summary'),
        ]);
        if (!alive) return;
        const lotId = /^\/app\/(?:lots|matches)\/([^/]+)(?:\/edit)?$/.exec(path)?.[1];
        if (lotId && lotId !== 'new' && !ls.some((l) => l.id === lotId))
          ls.unshift(await api<Lot>(`lots/${lotId}`));
        setLots(ls);
        setPickups(ps);
        setOrgs(os);
        setMetrics(ms);
        if (role === 'RECIPIENT_MANAGER')
          setOffers(await api<Offer[]>(`offers?offset=${pageOffset}`));
        if (role === 'DONOR_MANAGER') {
          setDispatchers(await api('dispatchers'));
          if (path.includes('partners')) setPartners(await api('recipients'));
        }
        if (path.includes('audit') || admin)
          setEvents(await api(`audit-events?offset=${pageOffset}`));
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [me, publicPage, role, path, admin, reload, pageOffset]);
  const run = async (fn: () => Promise<unknown>, message = 'Saved successfully') => {
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(message);
      setReload((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const submit =
    (fn: (f: FormData) => Promise<unknown>, message?: string) =>
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      void run(() => fn(f), message);
    };
  if (['/forgot-password', '/reset-password', '/verify-email', '/invite'].includes(path))
    return <AccountActionPage path={path} />;
  if (publicPage) {
    if (path === '/privacy' || path === '/terms')
      return (
        <main className="legal" id="main-content">
          <Link href="/" className="brand">
            <Leaf /> FoodLoop Dispatch
          </Link>
          <h1>{path === '/privacy' ? 'Privacy notice' : 'Terms of use'}</h1>
          <Badge value="DRAFT" />
          <p>
            Pakistan pilot draft for Emerge Nexus owner and legal review; this is not legal advice.
            The registered entity details and support email are pending confirmation.
          </p>
          <p>
            FoodLoop stores account details, organization declarations, collection records, handover
            evidence and audit events to coordinate donations. Access is restricted by organization
            and operational role.
          </p>
          <p>
            Operators remain responsible for food suitability, allergens, storage, transport and
            local compliance. FoodLoop does not certify food safety. Retention periods, lawful
            basis, deletion requests, hosting region and incident contacts must be approved before a
            real pilot.
          </p>
          <Link href="/">Return home</Link>
        </main>
      );
    if (path === '/login' || path === '/register')
      return (
        <main className="auth" id="main-content">
          <div className="auth-story">
            <Link href="/" className="brand">
              <span className="brand-icon">
                <Leaf />
              </span>
              FoodLoop <b>Dispatch</b>
            </Link>
            <span className="eyebrow">GOOD FOOD. CLEAR ACCOUNTABILITY.</span>
            <h1>
              One collection.
              <br />A meaningful
              <br />
              <em>difference.</em>
            </h1>
            <p>
              Connect surplus to the organizations that can use it. Every acceptance, pickup and
              handover stays on the record.
            </p>
            <div className="auth-proof">
              <ShieldCheck /> Verified partners <span>·</span> Confirmed handovers
            </div>
          </div>
          <div className="auth-form">
            <div>
              <span className="eyebrow">YOUR OPERATIONS WORKSPACE</span>
              <h2>{path === '/register' ? 'Create your account' : 'Welcome back'}</h2>
              <p>
                {path === '/register'
                  ? 'Start with your account, then register your organization.'
                  : 'Sign in to coordinate your next collection.'}
              </p>
              {error && (
                <div role="alert" className="alert error">
                  {error}
                </div>
              )}
              <form
                onSubmit={submit(async (f) => {
                  await api(
                    `auth/${path === '/register' ? 'register' : 'login'}`,
                    'POST',
                    Object.fromEntries(f),
                  );
                  setReload((x) => x + 1);
                  const next = new URLSearchParams(window.location.search).get('next');
                  router.push(
                    next?.startsWith('/invite?token=') && next.length < 500
                      ? next
                      : '/app/dashboard',
                  );
                })}
              >
                {path === '/register' && (
                  <Field label="Full name">
                    <input name="name" required minLength={2} autoComplete="name" />
                  </Field>
                )}
                <Field label="Email address">
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@organization.org"
                  />
                </Field>
                <Field label="Password">
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={path === '/register' ? 12 : 1}
                    autoComplete={path === '/register' ? 'new-password' : 'current-password'}
                  />
                </Field>
                {path === '/login' && (
                  <Field label="Authenticator or recovery code (if enabled)">
                    <input name="mfaCode" autoComplete="one-time-code" maxLength={64} />
                  </Field>
                )}
                <button className="button primary" type="submit">
                  {path === '/register' ? 'Create account' : 'Sign in'} <ArrowUpRight size={18} />
                </button>
              </form>
              <p>
                {path === '/register' ? 'Already registered?' : 'New to FoodLoop?'}{' '}
                <Link href={path === '/register' ? '/login' : '/register'}>
                  {path === '/register' ? 'Sign in' : 'Create an account'}
                </Link>
              </p>
              <Link href="/forgot-password">Forgot your password?</Link>
              {allowDemoAccounts && (
                <details>
                  <summary>Local demo accounts</summary>
                  <p>
                    Fictional fixtures only. Password: <code>DemoFoodLoop!2026</code>
                  </p>
                  <p>
                    admin@demo.foodloop.test
                    <br />
                    donor@demo.foodloop.test
                    <br />
                    recipient@demo.foodloop.test
                    <br />
                    recipient2@demo.foodloop.test
                    <br />
                    dispatcher@demo.foodloop.test
                  </p>
                </details>
              )}
            </div>
          </div>
        </main>
      );
    return (
      <main className="landing" id="main-content">
        <nav>
          <Link href="/" className="brand">
            <span className="brand-icon">
              <Leaf />
            </span>
            FoodLoop <b>Dispatch</b>
          </Link>
          <div>
            <Link href="/login">Sign in</Link>
            <Link className="button primary" href="/register">
              Join the network <ArrowUpRight size={18} />
            </Link>
          </div>
        </nav>
        <section className="hero">
          <span className="eyebrow">SURPLUS FOOD. PURPOSEFUL MOVEMENT.</span>
          <h1>
            Good food deserves
            <br />a <em>next destination.</em>
          </h1>
          <p>
            A shared operations workspace for donors, recipient organizations and collection teams.
            From available surplus to a verified handover, keep every step accountable.
          </p>
          <div className="inline">
            <Link href="/login" className="button primary">
              Open workspace <ArrowUpRight size={18} />
            </Link>
            <Link href="/register" className="button secondary">
              Register organization
            </Link>
          </div>
          <div className="hero-steps">
            {[
              [Box, 'List surplus', 'Declare quantities, handling and collection windows.'],
              [
                Users,
                'Find the right partner',
                'Match declared capacity, availability and location.',
              ],
              [
                PackageCheck,
                'Confirm the handover',
                'Two-party proof records the actual quantity received.',
              ],
            ].map(([Icon, title, text]) => {
              const I = Icon as typeof Box;
              return (
                <article key={String(title)}>
                  <I />
                  <h3>{String(title)}</h3>
                  <p>{String(text)}</p>
                </article>
              );
            })}
          </div>
        </section>
        <footer>
          <span>FoodLoop Dispatch · Responsible coordination, from listing to receipt.</span>
          <span>
            <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link>
          </span>
        </footer>
      </main>
    );
  }
  if (loading)
    return (
      <div className="empty" role="status">
        Opening your workspace…
      </div>
    );
  if (!me)
    return (
      <main className="empty" id="main-content">
        <ShieldCheck />
        <h1>Sign in to your workspace</h1>
        <Link className="button primary" href="/login">
          Sign in
        </Link>
      </main>
    );
  const nav = admin
    ? [
        ['/admin', 'Overview', BarChart3],
        ['/admin/organizations', 'Organizations', Users],
        ['/admin/audit', 'Audit ledger', ShieldCheck],
        ['/admin/disputes', 'Disputes', ClipboardList],
        ['/admin/policy', 'Matching policy', Users],
      ]
    : role === 'DONOR_MANAGER'
      ? [
          ['/app/dashboard', 'Overview', BarChart3],
          ['/app/lots', 'Surplus lots', Box],
          ['/app/matches', 'Matches', Users],
          ['/app/pickups', 'Pickups', Truck],
          ['/app/impact', 'Impact', Leaf],
          ['/app/partners', 'Partners', Users],
          ['/app/settings', 'Organization', ShieldCheck],
          ['/app/team', 'Team', Users],
        ]
      : role === 'RECIPIENT_MANAGER'
        ? [
            ['/app/dashboard', 'Overview', BarChart3],
            ['/app/opportunities', 'Opportunities', Box],
            ['/app/offers', 'Offers', ClipboardList],
            ['/app/pickups', 'Pickups', Truck],
            ['/app/received', 'Received', PackageCheck],
            ['/app/profile', 'Receiving profile', Users],
            ['/app/settings', 'Organization', ShieldCheck],
            ['/app/team', 'Team', Users],
          ]
        : [
            ['/app/dashboard', 'Overview', BarChart3],
            ['/app/dispatch', 'Dispatch queue', Truck],
          ];
  nav.push(
    ['/app/account', 'Account security', ShieldCheck],
    ['/app/notifications', 'Inbox', ClipboardList],
  );
  if (!admin) nav.push(['/app/disputes', 'Disputes', ShieldCheck]);
  const selectedLot = lots.find(
    (l) => l.id === (path.endsWith('/edit') ? path.split('/').at(-2) : path.split('/').at(-1)),
  );
  const isLots = path.includes('/lots') || path.includes('/matches');
  const title = path.includes('account')
    ? 'Account security'
    : path.includes('notifications')
      ? 'Notification inbox'
      : path.includes('team')
        ? 'Organization team'
        : path.includes('disputes')
          ? 'Pickup disputes'
          : path.includes('/policy')
            ? 'Matching policy'
            : path.includes('/new')
              ? 'Create a surplus lot'
              : path.includes('matches')
                ? 'Explainable matches'
                : path.includes('organizations')
                  ? 'Partner organizations'
                  : path.includes('audit')
                    ? 'Audit ledger'
                    : path.includes('profile')
                      ? 'Receiving profile'
                      : path.includes('settings')
                        ? 'Organization'
                        : path.includes('opportunities')
                          ? 'Available opportunities'
                          : path.includes('offers')
                            ? 'Your offers'
                            : path.includes('impact') || path.includes('received')
                              ? 'Verified impact'
                              : path.includes('dispatch') || path.includes('pickups')
                                ? 'Pickup operations'
                                : path.includes('/lots')
                                  ? 'Surplus lots'
                                  : 'Operations overview';
  const locations = orgs.find((o) => o.id === org?.id)?.locations ?? [];
  return (
    <div className="workspace">
      <aside className={`sidebar ${menu ? 'expanded' : ''}`}>
        <Link href="/app/dashboard" className="brand">
          <span className="brand-icon">
            <Leaf size={22} />
          </span>
          <span>
            FoodLoop<small>DISPATCH</small>
          </span>
        </Link>
        <div className="workspace-label">WORKSPACE</div>
        <div className="org-name">
          {org?.name ?? 'Platform administration'}
          <small>{admin ? 'PLATFORM ADMIN' : (role?.replaceAll('_', ' ') ?? 'ONBOARDING')}</small>
        </div>
        <nav>
          {nav.map(([href, label, Icon]) => {
            const I = Icon as typeof Box;
            return (
              <Link
                key={String(href)}
                onClick={() => setMenu(false)}
                href={String(href)}
                className={path === href ? 'active' : ''}
              >
                <I size={19} />
                {String(label)}
                {path === href && <ChevronRight size={14} />}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={20} />
          <p>
            Every handover matters.<small>Only verified receipts count.</small>
          </p>
        </div>
        <div className="account">
          <span className="avatar">{me.name[0]}</span>
          <div>
            {me.name}
            <small>{role?.replaceAll('_', ' ') ?? 'Administrator'}</small>
          </div>
          <button
            aria-label="Sign out"
            onClick={() =>
              void run(async () => {
                await api('auth/logout', 'POST');
                setMe(null);
                router.push('/login');
              })
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Toggle navigation"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
          <span>
            Workspace <ChevronRight size={14} /> <b>{title}</b>
          </span>
          <div>
            <span className="status-dot" /> {org?.demo ? 'DEMO WORKSPACE' : 'OPERATIONS'}
            <span className="avatar small">{me.name[0]}</span>
          </div>
        </header>
        <main className="content" id="main-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {new Intl.DateTimeFormat('en', {
                  dateStyle: 'full',
                  timeZone: org?.timezone ?? 'Asia/Karachi',
                }).format(new Date())}
              </span>
              <h1>{title}</h1>
              <p>Move surplus with clarity. Keep every collection accountable.</p>
            </div>
            {role === 'DONOR_MANAGER' && (
              <Link href="/app/lots/new" className="button primary">
                <Plus size={18} /> New surplus lot
              </Link>
            )}
          </div>
          {!me.emailVerified && (
            <div className="alert">
              Verify your email before using organization operations.{' '}
              <Link href="/app/account">Open account security</Link>
            </div>
          )}
          {org?.demo && (
            <div className="demo-banner">
              <span>FICTIONAL DEMO</span> Training records and synthetic accounts. No real donations
              are represented.
            </div>
          )}
          {org && org.verificationStatus !== 'VERIFIED' && (
            <div className="alert">
              Organization status: <Badge value={org.verificationStatus} /> Approval is required
              before publishing or accepting.
            </div>
          )}
          {error && (
            <div role="alert" className="alert error">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert success">
              {notice}
            </div>
          )}
          {path.includes('/account') ? (
            <AccountPanel
              email={me.email}
              emailVerified={me.emailVerified}
              mfaEnabled={me.mfaEnabled}
            />
          ) : path.includes('/team') ? (
            <TeamPanel managerRole={role} />
          ) : path.includes('/notifications') ? (
            <InboxPanel />
          ) : path.includes('/disputes') ? (
            <DisputePanel admin={!!admin} />
          ) : path.includes('/policy') ? (
            <PolicyPanel />
          ) : !member && !admin ? (
            <section className="panel">
              <h2>Register your organization</h2>
              <OrganizationForm
                onSubmit={submit(async (f) =>
                  api('organizations', 'POST', {
                    ...Object.fromEntries(f),
                    latitude: f.get('latitude') ? Number(f.get('latitude')) : undefined,
                    longitude: f.get('longitude') ? Number(f.get('longitude')) : undefined,
                  }),
                )}
              />
            </section>
          ) : path.includes('/new') || path.includes('/edit') ? (
            <section className="panel">
              {locations.length > 0 ? (
                <LotForm
                  key={path}
                  lot={selectedLot}
                  locations={locations}
                  onSave={async (v) => {
                    const l = await api<Lot>(
                      selectedLot ? `lots/${selectedLot.id}` : 'lots',
                      selectedLot ? 'PATCH' : 'POST',
                      v,
                    );
                    router.push(`/app/lots/${l.id}`);
                    setReload((x) => x + 1);
                  }}
                  onError={setError}
                />
              ) : (
                <p role="status">Loading collection points…</p>
              )}
            </section>
          ) : path.includes('organizations') ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Verification queue</h2>
                <span>{orgs.length} organizations</span>
              </div>
              <p>
                Review partner identity and handling responsibilities before approval. Verification
                is an administrative decision, not a food-safety certification.
              </p>
              {orgs.map((o) => (
                <div key={o.id} className="record">
                  <div>
                    <h3>{o.name}</h3>
                    <p>
                      {o.type} · {o.timezone}
                    </p>
                    <Badge value={o.verificationStatus} />
                  </div>
                  <div className="inline">
                    <Action
                      onClick={() => run(() => api(`admin/organizations/${o.id}/verify`, 'POST'))}
                    >
                      Verify organization
                    </Action>
                    <Action
                      danger
                      onClick={() => run(() => api(`admin/organizations/${o.id}/suspend`, 'POST'))}
                    >
                      Suspend
                    </Action>
                  </div>
                </div>
              ))}
            </section>
          ) : path.includes('audit') ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Append-only event ledger</h2>
                <a href="/api/v1/exports/audit" className="button secondary" download>
                  Export audit events
                </a>
              </div>
              <p>
                Showing the latest 50 authorized events. Event times use{' '}
                {org?.timezone ?? 'Asia/Karachi'}.
              </p>
              {events.map((e) => (
                <div className="audit-row" key={e.id}>
                  <ShieldCheck size={17} />
                  <div>
                    <b>{e.action.replaceAll('_', ' ')}</b>
                    <small>
                      {e.entityType} · {e.entityId} · actor {e.actorId ?? 'system'}
                    </small>
                  </div>
                  <time>{date(e.createdAt, org?.timezone)}</time>
                </div>
              ))}
            </section>
          ) : path.includes('profile') ? (
            <section className="panel">
              <h2>Declared receiving capabilities</h2>
              <p>
                Matching uses these declarations. Capacity units must match the offered lot;
                availability is an explicit UTC-backed interval.
              </p>
              <ProfileForm
                profile={orgs.find((o) => o.id === org?.id)?.profile}
                onSave={(v) => run(() => api('recipient-profile', 'PATCH', v))}
              />
            </section>
          ) : path.includes('partners') ? (
            <section className="panel">
              <h2>Recipient directory</h2>
              <p>Declared capabilities for matching. Contact details remain private.</p>
              {partners.map((p) => (
                <div className="record" key={p.id}>
                  <div>
                    <h3>{p.name}</h3>
                    <p>
                      {p.profile
                        ? `${p.profile.capacityValue} ${p.profile.capacityUnit} per lot · ${p.profile.serviceRadiusKm} km radius · ${p.profile.acceptedCategories.join(', ')}`
                        : 'Receiving profile incomplete'}
                    </p>
                  </div>
                  <Badge value={p.verificationStatus} />
                </div>
              ))}
            </section>
          ) : path.includes('settings') ? (
            <>
              {orgs.find((o) => o.id === org?.id)?.locations?.length ? (
                <OrganizationPanel organization={orgs.find((o) => o.id === org?.id)!} />
              ) : (
                <section className="panel" role="status">
                  Loading organization settings…
                </section>
              )}
            </>
          ) : path.includes('impact') || path.includes('received') ? (
            <>
              <MetricCards metrics={metrics} />
              <div className="metric-grid">
                {[
                  [
                    'Verified weight (kg)',
                    metrics?.verifiedKgDiverted,
                    'Explicitly measured; no conversions',
                  ],
                  ['Expired lots', metrics?.expiredLots, 'Excluded from donated totals'],
                  ['Failed pickups', metrics?.failedPickups, 'Excluded from donated totals'],
                  [
                    'Median acceptance (min)',
                    metrics?.medianListingToAcceptanceMinutes?.toFixed(1),
                    'Listing to successful acceptance',
                  ],
                ].map(([label, value, note]) => (
                  <article className="metric" key={String(label)}>
                    <div>{label}</div>
                    <strong>{value ?? '—'}</strong>
                    <small>{note}</small>
                  </article>
                ))}
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Verified handover receipts</h2>
                  <a href="/api/v1/exports/impact" className="button secondary" download>
                    Export verified receipts
                  </a>
                </div>
                <p>
                  All-time ledger. MEAL, KG and ITEM quantities stay separate. Weight is included
                  only when explicitly verified.
                </p>
                {pickups
                  .filter((p) => p.handover?.status === 'VERIFIED')
                  .map((p) => (
                    <div className="record" key={p.id}>
                      <div>
                        <h3>{p.lot.title}</h3>
                        <p>
                          {p.handover!.verifiedQuantityValue} {p.handover!.verifiedQuantityUnit} ·{' '}
                          {date(p.handover!.verifiedAt, org?.timezone)}
                        </p>
                        <small>Receipt {p.handover!.receiptReference}</small>
                      </div>
                      <Badge value="VERIFIED" />
                    </div>
                  ))}
                {!pickups.some((p) => p.handover?.status === 'VERIFIED') && (
                  <Empty title="No verified handovers yet">
                    Impact will appear after receiver proof and donor final confirmation.
                  </Empty>
                )}
              </section>
            </>
          ) : path.includes('pickups') || path.includes('dispatch') ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Collection queue</h2>
                <span>{pickups.length} records</span>
              </div>
              {role === 'DONOR_MANAGER' && (
                <BatchDispatchPanel
                  pickups={pickups}
                  dispatchers={dispatchers}
                  onDone={() => setReload((v) => v + 1)}
                />
              )}
              {!pickups.length && <Empty title="Your collection queue is clear" />}
              {pickups.map((p) => (
                <PickupCard
                  key={p.id}
                  p={p}
                  role={role}
                  me={me}
                  dispatchers={dispatchers}
                  code={code?.id === p.id ? code : null}
                  onAction={(suffix, v) => run(() => api(`pickups/${p.id}/${suffix}`, 'POST', v))}
                  onChallenge={(v) =>
                    run(
                      async () =>
                        setCode({
                          id: p.id,
                          ...(await api<{ code: string; expiresAt: string }>(
                            `pickups/${p.id}/handover/challenge`,
                            'POST',
                            v,
                          )),
                        }),
                      'Challenge issued. Share it directly with the collecting party.',
                    )
                  }
                />
              ))}
            </section>
          ) : path.includes('offers') || path.includes('opportunities') ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Offers for your organization</h2>
                <span>{offers.length} offers</span>
              </div>
              {offers.length === 0 && (
                <Empty title="No offers yet">
                  Complete your receiving profile and wait for a verified donor to send an eligible
                  offer.
                </Empty>
              )}
              {offers.map((o) => (
                <article className="offer-card" key={o.id}>
                  <div className="record">
                    <div>
                      <span className="eyebrow">{o.lot.donor.name}</span>
                      <h3>{o.lot.title}</h3>
                      <p>
                        {o.lot.quantityValue} {o.lot.quantityUnit} · {o.lot.category}
                      </p>
                    </div>
                    <Badge value={o.status} />
                  </div>
                  <p>{o.lot.location.address}</p>
                  <p>
                    <Clock size={14} /> Offer expires {date(o.expiresAt, org?.timezone)}
                  </p>
                  <p className="safety">
                    {o.lot.handlingDeclaration} · Storage: {o.lot.storageRequirements}. Assess
                    suitability before acceptance.
                  </p>
                  {o.status === 'PENDING' && (
                    <div className="inline">
                      <Action
                        onClick={() =>
                          run(
                            () => api(`offers/${o.id}/accept`, 'POST'),
                            'Reservation accepted. View Pickups for collection details.',
                          )
                        }
                      >
                        Accept exclusive reservation
                      </Action>
                      <Action onClick={() => run(() => api(`offers/${o.id}/decline`, 'POST'))}>
                        Decline
                      </Action>
                    </div>
                  )}
                </article>
              ))}
            </section>
          ) : isLots ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>{selectedLot ? selectedLot.title : 'Surplus inventory'}</h2>
                <label className="search">
                  <Search size={16} />
                  <input
                    aria-label="Search lots"
                    placeholder="Search lots…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              {(selectedLot ? [selectedLot] : lots)
                .filter((l) => l.title.toLowerCase().includes(search.toLowerCase()))
                .map((l) => (
                  <article className="lot-card" key={l.id}>
                    <div className="record">
                      <div>
                        <span className="eyebrow">
                          {l.category} · {l.quantityUnit}
                        </span>
                        <h3>
                          <Link href={`/app/lots/${l.id}`}>{l.title}</Link>
                        </h3>
                        <p>
                          {l.quantityValue} {l.quantityUnit} · {l.location.address}
                        </p>
                      </div>
                      <Badge value={l.status} />
                    </div>
                    <p>
                      Collection {date(l.pickupStart, org?.timezone)} —{' '}
                      {date(l.pickupEnd, org?.timezone)}
                    </p>
                    <p>{l.handlingDeclaration}</p>
                    <p className="muted">
                      {l.packaging} · {l.storageRequirements} · Allergens:{' '}
                      {l.allergensNote || 'Not declared; ask donor'}
                    </p>
                    <div className="inline">
                      {l.status === 'DRAFT' && (
                        <>
                          <Link className="button secondary" href={`/app/lots/${l.id}/edit`}>
                            Edit draft
                          </Link>
                          <Action onClick={() => run(() => api(`lots/${l.id}/publish`, 'POST'))}>
                            Publish lot
                          </Action>
                        </>
                      )}
                      {['DRAFT', 'OPEN'].includes(l.status) && (
                        <Action
                          onClick={() =>
                            run(async () => {
                              setMatchRows(
                                await api<Match[]>(`lots/${l.id}/matches/evaluate`, 'POST'),
                              );
                            }, 'Eligibility evaluated using current declarations.')
                          }
                        >
                          Evaluate matches
                        </Action>
                      )}
                      {l.status === 'OPEN' && (
                        <Action
                          onClick={() =>
                            run(async () => {
                              const result = await api<{ count: number }>(
                                `lots/${l.id}/offers`,
                                'POST',
                              );
                              if (!result.count)
                                throw new Error(
                                  'No eligible recipients. Review matching exclusions and recipient profiles.',
                                );
                            }, 'Offers sent to eligible recipients.')
                          }
                        >
                          Send eligible offers
                        </Action>
                      )}
                      {['DRAFT', 'OPEN', 'RESERVED'].includes(l.status) && (
                        <Action
                          danger
                          onClick={() => run(() => api(`lots/${l.id}/cancel`, 'POST'))}
                        >
                          Cancel lot
                        </Action>
                      )}
                    </div>
                  </article>
                ))}
              {lots.length === 0 && <Empty title="No surplus listed yet" />}
              {matchRows.length > 0 && (
                <section className="matches">
                  <h2>Latest evaluation</h2>
                  <p>
                    Versioned policy weights are recorded with each evaluation. Unknown distance is
                    omitted and remaining weights normalized.
                  </p>
                  {matchRows.map((m) => (
                    <div className="record" key={m.id}>
                      <div>
                        <h3>{m.recipientName}</h3>
                        <p>
                          {m.eligible
                            ? 'Declared requirements met'
                            : m.reasonCodes.join(' · ').replaceAll('_', ' ')}
                        </p>
                        <small>
                          {m.scoreBreakdown.distanceBasis} · evaluation {m.id}
                        </small>
                      </div>
                      <Badge value={m.eligible ? `${m.matchScore}/100` : 'INELIGIBLE'} />
                    </div>
                  ))}
                </section>
              )}
            </section>
          ) : (
            <>
              <MetricCards metrics={metrics} />
              {admin && <OperationsStatusPanel />}
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>{admin ? 'Network verification' : 'Your work queue'}</h2>
                    <Link
                      href={
                        admin
                          ? '/admin/organizations'
                          : role === 'DONOR_MANAGER'
                            ? '/app/lots'
                            : role === 'RECIPIENT_MANAGER'
                              ? '/app/offers'
                              : '/app/dispatch'
                      }
                    >
                      View all <ArrowUpRight size={14} />
                    </Link>
                  </div>
                  {admin
                    ? orgs
                        .filter((o) => o.verificationStatus === 'PENDING')
                        .map((o) => (
                          <div className="record" key={o.id}>
                            <div>
                              <h3>{o.name}</h3>
                              <p>{o.type}</p>
                            </div>
                            <Badge value="PENDING" />
                          </div>
                        ))
                    : role === 'DONOR_MANAGER'
                      ? lots
                          .filter((l) => ['OPEN', 'RESERVED', 'DRAFT'].includes(l.status))
                          .slice(0, 5)
                          .map((l) => (
                            <Link className="queue-row" key={l.id} href={`/app/lots/${l.id}`}>
                              <span className="item-icon">
                                <Box size={21} />
                              </span>
                              <div>
                                <h3>{l.title}</h3>
                                <p>
                                  {l.quantityValue} {l.quantityUnit} · Ends{' '}
                                  {date(l.pickupEnd, org?.timezone)}
                                </p>
                              </div>
                              <Badge value={l.status} />
                              <ChevronRight size={16} />
                            </Link>
                          ))
                      : pickups
                          .filter((p) => !['COMPLETED', 'FAILED', 'CANCELED'].includes(p.status))
                          .map((p) => (
                            <Link className="queue-row" key={p.id} href="/app/pickups">
                              <Truck />
                              <div>
                                <h3>{p.lot.title}</h3>
                                <p>{p.recipient.name}</p>
                              </div>
                              <Badge value={p.status} />
                            </Link>
                          ))}
                  {(admin
                    ? orgs.filter((o) => o.verificationStatus === 'PENDING').length === 0
                    : role === 'DONOR_MANAGER'
                      ? lots.filter((l) => ['OPEN', 'RESERVED', 'DRAFT'].includes(l.status))
                          .length === 0
                      : pickups.length === 0) && <Empty title="Ready for your next collection" />}
                  <div className="panel-foot">
                    <Clock size={15} /> Pickup windows are enforced using server time.
                  </div>
                </section>
                <aside className="panel assistant">
                  <span className="assistant-icon">
                    <Sparkles size={21} />
                  </span>
                  <h2>Operations brief</h2>
                  <p>Read-only summaries grounded in records you can access. No AI key required.</p>
                  <Action
                    onClick={() =>
                      run(
                        async () => setExplanation(await api('assistant/explain', 'POST')),
                        'Brief refreshed.',
                      )
                    }
                  >
                    Generate brief <ArrowUpRight size={15} />
                  </Action>
                  {explanation && (
                    <div className="brief">
                      <p>{explanation.summary}</p>
                      {explanation.citations.map((c) => (
                        <div key={c.id}>
                          <b>
                            {c.type} · {c.id.slice(-8)}
                          </b>
                          <p>{c.fact}</p>
                          <small>{c.id}</small>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="safety">
                    <ShieldCheck size={17} />
                    <p>
                      Human judgment stays central. FoodLoop cannot certify food safety or take
                      actions on your behalf.
                    </p>
                  </div>
                </aside>
              </div>
              <section className="workflow-strip">
                <CheckCircle2 />
                <div>
                  <h3>Accountability at every step</h3>
                  <p>
                    Listed → matched → reserved → collected → verified. Only the final handover
                    contributes to impact.
                  </p>
                </div>
              </section>
            </>
          )}
          {[
            '/app/lots',
            '/app/matches',
            '/app/pickups',
            '/app/dispatch',
            '/app/offers',
            '/app/opportunities',
            '/app/impact',
            '/app/received',
            '/admin/organizations',
            '/admin/audit',
          ].includes(path) && (
            <div className="inline">
              <a
                className="button secondary"
                aria-disabled={pageOffset === 0}
                href={`${path}?offset=${Math.max(0, pageOffset - 50)}`}
              >
                Previous page
              </a>
              <span>Page {Math.floor(pageOffset / 50) + 1} · up to 50 records</span>
              <a className="button secondary" href={`${path}?offset=${pageOffset + 50}`}>
                Next page
              </a>
            </div>
          )}
          <footer className="app-footer">
            <span>FoodLoop Dispatch · A product of Emerge Nexus · Pakistan.</span>
            <span>
              Times: {org?.timezone ?? 'Asia/Karachi'} · <Link href="/privacy">Privacy</Link>
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function MetricCards({ metrics: m }: { metrics: Metrics | null }) {
  return (
    <div className="metric-grid">
      {[
        ['Open lots', m?.openLots, Box, 'Available for reservation'],
        ['Accepted today', m?.acceptedToday, ClipboardList, 'UTC calendar day'],
        ['Verified handovers', m?.verifiedHandovers, PackageCheck, 'Both parties confirmed'],
        ['Confirmed meals', m?.verifiedMeals, Leaf, 'MEAL units only'],
      ].map(([label, value, Icon, note]) => {
        const I = Icon as typeof Box;
        return (
          <article className="metric" key={String(label)}>
            <div>
              <span>{String(label)}</span>
              <I size={18} />
            </div>
            <strong>{value === undefined ? '—' : String(value)}</strong>
            <small>{String(note)}</small>
          </article>
        );
      })}
    </div>
  );
}
function OrganizationForm({ onSubmit }: { onSubmit: (e: FormEvent<HTMLFormElement>) => void }) {
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <Field label="Organization name">
        <input name="name" required minLength={3} />
      </Field>
      <Field label="Organization type">
        <select name="type">
          <option value="DONOR">Donor</option>
          <option value="RECIPIENT">Recipient</option>
          <option value="LOGISTICS">Logistics / dispatcher</option>
        </select>
      </Field>
      <Field label="Contact email or phone">
        <input name="contact" required minLength={3} />
      </Field>
      <Field label="Timezone">
        <input name="timezone" defaultValue="Asia/Karachi" required />
      </Field>
      <Field label="Collection address">
        <input name="address" required minLength={5} />
      </Field>
      <Field label="Latitude (optional)">
        <input name="latitude" type="number" step="any" min={-90} max={90} />
      </Field>
      <Field label="Longitude (optional)">
        <input name="longitude" type="number" step="any" min={-180} max={180} />
      </Field>
      <button className="button primary" type="submit">
        Submit for verification
      </button>
    </form>
  );
}
function LotForm({
  lot,
  locations,
  onSave,
  onError,
}: {
  lot?: Lot;
  locations: { id: string; label: string }[];
  onSave: (v: unknown) => Promise<void>;
  onError: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h2>{lot ? 'Edit draft' : 'Describe available surplus'}</h2>
      <p>
        Record what is available and how it must be handled. Publication does not certify food
        safety.
      </p>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await onSave({
              ...Object.fromEntries(f),
              quantityValue: Number(f.get('quantityValue')),
              declaredWeightKg: f.get('declaredWeightKg')
                ? Number(f.get('declaredWeightKg'))
                : undefined,
              pickupStart: new Date(String(f.get('pickupStart'))).toISOString(),
              pickupEnd: new Date(String(f.get('pickupEnd'))).toISOString(),
            });
          } catch (e) {
            onError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Lot title">
          <input
            name="title"
            required
            minLength={3}
            maxLength={120}
            defaultValue={lot?.title}
            placeholder="25 packed campus meals"
          />
        </Field>
        <Field label="Category">
          <select name="category" defaultValue={lot?.category ?? 'PREPARED'}>
            {['PREPARED', 'BAKERY', 'PRODUCE', 'DAIRY', 'PANTRY'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="Quantity">
          <input
            name="quantityValue"
            required
            type="number"
            min="0.001"
            step="0.001"
            defaultValue={lot?.quantityValue ?? 25}
          />
        </Field>
        <Field label="Unit">
          <select name="quantityUnit" defaultValue={lot?.quantityUnit ?? 'MEAL'}>
            {['MEAL', 'KG', 'ITEM'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="Declared weight kg (optional)">
          <input name="declaredWeightKg" type="number" min="0.001" step="0.001" />
        </Field>
        <Field label="Collection point">
          <select name="locationId" required defaultValue={lot?.locationId}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Pickup starts (your browser time)">
          <input
            name="pickupStart"
            type="datetime-local"
            required
            defaultValue={localInput(lot?.pickupStart ?? iso(0))}
          />
        </Field>
        <Field label="Pickup ends (your browser time)">
          <input
            name="pickupEnd"
            type="datetime-local"
            required
            defaultValue={localInput(lot?.pickupEnd ?? iso(90))}
          />
        </Field>
        <Field label="Packaging">
          <input
            name="packaging"
            required
            minLength={3}
            defaultValue={lot?.packaging ?? 'Individually sealed containers'}
          />
        </Field>
        <Field label="Storage requirement">
          <select name="storageRequirements" defaultValue={lot?.storageRequirements ?? 'AMBIENT'}>
            {['AMBIENT', 'CHILLED', 'FROZEN'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="Allergens / labeling notes">
          <input name="allergensNote" maxLength={500} defaultValue={lot?.allergensNote} />
        </Field>
        <Field label="Description">
          <textarea name="description" maxLength={2000} defaultValue={lot?.description} />
        </Field>
        <Field label="Handling declaration (required)">
          <textarea
            name="handlingDeclaration"
            required
            minLength={12}
            maxLength={2000}
            defaultValue={lot?.handlingDeclaration}
            placeholder="Describe preparation, storage, packaging and collection precautions."
          />
        </Field>
        <div className="form-end">
          <p className="safety">
            Your team must assess suitability, allergens and local handling requirements.
          </p>
          <button className="button primary" disabled={busy} type="submit">
            {busy ? 'Saving…' : 'Save draft'}
          </button>
        </div>
      </form>
    </>
  );
}
function ProfileForm({
  profile: p,
  onSave,
}: {
  profile?: Profile | null;
  onSave: (v: unknown) => Promise<unknown>;
}) {
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void onSave({
          ...Object.fromEntries(f),
          capacityValue: Number(f.get('capacityValue')),
          serviceRadiusKm: Number(f.get('serviceRadiusKm')),
          acceptedCategories: f.getAll('acceptedCategories'),
          specialHandlingCapabilities: f.getAll('specialHandlingCapabilities'),
          latitude: f.get('latitude') ? Number(f.get('latitude')) : undefined,
          longitude: f.get('longitude') ? Number(f.get('longitude')) : undefined,
          availableFrom: new Date(String(f.get('availableFrom'))).toISOString(),
          availableUntil: new Date(String(f.get('availableUntil'))).toISOString(),
        });
      }}
    >
      <Field label="Capacity per lot">
        <input
          name="capacityValue"
          type="number"
          required
          min="0.001"
          step="0.001"
          defaultValue={p?.capacityValue ?? 50}
        />
      </Field>
      <Field label="Capacity unit">
        <select name="capacityUnit" defaultValue={p?.capacityUnit ?? 'MEAL'}>
          {['MEAL', 'KG', 'ITEM'].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </Field>
      <Field label="Service radius km">
        <input
          name="serviceRadiusKm"
          type="number"
          min="0.1"
          step="0.1"
          required
          defaultValue={p?.serviceRadiusKm ?? 20}
        />
      </Field>
      <Field label="Latitude (optional)">
        <input name="latitude" type="number" step="any" defaultValue={p?.latitude} />
      </Field>
      <Field label="Longitude (optional)">
        <input name="longitude" type="number" step="any" defaultValue={p?.longitude} />
      </Field>
      <Field label="Available from (browser time)">
        <input
          name="availableFrom"
          type="datetime-local"
          required
          defaultValue={localInput(p?.availableFrom ?? iso(0))}
        />
      </Field>
      <Field label="Available until (browser time)">
        <input
          name="availableUntil"
          type="datetime-local"
          required
          defaultValue={localInput(p?.availableUntil ?? iso(1440))}
        />
      </Field>
      <fieldset>
        <legend>Accepted categories</legend>
        {['PREPARED', 'BAKERY', 'PRODUCE', 'DAIRY', 'PANTRY'].map((x) => (
          <label className="check" key={x}>
            <input
              name="acceptedCategories"
              type="checkbox"
              value={x}
              defaultChecked={p?.acceptedCategories.includes(x) ?? x === 'PREPARED'}
            />
            {x}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Handling capabilities</legend>
        {['AMBIENT', 'CHILLED', 'FROZEN'].map((x) => (
          <label className="check" key={x}>
            <input
              name="specialHandlingCapabilities"
              type="checkbox"
              value={x}
              defaultChecked={p?.specialHandlingCapabilities.includes(x) ?? x === 'AMBIENT'}
            />
            {x}
          </label>
        ))}
      </fieldset>
      <button className="button primary" type="submit">
        Save receiving profile
      </button>
    </form>
  );
}
function PickupCard({
  p,
  role,
  me,
  dispatchers,
  code,
  onAction,
  onChallenge,
}: {
  p: Pickup;
  role?: string;
  me: Me;
  dispatchers: { id: string; name: string }[];
  code: { code: string; expiresAt: string } | null;
  onAction: (suffix: string, v?: unknown) => Promise<unknown>;
  onChallenge: (v: unknown) => Promise<unknown>;
}) {
  const timezone = me.memberships[0]?.organization.timezone ?? 'Asia/Karachi';
  const [scheduledDefault] = useState(() =>
    localInput(new Date(Math.max(Date.now() + 60000, +new Date(p.pickupStart))).toISOString()),
  );
  const donor = role === 'DONOR_MANAGER',
    receiver = role === 'RECIPIENT_MANAGER' || p.dispatcherUserId === me.id;
  return (
    <article className="pickup-card">
      <div className="record">
        <div>
          <span className="eyebrow">{p.recipient.name}</span>
          <h3>{p.lot.title}</h3>
          <p>
            {p.lot.quantityValue} {p.lot.quantityUnit} · {p.lot.location.address}
          </p>
        </div>
        <Badge value={p.status} />
      </div>
      <p>
        Window: {date(p.pickupStart, timezone)} — {date(p.pickupEnd, timezone)}
      </p>
      {p.scheduledAt && <p>Scheduled: {date(p.scheduledAt, timezone)}</p>}
      <small>Pickup reference: {p.id}</small>
      {p.failureReason && <p className="safety">{p.failureReason}</p>}
      {donor && ['REQUESTED', 'SCHEDULED'].includes(p.status) && (
        <form
          className="inline mini-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void onAction('schedule', {
              scheduledAt: new Date(String(f.get('scheduledAt'))).toISOString(),
            });
          }}
        >
          <Field label="Schedule collection (browser time)">
            <input
              name="scheduledAt"
              type="datetime-local"
              required
              defaultValue={scheduledDefault}
            />
          </Field>
          <button className="button secondary">Schedule</button>
        </form>
      )}
      {donor && ['SCHEDULED', 'ASSIGNED'].includes(p.status) && (
        <form
          className="inline mini-form"
          onSubmit={(e) => {
            e.preventDefault();
            void onAction('assign', Object.fromEntries(new FormData(e.currentTarget)));
          }}
        >
          <Field label="Dispatcher">
            <select name="dispatcherUserId" required>
              {dispatchers.map((d) => (
                <option value={d.id} key={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <button className="button secondary">Assign dispatcher</button>
        </form>
      )}
      {p.dispatcherUserId === me.id && p.status === 'ASSIGNED' && (
        <Action onClick={() => onAction('status', { status: 'EN_ROUTE' })}>Start collection</Action>
      )}
      {p.dispatcherUserId === me.id && p.status === 'EN_ROUTE' && (
        <Action onClick={() => onAction('status', { status: 'ARRIVED' })}>Record arrival</Action>
      )}
      {p.status === 'ARRIVED' && donor && !p.handover?.receiverConfirmedAt && (
        <form
          className="form-grid mini-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void onChallenge({
              quantity: Number(f.get('quantity')),
              weightKg: f.get('weightKg') ? Number(f.get('weightKg')) : undefined,
              discrepancyReason: f.get('discrepancyReason') || undefined,
            });
          }}
        >
          <Field label="Actual handover quantity">
            <input
              name="quantity"
              type="number"
              min="0.001"
              step="0.001"
              max={p.lot.quantityValue}
              defaultValue={p.lot.quantityValue}
              required
            />
          </Field>
          <Field label="Verified weight kg (optional)">
            <input name="weightKg" type="number" min="0.001" step="0.001" />
          </Field>
          <Field label="Partial handover reason">
            <input name="discrepancyReason" placeholder="Required if actual quantity is lower" />
          </Field>
          <button className="button primary">Generate one-time code</button>
        </form>
      )}
      {code && p.status === 'ARRIVED' && !p.handover?.receiverConfirmedAt && (
        <div className="code-box" role="status">
          <p>Share directly with the receiving party</p>
          <strong>{code.code}</strong>
          <p>Expires {date(code.expiresAt, timezone)}. Never share in public channels.</p>
        </div>
      )}
      {p.status === 'ARRIVED' && p.handover && (
        <p className="safety">
          Proposed actual handover: {p.handover.verifiedQuantityValue}{' '}
          {p.handover.verifiedQuantityUnit}
          {p.handover.verifiedWeightKg ? ` · ${p.handover.verifiedWeightKg} verified kg` : ''}.{' '}
          {p.handover.discrepancyReason ?? 'Full reserved quantity declared.'} Both parties should
          check these quantities before confirming.
        </p>
      )}
      {receiver && p.status === 'ARRIVED' && !p.handover?.receiverConfirmedAt && (
        <form
          className="inline mini-form"
          onSubmit={(e) => {
            e.preventDefault();
            void onAction('handover/verify', Object.fromEntries(new FormData(e.currentTarget)));
          }}
        >
          <Field label="Donor handover code">
            <input
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              required
              autoComplete="one-time-code"
            />
          </Field>
          <button className="button primary">Confirm receipt of food</button>
        </form>
      )}
      {p.handover?.receiverConfirmedAt && p.handover.status === 'PENDING' && (
        <div className="alert success">
          Receiver proof confirmed.{' '}
          {donor ? (
            <Action onClick={() => onAction('handover/confirm')}>Finalize verified handover</Action>
          ) : (
            'Awaiting donor final confirmation.'
          )}
        </div>
      )}
      {p.handover?.status === 'VERIFIED' && (
        <div className="receipt">
          <CheckCircle2 />
          <div>
            <h3>Verified handover</h3>
            <p>
              {p.handover.verifiedQuantityValue} {p.handover.verifiedQuantityUnit} ·{' '}
              {date(p.handover.verifiedAt, timezone)}
            </p>
            <small>Receipt {p.handover.receiptReference}</small>
          </div>
        </div>
      )}
      {!['COMPLETED', 'FAILED', 'CANCELED'].includes(p.status) &&
        (donor || p.dispatcherUserId === me.id) && (
          <details>
            <summary>Report collection failure / cancellation</summary>
            <form
              className="inline mini-form"
              onSubmit={(e) => {
                e.preventDefault();
                void onAction('status', Object.fromEntries(new FormData(e.currentTarget)));
              }}
            >
              <Field label="Outcome">
                <select name="status">
                  <option>FAILED</option>
                  <option>CANCELED</option>
                </select>
              </Field>
              <Field label="Reason">
                <input name="reason" minLength={5} required />
              </Field>
              <button className="button danger">Record outcome</button>
            </form>
          </details>
        )}
    </article>
  );
}
