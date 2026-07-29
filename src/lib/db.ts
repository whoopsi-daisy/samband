import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { EventFilters, EventWithMetadata, RawEvent, Statistics, DailyStats, YearlyStats, MonthlyStats, DailyPeak, TopItem, OperationalStats, FetchLogEntry, DatabaseHealth } from '@/types';
import { escapeLikeWildcards } from './utils';
import { memoizeWithTtl } from './cache';

// Database configuration. SAMBAND_DATA_DIR lets the container mount the SQLite
// database somewhere other than <cwd>/data (the standalone Next.js server runs
// from a different working directory than the repo root).
const DATA_DIR = process.env.SAMBAND_DATA_DIR
  ? path.resolve(process.env.SAMBAND_DATA_DIR)
  : path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'events.db');

// The resolved data directory, for code that needs to place files next to the
// database (see importSource.ts).
export function getDataDir(): string {
  return DATA_DIR;
}

// Bump when a migration is added below.
const SCHEMA_VERSION = 4;

// Singleton database instance
let db: Database.Database | null = null;

// Initialize database tables if they don't exist
function initializeDatabase(database: Database.Database): void {
  // Create events table
  database.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      datetime TEXT,
      event_time TEXT,
      publish_time TEXT,
      last_updated TEXT,
      name TEXT,
      summary TEXT,
      url TEXT,
      type TEXT,
      location_name TEXT,
      location_gps TEXT,
      raw_data TEXT,
      fetched_at TEXT,
      content_hash TEXT
    )
  `);

  // Create fetch_log table
  database.exec(`
    CREATE TABLE IF NOT EXISTS fetch_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fetched_at TEXT,
      events_fetched INTEGER,
      events_new INTEGER,
      success INTEGER,
      error_message TEXT
    )
  `);

  // Create indexes for better query performance
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_event_time ON events(event_time);
    CREATE INDEX IF NOT EXISTS idx_events_location ON events(location_name);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_fetch_log_fetched_at ON fetch_log(fetched_at);
    CREATE INDEX IF NOT EXISTS idx_events_content_hash ON events(content_hash);
    CREATE INDEX IF NOT EXISTS idx_events_composite ON events(event_time DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_events_location_type ON events(location_name, type);
  `);

  // Key/value table used to track which migrations have run.
  database.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  runMigrations(database);
}

function getSchemaVersion(database: Database.Database): number {
  const row = database.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  return row ? parseInt(row.value, 10) || 0 : 0;
}

function setSchemaVersion(database: Database.Database, version: number): void {
  database
    .prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(version));
}

// Migration 1: canonicalise timestamps to UTC ("...Z").
//
// Older rows stored `event_time`/`datetime` in two different shapes: UTC from
// `toISOString()` ("2026-07-27T12:30:00.000Z") and the API's local offset form
// ("2026-07-27T14:30:00+02:00"). Both are valid ISO 8601, but the columns are
// ordered and range-filtered as TEXT, and those two shapes do not sort against
// each other chronologically, so `ORDER BY event_time DESC` interleaved rows
// and the "last 24h" filters cut at the wrong instant. Rewrite every non-UTC
// value so the whole column is comparable as a string again.
function migrateTimestampsToUtc(database: Database.Database): void {
  const rows = database
    .prepare("SELECT id, datetime, event_time FROM events WHERE datetime NOT LIKE '%Z' OR event_time NOT LIKE '%Z'")
    .all() as Array<{ id: number; datetime: string | null; event_time: string | null }>;

  if (rows.length === 0) return;

  const update = database.prepare('UPDATE events SET datetime = ?, event_time = ? WHERE id = ?');
  const applyAll = database.transaction((pending: typeof rows) => {
    for (const row of pending) {
      update.run(toUtcIso(row.datetime), toUtcIso(row.event_time), row.id);
    }
  });
  applyAll(rows);

  console.log(`[db] migration: normalised ${rows.length} event timestamps to UTC`);
}

// Migration 2: tables for imported brottsplatskartan.se events.
//
// Deliberately a SEPARATE table rather than rows in `events`. Both sources
// number their events from 1, and `events.id` is the primary key holding
// polisen.se's ids: importing brottsplatskartan into it would silently
// overwrite unrelated polisen events wherever the two id spaces collide.
function migrateBrottsplatskartanTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS bpk_events (
      id INTEGER PRIMARY KEY,
      pubdate TEXT NOT NULL,
      pubdate_unix INTEGER,
      title_type TEXT,
      title_location TEXT,
      headline TEXT,
      description TEXT,
      content TEXT,
      location_string TEXT,
      county TEXT,
      lat REAL,
      lng REAL,
      external_source_link TEXT,
      permalink TEXT,
      imported_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bpk_pubdate ON bpk_events(pubdate DESC);
    CREATE INDEX IF NOT EXISTS idx_bpk_type ON bpk_events(title_type);
    CREATE INDEX IF NOT EXISTS idx_bpk_location ON bpk_events(location_string);
    CREATE INDEX IF NOT EXISTS idx_bpk_county ON bpk_events(county);
    CREATE INDEX IF NOT EXISTS idx_bpk_coords ON bpk_events(lat, lng);

    -- Single-row table tracking import progress so a run that is interrupted
    -- (container restart, network loss) resumes instead of starting over.
    CREATE TABLE IF NOT EXISTS bpk_import_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle',
      mode TEXT,
      last_page_done INTEGER NOT NULL DEFAULT 0,
      total_pages INTEGER,
      total_events INTEGER,
      per_page INTEGER,
      imported INTEGER NOT NULL DEFAULT 0,
      duplicates INTEGER NOT NULL DEFAULT 0,
      newest_pubdate_unix INTEGER,
      started_at TEXT,
      updated_at TEXT,
      finished_at TEXT,
      last_error TEXT
    );
  `);

  database.prepare('INSERT OR IGNORE INTO bpk_import_state (id) VALUES (1)').run();
}

// Migration 3: make imported events usable by the app's own queries.
//
// The feed, the map, the filters and the statistics now read this table
// alongside `events`, which needs three things the import alone did not care
// about. All of it is applied to new rows at import time too; this is for
// everything imported before that.
function migrateBrottsplatskartanForApp(database: Database.Database): void {
  // Composite (label, pubdate) indexes: the statistics group by label over
  // everything older than a cutoff, which these answer without touching the
  // table: the difference between a scan of the whole archive and an
  // index-only scan, several times per statistics rebuild.
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_bpk_type_pubdate ON bpk_events(title_type, pubdate);
    -- title_type is in this one so the location breakdown, which excludes
    -- summary posts, never has to touch the table to check the type.
    CREATE INDEX IF NOT EXISTS idx_bpk_title_location_pubdate ON bpk_events(title_location, pubdate, title_type);
  `);

  // Brottsplatskartan serves some types with a doubled space
  // ("Misshandel,  grov"), which would otherwise sit in every breakdown and
  // filter dropdown as a second type next to polisen.se's "Misshandel, grov".
  const collapsed = database
    .prepare(
      `UPDATE bpk_events
          SET title_type = TRIM(REPLACE(REPLACE(REPLACE(title_type, '  ', ' '), '  ', ' '), '  ', ' '))
        WHERE title_type LIKE '%  %' OR title_type != TRIM(title_type)`
    )
    .run();

  // The app groups and filters archive rows by title_location. Where the
  // import found none, fall back to the fuller location string once here
  // rather than in every query.
  const filled = database
    .prepare(
      `UPDATE bpk_events SET title_location = location_string
        WHERE (title_location IS NULL OR title_location = '')
          AND location_string IS NOT NULL AND location_string != ''`
    )
    .run();

  if (collapsed.changes > 0 || filled.changes > 0) {
    console.log(
      `[db] migration: normalised ${collapsed.changes} imported event types, ` +
        `filled in ${filled.changes} imported locations`
    );
  }
}

