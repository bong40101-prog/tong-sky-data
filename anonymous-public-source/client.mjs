const ENDPOINT = 'https://www.awardflightdaily.com/mcp-server/mcp';
const PROTOCOL = '2025-03-26';
const SEARCH_TOOL = 'afd_search_award_flights';

export class PublicSourceError extends Error {
  constructor(code, status) {
    super(`Public award source: ${code}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'PublicSourceError';
    this.code = code;
    if (status) this.status = status;
  }
}

const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const date = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export function validateQuery(query, nowMs = Date.now()) {
  if (!record(query) || !Number.isFinite(nowMs)) throw new PublicSourceError('INVALID_QUERY');
  if (Object.keys(query).some((k) => /password|cookie|token|api.?key|authorization|member|profile|login/i.test(k))) {
    throw new PublicSourceError('CREDENTIALS_NOT_ALLOWED');
  }
  if (typeof query.origin !== 'string' || !/^[A-Z]{3}$/.test(query.origin)) throw new PublicSourceError('INVALID_ORIGIN');
  if (!Array.isArray(query.destinations) || !query.destinations.length || query.destinations.length > 12
    || query.destinations.some((v) => typeof v !== 'string' || !/^[A-Z]{3}$/.test(v) || v === query.origin)) {
    throw new PublicSourceError('INVALID_DESTINATIONS');
  }
  if (!date(query.dateFrom) || !date(query.dateTo) || query.dateFrom > query.dateTo
    || query.dateFrom < new Date(nowMs).toISOString().slice(0, 10)) throw new PublicSourceError('INVALID_DATES');
  if (!['Y', 'W', 'J', 'F'].includes(query.cabin ?? 'J')) throw new PublicSourceError('INVALID_CABIN');
  if (query.source != null && query.source !== 'flyingblue') throw new PublicSourceError('INVALID_PROGRAM');
  if (query.directOnly != null && typeof query.directOnly !== 'boolean') throw new PublicSourceError('INVALID_DIRECT_FILTER');
  for (const [name, value, min, max] of [
    ['limit', query.limit ?? 200, 1, 200], ['minSeats', query.minSeats ?? 1, 1, 9], ['offset', query.offset ?? 0, 0, 100000],
  ]) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new PublicSourceError(`INVALID_${name.toUpperCase()}`);
  }
  return {
    origin: query.origin, destinations: [...new Set(query.destinations)], dateFrom: query.dateFrom, dateTo: query.dateTo,
    cabin: query.cabin ?? 'J', source: 'flyingblue', directOnly: query.directOnly ?? true,
    limit: query.limit ?? 200, minSeats: query.minSeats ?? 1, offset: query.offset ?? 0,
  };
}

function decodeRpc(text, id) {
  let value;
  try { value = JSON.parse(text); } catch { throw new PublicSourceError('INVALID_JSON'); }
  if (!record(value) || value.jsonrpc !== '2.0' || value.id !== id) throw new PublicSourceError('INVALID_RPC_ENVELOPE');
  if (Object.hasOwn(value, 'error')) throw new PublicSourceError('RPC_ERROR');
  if (!record(value.result)) throw new PublicSourceError('MISSING_RPC_RESULT');
  return value.result;
}

async function readRpc(response, id, maxBytes) {
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('application/json') && !type.includes('text/event-stream')) throw new PublicSourceError('UNEXPECTED_CONTENT_TYPE');
  if (!response.body) throw new PublicSourceError('MISSING_BODY');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, buffer = '';
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) throw new PublicSourceError('RESPONSE_TOO_LARGE');
      buffer += decoder.decode(part.value, { stream: true });
      if (!type.includes('text/event-stream')) continue;
      buffer = buffer.replace(/\r\n/g, '\n');
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n');
        if (!data) continue;
        let item;
        try { item = JSON.parse(data); } catch { throw new PublicSourceError('INVALID_JSON'); }
        if (record(item) && item.jsonrpc === '2.0' && !Object.hasOwn(item, 'id')) continue;
        return decodeRpc(data, id);
      }
    }
    buffer += decoder.decode();
    if (type.includes('text/event-stream')) throw new PublicSourceError('INCOMPLETE_EVENT_STREAM');
    return decodeRpc(buffer, id);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** A public cache client. It cannot read a browser profile, log in, or accept member credentials. */
export class AnonymousAwardClient {
  constructor(options = {}) {
    if (!record(options) || Object.keys(options).some((key) => !['fetchImpl', 'timeoutMs', 'maxBytes', 'now'].includes(key))) throw new PublicSourceError('INVALID_CLIENT_OPTIONS');
    const { fetchImpl = globalThis.fetch, timeoutMs = 15000, maxBytes = 524288, now = Date.now } = options;
    if (typeof fetchImpl !== 'function' || typeof now !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1
      || timeoutMs > 30000 || !Number.isSafeInteger(maxBytes) || maxBytes < 128 || maxBytes > 2097152) {
      throw new PublicSourceError('INVALID_CLIENT_OPTIONS');
    }
    this.blockedUntil = 0;
    this.blockCode = undefined;
    this.fetch = fetchImpl; this.timeoutMs = timeoutMs; this.maxBytes = maxBytes; this.now = now;
  }

  async search(query) {
    if (this.blockedUntil > this.now()) throw new PublicSourceError(this.blockCode);
    const validated = validateQuery(query, this.now());
    const trace = [];
    let session;
    const rpc = async (method, params, id) => {
      if (this.blockedUntil > this.now()) throw new PublicSourceError(this.blockCode);
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
      if (session) { headers['Mcp-Session-Id'] = session; headers['MCP-Protocol-Version'] = PROTOCOL; }
      let response;
      try {
        response = await this.fetch(ENDPOINT, {
          method: 'POST', headers, credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs),
          body: JSON.stringify({ jsonrpc: '2.0', ...(id == null ? {} : { id }), method, ...(params ? { params } : {}) }),
        });
      } catch {
        throw new PublicSourceError('NETWORK_OR_TIMEOUT');
      }
      trace.push({ method, status: response.status, authentication: 'none', memberCookies: false });
      if (response.status < 200 || response.status >= 300) {
        if ([401, 403, 429].includes(response.status)) {
          this.blockedUntil = this.now() + 24 * 3600000;
          this.blockCode = response.status === 429 ? 'PUBLIC_QUERY_LIMIT' : 'PUBLIC_ACCESS_DENIED';
        }
        await response.body?.cancel().catch(() => {});
        throw new PublicSourceError(response.status >= 300 && response.status < 400 ? 'REDIRECT_REJECTED' : 'HTTP_ERROR', response.status);
      }
      const candidate = response.headers.get('mcp-session-id');
      if (candidate) {
        if (candidate.length > 512 || !/^[\x21-\x7e]+$/.test(candidate)) throw new PublicSourceError('INVALID_PROTOCOL_SESSION');
        session = candidate; // Anonymous MCP transport identifier; never a cookie or airline member session.
      }
      if (id == null) { await response.body?.cancel().catch(() => {}); return undefined; }
      try {
        const parsed = await readRpc(response, id, this.maxBytes);
        const texts = [parsed.structuredContent?.result, ...(parsed.content ?? []).filter((item) => item?.type === 'text').map((item) => item.text)].filter((text) => typeof text === 'string');
        if (texts.some((text) => /free tier limit reached|daily.*limit.*(?:reached|exceeded)|too many requests/i.test(text))) {
          this.blockedUntil = this.now() + 24 * 3600000; this.blockCode = 'PUBLIC_QUERY_LIMIT';
          throw new PublicSourceError('PUBLIC_QUERY_LIMIT');
        }
        if (parsed.isError) throw new PublicSourceError('PROVIDER_TOOL_ERROR');
        return parsed;
      }
      catch (error) {
        if (error instanceof PublicSourceError) throw error;
        throw new PublicSourceError('RESPONSE_READ_FAILED');
      }
    };

    const initialized = await rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'TongSKY-public-reader', version: '0.1.0' } }, 1);
    if (initialized.protocolVersion !== PROTOCOL) throw new PublicSourceError('UNSUPPORTED_PROTOCOL');
    await rpc('notifications/initialized');
    const list = await rpc('tools/list', {}, 2);
    if (!Array.isArray(list.tools) || !list.tools.some((tool) => record(tool) && tool.name === SEARCH_TOOL)) {
      throw new PublicSourceError('SEARCH_TOOL_UNAVAILABLE');
    }
    const result = await rpc('tools/call', { name: SEARCH_TOOL, arguments: { params: {
      origin: validated.origin, destination: validated.destinations.join(','), date_from: validated.dateFrom, date_to: validated.dateTo,
      cabin: validated.cabin, source: 'flyingblue', direct_only: validated.directOnly, min_seats: validated.minSeats,
      limit: validated.limit, offset: validated.offset, response_format: 'json',
    } } }, 3);
    return { provider: 'award-flight-daily', authentication: 'none', query: validated, fetchedAt: new Date(this.now()).toISOString(), result, trace };
  }
}
