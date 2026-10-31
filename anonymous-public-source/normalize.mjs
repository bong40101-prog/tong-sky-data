/** Strict normalization of public cached award records. It never confirms live inventory. */
export class PublicSourceError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PublicSourceError'
    this.code = code
  }
}

const fail = (code, message) => { throw new PublicSourceError(code, message) }
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const owns = (value, key) => Object.hasOwn(value, key)
const isoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const integer = (value) => Number.isSafeInteger(value) && value >= 0
const canonical = (value) => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item)

const noRecordsText = /^No award flights found for ([A-Z,]+) → ([A-Z,]+) \((\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})\) in (Economy|Premium Economy|Business|First) cabin\.$/
/** A public tool may encode denial as HTTP200/isError:false text. Never parse it as empty data. */
const rejectProviderStatus = (value) => {
  if (typeof value !== 'string') return
  const text = value.trim().replace(/^⚠\uFE0F?\s*/, '')
  if (/^(?:Access denied:\s*)?(?:Free tier limit reached(?:\s*\(\d+\/day\))?|Daily query limit reached|Rate limit exceeded|Too many requests)(?:[.!\s]|$)/i.test(text)) {
    fail('public-query-limit', 'Public source query limit reached')
  }
  if (/^Access denied:/i.test(text)) fail('provider-error', 'Public source denied access')
}

const decodePayload = (value) => {
  if (object(value)) return value
  if (typeof value !== 'string') fail('malformed-response', 'Missing public award payload')
  const text = value.trim()
  rejectProviderStatus(text)
  const emptyMatch = noRecordsText.exec(text)
  if (emptyMatch) return { results: [], publicNoRecordsMessage: { origin: emptyMatch[1], destinations: emptyMatch[2].split(','), dateFrom: emptyMatch[3], dateTo: emptyMatch[4], cabin: { Economy: 'Y', 'Premium Economy': 'W', Business: 'J', First: 'F' }[emptyMatch[5]] } }
  try {
    const parsed = JSON.parse(text)
    if (!object(parsed)) fail('malformed-response', 'Invalid public award payload')
    return parsed
  } catch (error) {
    if (error instanceof PublicSourceError) throw error
    fail('malformed-response', 'Public award payload is not valid JSON')
  }
}

/** Both representations must agree; do not silently prefer one when the provider contradicts itself. */
const unwrap = (message) => {
  if (!object(message)) fail('malformed-response', 'Invalid public MCP response')
  if (message.error != null) fail('provider-error', 'Public source returned an RPC error')
  let result = message
  if (owns(message, 'jsonrpc')) {
    if (message.jsonrpc !== '2.0' || !object(message.result)) fail('malformed-response', 'Invalid public RPC envelope')
    result = message.result
  }
  if (result.isError === true) {
    for (const item of Array.isArray(result.content) ? result.content : []) rejectProviderStatus(item?.text)
    if (object(result.structuredContent)) rejectProviderStatus(result.structuredContent.result)
  }
  if (result.isError === true || result.error != null) fail('provider-error', 'Public source returned a tool error')
  if (owns(result, 'isError') && typeof result.isError !== 'boolean') fail('malformed-response', 'Invalid public tool error flag')
  const candidates = []
  if (owns(result, 'structuredContent')) {
    if (!object(result.structuredContent)) fail('malformed-response', 'Invalid structured public result')
    candidates.push(decodePayload(owns(result.structuredContent, 'result') ? result.structuredContent.result : result.structuredContent))
  }
  if (owns(result, 'content')) {
    if (!Array.isArray(result.content)) fail('malformed-response', 'Invalid public content blocks')
    for (const item of result.content) {
      if (!object(item) || item.type !== 'text' || typeof item.text !== 'string') fail('malformed-response', 'Unsupported public content block')
      candidates.push(decodePayload(item.text))
    }
  }
  if (!candidates.length) fail('malformed-response', 'Missing public award result')
  const first = canonical(candidates[0])
  if (candidates.some((candidate) => canonical(candidate) !== first)) fail('malformed-response', 'Conflicting public result representations')
  return candidates[0]
}

