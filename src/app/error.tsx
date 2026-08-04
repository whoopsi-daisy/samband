'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { reportClientError } from '@/lib/reportClientError';

/**
 * A render that threw.
 *
 * Without this the reader gets Next's own grey "Application error: a
 * client-side exception has occurred", which says nothing, offers nothing and
 * looks like the site is gone. The one thing worth saying here is that the
 * feed itself is probably fine, because it usually is: the failure is in one
 * view, and reloading or going back to the list gets round it.
 *
 * `digest` is the only detail shown. The message is deliberately not: it comes
 * from a stack the reader cannot act on, and on a public site it is a way to
 * leak internals into a screenshot.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server log is where this belongs, and the container is watching it.
    // This was a `console.error`, which in a client component means the
    // visitor's own devtools: a production render crash was invisible to the
    // operator by construction.
    reportClientError(error, error.digest);
  }, [error]);

  return (
    <main className="lost" id="main-content">
      <Link className="lost-brand" href="/">
        <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" aria-hidden="true">
          <circle cx="20" cy="20" r="13" strokeWidth="2.5" opacity="0.35" />
          <circle cx="20" cy="20" r="8" strokeWidth="2.5" />
          <circle cx="20" cy="20" r="3.4" fill="currentColor" stroke="none" />
        </svg>
        <span>Sambandscentralen</span>
      </Link>

      <p className="lost-code">Avbrott</p>
      <h1 className="lost-title">Något gick fel här</h1>
      <p className="lost-text">
        Vyn du var på kunde inte ritas upp. Flödet i sig är sannolikt oskadat, så det går oftast
        att fortsätta direkt.
      </p>

      <div className="lost-actions">
        <button type="button" className="btn" onClick={reset}>
          Försök igen
        </button>
        <Link className="btn-quiet" href="/">
          Till flödet
        </Link>
      </div>

      {error.digest && (
        <p className="lost-note">
          Referens <code className="lost-path">{error.digest}</code>. Den säger inget om dig, bara
          vilket fel det var, och finns i serverloggen.
        </p>
      )}
    </main>
  );
}
