'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The 404.
 *
 * A dispatch centre that cannot find something does not show a stack trace, it
 * sweeps the area and reports back. The scope below is the page: three rings, a
 * beam going round, and returns that light up as it passes and fade behind it.
 * None of them is the thing being looked for, which is the joke and also the
 * status.
 *
 * Everything here is CSS on top of one small SVG. No canvas, no library, no
 * request: a 404 is the one page that has to render when things have already
 * gone wrong.
 */
export default function NotFound() {
  const pathname = usePathname();

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

      <div className="lost-scope" role="img" aria-label="En radarskärm som sveper utan att hitta något.">
        <svg className="lost-grid" viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r="96" />
          <circle cx="100" cy="100" r="66" />
          <circle cx="100" cy="100" r="36" />
          <line x1="100" y1="4" x2="100" y2="196" />
          <line x1="4" y1="100" x2="196" y2="100" />
        </svg>
        <span className="lost-sweep" aria-hidden="true" />
        {/* Angles and delays are one number: a return lights when the beam
            reaches its bearing, so each delay is its angle as a fraction of a
            full turn. */}
        <span className="lost-blip" style={{ '--bearing': '52deg', '--reach': '0.58s' } as React.CSSProperties} />
        <span className="lost-blip" style={{ '--bearing': '148deg', '--reach': '1.64s' } as React.CSSProperties} />
        <span className="lost-blip" style={{ '--bearing': '263deg', '--reach': '2.92s' } as React.CSSProperties} />
        <span className="lost-centre" aria-hidden="true" />
      </div>

      <p className="lost-code">404</p>
      <h1 className="lost-title">Ingen träff</h1>
      <p className="lost-text">
        Vi har svept av området och hittar ingen sida på{' '}
        <code className="lost-path">{pathname}</code>. Ingen anmälan har upprättats.
      </p>

      <div className="lost-actions">
        <Link className="btn" href="/">
          Till flödet
        </Link>
        <Link className="btn-quiet" href="/?vy=karta">
          Öppna kartan
        </Link>
      </div>

      {/* No 112 here. It belongs on the VMA page, where the reader may
          actually be in danger; on a mistyped URL it is a serious number used
          as a punchline. */}
      <p className="lost-note">
        Om du kom hit från en länk inne i appen är det vårt fel, inte ditt. Gå tillbaka, eller
        börja om från flödet.
      </p>
    </main>
  );
}
