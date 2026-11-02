// Decision snapshots only. Airline observations and collection clocks are never rewritten.
export const REPEAT_HISTORY_KEY = 'tongsky.repeat-marker-history.v2';
export const REPEAT_HISTORY_LIMIT = 2000;
const MAX_BYTES = 3 * 1024 * 1024;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AIRPORT = /^[A-Z]{3}$/;
const validDate = value => typeof value === 'string' && DATE.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const clock = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : null;
const boundedLimit = value => Number.isInteger(value) ? Math.max(0, Math.min(value, REPEAT_HISTORY_LIMIT)) : REPEAT_HISTORY_LIMIT;

function normalizeEvent(value) {
  if (!value || value.carrier !== 'KE' || !AIRPORT.test(value.origin ?? '') || !AIRPORT.test(value.destination ?? '') || value.origin === value.destination || !validDate(value.month + '-01') || !Number.isInteger(value.weekday) || value.weekday < 0 || value.weekday > 6 || !['EXCLUDED', 'REVIEW'].includes(value.kind)) return null;
  const dates = Array.isArray(value.dates) ? [...new Set(value.dates)].filter(date => validDate(date) && date.slice(0, 7) === value.month && new Date(date + 'T00:00:00Z').getUTCDay() === value.weekday).sort() : [];
  if (!dates.length || dates.length > 5 || dates.length !== value.dates.length) return null;
  const matchedDates = value.kind === 'EXCLUDED' ? [...dates] : Array.isArray(value.matchedDates) ? [...new Set(value.matchedDates)].filter(date => dates.includes(date)).sort() : [];
  const hasReference=value.source==='USER_REFERENCE_MONTH_TRIPLET_V3'&&validDate(value.referenceMonth+'-01')&&value.referenceMonth!==value.month&&['JANUARY_FOR_DECEMBER','PREVIOUS_COMPLETE_MONTH'].includes(value.referenceMode);
  const checkDates = hasReference&&Array.isArray(value.checkDates)?[...new Set(value.checkDates)].filter(date=>dates.includes(date)).sort():dates.filter(date => !matchedDates.includes(date));
  if (value.kind === 'REVIEW' && ((!matchedDates.length&&!hasReference) || !checkDates.length)) return null;
  const issues = Array.isArray(value.issues) ? value.issues.filter(issue => issue && checkDates.includes(issue.date) && typeof issue.reason === 'string').map(issue => ({ date: issue.date, reason: issue.reason.slice(0, 160) })).sort((a, b) => a.date.localeCompare(b.date) || a.reason.localeCompare(b.reason)) : [];
  return {
    carrier: 'KE', origin: value.origin, destination: value.destination,
    month: value.month, weekday: value.weekday, kind: value.kind,
    dates, matchedDates, checkDates, issues,
    collectedAt: clock(value.collectedAt), sourceUpdatedAt: clock(value.sourceUpdatedAt),
    success: Number.isFinite(value.success) && value.success >= 0 ? value.success : null,
    source: typeof value.source === 'string' ? value.source.slice(0, 80) : '',
    scope: ['EUROPE', 'US','AMERICAS','OCEANIA','ALL_ROUTES'].includes(value.scope) ? value.scope : null,
    ...(hasReference?{referenceMode:value.referenceMode,referenceMonth:value.referenceMonth,referenceStatus:['COMPLETE','INCOMPLETE','MISSING'].includes(value.referenceStatus)?value.referenceStatus:'MISSING',referenceDates:Array.isArray(value.referenceDates)?[...new Set(value.referenceDates)].filter(date=>validDate(date)&&date.slice(0,7)===value.referenceMonth&&new Date(date+'T00:00:00Z').getUTCDay()===value.weekday).sort().slice(0,5):[],referenceSuccess:Number.isFinite(value.referenceSuccess)&&value.referenceSuccess>=0?value.referenceSuccess:null}:{})
  };
}

export function collectRepeatHistory(records) {
  const events = [];
  for (const record of Array.isArray(records) ? records : []) {
    const policy = record?.repeatMarkerPolicy;
    if (!policy) continue;
    const base = {
      carrier: record.carrier, origin: record.origin, destination: record.destination,
      month: record.month, collectedAt: record.collectedAt,
      sourceUpdatedAt: record.sourceUpdatedAt, success: record.success,
      source: policy.source, scope: policy.scope
    };
    for (const [kind, entries] of [['EXCLUDED', policy.evidence], ['REVIEW', policy.reviews]]) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        const event = normalizeEvent({ ...base, ...entry, kind });
        if (event) events.push(event);
      }
    }
  }
  return mergeRepeatHistory([], events);
}

export function mergeRepeatHistory(previous, currentEvents, limit = REPEAT_HISTORY_LIMIT) {
  const unique = new Map();
  for (const event of [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(currentEvents) ? currentEvents : [])]) {
    const normalized = normalizeEvent(event);
    if (normalized) unique.set(JSON.stringify(normalized), normalized);
  }
  const count = boundedLimit(limit);
  if (!count) return [];
  const observedTime = event => event.success ?? (Date.parse(event.collectedAt ?? '') || 0);
  return [...unique.values()].sort((a, b) => observedTime(a) - observedTime(b) || JSON.stringify(a).localeCompare(JSON.stringify(b))).slice(-count);
}

export function readRepeatHistory(storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target || typeof target.getItem !== 'function') return [];
    if (typeof target.removeItem === 'function') target.removeItem('tongsky.repeat-marker-history.v1');
    const raw = target.getItem(REPEAT_HISTORY_KEY);
    if (typeof raw !== 'string' || raw.length > MAX_BYTES) return [];
    const document = JSON.parse(raw);
    return document?.schema === 1 && Array.isArray(document.events) ? mergeRepeatHistory([], document.events) : [];
  } catch {
    return [];
  }
}

export function serializeRepeatHistory(events) {
  return JSON.stringify({ schema: 1, scope: 'browser-local', notice: '이 브라우저에서 확인한 대한항공 비운항·확인필요 판정 기록입니다. 시각은 원본 수집 기준이며, 원본 달력의 세 표식 반복과 기록된 참고월을 판정에 사용합니다. 공동운항 있을 수 있음.', events: mergeRepeatHistory([], events) }, null, 2);
}

export function writeRepeatHistory(events, storage) {
  const normalized = mergeRepeatHistory([], events);
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target || typeof target.setItem !== 'function') return { saved: false, events: normalized, error: 'STORAGE_UNAVAILABLE' };
    const serialized = serializeRepeatHistory(normalized);
    if (serialized.length > MAX_BYTES) return { saved: false, events: normalized, error: 'HISTORY_TOO_LARGE' };
    target.setItem(REPEAT_HISTORY_KEY, serialized);
    return { saved: true, events: normalized };
  } catch (error) {
    return { saved: false, events: normalized, error: error?.name ?? 'STORAGE_UNAVAILABLE' };
  }
}