// Migration 4: a full-text index over the imported archive.
//
// Search was a LIKE scan of every imported row: 160-225 ms at 333k events,
// on the request path, and it could only afford to look at the headline, the
// summary and the location. FTS5 answers in single-digit milliseconds and
// makes the event body searchable, which is where the detail actually is.
//
// The tokenizer is the whole design decision. The default one indexes words,
// so "guldsmed" does not match "guldsmedsaffär": Swedish compounds would
// silently stop being found, which is precisely what people search for. The
// trigram tokenizer matches substrings the way LIKE does, at the cost of a
// much larger index: ~350 MB against ~55 MB for a 333k-event archive. Disk is
// the cheaper thing to spend here, so trigram is the default;
// BPK_SEARCH_TOKENIZER=unicode61 trades the compound matches back for the
// space, and changing it rebuilds the index on the next start.
//
// External content table: it indexes bpk_events in place rather than keeping a
// second copy of the text.
const SEARCH_TOKENIZERS = ['trigram', 'unicode61'] as const;
const DEFAULT_SEARCH_TOKENIZER = 'trigram';

function configuredSearchTokenizer(): (typeof SEARCH_TOKENIZERS)[number] {
  const configured = process.env.BPK_SEARCH_TOKENIZER?.trim().toLowerCase();
  return SEARCH_TOKENIZERS.find((name) => name === configured) ?? DEFAULT_SEARCH_TOKENIZER;
}

function buildSearchIndex(database: Database.Database, tokenizer: string): void {
  const rows = (database.prepare('SELECT COUNT(*) AS c FROM bpk_events').get() as { c: number }).c;
  const started = Date.now();

  database.exec('DROP TABLE IF EXISTS bpk_search');
  database.exec(`
    CREATE VIRTUAL TABLE bpk_search USING fts5(
      headline, description, content, title_location,
      content='bpk_events', content_rowid='id', tokenize='${tokenizer}'
    )
  `);
  // Populating from the content table beats inserting row by row by an order
  // of magnitude, and is the only part of this that takes any time.
  database.exec("INSERT INTO bpk_search(bpk_search) VALUES('rebuild')");
  database
    .prepare("INSERT INTO meta (key, value) VALUES ('bpk_search_tokenizer', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(tokenizer);

  if (rows > 0) {
    console.log(
      `[db] search index (${tokenizer}) built over ${rows.toLocaleString('sv-SE')} imported events in ${Math.round(
        (Date.now() - started) / 1000
      )}s`
    );
  }
}

function migrateSearchIndex(database: Database.Database): void {
  buildSearchIndex(database, configuredSearchTokenizer());
}

// Rebuild when the operator changes the tokenizer. Cheap to check on every
// start, and the alternative is an index that quietly disagrees with the
// setting it was built from.
function reconcileSearchTokenizer(database: Database.Database): void {
  const wanted = configuredSearchTokenizer();
  const row = database.prepare("SELECT value FROM meta WHERE key = 'bpk_search_tokenizer'").get() as
    | { value: string }
    | undefined;

  if (row?.value === wanted) return;

  console.log(`[db] search tokenizer changed to ${wanted}; rebuilding the index`);
  buildSearchIndex(database, wanted);
}

function runMigrations(database: Database.Database): void {
  const current = getSchemaVersion(database);
  if (current >= SCHEMA_VERSION) {
    reconcileSearchTokenizer(database);
    return;
  }

  if (current < 1) {
    migrateTimestampsToUtc(database);
  }

  if (current < 2) {
    migrateBrottsplatskartanTables(database);
  }

  if (current < 3) {
    migrateBrottsplatskartanForApp(database);
  }

  if (current < 4) {
    migrateSearchIndex(database);
  }

  setSchemaVersion(database, SCHEMA_VERSION);
}

/**
 * Fail with instructions rather than a bare SQLITE_CANTOPEN.
 *
 * Nearly every report of that error is the same thing: the mounted data
 * directory is not writable by the uid the container runs as. better-sqlite3
 * cannot say that (it only knows the open failed) so the log filled with a
 * stack trace through minified chunks and no mention of ownership, on a
 * container that then kept serving with no database behind it.
 */
function assertDataDirWritable(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.accessSync(DATA_DIR, fs.constants.W_OK | fs.constants.X_OK);
  } catch (cause) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 'unknown';
    let owner = 'unknown';
    try {
      const stat = fs.statSync(DATA_DIR);
      owner = `${stat.uid}:${stat.gid}`;
    } catch {
      owner = 'missing';
    }

    throw new Error(
      `Cannot write to the data directory ${DATA_DIR}.\n` +
        `  running as uid: ${uid}\n` +
        `  directory owner: ${owner}\n` +
        `The SQLite database and its -wal/-shm sidecars live here, so the app\n` +
        `cannot start without write access. On the host holding the bind mount:\n` +
        `  sudo chown -R 1001:1001 <your data directory>\n` +
        `Note that "mkdir -p data" does not fix this on a cloned repository -\n` +
        `data/ already exists from the clone, owned by whoever cloned it.`,
      { cause }
    );
  }
}

export function getDatabase(): Database.Database {
  if (!db) {
    assertDataDirWritable();

    db = new Database(DB_PATH, { readonly: false });

    // Enable WAL mode for better performance
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000'); // 64MB cache
    db.pragma('temp_store = MEMORY');
    db.pragma('foreign_keys = ON');

    // Initialize tables
    initializeDatabase(db);
  }
  return db;
}

// Convert any parseable timestamp to canonical UTC ISO 8601 ("...Z").
//
// Every timestamp column is compared and sorted as TEXT by SQLite, so they must
// all share one shape: UTC ISO strings sort chronologically, mixed offset forms
// do not. Returns the input untouched if it cannot be parsed, so a malformed
// value is never silently turned into a wrong date.
export function toUtcIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

// Local calendar day as YYYY-MM-DD, matching SQLite's date(col, 'localtime').
function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Normalize the API's datetime ("2026-07-27 14:30:00 +02:00") to UTC ISO 8601.
function normalizeDateTime(datetime: string): string {
  let normalized = datetime.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T');
  normalized = normalized.replace(/ ([+-]\d{2}:\d{2})$/, '$1');
  return toUtcIso(normalized) ?? normalized;
}

// Extract actual event time from event data
function extractEventTime(event: RawEvent): string | null {
  const { summary = '', name = '', datetime, type = '' } = event;

  // For summaries, try to extract the time period they cover
  if (type.toLowerCase().includes('sammanfattning') || name.toLowerCase().includes('sammanfattning')) {
    const timeMatch = summary.match(/kl\.?\s*(\d{1,2})[:\.]?(\d{2})?\s*[-–]\s*(\d{1,2})/i);
    if (timeMatch && datetime) {
      try {
        const date = new Date(datetime);
        const startHour = parseInt(timeMatch[1], 10);
        date.setHours(startHour, 0, 0, 0);
        return date.toISOString();
      } catch {
        // Fall through
      }
    }

    const periodMatch = summary.match(/(dygn|dag|natt|kväll|morgon)/i);
    if (periodMatch && datetime) {
      try {
        const date = new Date(datetime);
        if (/natt/i.test(summary)) {
          date.setHours(0, 0, 0, 0);
        } else if (/kväll/i.test(summary)) {
          date.setHours(18, 0, 0, 0);
        } else if (/morgon/i.test(summary)) {
          date.setHours(6, 0, 0, 0);
        } else {
          date.setHours(0, 0, 0, 0);
        }
        return date.toISOString();
      } catch {
        // Fall through
      }
    }
  }

  // Primary: Extract time from name field format "DD månad HH.MM, Type, Location"
  const nameMatch = name.match(/^(\d{1,2})\s+\w+\s+(\d{1,2})[\.:,](\d{2})/);
  if (nameMatch && datetime) {
    const day = parseInt(nameMatch[1], 10);
    const hour = parseInt(nameMatch[2], 10);
    const minute = parseInt(nameMatch[3], 10);

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && day >= 1 && day <= 31) {
      try {
        const date = new Date(datetime);
        const apiDay = date.getDate();

        if (day !== apiDay) {
          // Anchor to the 1st before changing month/day so we never overflow a
          // short month (e.g. setMonth on the 31st rolling Feb -> Mar).
          date.setDate(1);
          if (day > apiDay) {
            // Name's day is later than the API date's day -> event is from the
            // previous month (published early the following month).
            date.setMonth(date.getMonth() - 1);
          }
          date.setDate(day);
        }
        date.setHours(hour, minute, 0, 0);
        return date.toISOString();
      } catch {
        // Fall through
      }
    }
  }

  // Fallback: Extract time from summary using "Kl" or "Klockan" prefix
  const klMatch = summary.match(/[Kk]l(?:ockan)?\.?\s*(\d{1,2})[:\.](\d{2})/);
  if (klMatch && datetime) {
    const hour = parseInt(klMatch[1], 10);
    const minute = parseInt(klMatch[2], 10);

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      try {
        const date = new Date(datetime);
        const apiHour = date.getHours();
        if (hour > apiHour + 2) {
          date.setDate(date.getDate() - 1);
        }
        date.setHours(hour, minute, 0, 0);
        return date.toISOString();
      } catch {
        // Fall through
      }
    }
  }

  return datetime ? normalizeDateTime(datetime) : null;
}

