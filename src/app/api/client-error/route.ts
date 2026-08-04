import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { logger } from '@/lib/log';

const log = logger('ui');

/**
 * Where a render failure in the browser goes.
 *
 * Both the error boundary and the route-level error page used to call
 * `console.error`, one of them commented "the server log is where this belongs,
 * and the container is watching it". It is not and it was not: those components
 * are `'use client'`, so the line went to the visitor's own devtools console.
 * A production render crash was therefore invisible to the operator by
 * construction, including the sort of hydration mismatch that only shows up
 * under a locale nobody developing the site uses.
 *
 * Small on purpose. This is not error tracking; it is the one hop that gets a
 * client failure into the same log as everything else, so `docker compose logs`
 * is still the whole story.
 */
export const dynamic = 'force-dynamic';

/** Long enough to identify a fault, short enough not to be a storage channel. */
const MAX_FIELD = 300;

function clean(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Control characters would let a report forge extra log lines.
  return value.replace(/[\x00-\x1F\x7F]/g, ' ').trim().slice(0, MAX_FIELD);
}

export async function POST(request: NextRequest) {
  // Shares the ordinary per-IP budget: a browser stuck in a render loop must
  // not be able to fill the log faster than the log can be read.
  const rateLimitResult = checkRateLimit(request);
  if (!rateLimitResult.allowed) {
    return rateLimitResponse(rateLimitResult);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Malformed report' }, { status: 400 });
  }

  const message = clean(body.message);
  const digest = clean(body.digest);
  if (!message && !digest) {
    return NextResponse.json({ error: 'Nothing to report' }, { status: 400 });
  }

  log.error('a view failed to render in the browser', undefined, {
    message: message || undefined,
    // Matches the reference shown to the reader on the error page, so a
    // screenshot and a log line can be tied together.
    digest: digest || undefined,
    // The view, not the visitor: query strings can carry a search term, so only
    // the path is kept.
    path: clean(body.path) || undefined,
    // Which browser, because a fault that only one engine hits is a different
    // problem from one everybody hits.
    agent: request.headers.get('user-agent')?.slice(0, MAX_FIELD) || undefined,
  });

  // 204: the browser has nothing to do with the answer, and a body would only
  // invite a retry loop.
  return new NextResponse(null, { status: 204 });
}
