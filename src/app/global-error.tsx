'use client';

/**
 * The root layout itself threw.
 *
 * This replaces <html> and <body>, so none of the app's chrome, fonts or
 * stylesheet are guaranteed to be there: the design system lives in a CSS file
 * imported by the layout that just failed. Everything here is therefore inline
 * and deliberately plain, and there is no Link, because the router is part of
 * what may be broken.
 *
 * The colours are the palette's own values written out literally, for the same
 * reason: a custom property defined in a stylesheet that did not load resolves
 * to nothing.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="sv">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#f2f5f9',
          color: '#0e1520',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: '32rem' }}>
          <p
            style={{
              margin: 0,
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#5e6b7a',
            }}
          >
            Sambandscentralen
          </p>
          <h1 style={{ margin: '8px 0 0', fontSize: '22px', lineHeight: 1.25 }}>
            Sidan kunde inte startas
          </h1>
          <p style={{ margin: '12px 0 0', fontSize: '15px', lineHeight: 1.55, color: '#37424f' }}>
            Något gick fel innan sidan hann ritas upp. Ladda om, eller försök igen om en stund.
          </p>
          <p style={{ margin: '24px 0 0' }}>
            <button
              type="button"
              onClick={reset}
              style={{
                height: '40px',
                padding: '0 16px',
                border: '1px solid #0d5cad',
                borderRadius: '6px',
                background: '#0d5cad',
                color: '#f2f5f9',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Ladda om
            </button>
          </p>
          {error.digest && (
            <p style={{ margin: '24px 0 0', fontSize: '12px', color: '#5e6b7a' }}>
              Referens {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
