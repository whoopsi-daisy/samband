/**
 * @jest-environment node
 */
import {
  classifyFetchError,
  isUnclassified,
  UNCLASSIFIED,
  FETCH_ERROR_CLASSES,
} from '@/lib/fetchErrors';

describe('classifyFetchError', () => {
  it('has nothing to say about a success', () => {
    expect(classifyFetchError(null)).toBeNull();
    expect(classifyFetchError(undefined)).toBeNull();
    expect(classifyFetchError('')).toBeNull();
  });

  it.each([
    ['fetch failed: ETIMEDOUT', 'Tidsgräns'],
    ['The operation was aborted', 'Tidsgräns'],
    ['connect ECONNREFUSED 127.0.0.1:443', 'Nekad anslutning'],
    ['getaddrinfo ENOTFOUND polisen.se', 'DNS-fel'],
    ['getaddrinfo EAI_AGAIN polisen.se', 'DNS-fel'],
    ['read ECONNRESET', 'Bruten anslutning'],
    ['socket hang up', 'Bruten anslutning'],
    ['HTTP error 429', 'Nedstrypt'],
    ['Too Many Requests', 'Nedstrypt'],
    ['HTTP error 500', 'Serverfel'],
    ['HTTP error 503', 'Serverfel'],
    ['HTTP error 404', 'Hittas inte'],
    ['HTTP error 403', 'Nekad'],
    ['HTTP error 401', 'Nekad'],
    ['Invalid JSON response', 'Ogiltigt svar'],
  ])('reads %s as %s', (message, expected) => {
    expect(classifyFetchError(message)).toBe(expected);
  });

  // The 503-as-"Other Error" bug the SQL version had, because it tested for the
  // literal '500'.
  it('recognises the whole 5xx range, not just 500', () => {
    for (const status of [500, 502, 503, 504, 521]) {
      expect(classifyFetchError(`HTTP error ${status}`)).toBe('Serverfel');
    }
  });

  /**
   * The point of the whole change. Anything the rules do not recognise used to
   * be folded into one anonymous bucket, so a brand-new kind of failure looked
   * exactly like more of an old one — and an error log exists precisely to make
   * "this has not happened before" visible.
   */
  it('names an unrecognised failure as unrecognised', () => {
    expect(classifyFetchError('the flux capacitor is de-energised')).toBe(UNCLASSIFIED);
    expect(isUnclassified(classifyFetchError('something entirely new'))).toBe(true);
  });

  it('does not call a recognised failure unrecognised', () => {
    expect(isUnclassified(classifyFetchError('HTTP error 500'))).toBe(false);
  });

  // A message can match several rules; the one you would act on should win.
  it('prefers the timeout when a slow response also carried a status', () => {
    expect(classifyFetchError('HTTP error 503 after ETIMEDOUT')).toBe('Tidsgräns');
  });

  it('only ever returns a declared class', () => {
    const samples = [
      'ETIMEDOUT',
      'HTTP error 404',
      'nonsense',
      'ECONNRESET',
      'Invalid JSON response',
    ];
    for (const sample of samples) {
      expect(FETCH_ERROR_CLASSES).toContain(classifyFetchError(sample));
    }
  });

  // Status codes are matched on word boundaries, so an id that happens to
  // contain the digits is not a server error.
  it('does not read a stray number in a URL as a status', () => {
    expect(classifyFetchError('could not reach /aktuellt/500123/')).toBe(UNCLASSIFIED);
  });
});
