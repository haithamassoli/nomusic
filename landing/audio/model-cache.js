import { CACHE_NAME, MODEL_BYTES, MODEL_SHA256, MODEL_URL } from './config.js';

export async function verifyModel(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') === MODEL_SHA256;
}

// Only called by Submit, after decode/encode preflight. Cache eviction and private
// browsing are normal: storage failures must never prevent a run.
export async function getModel(report) {
  let cache;
  try {
    cache = await caches.open(CACHE_NAME);
    const saved = await cache.match(MODEL_URL);
    if (saved) {
      report('cached');
      const bytes = new Uint8Array(await saved.arrayBuffer());
      if (await verifyModel(bytes)) return bytes;
      await cache.delete(MODEL_URL);
    }
  } catch { /* CacheStorage may be disabled or full. */ }

  report('download', 0);
  let bytes;
  try {
    const response = await fetch(MODEL_URL, { credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // Bound the download even if the CDN sends a bad response. Content-Length
    // may be a compressed size, so progress counts against the known size.
    if (Number(response.headers.get('content-length')) > MODEL_BYTES) throw new Error('Unexpected model size');
    const chunks = [];
    let received = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MODEL_BYTES) {
        await reader.cancel();
        throw new Error('Unexpected model size');
      }
      chunks.push(value);
      report('download', Math.min(99, Math.floor(received / MODEL_BYTES * 100)));
    }
    bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  } catch (cause) {
    throw Object.assign(new Error('model-download', { cause }), { code: 'model-download' });
  }
  report('verify');
  if (!await verifyModel(bytes)) throw Object.assign(new Error('model-integrity'), { code: 'model-integrity' });
  try {
    await cache?.put(MODEL_URL, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }));
    // Free the space of earlier models (each has its own URL).
    for (const request of await cache?.keys() ?? []) if (request.url !== MODEL_URL) await cache.delete(request);
  } catch { /* Best effort; the verified bytes are ready to use. */ }
  return bytes;
}