const validateQuery = (query) => {
  if (!object(query)) fail('invalid-query', 'Missing public query')
  const origin = query.origin
  const destinations = query.destinations ?? (typeof query.destination === 'string' ? query.destination.split(',') : undefined)
  const dateFrom = query.dateFrom ?? query.date_from
  const dateTo = query.dateTo ?? query.date_to
  if (typeof origin !== 'string' || !/^[A-Z]{3}$/.test(origin)
    || !Array.isArray(destinations) || !destinations.length || destinations.some((code) => typeof code !== 'string' || !/^[A-Z]{3}$/.test(code))) {
    fail('invalid-query', 'Invalid public query airports')
  }
  if (!isoDate(dateFrom) || !isoDate(dateTo) || dateFrom > dateTo) fail('invalid-query', 'Invalid public query dates')
  if (!['Y', 'W', 'J', 'F'].includes(query.cabin) || (query.source != null && query.source !== 'flyingblue')) fail('invalid-query', 'Invalid public query program or cabin')
  const directOnly = query.directOnly ?? query.direct_only ?? false
  const minSeats = query.minSeats ?? query.min_seats ?? 1
  if (typeof directOnly !== 'boolean' || !Number.isSafeInteger(minSeats) || minSeats < 1 || minSeats > 9) fail('invalid-query', 'Invalid public query seat filters')
  return { origin, destinations, dateFrom, dateTo, cabin: query.cabin, directOnly, minSeats }
}

const timestampInfo = (raw, nowMs, maxAgeMs) => {
  if (raw == null) return { state: 'unverifiable', reason: 'missing-timestamp', timezoneUnspecified: false }
  if (typeof raw !== 'string') fail('malformed-response', 'Invalid provider timestamp type')
  const matched = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?$/.exec(raw)
  if (!matched || !isoDate(matched[1]) || +matched[2] > 23 || +matched[3] > 59 || +matched[4] > 59) return { state: 'unverifiable', reason: 'invalid-timestamp', timezoneUnspecified: false }
  if (!matched[6]) {
    // Without the zone, only classify as definitely stale if every UTC±14h interpretation is old.
    const latestPossibleMs = Date.parse(`${raw}Z`) + 14 * 3_600_000
    return { state: 'unverifiable', reason: 'timestamp-timezone-unspecified', timezoneUnspecified: true,
      dateDefinitelyStale: Number.isFinite(latestPossibleMs) && nowMs - latestPossibleMs > maxAgeMs }
  }
  if (matched[6] !== 'Z') {
    const zone = matched[6].slice(1).split(':').map(Number)
    if (zone[0] > 14 || zone[1] > 59 || (zone[0] === 14 && zone[1] !== 0)) return { state: 'unverifiable', reason: 'invalid-timestamp-zone', timezoneUnspecified: false }
  }
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) return { state: 'unverifiable', reason: 'invalid-timestamp', timezoneUnspecified: false }
  if (ms > nowMs) return { state: 'unverifiable', reason: 'future-provider-timestamp', timezoneUnspecified: false }
  return { state: nowMs - ms <= maxAgeMs ? 'fresh' : 'stale', timezoneUnspecified: false, updatedAt: new Date(ms).toISOString(), ageMs: nowMs - ms }
}

