'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
function useAction() {
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  async function run(fn: () => Promise<unknown>, success = 'Saved successfully') {
    setBusy(true);
    setError('');
    try {
      await fn();
      setMessage(success);
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { error, message, busy, revision, run, setError };
}
function Status({ state }: { state: ReturnType<typeof useAction> }) {
  return (
    <>
      {state.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}
      {state.message && (
        <div className="alert success" role="status">
          {state.message}
        </div>
      )}
    </>
  );
}
function field(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  return new FormData(e.currentTarget);
}
export function AccountPanel({
  email,
  emailVerified,
  mfaEnabled,
}: {
  email: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
}) {
  const state = useAction(),
    router = useRouter(),
    [sessions, setSessions] = useState<
      { id: string; createdAt: string; expiresAt: string; current: boolean }[]
    >([]),
    [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null),
    [recovery, setRecovery] = useState<string[]>([]),
    [enabled, setEnabled] = useState(mfaEnabled);
  const { setError: reportLoadError } = state;
  useEffect(() => {
    api<typeof sessions>('account/sessions')
      .then(setSessions)
      .catch((e: Error) => reportLoadError(e.message));
  }, [state.revision, reportLoadError]);
  return (
    <section className="panel">
      <h2>Account security</h2>
      <p>
        {email} · {emailVerified ? 'Email verified' : 'Email verification required'}
      </p>
      <Status state={state} />
      {!emailVerified && (
        <button
          className="button secondary"
          disabled={state.busy}
          onClick={() =>
            void state.run(
              () => api('account/verification', 'POST'),
              'Verification link queued for delivery.',
            )
          }
        >
          Send verification email
        </button>
      )}
      <h3>Change password</h3>
      <form
        className="form-grid"
        onSubmit={(e) => {
          const f = field(e);
          void state.run(async () => {
            await api('account/password', 'POST', Object.fromEntries(f));
            router.push('/login');
          });
        }}
      >
        <label className="field">
          Current password
          <input name="currentPassword" type="password" required autoComplete="current-password" />
        </label>
        <label className="field">
          New password
          <input
            name="newPassword"
            type="password"
            minLength={12}
            maxLength={72}
            required
            autoComplete="new-password"
          />
        </label>
        <button className="button secondary" disabled={state.busy}>
          Change password and sign out all sessions
        </button>
      </form>
      <hr />
      <h3>Authenticator protection</h3>
      <p>
        {enabled
          ? 'Enabled. Authenticator or one-time recovery code is required at sign-in.'
          : 'Add a time-based authenticator. Production platform administrators must enable this.'}
      </p>
      {!enabled && !setup && (
        <form
          className="inline mini-form"
          onSubmit={(e) => {
            const f = field(e);
            void state.run(async () =>
              setSetup(await api('account/mfa/setup', 'POST', Object.fromEntries(f))),
            );
          }}
        >
          <label className="field">
            Confirm current password
            <input name="password" type="password" required autoComplete="current-password" />
          </label>
          <button className="button secondary" disabled={state.busy}>
            Set up authenticator
          </button>
        </form>
      )}
      {setup && !enabled && (
        <div className="safety">
          <p>
            Manually add this secret to your authenticator. It is displayed only during setup; keep
            it private.
          </p>
          <code className="secret">{setup.secret}</code>
          <form
            className="inline mini-form"
            onSubmit={(e) => {
              const f = field(e);
              void state.run(async () => {
                const result = await api<{ recoveryCodes: string[] }>(
                  'account/mfa/enable',
                  'POST',
                  Object.fromEntries(f),
                );
                setRecovery(result.recoveryCodes);
                setSetup(null);
                setEnabled(true);
              }, 'Authenticator enabled.');
            }}
          >
            <label className="field">
              Authenticator code
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                required
                autoComplete="one-time-code"
              />
            </label>
            <button className="button primary" disabled={state.busy}>
              Enable authenticator
            </button>
          </form>
        </div>
      )}
      {recovery.length > 0 && (
        <div className="safety">
          <h3>Save your one-time recovery codes</h3>
          <p>These cannot be shown again. Store them outside this device.</p>
          <pre className="secret">{recovery.join('\n')}</pre>
          <button className="button secondary" onClick={() => setRecovery([])}>
            I saved my recovery codes
          </button>
        </div>
      )}
      {enabled && (
        <details>
          <summary>Disable authenticator</summary>
          <form
            className="form-grid"
            onSubmit={(e) => {
              const f = field(e);
              void state.run(async () => {
                await api('account/mfa/disable', 'POST', Object.fromEntries(f));
                router.push('/login');
              });
            }}
          >
            <label className="field">
              Current password
              <input name="password" type="password" required />
            </label>
            <label className="field">
              Authenticator or recovery code
              <input name="code" required maxLength={64} />
            </label>
            <button className="button danger" disabled={state.busy}>
              Disable and revoke all sessions
            </button>
          </form>
        </details>
      )}
      <hr />
      <h3>Active sessions</h3>
      {sessions.map((s) => (
        <div className="record" key={s.id}>
          <div>
            <b>{s.current ? 'This session' : 'Other session'}</b>
            <p>
              Created {new Date(s.createdAt).toLocaleString()} · expires{' '}
              {new Date(s.expiresAt).toLocaleString()}
            </p>
          </div>
          <button
            className="button secondary"
            disabled={state.busy}
            onClick={() =>
              void state.run(async () => {
                await api('account/sessions/revoke', 'POST', { id: s.id });
                if (s.current) router.push('/login');
              })
            }
          >
            Revoke session
          </button>
        </div>
      ))}
    </section>
  );
}
export function OrganizationPanel({
  organization: o,
}: {
  organization: {
    id: string;
    name: string;
    contact: string;
    timezone: string;
    verificationStatus: string;
    locations?: { id: string; address: string }[];
  };
}) {
  const state = useAction();
  return (
    <section className="panel">
      <h2>Organization settings</h2>
      <Status state={state} />
      <p>
        Verification: {o.verificationStatus}. Changing the organization name requires admin
        re-verification and is blocked while donations are active. Verified receipts remain
        immutable.
      </p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          const f = field(e);
          void state.run(() => api('organization/settings', 'PATCH', Object.fromEntries(f)));
        }}
      >
        <label className="field">
          Organization name
          <input name="name" required minLength={3} maxLength={120} defaultValue={o.name} />
        </label>
        <label className="field">
          Operational contact
          <input name="contact" required minLength={3} maxLength={200} defaultValue={o.contact} />
        </label>
        <label className="field">
          Organization timezone
          <input name="timezone" required defaultValue={o.timezone} />
        </label>
        <label className="field">
          Collection address
          <input
            name="address"
            required
            minLength={5}
            maxLength={300}
            defaultValue={o.locations?.[0]?.address}
          />
        </label>
        <button className="button primary" disabled={state.busy}>
          Save organization settings
        </button>
      </form>
      <p className="safety">
        Operators remain responsible for food suitability, safe handling, labeling and Pakistan's
        applicable local requirements. This platform does not certify food safety.
      </p>
    </section>
  );
}
export function TeamPanel({ managerRole }: { managerRole?: string }) {
  const state = useAction(),
    [data, setData] = useState<{
      members: { id: string; role: string; user: { id: string; name: string; email: string } }[];
      invitations: { id: string; email: string; role: string; expiresAt: string }[];
    }>({ members: [], invitations: [] });
  const { setError: reportLoadError } = state;
  useEffect(() => {
    api<typeof data>('organization/members')
      .then(setData)
      .catch((e: Error) => reportLoadError(e.message));
  }, [state.revision, reportLoadError]);
  return (
    <section className="panel">
      <h2>Organization team</h2>
      <Status state={state} />
      <p>
        Invitations are bound to the recipient's verified email address and expire in 24 hours. Each
        account belongs to one organization.
      </p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          const f = field(e);
          void state.run(
            () => api('organization/invitations', 'POST', Object.fromEntries(f)),
            'Invitation queued for delivery.',
          );
        }}
      >
        <label className="field">
          Invitee email
          <input name="email" type="email" required />
        </label>
        <label className="field">
          Member role
          <select name="role">
            {[managerRole, 'DISPATCHER'].filter(Boolean).map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
        </label>
        <button className="button primary" disabled={state.busy}>
          Invite member
        </button>
      </form>
      <h3>Current members</h3>
      {data.members.map((m) => (
        <div className="record" key={m.id}>
          <div>
            <b>{m.user.name}</b>
            <p>
              {m.user.email} · {m.role}
            </p>
          </div>
          <button
            className="button danger"
            disabled={state.busy}
            onClick={() => void state.run(() => api(`organization/members/${m.id}/remove`, 'POST'))}
          >
            Remove member
          </button>
        </div>
      ))}
      <h3>Pending invitations</h3>
      {!data.invitations.length && <p>No pending invitations.</p>}
      {data.invitations.map((i) => (
        <div className="record" key={i.id}>
          <div>
            <b>{i.email}</b>
            <p>
              {i.role} · expires {new Date(i.expiresAt).toLocaleString()}
            </p>
          </div>
          <button
            className="button secondary"
            disabled={state.busy}
            onClick={() =>
              void state.run(() => api(`organization/invitations/${i.id}/revoke`, 'POST'))
            }
          >
            Revoke invitation
          </button>
        </div>
      ))}
    </section>
  );
}
export function InboxPanel() {
  const state = useAction(),
    [offset, setOffset] = useState(0),
    [data, setData] = useState<{
      unread: number;
      items: {
        id: string;
        kind: string;
        seenAt: string | null;
        createdAt: string;
        payload: { title: string; href: string };
      }[];
    }>({ unread: 0, items: [] });
  const { setError: reportLoadError } = state;
  useEffect(() => {
    api<typeof data>(`notifications?offset=${offset}`)
      .then(setData)
      .catch((e: Error) => reportLoadError(e.message));
  }, [state.revision, offset, reportLoadError]);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Notifications · {data.unread} unread</h2>
        <button
          className="button secondary"
          onClick={() => void state.run(() => api('notifications/read', 'POST'))}
        >
          Mark all read
        </button>
      </div>
      <Status state={state} />
      {!data.items.length && <p>Your inbox is clear.</p>}
      {data.items.map((n) => (
        <div className="record" key={n.id}>
          <div>
            <Link href={n.payload.href}>{n.payload.title}</Link>
            <p>
              {new Date(n.createdAt).toLocaleString()} · {n.seenAt ? 'Read' : 'Unread'}
            </p>
          </div>
          {!n.seenAt && (
            <button
              className="button secondary"
              onClick={() => void state.run(() => api('notifications/read', 'POST', { id: n.id }))}
            >
              Mark read
            </button>
          )}
        </div>
      ))}
      <div className="inline">
        <button
          className="button secondary"
          disabled={offset === 0}
          onClick={() => setOffset((v) => Math.max(0, v - 50))}
        >
          Previous page
        </button>
        <span>Page {offset / 50 + 1}</span>
        <button
          className="button secondary"
          disabled={data.items.length < 50}
          onClick={() => setOffset((v) => v + 50)}
        >
          Next page
        </button>
      </div>
    </section>
  );
}
export function DisputePanel({ admin }: { admin: boolean }) {
  const state = useAction(),
    [rows, setRows] = useState<
      { id: string; pickupId: string; reason: string; status: string; resolution: string | null }[]
    >([]);
  const { setError: reportLoadError } = state;
  useEffect(() => {
    api<typeof rows>(admin ? 'admin/disputes' : 'disputes')
      .then(setRows)
      .catch((e: Error) => reportLoadError(e.message));
  }, [state.revision, admin, reportLoadError]);
  return (
    <section className="panel">
      <h2>{admin ? 'Dispute review' : 'Pickup disputes'}</h2>
      <Status state={state} />
      <p>
        Disputes record issues and resolutions. They never rewrite a verified receipt or silently
        change impact.
      </p>
      {!admin && (
        <form
          className="form-grid"
          onSubmit={(e) => {
            const f = field(e);
            void state.run(() => api('disputes', 'POST', Object.fromEntries(f)));
          }}
        >
          <label className="field">
            Pickup reference
            <input name="pickupId" required />
          </label>
          <label className="field">
            Describe the issue
            <textarea name="reason" minLength={12} maxLength={2000} required />
          </label>
          <button className="button primary" disabled={state.busy}>
            Open dispute
          </button>
        </form>
      )}
      {!rows.length && <p>No disputes in this scope.</p>}
      {rows.map((d) => (
        <article className="record" key={d.id}>
          <div>
            <b>
              {d.status} · {d.pickupId}
            </b>
            <p>{d.reason}</p>
            {d.resolution && <p>Resolution: {d.resolution}</p>}
            {admin && d.status === 'OPEN' && (
              <form
                onSubmit={(e) => {
                  const f = field(e);
                  void state.run(() =>
                    api(`admin/disputes/${d.id}/resolve`, 'POST', Object.fromEntries(f)),
                  );
                }}
              >
                <label className="field">
                  Resolution
                  <textarea name="resolution" minLength={12} maxLength={2000} required />
                </label>
                <button className="button secondary" disabled={state.busy}>
                  Record resolution
                </button>
              </form>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
export function PolicyPanel() {
  const state = useAction(),
    [policy, setPolicy] = useState<{
      capacityWeight: number;
      windowWeight: number;
      distanceWeight: number;
      version: number;
    } | null>(null);
  const { setError: reportLoadError } = state;
  useEffect(() => {
    api<NonNullable<typeof policy>>('admin/policy')
      .then(setPolicy)
      .catch((e: Error) => reportLoadError(e.message));
  }, [state.revision, reportLoadError]);
  return (
    <section className="panel">
      <h2>Versioned matching policy</h2>
      <Status state={state} />
      <p>
        Hard eligibility filters always apply. Weights total 100; absent distance is excluded and
        remaining components normalized.
      </p>
      {policy && (
        <form
          className="form-grid"
          key={policy.version}
          onSubmit={(e) => {
            const f = field(e);
            void state.run(() =>
              api('admin/policy', 'PATCH', {
                capacityWeight: Number(f.get('capacityWeight')),
                windowWeight: Number(f.get('windowWeight')),
                distanceWeight: Number(f.get('distanceWeight')),
              }),
            );
          }}
        >
          {(['capacityWeight', 'windowWeight', 'distanceWeight'] as const).map((k) => (
            <label className="field" key={k}>
              {k === 'capacityWeight'
                ? 'Capacity weight'
                : k === 'windowWeight'
                  ? 'Pickup window weight'
                  : 'Distance weight'}
              <input
                name={k}
                type="number"
                min={0}
                max={100}
                step={1}
                required
                defaultValue={policy[k]}
              />
            </label>
          ))}
          <p>Policy version {policy.version}</p>
          <button className="button primary" disabled={state.busy}>
            Save new policy version
          </button>
        </form>
      )}
    </section>
  );
}

export function BatchDispatchPanel({
  pickups,
  dispatchers,
  onDone,
}: {
  pickups: { id: string; status: string; lot: { title: string } }[];
  dispatchers: { id: string; name: string }[];
  onDone: () => void;
}) {
  const state = useAction(),
    [selected, setSelected] = useState<string[]>([]),
    [results, setResults] = useState<{ id: string; ok: boolean; message: string }[]>([]);
  const available = pickups.filter((p) => ['SCHEDULED', 'ASSIGNED'].includes(p.status));
  return (
    <details>
      <summary>Batch dispatcher assignment · up to 25 pickups</summary>
      <Status state={state} />
      <p>
        Each pickup is authorized and assigned independently. A failed row does not undo successful
        assignments.
      </p>
      <form
        onSubmit={(e) => {
          const f = field(e);
          void state.run(async () => {
            const result = await api<{ results: typeof results }>('pickups/batch-assign', 'POST', {
              pickupIds: selected,
              dispatcherUserId: f.get('dispatcherUserId'),
            });
            setResults(result.results);
            onDone();
          }, 'Batch processed. Review each result.');
        }}
      >
        {available.map((p) => (
          <label className="check" key={p.id}>
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              disabled={!selected.includes(p.id) && selected.length >= 25}
              onChange={(e) =>
                setSelected((v) =>
                  e.target.checked ? [...v, p.id] : v.filter((id) => id !== p.id),
                )
              }
            />
            {p.lot.title} · {p.status}
          </label>
        ))}
        {!available.length && <p>Schedule pickups before using batch assignment.</p>}
        <label className="field">
          Batch dispatcher
          <select name="dispatcherUserId" required>
            {dispatchers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button secondary" disabled={!selected.length || state.busy}>
          Assign selected pickups
        </button>
      </form>
      {results.map((r) => (
        <p key={r.id}>
          {r.id} · {r.ok ? 'Assigned' : 'Failed'}: {r.message}
        </p>
      ))}
    </details>
  );
}

export function OperationsStatusPanel() {
  const state = useAction(),
    [data, setData] = useState<{
      computedAt: string;
      mail: { status: string; count: number }[];
      organizations: { status: string; count: number }[];
      failedPickupsLast24Hours: number;
      expiredBacklog: number;
    } | null>(null);
  const { setError: reportLoadError } = state;
  useEffect(() => {
    api<NonNullable<typeof data>>('admin/operations')
      .then(setData)
      .catch((e) => reportLoadError((e as Error).message));
  }, [state.revision, reportLoadError]);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Operational health</h2>
        <button
          className="button secondary"
          onClick={() =>
            void state.run(async () => setData(await api('admin/operations')), 'Status refreshed.')
          }
        >
          Refresh status
        </button>
      </div>
      <Status state={state} />
      {data && (
        <>
          <p>
            Observed {new Date(data.computedAt).toLocaleString()}. Backlogs are actual database
            counts.
          </p>
          <div className="metric-grid">
            <article className="metric">
              <div>Expired records awaiting reconciliation</div>
              <strong>{data.expiredBacklog}</strong>
            </article>
            <article className="metric">
              <div>Failed pickups · 24 hours</div>
              <strong>{data.failedPickupsLast24Hours}</strong>
            </article>
            {data.mail.map((m) => (
              <article className="metric" key={m.status}>
                <div>Email queue · {m.status}</div>
                <strong>{m.count}</strong>
              </article>
            ))}
          </div>
          <p>
            Failed mail requires operator review of sender configuration and worker health. Never
            print private message payloads or account links in logs.
          </p>
        </>
      )}
    </section>
  );
}
