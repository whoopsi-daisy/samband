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
   * The source is operator-controlled, so it may point anywhere: an absolute
   * path outside the data directory, or a URL on the operator's own network.
   * True for the CLI and for BPK_IMPORT_SOURCE, false for anything arriving
   * over HTTP, where the value is attacker-controlled the moment the dashboard
   * credentials leak.
   */
  allowAnyPath?: boolean;
}

/** Hostnames that always mean "this machine", whatever DNS says. */
const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);

/** Whether a dotted-quad address is in a range that is never the open internet. */
function isPrivateIpv4(address: string): boolean {
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!parts) return false;

  const [a, b] = [Number(parts[1]), Number(parts[2])];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local: 169.254.169.254 and friends
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, incl. 100.100.100.200
  return false;
}

/**
 * The IPv4 address inside an IPv4-mapped IPv6 one, as dotted quad.
 *
 * `new URL()` normalises these to hex, so `[::ffff:127.0.0.1]` arrives here as
 * `::ffff:7f00:1`. Reading only the dotted form would have let every mapped
 * address through the check below, which is a tidy way to reach loopback.
 */
function mappedIpv4(address: string): string | null {
  const mapped = /^::ffff:(.+)$/i.exec(address);
  if (!mapped) return null;

  const rest = mapped[1];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rest)) return rest;

  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(rest);
  if (!hex) return null;

  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/**
 * Whether a literal address belongs to a range that is never the public
 * internet: loopback, link-local (which is where every cloud metadata service
 * lives), and the private ranges.
 */
function isPrivateAddress(host: string): boolean {
  const address = (host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host).toLowerCase();

  if (isPrivateIpv4(address)) return true;

  const mapped = mappedIpv4(address);
  if (mapped) return isPrivateIpv4(mapped);

  if (address === '::' || address === '::1') return true;
  if (address.startsWith('fe80:')) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(address)) return true; // unique local
  return false;
}

/**
 * Refuse a URL that points back inside the network the container sits in.
 *
 * This is a literal-address check. A hostname that *resolves* to an internal
 * address still gets through, and pinning that properly means resolving DNS
 * ourselves and carrying the address into the request so it cannot change
 * underneath us. What it does stop is the whole realistic shape of the attack:
 * metadata services are reached at fixed literal addresses, and so is anything
 * else on the host.
 */
function assertPublicHost(url: URL): void {
  const hostname = url.hostname.toLowerCase();

  if (LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    throw new ImportSourceError(
      `Refusing to import from ${url.hostname}: it points at the server itself. ` +
        'Use a public URL, or put the dump in the data directory and pass its name.'
    );
  }

  if (isPrivateAddress(url.hostname)) {
    throw new ImportSourceError(
      `Refusing to import from ${url.hostname}: it is a private or link-local address, ` +
        'not something this import should be reaching. Use a public URL, or put the dump ' +
        'in the data directory and pass its name.'
    );
  }
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
    // Same threat as the path check below, under the same rule. A file path
    // arriving over HTTP was carefully confined to the data directory *because*
    // it is attacker-controlled if the dashboard credentials leak, and then any
    // URL at all was accepted and fetched by the server: link-local metadata
    // endpoints, loopback, anything else the container can reach. The operator
    // paths (the CLI, BPK_IMPORT_SOURCE) keep their freedom, which is what
    // allowAnyPath has always meant.
    if (!options.allowAnyPath) {
      assertPublicHost(url);
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
