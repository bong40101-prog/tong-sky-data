import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { normalizePublicAwards, PublicSourceError } from './normalize.mjs'

const nowMs = Date.parse('2026-10-31T12:00:00Z')
const policy = { nowMs, maxAgeMs: 12 * 3_600_000 }
const query = { origin: 'ICN', destinations: ['CDG', 'AMS'], dateFrom: '2026-11-01', dateTo: '2027-09-30', cabin: 'J', source: 'flyingblue', directOnly: true }
const row = (change = {}) => ({ id: 'fixture', source: 'flyingblue', origin: 'ICN', destination: 'CDG', date: '2026-12-01', mileage: 85000,
  seats: 9, taxes: null, direct: true, airlines: 'KL, AF, SK', flight_numbers: '', updated_at: '2026-10-31T08:00:00Z', ...change })
const payload = (rows = [row()], change = {}) => ({ count: rows.length, total: rows.length, has_more: false, offset: 0, cabin: 'J', results: rows, ...change })
const mcp = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: { result: JSON.stringify(value) }, isError: false })
const normalize = (value = payload(), q = query, options = policy) => normalizePublicAwards(mcp(value), q, options)
const reject = (value, code) => assert.throws(() => normalizePublicAwards(value, query, policy), (error) => error instanceof PublicSourceError && (!code || error.code === code))

test('normalizes fresh public cache data without claiming airline confirmation', () => {
  const result = normalize()
  assert.equal(result.status, 'fresh')
  assert.equal(result.source, 'public-cache')
  assert.equal(result.inventoryConfirmed, false)
  assert.equal(result.records[0].reportedMiles, 85000)
  assert.equal(result.records[0].reportedSeats, 9)
  assert.equal(result.records[0].reportedTaxes, null)
  assert.deepEqual(result.records[0].reportedAirlines, ['KL', 'AF', 'SK'])
  assert.equal(result.records[0].program, 'flyingblue')
  assert.equal(result.records[0].ageMs, 4 * 3_600_000)
  assert.equal(result.diagnostics.coverage, 'unknown')
})

test('supports full RPC and bare structured/text responses', () => {
  const actual = normalizePublicAwards({ jsonrpc: '2.0', id: 3, result: mcp(payload()) }, query, policy)
  assert.equal(actual.records.length, 1)
  assert.equal(normalizePublicAwards({ structuredContent: { result: payload() } }, query, policy).records.length, 1)
  assert.equal(normalizePublicAwards({ content: mcp(payload()).content }, query, policy).records.length, 1)
})

test('requires structured and text payloads to agree', () => {
  const result = mcp(payload())
  result.content[0].text = JSON.stringify(payload([row({ mileage: 100000 })]))
  reject(result, 'malformed-response')
})

test('accepts different object key order as the same JSON', () => {
  const original = payload()
  const result = mcp(original)
  result.structuredContent.result = JSON.stringify(Object.fromEntries(Object.entries(original).reverse()))
  assert.equal(normalizePublicAwards(result, query, policy).records.length, 1)
})

for (const [title, value] of [
  ['null', null], ['empty object', {}], ['missing records', mcp({ cabin: 'J' })],
  ['null records', mcp({ cabin: 'J', results: null })], ['array payload', { content: [{ type: 'text', text: '[]' }] }],
  ['broken JSON', { content: [{ type: 'text', text: '{broken' }] }],
  ['unknown text', { content: [{ type: 'text', text: 'Login required' }] }],
  ['invalid RPC', { jsonrpc: '1.0', result: mcp(payload()) }],
  ['tool error', { ...mcp(payload()), isError: true }],
  ['RPC error', { jsonrpc: '2.0', id: 3, error: { code: -1, message: 'failed' } }],
  ['award error', mcp({ ...payload(), error: 'denied' })],
  ['malformed errors', mcp({ ...payload(), errors: {} })],
  ['limit error disguised as empty', mcp({ ...payload([]), message: 'limit reached' })],
  ['invalid empty marker', mcp({ ...payload([]), publicNoRecordsMessage: true })],
]) test(`never calls ${title} an empty seat result`, () => reject(value))

