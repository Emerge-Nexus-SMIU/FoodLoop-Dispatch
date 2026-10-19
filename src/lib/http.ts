import { ensure } from '../server/errors';
export async function readJson(request: Request, limit = 16000): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        ensure(false, 413, 'BODY_TOO_LARGE', 'Request body exceeds limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    ensure(false, 422, 'INVALID_JSON', 'Provide a valid JSON object');
  }
}
