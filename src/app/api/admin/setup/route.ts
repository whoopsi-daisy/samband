import { NextRequest, NextResponse } from 'next/server';
import {
  AdminSetupError,
  createStoredAdmin,
  getEnvCredentials,
  hasStoredAdmin,
  isSetupOpen,
  verifySetupToken,
} from '@/lib/adminAuth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

// Create the dashboard account, once, on a fresh installation.
//
// This is the one route under /api that the proxy does not gate, because it is
// how the credentials it checks come to exist. It therefore does its own
// gating, and every one of these has to hold before a row is written:
//
//   - no STATS_USER/STATS_PASSWORD (those already are the credentials)
//   - no account in the database (this is first-run, not a password reset)
//   - the setup token matches, unless ADMIN_SETUP_OPEN=true
//
// The first two make the endpoint answer 409 for the entire life of a
// configured deployment, so it is not an open door left standing after setup.
export const dynamic = 'force-dynamic';

function conflict(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 409 });
}

export async function POST(request: NextRequest) {
  const limit = checkRateLimit(request);
  if (!limit.allowed) return rateLimitResponse(limit);

  if (getEnvCredentials()) {
    return conflict(
      'Inloggningen styrs av STATS_USER och STATS_PASSWORD. Ta bort dem för att välja lösenord här.'
    );
  }

  let stored: boolean;
  try {
    stored = hasStoredAdmin();
  } catch (error) {
    console.error('[auth] setup could not read the database:', error);
    return NextResponse.json({ error: 'Databasen kunde inte läsas.' }, { status: 503 });
  }
  if (stored) {
    return conflict('Ett administratörskonto finns redan.');
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Ogiltig begäran.' }, { status: 400 });
  }

  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const token = typeof body.token === 'string' ? body.token : '';

  if (!verifySetupToken(token)) {
    console.warn('[auth] setup rejected: wrong installation key');
    return NextResponse.json(
      { error: 'Fel installationsnyckel. Den står i containerns logg vid start.' },
      { status: 403 }
    );
  }

  try {
    const account = createStoredAdmin(username, password);
    return NextResponse.json(
      { username: account.username, createdAt: account.createdAt },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof AdminSetupError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[auth] setup failed:', error);
    return NextResponse.json({ error: 'Kontot kunde inte skapas.' }, { status: 500 });
  }
}

// Whether setup is still available, and whether it needs the key. The page
// renders from this on the server; the GET exists so a script can ask too.
export async function GET() {
  let stored = false;
  try {
    stored = hasStoredAdmin();
  } catch {
    return NextResponse.json({ error: 'Databasen kunde inte läsas.' }, { status: 503 });
  }

  return NextResponse.json(
    {
      configured: stored || getEnvCredentials() !== null,
      source: getEnvCredentials() ? 'env' : stored ? 'stored' : null,
      tokenRequired: !isSetupOpen(),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