test('documented empty text means no public records, never confirmed zero seats', () => {
  const result = normalizePublicAwards({ content: [{ type: 'text', text: 'No award flights found for ICN → CDG,AMS (2026-11-01 to 2027-09-30) in Business cabin.' }] }, query, policy)
  assert.equal(result.status, 'no-public-records')
  assert.equal(result.inventoryConfirmed, false)
  assert.deepEqual(result.records, [])
})

test('unknown no-records wording or a mismatched text response cannot hide an error', () => {
  reject({ content: [{ type: 'text', text: 'No award flights found because login required.' }] }, 'malformed-response')
  reject({ content: [{ type: 'text', text: 'No award flights found for JFK → LHR (2026-11-01 to 2027-09-30) in Business cabin.' }] }, 'filter-mismatch')
})

test('an explicit empty public cache keeps coverage unknown', () => {
  const result = normalize(payload([]))
  assert.equal(result.status, 'no-public-records')
  assert.equal(result.diagnostics.coverage, 'unknown')
})

for (const change of [
  { source: 'skypass' }, { origin: 'JFK' }, { destination: 'LHR' }, { date: '2026-10-31' },
  { date: '2027-10-01' }, { date: '2026-11-31' }, { cabin: 'Y' }, { direct: false },
]) test(`rejects a row outside filters: ${JSON.stringify(change)}`, () => reject(mcp(payload([row(change)])), 'filter-mismatch'))

for (const change of [
  { mileage: -1 }, { mileage: 0.5 }, { mileage: '85000' }, { mileage: Infinity }, { seats: -1 }, { seats: 1.5 },
  { seats: 0 }, { taxes: -1 }, { taxes: '100' }, { taxes_currency: '<b>' }, { airlines: {} }, { flight_numbers: '<script>' },
]) test(`rejects malformed reported values: ${JSON.stringify(change)}`, () => reject(mcp(payload([row(change)])), 'malformed-response'))

test('12-hour boundary is accepted; one millisecond older is stale', () => {
  assert.equal(normalize(payload([row({ updated_at: '2026-10-31T00:00:00Z' })])).status, 'fresh')
  const old = normalize(payload([row({ updated_at: '2026-10-30T23:59:59.999Z' })]))
  assert.equal(old.status, 'stale-data')
  assert.equal(old.records.length, 0)
})

test('timezone offsets represent the same instant', () => {
  const result = normalize(payload([row({ updated_at: '2026-10-31T17:00:00+09:00' })]))
  assert.equal(result.status, 'fresh')
  assert.equal(result.records[0].providerUpdatedAt, '2026-10-31T08:00:00.000Z')
})

for (const updated_at of [undefined, null, '', '2026-10-31T08:00:00', '2026-10-31T13:00:00Z', '2026-02-30T10:00:00Z', '2026-10-31T08:00:00+99:00']) {
  test(`does not publish unverifiable timestamp ${String(updated_at)}`, () => {
    const result = normalize(payload([row({ updated_at })]))
    assert.equal(result.status, 'unverifiable-data')
    assert.equal(result.records.length, 0)
    assert.equal(result.diagnostics.unverifiableCount, 1)
  })
}

test('clearly old timezone-less data is excluded without guessing its zone', () => {
  const result = normalize(payload([row({ updated_at: '2026-08-28T02:20:55.667544' })]))
  assert.equal(result.status, 'stale-data')
  assert.equal(result.records.length, 0)
  assert.equal(result.diagnostics.timezoneUnspecifiedCount, 1)
  assert.equal(result.diagnostics.definitelyStaleCount, 1)
  assert.deepEqual(result.diagnostics.providerUpdatedAtRaw, ['2026-08-28T02:20:55.667544'])
})

