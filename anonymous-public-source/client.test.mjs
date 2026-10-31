import test from 'node:test';
import assert from 'node:assert/strict';
import { AnonymousAwardClient, PublicSourceError, validateQuery } from './client.mjs';

const now = () => Date.parse('2026-10-31T08:00:00Z');
const query = () => ({ origin: 'ICN', destinations: ['CDG', 'AMS'], dateFrom: '2026-11-01', dateTo: '2027-09-30', cabin: 'J' });
const json = (id, result, headers = {}) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'content-type': 'application/json', ...headers } });
const good = () => [
  json(1, { protocolVersion: '2025-03-26' }, { 'mcp-session-id': 'anonymous-transport-id', 'set-cookie': 'must-not-be-reused=value' }),
  new Response(null, { status: 202 }),
  json(2, { tools: [{ name: 'afd_search_award_flights' }] }),
  json(3, { content: [{ type: 'text', text: '{"results":[],"has_more":true}' }] }),
];
const fixture = (responses = good()) => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); if (!responses.length) throw new Error('Unexpected network call'); return responses.shift(); };
  return { calls, client: new AnonymousAwardClient({ fetchImpl, now }) };
};

test('anonymous public query uses no login, API key, cookie, payment, or airline endpoint', async () => {
  const { client, calls } = fixture();
  const result = await client.search(query());
  assert.equal(result.authentication, 'none');
  assert.equal(calls.length, 4);
  for (const { url, init } of calls) {
    assert.equal(url, 'https://www.awardflightdaily.com/mcp-server/mcp');
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'manual');
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(Object.keys(init.headers).some((h) => /authorization|cookie|api.key/i.test(h)), false);
    assert.equal(/api_key|payment_token|password|travelerKey|PROFILE/.test(init.body), false);
  }
  assert.equal(calls[1].init.headers['Mcp-Session-Id'], 'anonymous-transport-id');
  assert.equal(JSON.parse(calls[3].init.body).params.arguments.params.destination, 'CDG,AMS');
  assert.equal(JSON.parse(calls[3].init.body).params.arguments.params.source, 'flyingblue');
  assert.equal(calls.filter((c) => JSON.parse(c.init.body).method === 'tools/call').length, 1);
});

for (const status of [301, 302, 401, 403, 429, 500, 503]) {
  test(`HTTP ${status} immediately stops without retries or auth fallback`, async () => {
    const { client, calls } = fixture([new Response('private provider text', { status, headers: { Location: 'https://example.invalid/login' } })]);
    await assert.rejects(client.search(query()), (e) => e instanceof PublicSourceError && e.status === status && !e.message.includes('private'));
    assert.equal(calls.length, 1);
  });
}

for (const [field, value] of [['api_key', 'not-real'], ['payment_token', 'not-real'], ['cookies', 'not-real'], ['password', 'not-real'], ['memberId', 'not-real']]) {
  test(`rejects supplied ${field} before sending anything`, async () => {
    const { client, calls } = fixture();
    await assert.rejects(client.search({ ...query(), [field]: value }), { code: 'CREDENTIALS_NOT_ALLOWED' });
    assert.equal(calls.length, 0);
  });
}

for (const change of [
  { origin: 'bad' }, { destinations: [] }, { destinations: ['ICN'] }, { dateFrom: '2026-02-29' },
  { dateFrom: '2026-10-01' }, { dateTo: '2026-01-01' }, { cabin: 'unknown' },
  { source: 'skypass' }, { limit: 201 }, { minSeats: 0 }, { offset: -1 },
]) {
  test(`invalid query ${JSON.stringify(change)} makes no external request`, async () => {
    const { client, calls } = fixture();
    await assert.rejects(client.search({ ...query(), ...change }), PublicSourceError);
    assert.equal(calls.length, 0);
  });
}

test('deduplicates destination codes without changing the caller object', () => {
  const original = { ...query(), destinations: ['CDG', 'CDG'] };
  assert.deepEqual(validateQuery(original, now()).destinations, ['CDG']);
  assert.deepEqual(original.destinations, ['CDG', 'CDG']);
});

for (const payload of [[], null, { jsonrpc: '2.0', id: 9, result: {} }, { jsonrpc: '2.0', id: 1, error: { message: 'private-error' } }]) {
  test(`rejects bad RPC envelope ${JSON.stringify(payload)}`, async () => {
    const { client, calls } = fixture([new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })]);
    await assert.rejects(client.search(query()), PublicSourceError);
    assert.equal(calls.length, 1);
  });
}

