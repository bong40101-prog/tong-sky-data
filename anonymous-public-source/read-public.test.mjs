import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAnonymousAvailability } from './read-public.mjs';

const now = () => Date.parse('2026-10-31T08:00:00Z');
const proof = JSON.parse(readFileSync(new URL('./fixtures/anonymous-provider-response.json', import.meta.url), 'utf8'));
const canonicalQuery = { origin: 'ICN', destinations: ['CDG', 'AMS'], dateFrom: '2026-11-01', dateTo: '2027-09-30', cabin: 'J', directOnly: true, source: 'flyingblue' };
const fetched = (result = proof.response.result) => ({ provider: 'award-flight-daily', authentication: 'none', query: canonicalQuery,
  fetchedAt: new Date(now()).toISOString(), trace: [{ method: 'tools/call', status: 200, authentication: 'none', memberCookies: false }], result });

test('the real anonymous response remains historical and never becomes current seat inventory', async () => {
  let calls = 0;
  const result = await readAnonymousAvailability(canonicalQuery, { now, client: { search: async () => { calls++; return fetched(); } } });
  assert.equal(result.status, 'stale-data');
  assert.equal(result.inventoryConfirmed, false);
  assert.deepEqual(result.records, []);
  assert.equal(result.authentication, 'none');
  assert.equal(result.diagnostics.definitelyStaleCount, 10);
  assert.equal(calls, 1);
});

test('valid recent public data keeps its separate cache and program labels', async () => {
  const text = JSON.stringify({ count: 1, cabin: 'J', results: [{ source: 'flyingblue', origin: 'ICN', destination: 'CDG', date: '2026-11-01',
    direct: true, mileage: 85000, seats: 9, taxes: null, airlines: 'AF, KL', updated_at: '2026-10-31T07:00:00Z' }] });
  const result = await readAnonymousAvailability(canonicalQuery, { now, client: { search: async () => fetched({ content: [{ type: 'text', text }] }) } });
  assert.equal(result.status, 'fresh');
  assert.equal(result.source, 'public-cache');
  assert.equal(result.records[0].program, 'flyingblue');
  assert.equal(result.records[0].inventoryConfirmed, false);
});

for (const change of [{ authentication: 'member-session' }, { provider: 'airline-browser' }, { trace: [{ authentication: 'none', memberCookies: true }] }]) {
  test(`rejects an authenticated or substituted reader: ${JSON.stringify(change)}`, async () => {
    await assert.rejects(readAnonymousAvailability(canonicalQuery, { now, client: { search: async () => ({ ...fetched(), ...change }) } }), /Unexpected authenticated provider/);
  });
}

test('quota failure propagates without retry, login or an empty-seat result', async () => {
  let calls = 0;
  const quota = Object.assign(new Error('Public source query limit reached'), { code: 'PUBLIC_QUERY_LIMIT' });
  await assert.rejects(readAnonymousAvailability(canonicalQuery, { now, client: { search: async () => { calls++; throw quota; } } }), { code: 'PUBLIC_QUERY_LIMIT' });
  assert.equal(calls, 1);
});
