import { NextRequest, NextResponse } from 'next/server';
import { resolveAuthMode, verifyCredentials } from '@/lib/adminAuth';

// HTTP Basic auth for the operational dashboard and import controls.
//
// /stats exposes fetch logs, error history and database internals, and
// /api/import can start a multi-hour job against a third-party API, or cancel
// someone else's. Both are gated here.
//
// Credentials come from one of two places, in this order:
//
//   1. STATS_USER + STATS_PASSWORD, if both are set. An operator who already
//      deploys with these keeps logging in exactly as before.
//   2. The account created at /stats/setup on first start, stored as a scrypt
//      hash in the database.
//
// With neither, these routes are CLOSED rather than open, and /stats redirects
// to the setup page. They used to be public in that case, on the reasoning that
// an upgrade should not lock an operator out of their own container. But
// .env.example ships both values empty, so the default deployment published its
// internals and its import controls to anyone who guessed the path, and the
// only notice was a line in the container log nobody reads. Sending the first
// visitor to a setup form costs an operator one page; the other direction costs
// them a dashboard they never knew was reachable.
//
// STATS_PUBLIC=true still restores the open behaviour for anyone who wants it,
// as a decision someone made rather than one made for them by an empty
// variable.

const SETUP_PATH = '/stats/setup';

let warnedAboutPublicDashboard = false;

function plainText(body: string, status: number): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
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

/** The Basic credentials in a request, or null if there are none to read. */
function readBasicAuth(request: NextRequest): { username: string; password: string } | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Basic ')) return null;

  let decoded: string;
  try {
    decoded = atob(header.slice('Basic '.length));
  } catch {
    return null;
  }

  // Only the first colon separates the two; passwords may contain colons.
  const separator = decoded.indexOf(':');
  if (separator === -1) return null;

  return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isSetupPage = pathname === SETUP_PATH || pathname.startsWith(`${SETUP_PATH}/`);
  const resolved = resolveAuthMode();

  // A database that cannot be read cannot say whether an account exists, and
  // "cannot tell" must not resolve to "let them in".
  if ('error' in resolved) {
    console.error(`[auth] refused ${pathname}: cannot read the credential store: ${resolved.error}`);
    return plainText(
      'Systemstatus är otillgänglig.\n\nDatabasen kunde inte läsas, så inloggningen kan inte kontrolleras.\n',
      503
    );
  }

  const { mode } = resolved;

  // The setup page only exists while there is nothing to log in with. Once
  // there is, it is not merely useless but misleading, so it goes away.
  if (isSetupPage) {
    if (mode === 'setup') return NextResponse.next();
    return NextResponse.redirect(new URL('/stats', request.url));
  }

  if (mode === 'public') {
    if (!warnedAboutPublicDashboard) {
      warnedAboutPublicDashboard = true;
      console.warn('[auth] /stats is public by configuration (STATS_PUBLIC=true).');
    }
    return NextResponse.next();
  }

  if (mode === 'setup') {
    // A browser gets the form. The import API gets a sentence, because a
    // redirect to an HTML page is not a useful answer to a fetch().
    if (pathname.startsWith('/api/')) {
      return plainText(
        'Systemstatus är inte konfigurerad ännu.\n\n' +
          'Öppna /stats/setup för att välja användarnamn och lösenord, eller\n' +
          'sätt STATS_USER och STATS_PASSWORD.\n',
        503
      );
    }
    console.log(`[auth] ${pathname} -> ${SETUP_PATH}: no admin account and no STATS_USER set`);
    return NextResponse.redirect(new URL(SETUP_PATH, request.url));
  }

  const provided = readBasicAuth(request);
  if (!provided) return unauthorized();

  try {
    if (!verifyCredentials(provided.username, provided.password)) {
      return unauthorized();
    }
  } catch (error) {
    console.error(`[auth] refused ${pathname}: credential check failed: ${String(error)}`);
    return plainText('Systemstatus är otillgänglig.\n', 503);
  }

  return NextResponse.next();
}

export const config = {
  // /api/import is included because it can start a multi-hour job against a
  // third-party API, not something an anonymous visitor should be able to
  // trigger, or cancel. /api/admin/setup is deliberately absent: it is how you
  // get credentials in the first place, and it guards itself.
  matcher: ['/stats/:path*', '/api/import/:path*'],
};
