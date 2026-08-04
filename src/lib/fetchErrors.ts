/**
 * What kind of failure a fetch was, decided once when it happens.
 *
 * This lived in SQL, as a CASE over `error_message LIKE '%...%'` evaluated
 * every time the dashboard was opened. Two things were wrong with that. The
 * cheap one: the same classification ran on every page view instead of once
 * per failure. The one that mattered: anything the patterns did not recognise
 * collapsed into a single "Fel" bucket, silently, so the arrival of a *new*
 * kind of failure looked exactly like more of the old kind. The one signal an
 * operator most needs out of an error log is "something is happening that has
 * not happened before", and it was the one signal the design threw away.
 *
 * Classifying at write time fixes both. The class is stored beside the message,
 * so the read path is a column rather than nine LIKE scans, and an unrecognised
 * message is *named* as unrecognised rather than folded in with the rest.
 */

/** The classes an operator can act on, in Swedish, as the dashboard shows them. */
export const FETCH_ERROR_CLASSES = [
  'Tidsgräns',
  'Nekad anslutning',
  'DNS-fel',
  'Bruten anslutning',
  'Nedstrypt',
  'Serverfel',
  'Hittas inte',
  'Nekad',
  'Ogiltigt svar',
  'Okänt fel',
] as const;

export type FetchErrorClass = (typeof FETCH_ERROR_CLASSES)[number];

/**
 * The bucket for a message no rule below matched.
 *
 * Deliberately not "Fel". A message that reached here is one this code has
 * never been taught to read, which is a different and more interesting fact
 * than "a fetch failed", and the dashboard is meant to show it as such.
 */
export const UNCLASSIFIED: FetchErrorClass = 'Okänt fel';

/**
 * Ordered, because several can match one message: a 503 that also timed out
 * should read as a timeout, since that is the part you would act on.
 */
const RULES: Array<{ test: RegExp; label: FetchErrorClass }> = [
  { test: /timeout|ETIMEDOUT|aborted|AbortError/i, label: 'Tidsgräns' },
  { test: /ECONNREFUSED/i, label: 'Nekad anslutning' },
  { test: /ENOTFOUND|EAI_AGAIN|getaddrinfo/i, label: 'DNS-fel' },
  { test: /ECONNRESET|socket hang up|EPIPE/i, label: 'Bruten anslutning' },
  { test: /\b429\b|rate limit|too many requests/i, label: 'Nedstrypt' },
  { test: /\b5\d{2}\b/, label: 'Serverfel' },
  { test: /\b404\b/, label: 'Hittas inte' },
  { test: /\b40[13]\b/, label: 'Nekad' },
  { test: /invalid json|unexpected token|malformed/i, label: 'Ogiltigt svar' },
];

/**
 * Which class a failure message belongs to.
 *
 * Returns null for no message at all, which is not the same as an unrecognised
 * one: a success carries no message, and only failures are classified.
 */
export function classifyFetchError(message: string | null | undefined): FetchErrorClass | null {
  if (!message) return null;
  for (const rule of RULES) {
    if (rule.test.test(message)) return rule.label;
  }
  return UNCLASSIFIED;
}

/** Whether a class is the "we have not seen this before" one. */
export function isUnclassified(label: string | null | undefined): boolean {
  return label === UNCLASSIFIED;
}
