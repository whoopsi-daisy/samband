/**
 * @jest-environment node
 */
import { memoizeWithTtl } from '@/lib/cache';

describe('memoizeWithTtl', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('answers a repeated call from the cache', () => {
    const fn = jest.fn((n: number) => n * 2);
    const memo = memoizeWithTtl(fn, 1000, (n) => String(n));

    expect(memo(21)).toBe(42);
    expect(memo(21)).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('recomputes once the entry has expired', () => {
    jest.useFakeTimers();
    const fn = jest.fn((n: number) => n * 2);
    const memo = memoizeWithTtl(fn, 1000, (n) => String(n));

    memo(1);
    jest.advanceTimersByTime(1001);
    memo(1);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  // The leak this cache used to be. The TTL was only ever consulted on the way
  // in, so a key that was never asked for a second time sat in the map for the
  // lifetime of the process. Every /api/map request minted one, each holding
  // 500 event objects.
  it('drops expired entries instead of holding them forever', () => {
    jest.useFakeTimers();
    const memo = memoizeWithTtl((n: number) => n, 1000, (n) => String(n));

    for (let i = 0; i < 10; i++) memo(i);
    expect(memo.size()).toBe(10);

    jest.advanceTimersByTime(1001);
    // A miss is what sweeps: the dead entries go, and only the new one remains.
    memo(99);

    expect(memo.size()).toBe(1);
  });

  // Expiry alone bounds the map only by how many requests arrive inside one
  // TTL, which is no bound at all when the key comes from a search box.
  it('caps the key space even while every entry is still live', () => {
    const memo = memoizeWithTtl((n: number) => n, 60_000, (n) => String(n), {
      maxEntries: 4,
    });

    for (let i = 0; i < 50; i++) memo(i);

    expect(memo.size()).toBeLessThanOrEqual(4);
  });

  it('evicts the oldest key first when it is over the cap', () => {
    const fn = jest.fn((n: number) => n);
    const memo = memoizeWithTtl(fn, 60_000, (n) => String(n), { maxEntries: 2 });

    memo(1);
    memo(2);
    // Pushes 1 out, since it is the oldest.
    memo(3);
    // 1 has to be recomputed; 3 is still held, so it does not.
    memo(1);
    memo(3);

    expect(fn.mock.calls.map(([n]) => n)).toEqual([1, 2, 3, 1]);
  });

  it('clears everything on invalidate', () => {
    const memo = memoizeWithTtl((n: number) => n, 60_000, (n) => String(n));

    memo(1);
    memo(2);
    expect(memo.size()).toBe(2);

    memo.invalidate();
    expect(memo.size()).toBe(0);
  });
});
