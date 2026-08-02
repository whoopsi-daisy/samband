'use client';

import { useId, useState } from 'react';

interface AdminSetupFormProps {
  /** False when ADMIN_SETUP_OPEN=true, which drops the installation key. */
  tokenRequired: boolean;
}

const MIN_PASSWORD_LENGTH = 12;

/**
 * The page has no header: /stats does not get one either, and the app shell
 * would be the wrong frame around a form that runs before the app is usable.
 * A wordmark still has to say whose machine this is, so it is here and small.
 */
function SetupShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="ops-container setup">
      <div className="setup-column">
        <p className="setup-brand">
          <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" aria-hidden="true">
            <circle cx="20" cy="20" r="13" strokeWidth="2.5" opacity="0.35" />
            <circle cx="20" cy="20" r="8" strokeWidth="2.5" />
            <circle cx="20" cy="20" r="3.4" fill="currentColor" stroke="none" />
          </svg>
          Sambandscentralen
        </p>
        {children}
      </div>
    </div>
  );
}

export default function AdminSetupForm({ tokenRequired }: AdminSetupFormProps) {
  const ids = useId();
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  // The two fields are compared here rather than at the endpoint: the server
  // has no use for a second copy of the password, and a typo should not cost a
  // round trip to find out about.
  const mismatch = confirmation.length > 0 && password !== confirmation;
  const ready =
    username.trim().length >= 3 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password === confirmation &&
    (!tokenRequired || token.trim().length > 0);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, token: token.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; username?: string };

      if (!response.ok) {
        setError(payload.error || 'Kontot kunde inte skapas.');
        return;
      }
      setCreated(payload.username || username.trim());
    } catch {
      setError('Servern svarade inte. Försök igen.');
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <SetupShell>
        <div className="setup-panel card">
          <h1 className="setup-title">Klart</h1>
          <p className="setup-lead">
            Kontot <strong>{created}</strong> är skapat. Systemstatus frågar nu efter det
            användarnamnet och lösenordet.
          </p>
          {/* A plain link, not a router push: the next request has to reach the
              proxy so the browser gets the 401 that opens the login prompt. */}
          <a className="btn setup-submit" href="/stats">
            Gå till systemstatus
          </a>
        </div>
      </SetupShell>
    );
  }

  return (
    <SetupShell>
      <form className="setup-panel card" onSubmit={handleSubmit}>
        <h1 className="setup-title">Skapa administratörskonto</h1>
        <p className="setup-lead">
          Systemstatus visar hämtningsloggar, felhistorik och databasens innehåll, och styr
          importen från brottsplatskartan. Den behöver en inloggning. Det här görs en gång.
        </p>

        {tokenRequired && (
          <div className="setup-field">
            <label className="setup-label" htmlFor={`${ids}-token`}>
              Installationsnyckel
            </label>
            <input
              id={`${ids}-token`}
              className="field setup-input"
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
              aria-describedby={`${ids}-token-hint`}
            />
            <p className="setup-hint" id={`${ids}-token-hint`}>
              Står i containerns logg vid start, och i <code>admin-setup-token.txt</code> i
              datakatalogen. Utan den skulle den som hittar adressen först kunna ta panelen.
            </p>
          </div>
        )}

        <div className="setup-field">
          <label className="setup-label" htmlFor={`${ids}-user`}>
            Användarnamn
          </label>
          <input
            id={`${ids}-user`}
            className="field setup-input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            spellCheck={false}
            minLength={3}
            maxLength={64}
            required
          />
        </div>

        <div className="setup-field">
          <label className="setup-label" htmlFor={`${ids}-password`}>
            Lösenord
          </label>
          <input
            id={`${ids}-password`}
            className="field setup-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            aria-describedby={`${ids}-password-hint`}
          />
          <p className="setup-hint" id={`${ids}-password-hint`}>
            Minst {MIN_PASSWORD_LENGTH} tecken. Sparas som en scrypt-hash, inte i klartext.
          </p>
        </div>

        <div className="setup-field">
          <label className="setup-label" htmlFor={`${ids}-confirm`}>
            Upprepa lösenordet
          </label>
          <input
            id={`${ids}-confirm`}
            className="field setup-input"
            type="password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="new-password"
            required
            aria-invalid={mismatch}
            aria-describedby={mismatch ? `${ids}-confirm-error` : undefined}
          />
          {mismatch && (
            <p className="setup-hint setup-hint--alert" id={`${ids}-confirm-error`}>
              Lösenorden matchar inte.
            </p>
          )}
        </div>

        {error && (
          <p className="ops-alert" role="alert">
            {error}
          </p>
        )}

        <button className="btn setup-submit" type="submit" disabled={!ready || submitting}>
          {submitting ? 'Skapar…' : 'Skapa konto'}
        </button>

        <p className="setup-footnote">
          Föredrar du att styra inloggningen från miljön? Sätt <code>STATS_USER</code> och{' '}
          <code>STATS_PASSWORD</code> och starta om. De har företräde framför kontot här.
        </p>
      </form>
    </SetupShell>
  );
}