test('mixed fresh and historical records only publishes fresh snapshots', () => {
  const result = normalize(payload([row(), row({ id: 'old', updated_at: '2026-08-28T01:00:00Z' })]))
  assert.equal(result.status, 'fresh')
  assert.equal(result.records.length, 1)
  assert.equal(result.diagnostics.excludedCount, 1)
})

test('reported total is diagnostic only and marks incomplete coverage', () => {
  const result = normalize(payload([row()], { total: 233, has_more: true }))
  assert.equal(result.diagnostics.providerReportedTotal, 233)
  assert.equal(result.diagnostics.partial, true)
  assert.equal(result.records.length, 1)
  assert.equal(result.diagnostics.coverage, 'unknown')
})

test('record counts, malformed limits and duplicates cannot silently alter totals', () => {
  reject(mcp(payload([row()], { count: 2 })), 'malformed-response')
  reject(mcp(payload([row()], { total: -1 })), 'malformed-response')
  reject(mcp(payload([row(), row()])), 'malformed-response')
})

test('canonical query and direct provider query syntax both work', () => {
  assert.equal(normalize(payload(), { origin: 'ICN', destination: 'CDG,AMS', date_from: '2026-11-01', date_to: '2027-09-30', cabin: 'J', source: 'flyingblue', direct_only: true }).records.length, 1)
})

test('bad query and invalid freshness policy fail before accepting any data', () => {
  assert.throws(() => normalize(payload(), { ...query, source: 'skypass' }), PublicSourceError)
  assert.throws(() => normalize(payload(), { ...query, dateFrom: '2026-02-30' }), PublicSourceError)
  assert.throws(() => normalize(payload(), query, { nowMs, maxAgeMs: -1 }), PublicSourceError)
})

const proofPath = new URL('./fixtures/anonymous-provider-response.json', import.meta.url)
const originalProof = '/workspace/scratch/8efe7731e698/afd-anonymous-probe.json'
const proofFile = existsSync(proofPath) ? proofPath : originalProof
if (existsSync(proofFile)) test('actual anonymous response from 2026-10-31 cannot become current availability', () => {
  const proof = JSON.parse(readFileSync(proofFile, 'utf8'))
  const result = normalizePublicAwards(proof.response, proof.query, policy)
  assert.equal(result.status, 'stale-data')
  assert.equal(result.records.length, 0)
  assert.equal(result.diagnostics.receivedCount, 10)
  assert.equal(result.diagnostics.definitelyStaleCount, 10)
  assert.equal(result.diagnostics.timezoneUnspecifiedCount, 10)
})

const quotaText = '⚠️ Access denied: Free tier limit reached (10/day). Add an API key for higher limits.'
for (const [label, result] of [
  ['text-only', { content: [{ type: 'text', text: quotaText }], isError: false }],
  ['structured-only', { structuredContent: { result: quotaText }, isError: false }],
  ['both representations', { content: [{ type: 'text', text: quotaText }], structuredContent: { result: quotaText }, isError: false }],
  ['isError true', { content: [{ type: 'text', text: quotaText }], isError: true }],
  ['JSON status message', mcp({ results: [], message: quotaText })],
]) test(`preserves public quota denial (${label}) as a query-limit error`, () => reject(result, 'public-query-limit'))

test('other access denial is a provider error, never empty or a login fallback', () => {
  reject({ content: [{ type: 'text', text: '⚠️ Access denied: anonymous access unavailable.' }], isError: false }, 'provider-error')
})

const savedQuotaProofPath = new URL('./fixtures/anonymous-provider-limit.json', import.meta.url)
const quotaProofPath = existsSync(savedQuotaProofPath) ? savedQuotaProofPath : '/workspace/scratch/8efe7731e698/afd-programmed-raw.json'
if (existsSync(quotaProofPath)) test('actual HTTP200 anonymous response preserves the observed free-tier denial', () => {
  const proof = JSON.parse(readFileSync(quotaProofPath, 'utf8'))
  assert.throws(() => normalizePublicAwards(proof.result, proof.query, policy), (error) => error instanceof PublicSourceError && error.code === 'public-query-limit')
})