// Generate content hash for change detection using FNV-1a algorithm
// FNV-1a provides better distribution and fewer collisions than simple djb2
function generateContentHash(event: RawEvent): string {
  const content = `${event.name || ''}|${event.summary || ''}|${event.type || ''}`;

  // FNV-1a 32-bit parameters
  const FNV_PRIME = 0x01000193;
  const FNV_OFFSET_BASIS = 0x811c9dc5;

  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    // Multiply by prime using BigInt to avoid overflow, then convert back
    hash = Math.imul(hash, FNV_PRIME) >>> 0; // >>> 0 ensures unsigned 32-bit
  }

  // Return as 8-character hex string (zero-padded)
  return hash.toString(16).padStart(8, '0');
}

// Insert or update event in database
export function insertEvent(event: RawEvent): 'new' | 'updated' | 'unchanged' {
  const pdo = getDatabase();
  const normalizedDatetime = normalizeDateTime(event.datetime);
  const now = new Date().toISOString();
  const contentHash = generateContentHash(event);

  // Check if event already exists
  const existing = pdo.prepare('SELECT content_hash, event_time FROM events WHERE id = ?').get(event.id) as { content_hash: string; event_time: string } | undefined;

  if (existing) {
    if (existing.content_hash === contentHash) {
      return 'unchanged';
    }

    // Content changed - update the event, including recalculating event_time
    const updatedEventTime = extractEventTime(event) || normalizedDatetime;
    pdo.prepare(`
      UPDATE events SET
        datetime = ?,
        event_time = ?,
        name = ?,
        summary = ?,
        url = ?,
        type = ?,
        location_name = ?,
        location_gps = ?,
        raw_data = ?,
        last_updated = ?,
        content_hash = ?
      WHERE id = ?
    `).run(
      normalizedDatetime,
      updatedEventTime,
      event.name,
      event.summary || '',
      event.url || '',
      event.type,
      event.location.name,
      event.location.gps || '',
      JSON.stringify(event),
      now,
      contentHash,
      event.id
    );
    return 'updated';
  }

  // New event - extract event_time and insert
  const eventTime = extractEventTime(event) || normalizedDatetime;

  pdo.prepare(`
    INSERT INTO events
    (id, datetime, event_time, publish_time, last_updated, name, summary, url, type,
     location_name, location_gps, raw_data, fetched_at, content_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    normalizedDatetime,
    eventTime,
    now,
    now,
    event.name,
    event.summary || '',
    event.url || '',
    event.type,
    event.location.name,
    event.location.gps || '',
    JSON.stringify(event),
    now,
    contentHash
  );
  return 'new';
}

// Log a fetch operation
export function logFetch(eventsFetched: number, eventsNew: number, success: boolean, error?: string): void {
  const pdo = getDatabase();
  pdo.prepare(`
    INSERT INTO fetch_log (fetched_at, events_fetched, events_new, success, error_message)
    VALUES (?, ?, ?, ?, ?)
  `).run(new Date().toISOString(), eventsFetched, eventsNew, success ? 1 : 0, error || null);
}

// Prune fetch_log entries older than the retention window to keep the
// operational log from growing without bound (~144 rows/day at a 10-min
// cadence). Events themselves are intentionally retained as the dataset.
export function pruneFetchLog(retentionDays = 30): number {
  const pdo = getDatabase();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = pdo.prepare('DELETE FROM fetch_log WHERE fetched_at < ?').run(cutoff);
  return result.changes;
}

// ---------------------------------------------------------------------------
// The archive as part of the dataset
//
// Imported brottsplatskartan events live in bpk_events (see the migration note
// above for why they are not rows in `events`). Everything below lets the app's
// own queries (feed, map, filters, statistics) read both tables as one
// dataset, so an import is usable the moment it finishes rather than being a
// pile of rows nothing looks at.
//
// The two sources overlap: brottsplatskartan republishes polisen.se, so any
// period the live feed already covers exists in both. The rule is a single
// cutoff: the oldest event the live feed holds. Live data wins from there
// forward; the archive supplies everything before it. That deduplicates
// without guessing which archived row is "the same incident" as which live
// one, and it is one comparison per row rather than a lookup per row.
//
// Archive rows are projected into the live shape, with negative ids: both
// sources number from 1, and the UI uses the id as a key.

const ARCHIVE_CUTOFF_NONE = '9999-12-31T23:59:59.999Z';

// The aggregates below are pure functions of the tables and were previously
// recomputed on every home-page request. New data only lands every 10 minutes,
// so a short TTL is invisible to users but removes the repeated full scans.
const AGGREGATE_CACHE_TTL_MS = 60_000;

// The statistics scan the whole dataset, which is seconds of work once the
// archive is hundreds of thousands of rows. They are exact rather than stale.
// Both paths that change the data, the polisen.se refresh and an import,
// invalidate them explicitly, so the TTL is only a backstop and can be long.
// Long, because it is a backstop and not the mechanism. Both paths that change
// the data invalidate and re-warm this explicitly, so the TTL only matters when
// nothing has changed for an hour, and in that case the answer has not changed
// either. At 300,000 rows a cold rebuild is most of a second, which is not
// something to hand to a visitor every ten minutes for no reason.
const STATS_CACHE_TTL_MS = 60 * 60_000;

// Columns shared by both arms of a union, in one fixed order.
const LIVE_COLUMNS = `e.raw_data AS raw_data, e.id AS id, e.event_time AS event_time,
  e.publish_time AS publish_time, e.last_updated AS last_updated, e.name AS name,
  e.summary AS summary, e.url AS url, e.type AS type, e.location_name AS location_name,
  e.location_gps AS location_gps`;

const ARCHIVE_COLUMNS = `NULL AS raw_data, -b.id AS id, b.pubdate AS event_time,
  b.pubdate AS publish_time, b.pubdate AS last_updated, COALESCE(b.headline, '') AS name,
  COALESCE(b.description, b.headline, '') AS summary,
  -- 'https://polisen.se' is 18 characters, so the path starts at 19. The app
  -- treats url as a path under polisen.se, for the detail fetch and the link.
  CASE WHEN b.external_source_link LIKE 'https://polisen.se/%'
       THEN SUBSTR(b.external_source_link, 19) ELSE '' END AS url,
  COALESCE(b.title_type, '') AS type,
  COALESCE(b.title_location, b.location_string, '') AS location_name,
  CASE WHEN b.lat IS NOT NULL AND b.lng IS NOT NULL
       THEN CAST(b.lat AS TEXT) || ',' || CAST(b.lng AS TEXT) ELSE '' END AS location_gps`;

// The location the app groups and filters archive rows by. title_location is
// filled in at import (falling back to location_string), and backfilled for
// rows imported before that, so this is a plain indexed column rather than an
// expression, which is what makes the grouping below an index-only scan.
const ARCHIVE_LOCATION = 'b.title_location';

interface UnionRow {
  raw_data: string | null;
  id: number;
  event_time: string;
  publish_time: string;
  last_updated: string;
  name: string;
  summary: string;
  url: string;
  type: string;
  location_name: string;
  location_gps: string;
}

function countArchiveRows(): number {
  const pdo = getDatabase();
  return (pdo.prepare('SELECT COUNT(*) AS count FROM bpk_events').get() as { count: number }).count;
}

// Cached: read on nearly every query, and only changes when an import runs
// (which invalidates these) or the live feed reaches further back.
const getArchiveRowCount = memoizeWithTtl(countArchiveRows, AGGREGATE_CACHE_TTL_MS, () => 'archive-rows');

function computeArchiveCutoff(): string {
  const pdo = getDatabase();
  const row = pdo.prepare('SELECT MIN(event_time) AS oldest FROM events').get() as { oldest: string | null };
  // No live events at all: the archive is the whole dataset.
  return row?.oldest ?? ARCHIVE_CUTOFF_NONE;
}

const getArchiveCutoff = memoizeWithTtl(computeArchiveCutoff, AGGREGATE_CACHE_TTL_MS, () => 'archive-cutoff');

/** Whether any imported events are in play. False keeps every query single-table. */
export function hasArchiveEvents(): boolean {
  return getArchiveRowCount() > 0;
}

/** Imported events older than the live feed's reach: the ones the app shows. */
export function getArchiveCoverage(): { events: number; cutoff: string | null } {
  if (!hasArchiveEvents()) return { events: 0, cutoff: null };
  const pdo = getDatabase();
  const cutoff = getArchiveCutoff();
  const events = (
    pdo.prepare('SELECT COUNT(*) AS count FROM bpk_events WHERE pubdate < ?').get(cutoff) as { count: number }
  ).count;
  return { events, cutoff: cutoff === ARCHIVE_CUTOFF_NONE ? null : cutoff };
}

interface SqlFragment {
  sql: string;
  params: (string | number)[];
}

// WHERE conditions for the live table, matching the filters the UI offers.
/**
 * Summary posts are not incidents.
 *
 * "Sammanfattning natt" and its siblings are a shift handover the police
 * publish on a schedule: one post covering everything and nothing, filed to
 * whichever county desk wrote it. The statistics have always left them out.
 * The map has the same reason to, and a sharper one: a marker for it lands on
 * a county centroid that no incident actually happened at.
 */
const SUMMARY_TYPE_PATTERN = '%Sammanfattning%';

interface QueryOptions {
  /** Drop the police's scheduled summary posts from the result. */
  excludeSummaries?: boolean;
}

function liveFilterSql(filters: EventFilters, options: QueryOptions = {}): SqlFragment {
  const params: (string | number)[] = [];
  let sql = '';

  if (filters.since) {
    sql += ' AND e.event_time >= ?';
    params.push(filters.since);
  }

  if (options.excludeSummaries) {
    sql += " AND COALESCE(e.type, '') NOT LIKE ?";
    params.push(SUMMARY_TYPE_PATTERN);
  }

  if (filters.location) {
    sql += ' AND e.location_name = ?';
    params.push(filters.location);
  }
  if (filters.type) {
    sql += ' AND e.type = ?';
    params.push(filters.type);
  }
  if (filters.search) {
    sql += " AND (e.name LIKE ? ESCAPE '\\' OR e.summary LIKE ? ESCAPE '\\' OR e.location_name LIKE ? ESCAPE '\\')";
    const term = '%' + escapeLikeWildcards(filters.search) + '%';
    params.push(term, term, term);
  }

  return { sql, params };
}

// The shortest string the trigram tokenizer can look up. Anything shorter has
// no trigram to match, and FTS5 answers such a query with nothing at all
// rather than an error, so those have to take the scan instead.
const MIN_SEARCH_LENGTH = 3;

/**
 * A user's search box turned into an FTS5 query, or null if the index cannot
 * answer it.
 *
 * Wrapped in double quotes so the whole thing is one phrase: FTS5 query syntax
 * has operators (AND, OR, NOT, *, ^, :) and a bare term like `polisen OR` or
 * `12:30` is a syntax error, which would surface as a failed search rather
 * than an empty one. Inside a phrase, the only character with meaning is the
 * quote itself, which doubles to escape.
 */
function toSearchMatch(search: string): string | null {
  const trimmed = search.trim();
  if (trimmed.length < MIN_SEARCH_LENGTH) return null;
  return `"${trimmed.replace(/"/g, '""')}"`;
}

