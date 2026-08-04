import { VmaAlert, VmaSeverity } from '@/types';

/**
 * Viktigt meddelande till allmänheten, from Sveriges Radio's VMA API.
 *
 * https://vmaapi.sr.se/index.html
 *
 * A VMA is the alert broadcast over radio and phones when there is an
 * immediate danger to life, health or property: a gas leak, a large fire, a
 * missing person in cold water. Sveriges Radio publishes them over an open API
 * in CAP, the Common Alerting Protocol, which is also what the sirens and the
 * broadcast systems run on.
 *
 * Fetched on the server rather than from the browser. That keeps the site's
 * connect-src closed, lets one request serve every visitor, and means an
 * outage at SR is a quiet empty state here rather than a console error in
 * everyone's browser.
 */

const DEFAULT_BASE = 'https://vmaapi.sr.se/api/v3';

/**
 * Overridable, which is how this gets exercised without waiting for a real
 * emergency: SR publishes the same shapes under /testapi/v3, so setting the
 * base to that reaches /testapi/v3/alerts and the page fills with test
 * warnings.
 *
 * Note that SR's other development endpoint, /testapi/v3/examples/data, is not
 * reachable this way: everything here appends /alerts to the base.
 */
export function vmaBaseUrl(): string {
  return (process.env.VMA_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
}

// A VMA is time-critical, so this is short. It still means one request per
// minute to SR no matter how many people are reading.
const VMA_CACHE_TTL_MS = 60_000;
const VMA_TIMEOUT_MS = 6_000;

const USER_AGENT = 'Sambandscentralen/1.0 (+https://samband.unicast.space)';

/**
 * CAP is specified with PascalCase element names, and different serialisations
 * of it disagree about whether that survives into JSON: SR has shipped both
 * `Identifier` and `identifier` across API versions. Every read goes through
 * here so the shape of the response cannot break the page over a capital.
 */
function field(source: unknown, ...names: string[]): unknown {
  if (!source || typeof source !== 'object') return undefined;
  const record = source as Record<string, unknown>;
  for (const name of names) {
    for (const key of Object.keys(record)) {
      if (key.toLowerCase() === name.toLowerCase()) {
        const value = record[key];
        if (value !== undefined && value !== null) return value;
      }
    }
  }
  return undefined;
}

function text(source: unknown, ...names: string[]): string {
  const value = field(source, ...names);
  return typeof value === 'string' ? value.trim() : '';
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

const SEVERITIES: VmaSeverity[] = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];

function severityOf(value: string): VmaSeverity {
  const match = SEVERITIES.find((s) => s.toLowerCase() === value.toLowerCase());
  return match ?? 'Unknown';
}

/**
 * Which `info` block to show.
 *
 * CAP repeats the whole message once per language. Swedish is what this site is
 * in; the first block is the fallback, since a message with only English is
 * better than no message.
 */
function swedishInfo(infos: unknown[]): unknown {
  const swedish = infos.find((info) => text(info, 'language').toLowerCase().startsWith('sv'));
  return swedish ?? infos[0];
}

export function normaliseAlert(raw: unknown): VmaAlert | null {
  const identifier = text(raw, 'identifier');
  if (!identifier) return null;

  const infos = list(field(raw, 'info'));
  const info = swedishInfo(infos);

  const areas = list(field(info, 'area'))
    .map((area) => text(area, 'areaDesc', 'areaDescription', 'description'))
    .filter(Boolean);

  const expires = text(info, 'expires') || text(raw, 'expires');
  const sent = text(raw, 'sent') || text(info, 'effective') || new Date().toISOString();

  const msgType = text(raw, 'msgType', 'messageType') || 'Alert';
  const status = text(raw, 'status') || 'Actual';

  // Every message about one announcement carries the same SRVMA- incident id,
  // while each message has its own SRCAP- identifier. That is what ties an
  // Alert to the Cancel that ends it.
  const incidents = list(field(raw, 'incidents'))
    .map((incident) => (typeof incident === 'string' ? incident.trim() : ''))
    .filter(Boolean);

  return {
    id: identifier,
    incidents,
    sent,
    status,
    msgType,
    scope: text(raw, 'scope') || 'Public',
    // CAP's `event` is the one-line name of what is happening, and SR's schema
    // has no `headline` at all, so `event` is the title here. `headline` is
    // still read for the versions and translations that do carry one.
    event: text(info, 'event'),
    headline: text(info, 'headline'),
    description: text(info, 'description'),
    instruction: text(info, 'instruction'),
    severity: severityOf(text(info, 'severity')),
    urgency: text(info, 'urgency'),
    certainty: text(info, 'certainty'),
    senderName: text(info, 'senderName') || text(raw, 'sender'),
    areas,
    web: text(info, 'web'),
    expires: expires || null,
  };
}

/**
 * Whether an alert is something to warn a reader about right now.
 *
 * Four things disqualify one, and all four matter:
 *
 * - Anything but `Actual`. SR sends `Exercise` over the same endpoint for the
 *   quarterly siren test, and `Test` for system checks. A drill rendered as a
 *   live emergency is the worst thing this feature could do.
 * - Anything but `Public` scope.
 * - `Cancel`, which is the message that ends an announcement.
 * - An `expires` in the past. Not every announcement is cancelled promptly.
 */
export function isLiveAlert(alert: VmaAlert, now = Date.now()): boolean {
  if (alert.status.toLowerCase() !== 'actual') return false;
  if (alert.scope.toLowerCase() !== 'public') return false;
  if (alert.msgType.toLowerCase() === 'cancel') return false;
  if (alert.expires) {
    const expiresAt = new Date(alert.expires).getTime();
    if (!isNaN(expiresAt) && expiresAt <= now) return false;
  }
  return true;
}

/**
 * One message per announcement: the most recent one.
 *
 * An announcement is at least two alerts, an initial `Alert` and a `Cancel`
 * when it is over, and they share an SRVMA- incident identifier while each
 * carries its own SRCAP- one. Left alone the feed therefore shows the warning
 * and its own cancellation side by side, both looking current.
 *
 * Grouping on the incident and keeping the newest is what makes a `Cancel`
 * actually cancel: the announcement stays in the list, but as the cancellation,
 * which `isLiveAlert` then rejects.
 */
export function latestPerIncident(alerts: VmaAlert[]): VmaAlert[] {
  const newest = new Map<string, VmaAlert>();
  const ungrouped: VmaAlert[] = [];

  for (const alert of alerts) {
    // No incident id is not expected, but a message without one must not be
    // silently dropped: it is still something SR published.
    if (alert.incidents.length === 0) {
      ungrouped.push(alert);
      continue;
    }

    for (const incident of alert.incidents) {
      const held = newest.get(incident);
      if (!held || new Date(alert.sent).getTime() >= new Date(held.sent).getTime()) {
        newest.set(incident, alert);
      }
    }
  }

  // A message can list several incidents, so dedupe on the CAP identifier.
  const seen = new Set<string>();
  return [...newest.values(), ...ungrouped].filter((alert) => {
    if (seen.has(alert.id)) return false;
    seen.add(alert.id);
    return true;
  });
}

async function requestAlerts(path: string): Promise<unknown[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VMA_TIMEOUT_MS);

  try {
    const response = await fetch(`${vmaBaseUrl()}${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`VMA API returned ${response.status}`);

    const body = await response.json();
    // The endpoint has been documented as both a bare array and an object with
    // the array under `alerts`, so accept either rather than depending on it.
    if (Array.isArray(body)) return body;
    const alerts = field(body, 'alerts', 'items', 'data');
    return Array.isArray(alerts) ? alerts : [];
  } finally {
    clearTimeout(timeout);
  }
}

async function loadAlerts(): Promise<VmaAlert[]> {
  const raw = await requestAlerts('/alerts');
  const alerts = raw
    .map(normaliseAlert)
    .filter((alert): alert is VmaAlert => alert !== null);

  return latestPerIncident(alerts).sort(
    (a, b) => new Date(b.sent).getTime() - new Date(a.sent).getTime()
  );
}

export interface VmaResult {
  alerts: VmaAlert[];
  failed: boolean;
}

/**
 * How long a failure is held.
 *
 * A success is worth a minute: the answer is unlikely to have changed and SR
 * should not be asked more often than that. A *failure* is not an answer at all,
 * and caching it for the same minute was the bug: one refused connection or one
 * slow response pinned "vi vet inte just nu" in front of every reader for sixty
 * seconds, and the browser polls on the same minute, so a warning could arrive
 * as much as two minutes after SR had recovered.
 *
 * Long enough that a hard outage is not retried on every single request, short
 * enough that a blip costs a few seconds. On the one feature here whose whole
 * justification is immediacy, that is the trade worth making.
 */
const VMA_FAILURE_TTL_MS = 5_000;

interface CacheEntry {
  storedAt: number;
  ttlMs: number;
  value: VmaResult;
}

let cached: CacheEntry | null = null;
/** The request currently in flight, so concurrent readers share one call. */
let inFlight: Promise<VmaResult> | null = null;

async function loadWithFallback(): Promise<VmaResult> {
  try {
    const value: VmaResult = { alerts: await loadAlerts(), failed: false };
    cached = { storedAt: Date.now(), ttlMs: VMA_CACHE_TTL_MS, value };
    return value;
  } catch (error) {
    console.error('[vma] could not reach the VMA API:', error);
    const value: VmaResult = { alerts: [], failed: true };
    cached = { storedAt: Date.now(), ttlMs: VMA_FAILURE_TTL_MS, value };
    return value;
  }
}

/**
 * Every alert the API currently returns, cancellations and tests included.
 *
 * Returns an empty list rather than throwing when SR is unreachable: a warning
 * service that takes the site down with it when it has an outage is worse than
 * one that quietly says it has nothing. The `failed` flag is what lets the page
 * tell "there is no warning" apart from "we could not ask", which are very
 * different things to put in front of someone.
 */
export function getVmaAlerts(): Promise<VmaResult> {
  const now = Date.now();
  if (cached && now - cached.storedAt < cached.ttlMs) {
    return Promise.resolve(cached.value);
  }
  // Whoever got here first is already asking; everyone else takes their answer
  // rather than opening a second connection to SR.
  if (inFlight) return inFlight;

  const run = loadWithFallback();
  inFlight = run;
  void run.finally(() => {
    if (inFlight === run) inFlight = null;
  });
  return run;
}

/** Drop the cached answer. For tests, and for an explicit refresh. */
getVmaAlerts.invalidate = (): void => {
  cached = null;
};

/** Only the ones a reader should be warned about right now. */
export function liveAlerts(alerts: VmaAlert[], now = Date.now()): VmaAlert[] {
  return alerts.filter((alert) => isLiveAlert(alert, now));
}
