import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const origin = process.env.SMOKE_ORIGIN ?? process.env.APP_ORIGIN ?? 'http://localhost:3000';
assert.equal(
  process.env.ALLOW_DEMO_SEED,
  'true',
  'Smoke creates fictional records; run only on a local demo database.',
);
class Client {
  cookie = '';
  async call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const r = await fetch(`${origin}/api/v1/${path}`, {
      method,
      headers: {
        Origin: origin,
        Cookie: this.cookie,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await r.json();
    assert(r.ok, `${method} ${path}: ${r.status} ${data.error?.message ?? ''}`);
    const cookie = r.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    return data.data as T;
  }
  async login(who: string) {
    await this.call('auth/login', 'POST', {
      email: `${who}@demo.foodloop.test`,
      password: 'DemoFoodLoop!2026',
    });
  }
}
const donor = new Client(),
  receiver = new Client(),
  dispatcher = new Client();
await donor.login('donor');
await receiver.login('recipient');
await dispatcher.login('dispatcher');
const before = await donor.call<{ verifiedMeals: number }>('impact/summary');
const orgs = await donor.call<{ locations: { id: string }[] }[]>('organizations/me');
const l = await donor.call<{ id: string }>('lots', 'POST', {
  title: `Smoke handover ${randomUUID().slice(0, 8)}`,
  category: 'PREPARED',
  quantityValue: 25,
  quantityUnit: 'MEAL',
  packaging: 'Sealed demo containers',
  handlingDeclaration: 'Fictional operator declaration: sealed and labeled for collection',
  storageRequirements: 'AMBIENT',
  locationId: orgs[0].locations[0].id,
  pickupStart: new Date(Date.now() - 60000).toISOString(),
  pickupEnd: new Date(Date.now() + 90 * 60000).toISOString(),
});
await donor.call(`lots/${l.id}/publish`, 'POST');
await donor.call(`lots/${l.id}/matches/evaluate`, 'POST');
await donor.call(`lots/${l.id}/offers`, 'POST');
const offers = await receiver.call<{ id: string; lot: { id: string } }[]>('offers');
const offer = offers.find((o) => o.lot.id === l.id);
assert(offer, 'Receiver must receive an eligible offer');
const p = await receiver.call<{ id: string }>(`offers/${offer.id}/accept`, 'POST');
await donor.call(`pickups/${p.id}/schedule`, 'POST', {
  scheduledAt: new Date(Date.now() + 60000).toISOString(),
});
await donor.call(`pickups/${p.id}/assign`, 'POST', { dispatcherUserId: 'demo-dispatcher' });
await dispatcher.call(`pickups/${p.id}/status`, 'POST', { status: 'EN_ROUTE' });
await dispatcher.call(`pickups/${p.id}/status`, 'POST', { status: 'ARRIVED' });
const proof = await donor.call<{ code: string }>(`pickups/${p.id}/handover/challenge`, 'POST', {
  quantity: 25,
});
await receiver.call(`pickups/${p.id}/handover/verify`, 'POST', { code: proof.code });
assert.equal(
  (await donor.call<{ verifiedMeals: number }>('impact/summary')).verifiedMeals,
  before.verifiedMeals,
  'Receiver proof alone must not increment impact',
);
await donor.call(`pickups/${p.id}/handover/confirm`, 'POST');
assert.equal(
  (await donor.call<{ verifiedMeals: number }>('impact/summary')).verifiedMeals -
    before.verifiedMeals,
  25,
);
const receipt = await receiver.call<{ handover: { status: string; receiptReference: string } }>(
  `pickups/${p.id}/receipt`,
);
assert.equal(receipt.handover.status, 'VERIFIED');
console.log(
  `PASS: full demo API handover; exactly 25 additional confirmed meals. Receipt ${receipt.handover.receiptReference}`,
);
