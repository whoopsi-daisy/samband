import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { resolveAuthMode, verifyCredentials } from '@/lib/adminAuth';
import { THEME_SCRIPT } from '@/lib/themeScript';

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

/*
 * The Content-Security-Policy, built per request.
 *
 * It used to be a static header in next.config.js, and it had to carry
 * `script-src 'unsafe-inline'` because a page carries twenty-two inline
 * scripts: seven of them are Next's own streamed React payload, which cannot
 * be hashed because it differs per render, and one is the theme bootstrap that
 * has to run before first paint. `'unsafe-inline'` allows all of them, and
 * also allows any script an injection manages to put on the page, which is
 * the one thing the policy exists to stop.
 *
 * A per-request nonce fixes it. Next reads the nonce out of this header and
 * stamps it on its own scripts; the theme bootstrap is a constant, so it is
 * allowed by digest instead — computed here from the same module the layout
 * renders, so the two cannot drift apart.
 *
 * `style-src` keeps 'unsafe-inline'. React writes inline styles for every
 * chart bar, marker colour and progress track in the app, and there is no
 * nonce path for a style attribute. It is also a much smaller hole: CSS
 * injection cannot execute.
 */
const THEME_SCRIPT_HASH = `sha256-${crypto.createHash('sha256').update(THEME_SCRIPT).digest('base64')}`;

function contentSecurityPolicy(nonce: string): string {
  // React's development build and the dev server's hot-reload client both use
  // eval(), and hot reload talks over a websocket. Production keeps neither.
  const development = process.env.NODE_ENV !== 'production';

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' '${THEME_SCRIPT_HASH}'${development ? " 'unsafe-eval' 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // The OSM fallback layer requests the bare host tile.openstreetmap.org,
    // which a '*.' wildcard does NOT match: it has to be listed separately or
    // the fallback is blocked exactly when CartoDB is down and it is needed.
    "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com",
    "font-src 'self'",
    `connect-src 'self' https://polisen.se https://*.basemaps.cartocdn.com https://tile.openstreetmap.org${development ? ' ws: wss:' : ''}`,
    "frame-ancestors 'self'",
    // Nothing here embeds a plugin, posts to another origin, or wants a <base>
    // tag, and each is a way around the directives above if left at default.
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}

/** Whether this path is behind the dashboard login. */
function isGuarded(pathname: string): boolean {
  // /api/import can start a multi-hour job against a third-party API, or cancel
  // someone else's. /api/admin/setup is deliberately absent: it is how you get
  // credentials in the first place, and it guards itself.
  return pathname.startsWith('/stats') || pathname.startsWith('/api/import');
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = crypto.randomUUID();
  const policy = contentSecurityPolicy(nonce);

  const withPolicy = (response: NextResponse): NextResponse => {
    response.headers.set('Content-Security-Policy', policy);
    return response;
  };

  if (!isGuarded(request.nextUrl.pathname)) {
    // Forwarded on the request so Next can stamp the nonce onto the scripts it
    // streams. Reading the auth store for a path that is not guarded would be
    // a database round trip on every page view for nothing.
    const headers = new Headers(request.headers);
    headers.set('x-nonce', nonce);
    return withPolicy(NextResponse.next({ request: { headers } }));
  }

  return withPolicy(guard(request));
}

function guard(request: NextRequest): NextResponse {
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
  /*
   * Everything, now that this also carries the Content-Security-Policy.
   *
   * It used to match only the two guarded prefixes. The policy has to be on
   * every document, and the nonce in it has to be generated per request, so the
   * static header in next.config.js could not do it.
   *
   * Excluded: Next's build output and image optimiser, and the files served
   * straight out of public/. None of them is a document, none can carry a
   * script, and running middleware on every icon is work for nothing.
   */
  matcher: [
    '/((?!_next/static|_next/image|icons/|screenshots/|geo/|favicon.ico|manifest.json|og.png|sw.js).*)',
  ],
};
