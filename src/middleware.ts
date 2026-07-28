import { NextRequest, NextResponse } from 'next/server';

// HTTP Basic auth for the operational dashboard and import controls.
//
// /stats exposes fetch logs, error history and database internals, and
// /api/import can start a multi-hour job against a third-party API — or cancel
// someone else's. Set STATS_USER and STATS_PASSWORD to gate them.
//
// With neither set, these routes are CLOSED rather than open. They used to be
// public in that case, on the reasoning that an upgrade should not lock an
// operator out of their own container. But .env.example ships both values
// empty, so the default deployment published its internals and its import
// controls to anyone who guessed the path, and the only notice was a line in
// the container log nobody reads. Refusing is the recoverable failure: it
// costs an operator one environment variable, where the other direction costs
// them a dashboard they never knew was reachable.
//
// STATS_PUBLIC=true restores the open behaviour for anyone who wants it — as a
// decision someone made, rather than one made for them by an empty variable.

let warnedAboutPublicDashboard = false;

function credentialsMissing(pathname: string): NextResponse {
  const body =
    'Systemstatus är avstängd.\n\n' +
    'Sätt STATS_USER och STATS_PASSWORD för att logga in här, eller\n' +
    'STATS_PUBLIC=true för att medvetet lämna sidan öppen.\n';

  console.warn(
    `[auth] refused ${pathname}: STATS_USER/STATS_PASSWORD are unset. ` +
      'Set them to enable the dashboard, or STATS_PUBLIC=true to leave it open.'
  );

  return new NextResponse(body, {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Compare in constant time so a wrong password cannot be discovered one
// character at a time by timing the response. crypto.timingSafeEqual is not
// available in the middleware runtime, so do it by hand over the full length.
function safeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

function unauthorized(): NextResponse {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Sambandscentralen systemstatus", charset="UTF-8"',
      // Never let a proxy or the service worker hold on to a 401.
      'Cache-Control': 'no-store',
    },
  });
}

export function middleware(request: NextRequest): NextResponse {
  const user = process.env.STATS_USER;
  const password = process.env.STATS_PASSWORD;

  if (!user || !password) {
    if (process.env.STATS_PUBLIC === 'true') {
      if (!warnedAboutPublicDashboard) {
        warnedAboutPublicDashboard = true;
        console.warn('[auth] /stats is public by configuration (STATS_PUBLIC=true).');
      }
      return NextResponse.next();
    }
    return credentialsMissing(request.nextUrl.pathname);
  }

  const header = request.headers.get('authorization');
  if (!header?.startsWith('Basic ')) {
    return unauthorized();
  }

  let decoded: string;
  try {
    decoded = atob(header.slice('Basic '.length));
  } catch {
    return unauthorized();
  }

  // Only the first colon separates the two; passwords may contain colons.
  const separator = decoded.indexOf(':');
  if (separator === -1) {
    return unauthorized();
  }

  const providedUser = decoded.slice(0, separator);
  const providedPassword = decoded.slice(separator + 1);

  // Evaluate both comparisons so the work does not depend on which one failed.
  const userOk = safeEqual(providedUser, user);
  const passwordOk = safeEqual(providedPassword, password);
  if (!userOk || !passwordOk) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  // /api/import is included because it can start a multi-hour job against a
  // third-party API — not something an anonymous visitor should be able to
  // trigger, or cancel.
  matcher: ['/stats/:path*', '/api/import/:path*'],
};
