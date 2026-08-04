import { NextResponse } from 'next/server';
import zlib from 'zlib';

/**
 * JSON, compressed.
 *
 * Next compresses pages and static assets and does not compress Route
 * Handlers, which is where nearly all of this app's bytes are. Measured on a
 * month of map data: 192 kB served, 9.5 kB gzipped, a factor of twenty. The
 * feed's own endpoint is 16 kB against 2.4 kB, and every open tab polls it
 * every ten minutes.
 *
 * A reverse proxy in front is the other place to fix this and often already
 * does — but nginx gzips text/html by default and nothing else, so
 * `application/json` has to be added to gzip_types by hand and frequently is
 * not. Doing it here means the deployment is small over the wire whatever sits
 * in front of it, and a proxy that also compresses simply finds the work done.
 */

/**
 * Below this, compression costs more than it saves: a gzip member carries
 * about twenty bytes of header and trailer, and the CPU is not free either.
 */
const MIN_COMPRESS_BYTES = 1024;

/**
 * gzip rather than brotli, deliberately.
 *
 * Brotli would shave perhaps another fifteen percent, and at its default
 * quality it costs an order of magnitude more CPU per response. These bodies
 * are built per request on a server that also runs SQLite synchronously on the
 * same thread, so spending 50 ms compressing to save 1 kB is the wrong trade.
 */
function acceptsGzip(request: Request): boolean {
  const header = request.headers.get('accept-encoding') ?? '';
  return /\bgzip\b/i.test(header);
}

/**
 * A JSON response, gzipped when the client accepts it and the body is big
 * enough to be worth it.
 *
 * Returns a NextResponse so callers can go on setting headers on it, which is
 * what the rate-limit headers do.
 */
export function jsonResponse(request: Request, data: unknown, init: ResponseInit = {}): NextResponse {
  const body = JSON.stringify(data);
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  // Set whether or not this particular response was compressed: a cache that
  // stored the uncompressed one must not serve it to a client that asked for
  // gzip, nor the reverse.
  headers.set('Vary', 'Accept-Encoding');

  if (body.length < MIN_COMPRESS_BYTES || !acceptsGzip(request)) {
    return new NextResponse(body, { ...init, headers });
  }

  const packed = zlib.gzipSync(Buffer.from(body, 'utf8'));
  headers.set('Content-Encoding', 'gzip');
  headers.set('Content-Length', String(packed.length));
  return new NextResponse(new Uint8Array(packed), { ...init, headers });
}
