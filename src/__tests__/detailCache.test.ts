/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RawEvent } from '@/types';

let tempDir: string;
let db: typeof import('@/lib/db');

const makeEvent = (id: number, overrides: Partial<RawEvent> = {}): RawEvent => ({
  id,
  name: '27 juli 08:53, Trafikolycka, Ljungby',
  summary: 'Sammandrag.',
  url: `/e/${id}/`,
  type: 'Trafikolycka',
  datetime: '2026-07-27T08:53:00+02:00',
  location: { name: 'Kronobergs län', gps: '56.83,13.94' },
  ...overrides,
});

beforeEach(async () => {
  jest.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-detail-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  db = await import('@/lib/db');
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Expanding a card scraped polisen.se every time, for every reader, even though
 * the imported half of the dataset has always answered the identical question
 * out of this same database.
 */
describe('the stored text of a live notice', () => {
  it('has nothing before anything has been fetched', () => {
    db.insertEvent(makeEvent(1));

    expect(db.getEventDetailText(1)).toBeNull();
  });

  it('gives back what was stored', () => {
    db.insertEvent(makeEvent(1));
    db.saveEventDetailText(1, 'Första stycket.\n\nAndra stycket.');

    expect(db.getEventDetailText(1)).toBe('Första stycket.\n\nAndra stycket.');
  });

  it('keeps each notice to its own text', () => {
    db.insertEvent(makeEvent(1));
    db.insertEvent(makeEvent(2));
    db.saveEventDetailText(1, 'Ett.');

    expect(db.getEventDetailText(1)).toBe('Ett.');
    expect(db.getEventDetailText(2)).toBeNull();
  });

  /**
   * The reason a cache here is safe at all. When polisen.se rewrites a notice
   * the content hash moves, the row is updated, and whatever was scraped for
   * the old wording is no longer the notice.
   */
  it('is dropped when the notice itself is corrected', () => {
    db.insertEvent(makeEvent(1));
    db.saveEventDetailText(1, 'Den ursprungliga texten.');

    expect(db.insertEvent(makeEvent(1, { summary: 'Rättad text.' }))).toBe('updated');
    expect(db.getEventDetailText(1)).toBeNull();
  });

  it('survives a re-served notice that has not changed', () => {
    db.insertEvent(makeEvent(1));
    db.saveEventDetailText(1, 'Texten.');

    // polisen.se re-serves the same events on every poll.
    expect(db.insertEvent(makeEvent(1))).toBe('unchanged');
    expect(db.getEventDetailText(1)).toBe('Texten.');
  });

  it('survives a whole batched refresh that changed nothing', () => {
    db.insertEvent(makeEvent(1));
    db.saveEventDetailText(1, 'Texten.');

    db.insertEvents([makeEvent(1), makeEvent(2)]);

    expect(db.getEventDetailText(1)).toBe('Texten.');
  });

  // An empty scrape is a page whose layout we misread or a fetch that failed.
  // Remembering that as "this notice has no text" would make it permanent.
  it('refuses to store an empty answer', () => {
    db.insertEvent(makeEvent(1));
    db.saveEventDetailText(1, '');

    expect(db.getEventDetailText(1)).toBeNull();
  });

  // Archive rows are negative ids and answer from bpk_events, never from here.
  it('ignores an archive id', () => {
    expect(db.getEventDetailText(-5)).toBeNull();
    expect(() => db.saveEventDetailText(-5, 'text')).not.toThrow();
  });

  it('ignores a nonsense id rather than throwing', () => {
    expect(db.getEventDetailText(0)).toBeNull();
    expect(db.getEventDetailText(1.5)).toBeNull();
    expect(db.getEventDetailText(NaN)).toBeNull();
  });

  it('writing for an unknown notice stores nothing and does not throw', () => {
    expect(() => db.saveEventDetailText(999, 'text')).not.toThrow();
    expect(db.getEventDetailText(999)).toBeNull();
  });
});