// The same filters against the archive's own column names, plus the cutoff
// that keeps the two sources from overlapping.
function archiveFilterSql(filters: EventFilters, options: QueryOptions = {}): SqlFragment {
  const params: (string | number)[] = [getArchiveCutoff()];
  let sql = ' AND b.pubdate < ?';

  if (filters.since) {
    sql += ' AND b.pubdate >= ?';
    params.push(filters.since);
  }

  if (options.excludeSummaries) {
    sql += " AND COALESCE(b.title_type, '') NOT LIKE ?";
    params.push(SUMMARY_TYPE_PATTERN);
  }

  if (filters.location) {
    sql += ` AND ${ARCHIVE_LOCATION} = ?`;
    params.push(filters.location);
  }
  if (filters.type) {
    sql += ' AND b.title_type = ?';
    params.push(filters.type);
  }
  if (filters.search) {
    const match = toSearchMatch(filters.search);
    if (match) {
      // The full-text index, which also covers the event body: a LIKE scan of
      // 333k rows could not have afforded to look there.
      sql += ' AND b.id IN (SELECT rowid FROM bpk_search WHERE bpk_search MATCH ?)';
      params.push(match);
    } else {
      // Too short for the index to answer: the trigram tokenizer indexes three
      // characters at a time, so a one- or two-character search has nothing to
      // look up. Falls back to the scan this used to do: over the same three
      // columns, deliberately not the body, which would triple the cost of the
      // one query shape that still cannot use the index.
      sql +=
        " AND (b.headline LIKE ? ESCAPE '\\' OR b.description LIKE ? ESCAPE '\\'" +
        ` OR ${ARCHIVE_LOCATION} LIKE ? ESCAPE '\\')`;
      const term = '%' + escapeLikeWildcards(filters.search) + '%';
      params.push(term, term, term);
    }
  }

  return { sql, params };
}

function rowToEvent(row: UnionRow): EventWithMetadata {
  if (row.raw_data) {
    const event = JSON.parse(row.raw_data) as RawEvent;
    return {
      ...event,
      event_time: row.event_time,
      publish_time: row.publish_time,
      last_updated: row.last_updated,
      was_updated: Boolean(row.last_updated && row.publish_time && row.last_updated !== row.publish_time),
    };
  }

  // An archive row: no stored polisen.se payload, so build the same shape from
  // the columns the projection above produced.
  return {
    id: row.id,
    datetime: row.event_time,
    name: row.name,
    summary: row.summary,
    url: row.url,
    type: row.type,
    location: { name: row.location_name, gps: row.location_gps },
    event_time: row.event_time,
    publish_time: row.publish_time,
    last_updated: row.last_updated,
    was_updated: false,
  };
}

// ---------------------------------------------------------------------------

