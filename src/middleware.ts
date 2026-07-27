import { NextRequest, NextResponse } from 'next/server';

// Optional HTTP Basic auth for the operational dashboard.
//
// /stats exposes fetch logs, error history and database internals. Set
// STATS_USER and STATS_PASSWORD to require credentials. Both unset leaves the
// dashboard public, which is the pre-existing behaviour — so upgrading cannot
// lock an operator out of their own container — but it is logged as a warning
// on first access.

let warnedAboutOpenDashboard = false;

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
    if (!warnedAboutOpenDashboard) {
      warnedAboutOpenDashboard = true;
      console.warn(
        '[auth] /stats is publicly reachable. Set STATS_USER and STATS_PASSWORD to require a login.'
      );
    }
    return NextResponse.next();
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
  matcher: ['/stats/:path*'],
};
