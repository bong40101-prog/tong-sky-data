import { pathToFileURL } from 'node:url';
import { AnonymousAwardClient } from './client.mjs';
import { normalizePublicAwards } from './normalize.mjs';

const defaultClient = new AnonymousAwardClient();

export async function readAnonymousAvailability(query, { client = defaultClient, now = Date.now } = {}) {
  const fetched = await client.search(query);
  if (fetched.authentication !== 'none' || fetched.provider !== 'award-flight-daily' || !Array.isArray(fetched.trace)
    || fetched.trace.some((event) => event.authentication !== 'none' || event.memberCookies !== false)) throw new Error('Unexpected authenticated provider');
  const result = normalizePublicAwards(fetched.result, fetched.query, { nowMs: now(), maxAgeMs: 12 * 3600000 });
  return { ...result, authentication: 'none', provider: fetched.provider, fetchedAt: fetched.fetchedAt, query: fetched.query, trace: fetched.trace };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) throw new Error('A public query JSON argument is required');
    const result = await readAnonymousAvailability(JSON.parse(process.argv[2]));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ status: 'public-source-unavailable', authentication: 'none', inventoryConfirmed: false, records: [], errorCode: error.code ?? 'PUBLIC_QUERY_FAILED' }));
    process.exitCode = 1;
  }
}