// One event by the id the UI shares in a link (?handelse=123).
//
// Shared links have to resolve to an event that is no longer near the top of
// the feed, which is most of them, since the first page covers well under a
// day. The sign of the id says which table to look in: ARCHIVE_COLUMNS
// projects imported rows as `-b.id` so the two id spaces cannot collide.
export function getEventById(id: number): EventWithMetadata | null {
  if (!Number.isInteger(id) || id === 0) return null;
  const pdo = getDatabase();

  if (id > 0) {
    const row = pdo
      .prepare(`SELECT ${LIVE_COLUMNS} FROM events e WHERE e.id = ?`)
      .get(id) as UnionRow | undefined;
    return row ? rowToEvent(row) : null;
  }

  if (!hasArchiveEvents()) return null;
  const row = pdo
    .prepare(`SELECT ${ARCHIVE_COLUMNS} FROM bpk_events b WHERE b.id = ?`)
    .get(-id) as UnionRow | undefined;
  return row ? rowToEvent(row) : null;
}

// Get events from database with optional filters
export function getEventsFromDb(
  filters: EventFilters = {},
  limit = 500,
  offset = 0,
  options: QueryOptions = {}
): EventWithMetadata[] {
  const pdo = getDatabase();
  const live = liveFilterSql(filters, options);

  if (!hasArchiveEvents()) {
    const rows = pdo
      .prepare(
        `SELECT ${LIVE_COLUMNS} FROM events e WHERE 1=1${live.sql}
         ORDER BY e.event_time DESC, e.id DESC LIMIT ? OFFSET ?`
      )
      .all(...live.params, limit, offset) as UnionRow[];
    return rows.map(rowToEvent);
  }

  const archive = archiveFilterSql(filters, options);

  // Each arm is limited to what the requested window could possibly need
  // before the union is sorted, so neither side is materialised in full.
  const window = limit + offset;
  const rows = pdo
    .prepare(
      `SELECT * FROM (
         SELECT * FROM (
           SELECT ${LIVE_COLUMNS} FROM events e WHERE 1=1${live.sql}
           ORDER BY e.event_time DESC, e.id DESC LIMIT ?
         )
         UNION ALL
         SELECT * FROM (
           SELECT ${ARCHIVE_COLUMNS} FROM bpk_events b WHERE 1=1${archive.sql}
           ORDER BY b.pubdate DESC, b.id DESC LIMIT ?
         )
       )
       ORDER BY event_time DESC, id DESC LIMIT ? OFFSET ?`
    )
    .all(...live.params, window, ...archive.params, window, limit, offset) as UnionRow[];

  return rows.map(rowToEvent);
}

/**
 * The map's slice of the feed, cached per filter set.
 *
 * The map asks for 500 rows and gets them from the same union-and-sort as the
 * list, and it asked again on every open and every filter change: per visitor,
 * with no reuse between them, even though the underlying rows only change when
 * a fetch lands every ten minutes. Two people looking at the unfiltered map ran
 * the query twice; one person switching list → map → list ran it twice.
 *
 * Cached as database rows rather than formatted events on purpose: formatting
 * stamps a relative time ("2 timmar sedan") that would be frozen at whatever it
 * said when the entry was created. Formatting is cheap; the query is not.
 */
const MAP_EVENT_LIMIT = 500;
const MAP_CACHE_TTL_MS = 60_000;

const getMapEventRows = memoizeWithTtl(
  (filters: EventFilters, since: string): EventWithMetadata[] =>
    getEventsFromDb({ ...filters, since }, MAP_EVENT_LIMIT, 0, { excludeSummaries: true }),
  MAP_CACHE_TTL_MS,
  (filters, since) => `${filters.location ?? ''}|${filters.type ?? ''}|${filters.search ?? ''}|${since}`
);

/**
 * The map's slice of the feed, bounded by the period the reader is looking at.
 *
 * `since` is not optional. The map used to ask for the newest 500 rows matching
 * the filter and then throw away everything outside its window on the client,
 * which meant a filter whose incidents were all in the archive fetched five
 * hundred rows and drew none of them.
 */
export function getMapEvents(filters: EventFilters = {}, since: Date): EventWithMetadata[] {
  return getMapEventRows(filters, since.toISOString());
}

// Count events in database with optional filters
export function countEventsInDb(filters: EventFilters = {}): number {
  const pdo = getDatabase();
  const live = liveFilterSql(filters);

  const liveCount = (
    pdo.prepare(`SELECT COUNT(*) as count FROM events e WHERE 1=1${live.sql}`).get(...live.params) as {
      count: number;
    }
  ).count;

  if (!hasArchiveEvents()) return liveCount;

  const archive = archiveFilterSql(filters);
  const archiveCount = (
    pdo.prepare(`SELECT COUNT(*) as count FROM bpk_events b WHERE 1=1${archive.sql}`).get(...archive.params) as {
      count: number;
    }
  ).count;

  return liveCount + archiveCount;
}

// Get last fetch time
export function getLastFetchTime(): Date | null {
  const pdo = getDatabase();
  const result = pdo.prepare('SELECT fetched_at FROM fetch_log ORDER BY fetched_at DESC LIMIT 1').get() as { fetched_at: string } | undefined;
  return result ? new Date(result.fetched_at) : null;
}

// Count fetches in the last 24 hours for daily limit enforcement
export function getDailyFetchCount(): number {
  const pdo = getDatabase();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const result = pdo.prepare('SELECT COUNT(*) as count FROM fetch_log WHERE fetched_at >= ?').get(since24h) as { count: number };
  return result.count;
}

// Get filter options
function computeFilterOptions(column: 'location_name' | 'type'): string[] {
  // Defensive allowlist: this value is interpolated into the SQL string, so
  // guard against anything outside the known columns even though the type
  // already constrains callers.
  if (column !== 'location_name' && column !== 'type') {
    throw new Error(`Invalid column for getFilterOptions: ${column}`);
  }
  const pdo = getDatabase();

  if (!hasArchiveEvents()) {
    const rows = pdo
      .prepare(`SELECT DISTINCT ${column} AS value FROM events WHERE ${column} != '' ORDER BY ${column} ASC`)
      .all() as Array<{ value: string }>;
    return rows.map(row => row.value);
  }

  // The dropdowns have to offer what the archive holds too, or a filter can
  // never reach the years only the archive covers. UNION (not UNION ALL)
  // deduplicates the labels the two sources share.
  const archiveColumn = column === 'type' ? 'b.title_type' : ARCHIVE_LOCATION;
  const rows = pdo
    .prepare(
      `SELECT value FROM (
         SELECT DISTINCT ${column} AS value FROM events WHERE ${column} != ''
         UNION
         SELECT DISTINCT ${archiveColumn} AS value FROM bpk_events b
          WHERE b.pubdate < ? AND ${archiveColumn} != ''
       ) ORDER BY value ASC`
    )
    .all(getArchiveCutoff()) as Array<{ value: string }>;
  return rows.map(row => row.value);
}

// One source's contribution to the statistics. Both tables answer the same
// questions with different column names, so the queries are written once
// against this description and run per source.
interface StatsSource {
  /** Table with its alias, as it appears after FROM. */
  from: string;
  time: string;
  /** Type as a predicate reads it, never NULL, so NOT LIKE behaves. */
  type: string;
  /** Type as the breakdown groups it: the bare column, so an index answers it. */
  typeLabel: string;
  location: string;
  hasGps: string;
  wasUpdated: string;
  /** Extra always-on condition, e.g. the archive cutoff. */
  where: string;
  whereParams: (string | number)[];
}

const LIVE_STATS_SOURCE: StatsSource = {
  from: 'events e',
  time: 'e.event_time',
  type: "COALESCE(e.type, '')",
  typeLabel: 'e.type',
  location: 'e.location_name',
  hasGps: "e.location_gps != ''",
  wasUpdated: 'e.last_updated != e.publish_time',
  where: '',
  whereParams: [],
};

function archiveStatsSource(): StatsSource {
  return {
    from: 'bpk_events b',
    time: 'b.pubdate',
    type: "COALESCE(b.title_type, '')",
    typeLabel: 'b.title_type',
    location: ARCHIVE_LOCATION,
    hasGps: 'b.lat IS NOT NULL AND b.lng IS NOT NULL',
    // Brottsplatskartan does not republish corrections, so nothing here is
    // ever a revision of something already stored.
    wasUpdated: '0',
    where: ' AND b.pubdate < ?',
    whereParams: [getArchiveCutoff()],
  };
}