export function normalizePublicAwards(mcpResult, query, { nowMs = Date.now(), maxAgeMs = 12 * 3_600_000 } = {}) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) fail('invalid-query', 'Invalid freshness policy')
  const expected = validateQuery(query)
  const payload = unwrap(mcpResult)
  if (owns(payload, 'errors') && (!Array.isArray(payload.errors) || payload.errors.some((error) => !object(error)))) fail('malformed-response', 'Invalid public award errors')
  rejectProviderStatus(payload.message)
  if (payload.message != null && payload.message !== '') fail('provider-error', 'Public source returned an unexpected status message')
  if (payload.error != null || (Array.isArray(payload.errors) && payload.errors.length)) fail('provider-error', 'Public source returned an award error')
  if (payload.publicNoRecordsMessage) {
    const marker = payload.publicNoRecordsMessage
    if (!object(marker) || !Array.isArray(marker.destinations)) fail('malformed-response', 'Invalid public empty-record marker')
    if (marker.origin !== expected.origin || canonical([...marker.destinations].sort()) !== canonical([...new Set(expected.destinations)].sort())
      || marker.dateFrom !== expected.dateFrom || marker.dateTo !== expected.dateTo || marker.cabin !== expected.cabin) fail('filter-mismatch', 'Public empty-record message has different query filters')
  }
  if (!Array.isArray(payload.results)) fail('malformed-response', 'Missing public award records')
  if (payload.results.length && payload.cabin !== expected.cabin) fail('filter-mismatch', 'Public source returned a different cabin')
  if (payload.cabin != null && payload.cabin !== expected.cabin) fail('filter-mismatch', 'Public source returned a different cabin')
  if (payload.count != null && (!integer(payload.count) || payload.count !== payload.results.length)) fail('malformed-response', 'Public record count mismatch')
  if (payload.total != null && !integer(payload.total)) fail('malformed-response', 'Invalid public reported total')
  if (payload.offset != null && !integer(payload.offset)) fail('malformed-response', 'Invalid public pagination offset')
  if (payload.has_more != null && typeof payload.has_more !== 'boolean') fail('malformed-response', 'Invalid public pagination marker')
  const records = []
  const diagnostics = { receivedCount: payload.results.length, freshCount: 0, staleCount: 0, unverifiableCount: 0,
    definitelyStaleCount: 0, timezoneUnspecifiedCount: 0, providerReportedTotal: payload.total ?? null,
    partial: payload.has_more === true || (payload.offset ?? 0) > 0 || (payload.total ?? 0) > payload.results.length,
    coverage: 'unknown', maxAgeMs, providerUpdatedAtRaw: [], freshnessReasons: {} }
  const seen = new Set()
  for (const row of payload.results) {
    if (!object(row)) fail('malformed-response', 'Invalid public award record')
    if (row.id != null && (typeof row.id !== 'string' || !row.id)) fail('malformed-response', 'Invalid public record identifier')
    if (row.source !== 'flyingblue' || row.origin !== expected.origin || !expected.destinations.includes(row.destination)
      || !isoDate(row.date) || row.date < expected.dateFrom || row.date > expected.dateTo
      || (row.cabin != null && row.cabin !== expected.cabin)) fail('filter-mismatch', 'Public source returned records outside the requested filters')
    if (typeof row.direct !== 'boolean' || (expected.directOnly && !row.direct)) fail('filter-mismatch', 'Public source returned a different routing filter')
    if (!integer(row.mileage) || (row.seats != null && (!integer(row.seats) || row.seats < expected.minSeats))) fail('malformed-response', 'Invalid reported public mileage or seats')
    if (row.taxes != null && (typeof row.taxes !== 'number' || !Number.isFinite(row.taxes) || row.taxes < 0)) fail('malformed-response', 'Invalid reported public taxes')
    if (row.taxes_currency != null && (typeof row.taxes_currency !== 'string' || !/^[A-Z]{3}$/.test(row.taxes_currency))) fail('malformed-response', 'Invalid reported public tax currency')
    if (row.airlines != null && (typeof row.airlines !== 'string' || row.airlines.length > 255 || !/^[A-Z0-9 ,/-]*$/.test(row.airlines))) fail('malformed-response', 'Invalid reported public airlines')
    if (row.flight_numbers != null && (typeof row.flight_numbers !== 'string' || row.flight_numbers.length > 255 || !/^[A-Z0-9 ,/-]*$/.test(row.flight_numbers))) fail('malformed-response', 'Invalid reported public flight numbers')
    const freshness = timestampInfo(row.updated_at, nowMs, maxAgeMs)
    if (row.updated_at != null) diagnostics.providerUpdatedAtRaw.push(row.updated_at)
    if (freshness.timezoneUnspecified) diagnostics.timezoneUnspecifiedCount++
    if (freshness.dateDefinitelyStale || freshness.state === 'stale') diagnostics.definitelyStaleCount++
    if (freshness.state === 'fresh') diagnostics.freshCount++
    else {
      if (freshness.state === 'stale') diagnostics.staleCount++
      else diagnostics.unverifiableCount++
      const reason = freshness.reason ?? 'older-than-policy'
      diagnostics.freshnessReasons[reason] = (diagnostics.freshnessReasons[reason] ?? 0) + 1
      continue
    }
    const key = `${row.origin}|${row.destination}|${row.date}|${expected.cabin}|${row.id ?? ''}`
    if (seen.has(key)) fail('malformed-response', 'Duplicate public award record')
    seen.add(key)
    records.push({ source: 'public-cache', program: 'flyingblue', origin: row.origin, destination: row.destination,
      date: row.date, cabin: expected.cabin, reportedMiles: row.mileage, reportedSeats: row.seats ?? null,
      reportedTaxes: row.taxes ?? null, reportedTaxCurrency: row.taxes_currency ?? null, direct: row.direct,
      reportedAirlines: typeof row.airlines === 'string' ? [...new Set(row.airlines.split(/[\s,]+/).filter(Boolean))] : [],
      reportedFlightNumbers: typeof row.flight_numbers === 'string' ? row.flight_numbers.split(/[\s,]+/).filter(Boolean) : [],
      providerUpdatedAtRaw: row.updated_at, providerUpdatedAt: freshness.updatedAt, ageMs: freshness.ageMs,
      timezoneUnspecified: false, inventoryConfirmed: false })
  }
  diagnostics.providerUpdatedAtRaw = [...new Set(diagnostics.providerUpdatedAtRaw)]
  diagnostics.excludedCount = diagnostics.receivedCount - records.length
  const status = records.length ? 'fresh' : !payload.results.length ? 'no-public-records'
    : diagnostics.definitelyStaleCount === diagnostics.receivedCount ? 'stale-data' : 'unverifiable-data'
  return { status, source: 'public-cache', program: 'flyingblue', inventoryConfirmed: false, records, diagnostics }
}
