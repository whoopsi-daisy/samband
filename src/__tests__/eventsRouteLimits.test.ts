/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';

/**
 * How deep an anonymous request can page the feed.
 *
 * The union query asks each source for `limit + offset` rows before sorting
 * them together, so the work rose with whatever number was in the URL. Against
 * a 338,000-row archive that measured 150ms at page=1 and 950ms at page=8000,
 * and better-sqlite3 is synchronous, so that is the event loop blocked rather
 * than a request waiting on IO: five concurrent page=99999999 requests took
 * /api/health from 6ms to 4.2s, past the container healthcheck's own timeout.
 */
const getEventsFromDb = jest.fn((filters: unknown, limit: number, offset: number) => {
  void filters;
  void limit;
  void offset;
  return [];
});
const countEventsInDb = jest.fn(() => 338_000);

jest.mock('@/lib/db', () => ({
  getEventsFromDb: (filters: unknown, limit: number, offset: number) =>
    getEventsFromDb(filters, limit, offset),
  countEventsInDb: () => countEventsInDb(),
}));
jest.mock('@/lib/policeApi', () => ({ refreshEventsIfNeeded: jest.fn(async () => {}) }));

const call = async (query: string) => {
  const { GET } = await import('@/app/api/events/route');
  const response = await GET(new NextRequest(`http://localhost/api/events${query}`));
  return { response, body: await response.json() };
};

/** The offset getEventsFromDb was actually asked for. */
const offsetUsed = (): number => getEventsFromDb.mock.calls[0][2];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('paging the feed', () => {
  it('pages normally well inside the cap', async () => {
    await call('?page=12');
    expect(offsetUsed()).toBe(11 * 40);
  });

  it('refuses to page deeper than the cap, whatever the URL asks for', async () => {
    await call('?page=99999999');
    expect(offsetUsed()).toBe(499 * 40);
  });

  it('is not fooled by a negative or non-numeric page', async () => {
    await call('?page=-5000');
    expect(offsetUsed()).toBe(0);

    jest.clearAllMocks();
    await call('?page=notanumber');
    expect(offsetUsed()).toBe(0);
  });

  // Without this the feed's infinite scroll asks for page 501, is handed page
  // 500 again, and appends the same forty rows for ever.
  it('stops claiming there is more once the cap is reached', async () => {
    const { body } = await call('?page=500');
    expect(body.hasMore).toBe(false);
  });

  it('still reports more while there is more to reach', async () => {
    const { body } = await call('?page=499');
    expect(body.hasMore).toBe(true);
  });

  // The count is what the page says out loud; capping how far it can be paged
  // must not change what it claims to hold.
  it('leaves the total alone', async () => {
    const { body } = await call('?page=99999999');
    expect(body.total).toBe(338_000);
  });
});