interface SourceStats {
  last24h: number;
  last7d: number;
  last30d: number;
  total: number;
  oldest: string | null;
  types: Map<string, number>;
  locations: Map<string, number>;
  hourly: number[];
  /** Sunday-first, as SQLite's %w numbers them. */
  weekdays: number[];
  daily: Map<string, number>;
  /**
   * Every calendar day the source covers, not just the last week. One scan
   * answers the year chart, the month chart and the busiest day between them,
   * and at roughly 3,600 buckets for a decade of history it is a small map.
   */
  allDays: Map<string, number>;
  withGps: number;
  updated: number;
}

function collectSourceStats(source: StatsSource, windows: { since24h: string; since7d: string; since30d: string }): SourceStats {
  const pdo = getDatabase();
  const excludePattern = '%Sammanfattning%';
  const { from, time, type, location, where, whereParams } = source;

  // Every query carries the source's always-on condition and the summary-post
  // exclusion, so the two sources are counted on identical terms.
  const base = `FROM ${from} WHERE ${type} NOT LIKE ?${where}`;
  const baseParams = [excludePattern, ...whereParams];

  // One pass for every scalar. Each of these was its own query once, and each
  // one is a scan of the whole source, six scans of a 300k-row archive is
  // seconds of work to answer six numbers.
  const scalars = pdo
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN (${source.hasGps}) THEN 1 ELSE 0 END) AS withGps,
         SUM(CASE WHEN (${source.wasUpdated}) THEN 1 ELSE 0 END) AS updated,
         MIN(CASE WHEN ${type} NOT LIKE ? THEN ${time} END) AS oldest,
         SUM(CASE WHEN ${type} NOT LIKE ? AND ${time} >= ? THEN 1 ELSE 0 END) AS last24h,
         SUM(CASE WHEN ${type} NOT LIKE ? AND ${time} >= ? THEN 1 ELSE 0 END) AS last7d,
         SUM(CASE WHEN ${type} NOT LIKE ? AND ${time} >= ? THEN 1 ELSE 0 END) AS last30d
       FROM ${from} WHERE 1=1${where}`
    )
    // Bound in the order the placeholders appear in the statement text: the
    // SELECT list first, then the WHERE clause. Passing the source's own
    // parameters first would silently bind the cutoff to a summary-post
    // pattern and the window to the cutoff.
    .get(
      excludePattern,
      excludePattern,
      windows.since24h,
      excludePattern,
      windows.since7d,
      excludePattern,
      windows.since30d,
      ...whereParams
    ) as {
    total: number;
    withGps: number | null;
    updated: number | null;
    oldest: string | null;
    last24h: number | null;
    last7d: number | null;
    last30d: number | null;
  };

  const groupToMap = (sql: string, params: (string | number)[]): Map<string, number> => {
    const rows = pdo.prepare(sql).all(...params) as Array<{ label: string | null; total: number }>;
    // A NULL label is a row with no type or no location; it is still counted
    // as an event, and the '' key is skipped by the breakdowns.
    return new Map(rows.map(row => [row.label ?? '', row.total]));
  };

  const hourlyRows = pdo
    .prepare(
      // Timestamps are stored in UTC, but "events by hour of day" is only
      // meaningful on the local (Swedish) wall clock, so bucket with the
      // 'localtime' modifier: it applies the correct DST offset per row.
      `SELECT strftime('%H', ${time}, 'localtime') AS bucket, COUNT(*) AS total ${base} AND ${time} >= ? GROUP BY bucket`
    )
    .all(...baseParams, windows.since24h) as Array<{ bucket: string; total: number }>;
  const hourly: number[] = Array(24).fill(0);
  for (const row of hourlyRows) hourly[parseInt(row.bucket, 10)] = row.total;

  const weekdayRows = pdo
    .prepare(
      `SELECT strftime('%w', ${time}, 'localtime') AS bucket, COUNT(*) AS total ${base} AND ${time} >= ? GROUP BY bucket`
    )
    .all(...baseParams, windows.since30d) as Array<{ bucket: string; total: number }>;
  const weekdays: number[] = Array(7).fill(0);
  for (const row of weekdayRows) weekdays[parseInt(row.bucket, 10)] = row.total;

  const dailyRows = pdo
    .prepare(
      `SELECT date(${time}, 'localtime') AS bucket, COUNT(*) AS total ${base} AND ${time} >= ? GROUP BY bucket`
    )
    .all(...baseParams, windows.since7d) as Array<{ bucket: string; total: number }>;

  // The same grouping with no window on it. A scan of the source rather than a
  // range on the index, which makes it the most expensive query here, so
  // everything needing a long view is derived from this one result: per year,
  // per month, and the busiest day on record.
  //
  // Bucketed by slicing the ISO string rather than with date(..., 'localtime').
  // Timestamps are stored as UTC ISO, so the first ten characters are the UTC
  // day, and taking them is a string operation instead of a datetime parse and
  // a timezone lookup per row. Over 300,000 rows that is the difference between
  // 170ms and 760ms, and it is the single largest cost on this page.
  //
  // The cost of that is the bucket boundary: Sweden runs one or two hours ahead
  // of UTC, so incidents in the last hours of a day land on the day before. On
  // a year or a month that moves a handful of rows out of thousands and is
  // invisible. The seven-day chart above deliberately keeps 'localtime': it is
  // a cheap range query, and its bars have to line up with the day headings in
  // the feed, which are Swedish days.
  const allDayRows = pdo
    .prepare(`SELECT substr(${time}, 1, 10) AS bucket, COUNT(*) AS total ${base} GROUP BY bucket`)
    .all(...baseParams) as Array<{ bucket: string; total: number }>;

  return {
    // The totals count every row: they answer "how much is stored". The rest
    // exclude summary posts, as the live feed's statistics always have.
    last24h: scalars.last24h ?? 0,
    last7d: scalars.last7d ?? 0,
    last30d: scalars.last30d ?? 0,
    total: scalars.total,
    oldest: scalars.oldest,
    // Grouped on the bare column so an index can answer it without the table.
    types: groupToMap(`SELECT ${source.typeLabel} AS label, COUNT(*) AS total ${base} GROUP BY label`, baseParams),
    locations: groupToMap(`SELECT ${location} AS label, COUNT(*) AS total ${base} GROUP BY label`, baseParams),
    hourly,
    weekdays,
    daily: new Map(dailyRows.map(row => [row.bucket, row.total])),
    allDays: new Map(allDayRows.map(row => [row.bucket, row.total])),
    withGps: scalars.withGps ?? 0,
    updated: scalars.updated ?? 0,
  };
}

function mergeCounts(target: Map<string, number>, extra: Map<string, number>): void {
  for (const [label, count] of extra) {
    target.set(label, (target.get(label) ?? 0) + count);
  }
}

/** Distinct labels, ignoring rows that carry none. */
function countLabels(counts: Map<string, number>): number {
  let total = 0;
  for (const label of counts.keys()) if (label !== '') total++;
  return total;
}

const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/**
 * Every year the data covers, oldest first, with the gaps filled in.
 *
 * A year with no events still gets a bar rather than being left out, so a hole
 * in the archive reads as a hole instead of as two adjacent years.
 */
function yearlyFromDays(days: Map<string, number>): YearlyStats[] {
  const totals = new Map<string, number>();
  for (const [day, count] of days) {
    const year = day.slice(0, 4);
    totals.set(year, (totals.get(year) ?? 0) + count);
  }
  if (totals.size === 0) return [];

  const years = [...totals.keys()].sort();
  const first = parseInt(years[0], 10);
  const last = parseInt(years[years.length - 1], 10);
  const out: YearlyStats[] = [];
  for (let year = first; year <= last; year++) {
    const key = String(year);
    out.push({ year: key, count: totals.get(key) ?? 0 });
  }
  return out;
}

/** The last `months` calendar months up to and including the current one. */
function monthlyFromDays(days: Map<string, number>, now: Date, months: number): MonthlyStats[] {
  const totals = new Map<string, number>();
  for (const [day, count] of days) {
    const month = day.slice(0, 7);
    totals.set(month, (totals.get(month) ?? 0) + count);
  }

  const out: MonthlyStats[] = [];
  for (let back = months - 1; back >= 0; back--) {
    const at = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const key = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;
    out.push({
      month: key,
      label: MONTH_ABBR[at.getMonth()],
      year: at.getFullYear(),
      count: totals.get(key) ?? 0,
    });
  }
  return out;
}

function busiestFromDays(days: Map<string, number>): DailyPeak | null {
  let best: DailyPeak | null = null;
  for (const [date, count] of days) {
    if (!best || count > best.count) best = { date, count };
  }
  return best;
}

function topItems(counts: Map<string, number>, limit = 8): TopItem[] {
  return [...counts]
    .filter(([label]) => label !== '')
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'sv'))
    .slice(0, limit);
}

// Get statistics summary
//
// Covers the whole dataset: the live polisen.se feed plus every imported event
// older than the feed reaches. Both sources are counted on the same terms and
// added together, so an import shows up here as soon as it finishes.
function computeStatsSummary(): Statistics {
  const now = new Date();
  const windows = {
    since24h: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    since7d: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    since30d: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  };

  const live = collectSourceStats(LIVE_STATS_SOURCE, windows);
  const archive = hasArchiveEvents() ? collectSourceStats(archiveStatsSource(), windows) : null;

  const last24h = live.last24h + (archive?.last24h ?? 0);
  const last7d = live.last7d + (archive?.last7d ?? 0);
  const last30d = live.last30d + (archive?.last30d ?? 0);
  const totalStored = live.total + (archive?.total ?? 0);
  // Total should match totalStored so the footer shows consistent counts
  const total = totalStored;

  const oldestCandidates = [live.oldest, archive?.oldest ?? null].filter((v): v is string => Boolean(v));
  const oldest = oldestCandidates.length > 0 ? oldestCandidates.sort()[0] : null;

  let avgPerDay = 0;
  let coverageDays = 0;
  if (oldest) {
    coverageDays = Math.max(1, Math.floor((now.getTime() - new Date(oldest).getTime()) / (24 * 60 * 60 * 1000)));
    avgPerDay = Math.round((total / coverageDays) * 10) / 10;
  }

  const typeCounts = new Map(live.types);
  const locationCounts = new Map(live.locations);
  const hourly = [...live.hourly];
  const weekdayData = [...live.weekdays];
  const dailyMap = new Map(live.daily);
  const allDays = new Map(live.allDays);

  if (archive) {
    mergeCounts(typeCounts, archive.types);
    mergeCounts(locationCounts, archive.locations);
    for (let i = 0; i < 24; i++) hourly[i] += archive.hourly[i];
    for (let i = 0; i < 7; i++) weekdayData[i] += archive.weekdays[i];
    for (const [day, count] of archive.daily) dailyMap.set(day, (dailyMap.get(day) ?? 0) + count);
    mergeCounts(allDays, archive.allDays);
  }

  // Convert to Monday-Sunday order (Swedish)
  const weekdays = [
    weekdayData[1], // Monday
    weekdayData[2], // Tuesday
    weekdayData[3], // Wednesday
    weekdayData[4], // Thursday
    weekdayData[5], // Friday
    weekdayData[6], // Saturday
    weekdayData[0], // Sunday
  ];

  const daily: DailyStats[] = [];
  const dayNames = ['Sön', 'Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör'];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    // Must be the local calendar day to line up with date(..., 'localtime')
    // above; toISOString() would key these buckets off the UTC day instead.
    const dateStr = toLocalDateKey(date);
    daily.push({
      date: dateStr,
      day: dayNames[date.getDay()],
      count: dailyMap.get(dateStr) ?? 0,
    });
  }

  const eventsWithGps = live.withGps + (archive?.withGps ?? 0);
  const gpsPercent = totalStored > 0 ? Math.round((eventsWithGps / totalStored) * 100) : 0;
  const updatedEvents = live.updated + (archive?.updated ?? 0);
  const updatedPercent = totalStored > 0 ? Math.round((updatedEvents / totalStored) * 100) : 0;

  const coverage = getArchiveCoverage();

  return {
    total,
    totalStored,
    last24h,
    last7d,
    last30d,
    avgPerDay,
    topTypes: topItems(typeCounts),
    topLocations: topItems(locationCounts),
    hourly,
    weekdays,
    daily,
    yearly: yearlyFromDays(allDays),
    monthly: monthlyFromDays(allDays, now, 24),
    busiestDay: busiestFromDays(allDays),
    coverageDays,
    gpsPercent,
    updatedPercent,
    // Distinct across both sources: a location present in each counts once.
    uniqueLocations: countLabels(locationCounts),
    uniqueTypes: countLabels(typeCounts),
    oldestEvent: oldest,
    archiveEvents: coverage.events,
    archiveCutoff: coverage.cutoff,
  };
}

export const getFilterOptions = memoizeWithTtl(
  computeFilterOptions,
  AGGREGATE_CACHE_TTL_MS,
  (column) => column
);

export const getStatsSummary = memoizeWithTtl(computeStatsSummary, STATS_CACHE_TTL_MS, () => 'stats');

/**
 * Recompute the statistics off the request path.
 *
 * Called after the data changes (a refresh, or a finished import) so the
 * next page view is served from a warm cache instead of waiting out a scan of
 * the whole archive.
 */
export function warmAggregateCaches(): void {
  try {
    getStatsSummary();
    getFilterOptions('type');
    getFilterOptions('location_name');
  } catch (error) {
    // Warming is an optimisation; a failure here must not take down the caller.
    console.error('[db] failed to warm aggregate caches:', error);
  }
}

// Drop cached aggregates. Called after a refresh writes new events so the next
// request reflects them immediately rather than waiting out the TTL.
export function invalidateAggregateCaches(): void {
  getFilterOptions.invalidate();
  getStatsSummary.invalidate();
  // The map reads the same rows the list does, so a fetch that changes them
  // has to drop this too: otherwise the map lags the feed by up to a minute.
  getMapEventRows.invalidate();
  // An import changes both of these: how much archive there is, and: once the
  // live feed reaches further back: how much of it the app counts.
  getArchiveRowCount.invalidate();
  getArchiveCutoff.invalidate();
}

// Get operational statistics for monitoring
export function getOperationalStats(): OperationalStats {
  const pdo = getDatabase();
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Total fetches
  const totalFetches = (pdo.prepare('SELECT COUNT(*) as count FROM fetch_log').get() as { count: number }).count;

  // Successful fetches
  const successfulFetches = (pdo.prepare('SELECT COUNT(*) as count FROM fetch_log WHERE success = 1').get() as { count: number }).count;

  // Failed fetches
  const failedFetches = (pdo.prepare('SELECT COUNT(*) as count FROM fetch_log WHERE success = 0').get() as { count: number }).count;

  // Fetches in last 24h
  const fetches24h = (pdo.prepare('SELECT COUNT(*) as count FROM fetch_log WHERE fetched_at >= ?').get(since24h) as { count: number }).count;

  // Fetches in last 7d
  const fetches7d = (pdo.prepare('SELECT COUNT(*) as count FROM fetch_log WHERE fetched_at >= ?').get(since7d) as { count: number }).count;

  // Success rate
  const successRate = totalFetches > 0 ? Math.round((successfulFetches / totalFetches) * 1000) / 10 : 100;

  // Average fetch interval (in minutes)
  let avgFetchInterval = 30; // default
  const fetchTimes = pdo.prepare('SELECT fetched_at FROM fetch_log ORDER BY fetched_at DESC LIMIT 50').all() as Array<{ fetched_at: string }>;
  if (fetchTimes.length > 1) {
    let totalInterval = 0;
    for (let i = 0; i < fetchTimes.length - 1; i++) {
      const diff = new Date(fetchTimes[i].fetched_at).getTime() - new Date(fetchTimes[i + 1].fetched_at).getTime();
      totalInterval += diff;
    }
    avgFetchInterval = Math.round(totalInterval / (fetchTimes.length - 1) / 60000); // convert to minutes
  }

  // Last successful fetch
  const lastSuccess = pdo.prepare('SELECT fetched_at FROM fetch_log WHERE success = 1 ORDER BY fetched_at DESC LIMIT 1').get() as { fetched_at: string } | undefined;

  // Last failed fetch
  const lastFailure = pdo.prepare('SELECT fetched_at FROM fetch_log WHERE success = 0 ORDER BY fetched_at DESC LIMIT 1').get() as { fetched_at: string } | undefined;

  // Recent errors (last 10, without detailed messages for security)
  const recentErrors = pdo.prepare(`
    SELECT
      fetched_at,
      CASE
        WHEN error_message LIKE '%timeout%' THEN 'Timeout'
        WHEN error_message LIKE '%network%' THEN 'Network Error'
        WHEN error_message LIKE '%ECONNREFUSED%' THEN 'Connection Refused'
        WHEN error_message LIKE '%ENOTFOUND%' THEN 'DNS Error'
        WHEN error_message LIKE '%500%' THEN 'Server Error (5xx)'
        WHEN error_message LIKE '%404%' THEN 'Not Found (404)'
        WHEN error_message LIKE '%403%' THEN 'Forbidden (403)'
        WHEN error_message LIKE '%rate%' THEN 'Rate Limited'
        WHEN error_message IS NOT NULL THEN 'Other Error'
        ELSE 'Unknown'
      END as error_type
    FROM fetch_log
    WHERE success = 0
    ORDER BY fetched_at DESC
    LIMIT 10
  `).all() as Array<{ fetched_at: string; error_type: string }>;

  // Fetch history by hour (last 24h)
  const fetchesByHour = pdo.prepare(`
    SELECT strftime('%H', fetched_at, 'localtime') AS hour, COUNT(*) AS count
    FROM fetch_log
    WHERE fetched_at >= ?
    GROUP BY hour
    ORDER BY hour
  `).all(since24h) as Array<{ hour: string; count: number }>;
  const hourlyFetches: number[] = Array(24).fill(0);
  for (const row of fetchesByHour) {
    hourlyFetches[parseInt(row.hour, 10)] = row.count;
  }

  // Events added per fetch (average)
  const avgEventsPerFetch = pdo.prepare(`
    SELECT AVG(events_new) as avg
    FROM fetch_log
    WHERE success = 1 AND events_new > 0
  `).get() as { avg: number | null };

  // Total events added today
  const eventsAddedToday = (pdo.prepare(`
    SELECT COUNT(*) as count
    FROM events
    WHERE date(fetched_at, 'localtime') = date('now', 'localtime')
  `).get() as { count: number }).count;

  // Uptime (based on successful fetches in expected intervals)
  // If we expect a fetch every 10 min, check how many we got vs expected in last 24h
  const expectedFetches24h = 144; // 24h / 10min
  const uptimeScore = Math.min(100, Math.round((fetches24h / expectedFetches24h) * 100));

  return {
    totalFetches,
    successfulFetches,
    failedFetches,
    fetches24h,
    fetches7d,
    successRate,
    avgFetchInterval,
    lastSuccessfulFetch: lastSuccess?.fetched_at || null,
    lastFailedFetch: lastFailure?.fetched_at || null,
    recentErrors,
    hourlyFetches,
    avgEventsPerFetch: avgEventsPerFetch.avg ? Math.round(avgEventsPerFetch.avg * 10) / 10 : 0,
    eventsAddedToday,
    uptimeScore,
  };
}

// Get recent fetch log entries
export function getRecentFetchLogs(limit = 20): FetchLogEntry[] {
  const pdo = getDatabase();
  const rows = pdo.prepare(`
    SELECT
      id,
      fetched_at,
      events_fetched,
      events_new,
      success,
      CASE
        WHEN error_message LIKE '%timeout%' THEN 'Timeout'
        WHEN error_message LIKE '%network%' THEN 'Network Error'
        WHEN error_message LIKE '%ECONNREFUSED%' THEN 'Connection Refused'
        WHEN error_message LIKE '%ENOTFOUND%' THEN 'DNS Error'
        WHEN error_message LIKE '%500%' THEN 'Server Error'
        WHEN error_message LIKE '%404%' THEN 'Not Found'
        WHEN error_message LIKE '%403%' THEN 'Forbidden'
        WHEN error_message LIKE '%rate%' THEN 'Rate Limited'
        WHEN error_message IS NOT NULL THEN 'Error'
        ELSE NULL
      END as error_type
    FROM fetch_log
    ORDER BY fetched_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: number;
    fetched_at: string;
    events_fetched: number;
    events_new: number;
    success: number;
    error_type: string | null;
  }>;

  return rows.map(row => ({
    id: row.id,
    fetchedAt: row.fetched_at,
    eventsFetched: row.events_fetched,
    eventsNew: row.events_new,
    success: row.success === 1,
    errorType: row.error_type,
  }));
}

