import fs from 'fs';
import path from 'path';
import { getDataDir } from './db';

// Where an NDJSON dump may be read from.
//
// The import can be started over HTTP (POST /api/import/brottsplatskartan), so
// the path in that request is attacker-controlled if the dashboard credentials
// ever leak. A request may therefore only name files inside the data directory
//: the one place the operator already mounts data into. The CLI and the
// startup environment variable are operator-controlled and may point anywhere.

export class ImportSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportSourceError';
  }
}

export interface ResolvedImportSource {
  kind: 'file' | 'url';
  /** What the importer opens: an absolute path, or the URL as given. */
  value: string;
  /** Short form for logs and the dashboard. */
  label: string;
}

export interface ResolveOptions {
  /**
   * Allow absolute paths outside the data directory. True for the CLI and for
   * BPK_IMPORT_SOURCE, false for anything arriving over HTTP.
   */
  allowAnyPath?: boolean;
}

export function resolveImportSource(input: string, options: ResolveOptions = {}): ResolvedImportSource {
  const source = input.trim();
  if (source === '') {
    throw new ImportSourceError('No source given');
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new ImportSourceError(`Not a valid URL: ${source}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ImportSourceError(`Only http(s) URLs can be imported, got ${url.protocol}//`);
    }
    return { kind: 'url', value: url.toString(), label: url.toString() };
  }

  const dataDir = path.resolve(getDataDir());
  // Bare names and relative paths are resolved against the data directory, so
  // `brottsplatskartan.ndjson` means the file the operator mounted there.
  const resolved = path.resolve(dataDir, source);

  if (!options.allowAnyPath) {
    const withinDataDir = resolved === dataDir || resolved.startsWith(dataDir + path.sep);
    if (!withinDataDir) {
      throw new ImportSourceError(
        `Files must be inside the data directory (${dataDir}). Mount the dump there and pass its name, or use an http(s) URL.`
      );
    }
  }

  if (!fs.existsSync(resolved)) {
    throw new ImportSourceError(`No such file: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new ImportSourceError(`Not a file: ${resolved}`);
  }

  return { kind: 'file', value: resolved, label: path.basename(resolved) };
}

/**
 * Dumps sitting in the data directory, newest first. Offered by the dashboard
 * so an operator can pick a file instead of typing a path.
 */
export function listLocalDumps(): Array<{ name: string; bytes: number; modified: string }> {
  const dataDir = path.resolve(getDataDir());
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dataDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile() && /\.(ndjson|jsonl)(\.txt)?$/i.test(entry.name))
    .flatMap((entry) => {
      // A dump can be moved or deleted between the readdir above and this stat
      // — an operator swapping one in is exactly when this endpoint gets
      // polled. Unguarded, that threw and took the whole dashboard panel with
      // it; the file is simply not there any more, which is not an error worth
      // failing a listing over.
      try {
        const stat = fs.statSync(path.join(dataDir, entry.name));
        return [{ name: entry.name, bytes: stat.size, modified: stat.mtime.toISOString() }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}
