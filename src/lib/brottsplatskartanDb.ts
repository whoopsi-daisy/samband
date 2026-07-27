import { getDatabase } from './db';
import type { BpkEvent, BpkImportState } from '@/types';

// Persistence for imported brottsplatskartan.se events.
//
// Kept out of db.ts so the polisen.se dataset and this one stay visibly
// separate — they have independent id spaces and independent lifecycles.

export interface BpkEventInput {
  id: number;
  pubdate: string;
  pubdateUnix: number | null;
  titleType: string | null;
  titleLocation: string | null;
  headline: string | null;
  description: string | null;
  content: string | null;
  locationString: string | null;
  county: string | null;
  lat: number | null;
  lng: number | null;
  externalSourceLink: string | null;
  permalink: string | null;
}

export interface InsertResult {
  inserted: number;
  duplicates: number;
}

// Insert a batch, ignoring events already stored.
//
// INSERT OR IGNORE gives idempotent imports for free, which matters because
// page-based pagination over a live feed re-serves events as new ones are
// published (see the drift note in brottsplatskartan.ts).
export function insertBpkEvents(events: BpkEventInput[]): InsertResult {
  if (events.length === 0) return { inserted: 0, duplicates: 0 };

  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO bpk_events
      (id, pubdate, pubdate_unix, title_type, title_location, headline,
       description, content, location_string, county, lat, lng,
       external_source_link, permalink, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  let inserted = 0;

  const run = db.transaction((batch: BpkEventInput[]) => {
    for (const e of batch) {
      const result = stmt.run(
        e.id,
        e.pubdate,
        e.pubdateUnix,
        e.titleType,
        e.titleLocation,
        e.headline,
        e.description,
        e.content,
        e.locationString,
        e.county,
        e.lat,
        e.lng,
        e.externalSourceLink,
        e.permalink,
        now
      );
      inserted += result.changes;
    }
  });
  run(events);

  return { inserted, duplicates: events.length - inserted };
}

export function getBpkImportState(): BpkImportState {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM bpk_import_state WHERE id = 1').get() as
    | {
        status: string;
        mode: string | null;
        last_page_done: number;
        total_pages: number | null;
        total_events: number | null;
        per_page: number | null;
        imported: number;
        duplicates: number;
        newest_pubdate_unix: number | null;
        started_at: string | null;
        updated_at: string | null;
        finished_at: string | null;
        last_error: string | null;
      }
    | undefined;

  // The row is created by the migration, but tolerate its absence rather than
  // throwing from a status endpoint.
  if (!row) {
    return {
      status: 'idle',
      mode: null,
      lastPageDone: 0,
      totalPages: null,
      totalEvents: null,
      perPage: null,
      imported: 0,
      duplicates: 0,
      newestPubdateUnix: null,
      startedAt: null,
      updatedAt: null,
      finishedAt: null,
      lastError: null,
      storedEvents: 0,
    };
  }

  const storedEvents = (db.prepare('SELECT COUNT(*) AS c FROM bpk_events').get() as { c: number }).c;

  return {
    status: row.status as BpkImportState['status'],
    mode: row.mode as BpkImportState['mode'],
    lastPageDone: row.last_page_done,
    totalPages: row.total_pages,
    totalEvents: row.total_events,
    perPage: row.per_page,
    imported: row.imported,
    duplicates: row.duplicates,
    newestPubdateUnix: row.newest_pubdate_unix,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    lastError: row.last_error,
    storedEvents,
  };
}

type StatePatch = Partial<{
  status: string;
  mode: string | null;
  lastPageDone: number;
  totalPages: number | null;
  totalEvents: number | null;
  perPage: number | null;
  imported: number;
  duplicates: number;
  newestPubdateUnix: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
}>;

const COLUMN_OF: Record<keyof StatePatch, string> = {
  status: 'status',
  mode: 'mode',
  lastPageDone: 'last_page_done',
  totalPages: 'total_pages',
  totalEvents: 'total_events',
  perPage: 'per_page',
  imported: 'imported',
  duplicates: 'duplicates',
  newestPubdateUnix: 'newest_pubdate_unix',
  startedAt: 'started_at',
  finishedAt: 'finished_at',
  lastError: 'last_error',
};

export function updateBpkImportState(patch: StatePatch): void {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as Array<
    [keyof StatePatch, string | number | null]
  >;
  if (entries.length === 0) return;

  const db = getDatabase();
  const assignments = entries.map(([key]) => `${COLUMN_OF[key]} = ?`).join(', ');
  const values = entries.map(([, value]) => value);

  db.prepare(`UPDATE bpk_import_state SET ${assignments}, updated_at = ? WHERE id = 1`).run(
    ...values,
    new Date().toISOString()
  );
}

// Highest pubdate seen so far — the watermark an incremental sync stops at.
export function getNewestStoredPubdateUnix(): number | null {
  const db = getDatabase();
  const row = db.prepare('SELECT MAX(pubdate_unix) AS newest FROM bpk_events').get() as {
    newest: number | null;
  };
  return row.newest;
}

export function countBpkEvents(): number {
  const db = getDatabase();
  return (db.prepare('SELECT COUNT(*) AS c FROM bpk_events').get() as { c: number }).c;
}

export function getRecentBpkEvents(limit = 20): BpkEvent[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT id, pubdate, title_type AS titleType, title_location AS titleLocation,
              headline, description, location_string AS locationString, county,
              lat, lng, permalink
       FROM bpk_events ORDER BY pubdate DESC LIMIT ?`
    )
    .all(limit) as BpkEvent[];
}