// Get database health metrics
export function getDatabaseHealth(): DatabaseHealth {
  const pdo = getDatabase();

  // Total events
  const totalEvents = (pdo.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number }).count;

  // Total fetch logs
  const totalFetchLogs = (pdo.prepare('SELECT COUNT(*) as count FROM fetch_log').get() as { count: number }).count;

  // Events with GPS coordinates
  const eventsWithGps = (pdo.prepare("SELECT COUNT(*) as count FROM events WHERE location_gps != ''").get() as { count: number }).count;

  // Unique locations
  const uniqueLocations = (pdo.prepare('SELECT COUNT(DISTINCT location_name) as count FROM events').get() as { count: number }).count;

  // Unique event types
  const uniqueTypes = (pdo.prepare('SELECT COUNT(DISTINCT type) as count FROM events').get() as { count: number }).count;

  // Oldest event
  const oldestEvent = pdo.prepare('SELECT MIN(event_time) as oldest FROM events').get() as { oldest: string | null };

  // Newest event
  const newestEvent = pdo.prepare('SELECT MAX(event_time) as newest FROM events').get() as { newest: string | null };

  // Events by type breakdown
  const eventsByType = pdo.prepare(`
    SELECT type, COUNT(*) as count
    FROM events
    GROUP BY type
    ORDER BY count DESC
  `).all() as Array<{ type: string; count: number }>;

  // Data freshness (time since last event)
  let dataFreshnessMinutes = 0;
  if (newestEvent?.newest) {
    dataFreshnessMinutes = Math.round((Date.now() - new Date(newestEvent.newest).getTime()) / 60000);
  }

  // Updated events count (events that have been modified)
  const updatedEvents = (pdo.prepare(`
    SELECT COUNT(*) as count
    FROM events
    WHERE last_updated != publish_time
  `).get() as { count: number }).count;

  return {
    totalEvents,
    totalFetchLogs,
    eventsWithGps,
    eventsWithGpsPercent: totalEvents > 0 ? Math.round((eventsWithGps / totalEvents) * 100) : 0,
    uniqueLocations,
    uniqueTypes,
    oldestEvent: oldestEvent?.oldest || null,
    newestEvent: newestEvent?.newest || null,
    eventsByType: eventsByType.slice(0, 15), // Top 15 types
    dataFreshnessMinutes,
    updatedEvents,
    updatedEventsPercent: totalEvents > 0 ? Math.round((updatedEvents / totalEvents) * 100) : 0,
  };
}
