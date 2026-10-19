import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { ZodError, z } from 'zod';
import { Prisma } from '@prisma/client';
import { currentUser, login, register, sessionHash, rateLimit } from '@/server/auth';
import { db } from '@/server/db';
import { ensure, AppError } from '@/server/errors';
import * as s from '@/server/service';
import * as account from '@/server/accounts';
import * as ops from '@/server/operations';
import { requireAdmin } from '@/server/auth';
import { readJson } from '@/lib/http';
export const runtime = 'nodejs';
async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const correlationId = randomUUID();
  try {
    const path = (await params).path;
    const p = path.join('/'),
      method = req.method;
    if (method !== 'GET') {
      const origin = req.headers.get('origin');
      ensure(
        process.env.NODE_ENV !== 'production' || process.env.APP_ORIGIN,
        503,
        'ORIGIN_CONFIG',
        'Configure the application origin',
      );
      const expected =
        process.env.NODE_ENV === 'production'
          ? account.appOrigin()
          : (process.env.APP_ORIGIN ?? req.nextUrl.origin);
      ensure(origin === expected, 403, 'ORIGIN_REJECTED', 'Request origin is not allowed');
      ensure(
        Number(req.headers.get('content-length') ?? 0) <= 16000,
        413,
        'BODY_TOO_LARGE',
        'Request body exceeds limit',
      );
    }
    const body = method === 'GET' ? {} : await readJson(req);
    if (p === 'auth/login' || p === 'auth/register') {
      ensure(method === 'POST', 405, 'METHOD', 'POST required');
      await rateLimit('global:auth', 120, 60);
      const v = z
        .object({
          email: z.email().max(200),
          password: z
            .string()
            .min(p.endsWith('register') ? 12 : 1)
            .max(128),
          name: z.string().min(2).max(100).optional(),
          mfaCode: z.string().max(64).optional(),
        })
        .parse(body);
      if (p.endsWith('register')) {
        ensure(v.name, 422, 'NAME_REQUIRED', 'Name required');
        ensure(
          Buffer.byteLength(v.password, 'utf8') <= 72,
          422,
          'PASSWORD_TOO_LONG',
          'Password must be at most 72 UTF-8 bytes',
        );
      }
      const token = p.endsWith('login')
        ? await login(v.email, v.password, v.mfaCode)
        : await register(v.name!, v.email, v.password);
      const response = NextResponse.json({
        data: { authenticated: true },
        error: null,
        meta: { correlationId },
      });
      response.cookies.set('foodloop_session', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 8 * 3600,
      });
      return response;
    }
    if (
      method === 'POST' &&
      ['auth/forgot-password', 'auth/reset-password', 'auth/verify-email'].includes(p)
    ) {
      await rateLimit('global:account-actions', 60, 60);
      let data: unknown;
      if (p === 'auth/forgot-password') {
        const v = z.object({ email: z.email().max(200) }).parse(body);
        data = await account.requestAction(v.email, 'RESET');
      } else {
        const v = z
          .object({
            token: z.string().regex(/^[a-f0-9]{64}$/),
            password: z.string().min(12).max(72).optional(),
          })
          .parse(body);
        data = await account.consumeAction(
          v.token,
          p === 'auth/reset-password' ? 'RESET' : 'VERIFY',
          v.password,
        );
      }
      return NextResponse.json(
        { data, error: null, meta: { correlationId } },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const a = await currentUser();
    ensure(a, 401, 'UNAUTHENTICATED', 'Please sign in');
    if (p === 'auth/logout' && method === 'POST') {
      const token = req.cookies.get('foodloop_session')?.value;
      if (token) await db.session.deleteMany({ where: { id: sessionHash(token) } });
      const r = NextResponse.json({ data: { ok: true }, error: null, meta: { correlationId } });
      r.cookies.delete('foodloop_session');
      return r;
    }
    if (a.platformAdmin && p !== 'me' && !p.startsWith('account/')) requireAdmin(a);
    if (p.startsWith('admin/')) requireAdmin(a);
    await s.reconcile();
    const skip = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(req.nextUrl.searchParams.get('offset') ?? 0);
    const key = req.headers.get('idempotency-key') ?? undefined;
    let data: unknown;
    const get = method === 'GET',
      post = method === 'POST';
    if (p === 'me' && get)
      data = {
        id: a.id,
        name: a.name,
        email: a.email,
        platformAdmin: a.platformAdmin,
        emailVerified: !!a.emailVerifiedAt,
        mfaEnabled: !!a.mfaSecret,
        memberships: a.memberships,
      };
    else if (p === 'account/verification' && post)
      data = await account.requestAction(a.email, 'VERIFY', a);
    else if (p === 'account/password' && post) data = await account.changePassword(a, body);
    else if (p === 'account/sessions' && get)
      data = await account.listSessions(
        a,
        sessionHash(req.cookies.get('foodloop_session')?.value ?? ''),
      );
    else if (p === 'account/sessions/revoke' && post)
      data = await account.revokeSessions(
        a,
        z.object({ id: z.string().optional() }).parse(body).id,
      );
    else if (p === 'account/mfa/setup' && post)
      data = await account.beginMfa(
        a,
        z.object({ password: z.string().max(128) }).parse(body).password,
      );
    else if (p === 'account/mfa/enable' && post)
      data = await account.enableMfa(
        a,
        z.object({ code: z.string().length(6) }).parse(body).code,
        sessionHash(req.cookies.get('foodloop_session')?.value ?? ''),
      );
    else if (p === 'account/mfa/disable' && post) {
      const v = z.object({ password: z.string().max(128), code: z.string().max(64) }).parse(body);
      data = await account.disableMfa(a, v.password, v.code);
    } else if (p === 'organization/settings' && method === 'PATCH')
      data = await ops.settings(a, body);
    else if (p === 'organization/members' && get) data = await ops.members(a);
    else if (p === 'organization/invitations' && post) data = await ops.invite(a, body);
    else if (/^organization\/invitations\/[^/]+\/revoke$/.test(p) && post)
      data = await ops.revokeInvite(a, path[2]);
    else if (/^organization\/members\/[^/]+\/remove$/.test(p) && post)
      data = await ops.removeMember(a, path[2]);
    else if (p === 'invitations/accept' && post)
      data = await ops.acceptInvite(a, z.object({ token: z.string() }).parse(body).token);
    else if (p === 'notifications' && get) data = await ops.notifications(a, skip);
    else if (p === 'notifications/read' && post)
      data = await ops.readNotification(a, z.object({ id: z.string().optional() }).parse(body).id);
    else if (p === 'admin/operations' && get) data = await ops.operationalStatus(a);
    else if (p === 'admin/policy' && (get || method === 'PATCH'))
      data = await ops.policy(a, get ? undefined : body);
    else if ((p === 'disputes' || p === 'admin/disputes') && get) data = await ops.disputes(a);
    else if (p === 'disputes' && post) data = await ops.openDispute(a, body);
    else if (/^admin\/disputes\/[^/]+\/resolve$/.test(p) && post)
      data = await ops.resolveDispute(a, path[2], body);
    else if (/^exports\/(impact|audit)$/.test(p) && get) {
      const csv = await ops.exportData(a, path[1]);
      return new NextResponse(csv.text, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${csv.filename}"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } else if ((p === 'organizations/me' || p === 'admin/organizations') && get) {
      if (p.startsWith('admin')) ensure(a.platformAdmin, 403, 'FORBIDDEN', 'Admin required');
      data = await s.organizations(
        a,
        skip,
        z
          .enum(['PENDING', 'VERIFIED', 'SUSPENDED'])
          .optional()
          .parse(req.nextUrl.searchParams.get('status')?.toUpperCase()),
      );
    } else if (p === 'organizations' && post) data = await s.onboard(a, body);
    else if (p === 'recipient-profile' && method === 'PATCH') data = await s.updateProfile(a, body);
    else if (/^admin\/organizations\/[^/]+\/(verify|suspend)$/.test(p) && post)
      data = await s.orgStatus(a, path[2], path[3] === 'verify' ? 'VERIFIED' : 'SUSPENDED');
    else if (p === 'lots' && get) data = await s.listLots(a, skip);
    else if (p === 'lots' && post) data = await s.saveLot(a, body);
    else if (path[0] === 'lots' && path.length === 2 && get) data = await s.getLot(a, path[1]);
    else if (path[0] === 'lots' && path.length === 2 && method === 'PATCH')
      data = await s.saveLot(a, body, path[1]);
    else if (
      path.length === 3 &&
      path[0] === 'lots' &&
      ['publish', 'cancel'].includes(path[2]) &&
      post
    )
      data = await s.lotAction(a, path[1], path[2] as 'publish' | 'cancel');
    else if (
      path[0] === 'lots' &&
      path[2] === 'matches' &&
      ((get && path.length === 3) || (post && path.length === 4 && path[3] === 'evaluate'))
    )
      data = await s.matches(a, path[1], post);
    else if (path.length === 3 && path[0] === 'lots' && path[2] === 'offers' && post)
      data = await s.sendOffers(a, path[1]);
    else if (p === 'offers' && get) data = await s.listOffers(a, skip);
    else if (
      path.length === 3 &&
      path[0] === 'offers' &&
      ['accept', 'decline'].includes(path[2]) &&
      post
    )
      data = await s.offerAction(a, path[1], path[2] === 'accept', key);
    else if (p === 'recipients' && get) data = await s.recipientDirectory(a);
    else if (p === 'dispatchers' && get) data = await s.dispatchers(a);
    else if (p === 'pickups/batch-assign' && post) data = await ops.batchAssign(a, body);
    else if (p === 'pickups' && get) data = await s.listPickups(a, skip);
    else if (path[0] === 'pickups' && path.length === 2 && get)
      data = await s.getPickup(a, path[1]);
    else if (
      path.length === 3 &&
      path[0] === 'pickups' &&
      ['schedule', 'assign', 'status'].includes(path[2]) &&
      post
    )
      data = await s.pickupAction(a, path[1], path[2], body);
    else if (
      path.length === 4 &&
      path[0] === 'pickups' &&
      path[2] === 'handover' &&
      path[3] === 'challenge' &&
      post
    )
      data = await s.challenge(a, path[1], body);
    else if (
      path.length === 4 &&
      path[0] === 'pickups' &&
      path[2] === 'handover' &&
      path[3] === 'verify' &&
      post
    )
      data = await s.verifyCode(a, path[1], body, key);
    else if (
      path.length === 4 &&
      path[0] === 'pickups' &&
      path[2] === 'handover' &&
      path[3] === 'confirm' &&
      post
    )
      data = await s.confirm(a, path[1], key);
    else if (path.length === 3 && path[0] === 'pickups' && path[2] === 'receipt' && get)
      data = await s.receipt(a, path[1]);
    else if (p === 'impact/summary' && get) data = await s.impact(a);
    else if (p === 'impact/handovers' && get) data = await s.listPickups(a, skip, true);
    else if (p === 'audit-events' && get) data = await s.audits(a, skip);
    else if (p === 'assistant/explain' && post) data = await s.explain(a);
    else throw new AppError(404, 'NOT_FOUND', 'Endpoint not found');
    return NextResponse.json(
      { data, error: null, meta: { correlationId, offset: skip, limit: 50 } },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    let status = 500,
      code = 'INTERNAL_ERROR',
      message = 'Unable to complete request';
    if (e instanceof AppError) {
      status = e.status;
      code = e.code;
      message = e.message;
    } else if (e instanceof ZodError) {
      status = 422;
      code = 'VALIDATION';
      message = e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    } else if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      status = 409;
      code = 'CONFLICT';
      message = 'Record or request already exists';
    } else
      console.error(
        JSON.stringify({
          correlationId,
          event: 'request_failed',
          type: e instanceof Error ? e.name : 'unknown',
        }),
      );
    return NextResponse.json(
      { data: null, error: { code, message }, meta: { correlationId } },
      {
        status,
        headers: {
          'Cache-Control': 'no-store',
          ...(status === 429 ? { 'Retry-After': '60' } : {}),
        },
      },
    );
  }
}
export { handle as GET, handle as POST, handle as PATCH };