test('rejects HTML without trying a browser', async () => {
  const { client } = fixture([new Response('<html>sign in</html>', { headers: { 'content-type': 'text/html' } })]);
  await assert.rejects(client.search(query()), { code: 'UNEXPECTED_CONTENT_TYPE' });
});
test('does not guess an unsupported tool name', async () => {
  const replies = good(); replies[2] = json(2, { tools: [] });
  const { client, calls } = fixture(replies);
  await assert.rejects(client.search(query()), { code: 'SEARCH_TOOL_UNAVAILABLE' });
  assert.equal(calls.length, 3);
});
test('rejects MCP tool errors without treating them as no seats', async () => {
  const replies = good(); replies[3] = json(3, { isError: true, content: [{ type: 'text', text: 'login needed' }] });
  const { client, calls } = fixture(replies);
  await assert.rejects(client.search(query()), { code: 'PROVIDER_TOOL_ERROR' });
  assert.equal(calls.length, 4);
});
test('rejects oversized responses', async () => {
  const client = new AnonymousAwardClient({ now, maxBytes: 128, fetchImpl: async () => json(1, { protocolVersion: '2025-03-26', large: 'x'.repeat(2000) }) });
  await assert.rejects(client.search(query()), { code: 'RESPONSE_TOO_LARGE' });
});
test('supports split SSE events and ignores protocol notifications', async () => {
  const replies = good();
  const text = 'event: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/ping"}\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26"}}\r\n\r\n';
  replies[0] = new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < text.length; i += 7) controller.enqueue(new TextEncoder().encode(text.slice(i, i + 7)));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
  const { client } = fixture(replies);
  assert.equal((await client.search(query())).authentication, 'none');
});
test('timeout ends a request without another attempt', async () => {
  let calls = 0;
  const keepAlive = setTimeout(() => {}, 1000);
  const client = new AnonymousAwardClient({ now, timeoutMs: 5, fetchImpl: async (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  try { await assert.rejects(client.search(query()), { code: 'NETWORK_OR_TIMEOUT' }); }
  finally { clearTimeout(keepAlive); }
  assert.equal(calls, 1);
});

test('HTTP200 quota text blocks further calls for 24 hours without keys or login', async () => {
  const replies = good();
  replies[3] = json(3, { content: [{ type: 'text', text: '⚠️ Access denied: Free tier limit reached (10/day). Add an API key for higher limits.' }] });
  const { client, calls } = fixture(replies);
  await assert.rejects(client.search(query()), { code: 'PUBLIC_QUERY_LIMIT' });
  await assert.rejects(client.search(query()), { code: 'PUBLIC_QUERY_LIMIT' });
  assert.equal(calls.length, 4);
});

test('HTTP429 blocks subsequent attempts locally', async () => {
  const { client, calls } = fixture([new Response('', { status: 429 })]);
  await assert.rejects(client.search(query()), { status: 429 });
  await assert.rejects(client.search(query()), { code: 'PUBLIC_QUERY_LIMIT' });
  assert.equal(calls.length, 1);
});

test('client options cannot introduce API keys, cookies or alternate endpoints', () => {
  for (const option of ['apiKey', 'cookies', 'endpoint', 'authorization']) {
    assert.throws(() => new AnonymousAwardClient({ [option]: 'not-allowed' }), { code: 'INVALID_CLIENT_OPTIONS' });
  }
});

test('a quota response also stops new requests in already-started concurrent searches', async () => {
  let resolveFirst, resolveSecond, calls = 0;
  const client = new AnonymousAwardClient({ now, fetchImpl: async () => {
    calls++;
    return new Promise((resolve) => { if (calls === 1) resolveFirst = resolve; else resolveSecond = resolve; });
  } });
  const first = client.search(query()).then(() => null, (error) => error);
  const second = client.search(query()).then(() => null, (error) => error);
  resolveFirst(new Response('', { status: 429 }));
  assert.equal((await first).status, 429);
  resolveSecond(json(1, { protocolVersion: '2025-03-26' }));
  assert.equal((await second).code, 'PUBLIC_QUERY_LIMIT');
  assert.equal(calls, 2);
});
