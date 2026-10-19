'use client';
export async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const r = await fetch(`/api/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.error?.message ?? 'Request failed');
  return b.data;
}
