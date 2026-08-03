import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * What this is, and what it is not.
 *
 * A feed of police notices, named after a dispatch centre, behind a mark of
 * concentric rings, can be read as something the police run. It is not, and
 * before this page nothing anywhere on the site said so. The rest is the
 * things a reader is entitled to ask of a site that republishes somebody
 * else's data: where it comes from, how current it is, and what is collected
 * about them for looking at it.
 */
export const metadata: Metadata = {
  title: 'Om Sambandscentralen',
  description:
    'Vad Sambandscentralen är, varifrån uppgifterna kommer och vad som gäller. En inofficiell tjänst utan koppling till Polisen.',
  alternates: { canonical: '/om' },
};

export default function AboutPage() {
  return (
    <main className="about" id="main-content">
      <Link className="about-brand" href="/">
        <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" aria-hidden="true">
          <circle cx="20" cy="20" r="13" strokeWidth="2.5" opacity="0.35" />
          <circle cx="20" cy="20" r="8" strokeWidth="2.5" />
          <circle cx="20" cy="20" r="3.4" fill="currentColor" stroke="none" />
        </svg>
        <span>Sambandscentralen</span>
      </Link>

      <h1 className="about-title">Om sidan</h1>

      {/* First, before anything else, and marked so it cannot be skimmed past. */}
      <p className="notice notice--alert about-lead">
        <strong>Det här är inte Polisen.</strong> Sambandscentralen är en fristående tjänst utan
        koppling till Polismyndigheten eller någon annan myndighet. Vid pågående fara, ring 112.
        Vid annat, använd{' '}
        <a href="https://polisen.se" target="_blank" rel="noopener noreferrer">
          polisen.se
        </a>{' '}
        eller ring 114 14.
      </p>

      <h2 className="about-heading">Vad sidan gör</h2>
      <p className="about-text">
        Den hämtar polisens publicerade händelsenotiser och visar dem i en lista, på en karta och
        som statistik. Ingenting skrivs om, tolkas eller bedöms: en notis här säger exakt det
        polisen skrev, och inget mer. Sidan hämtar nytt var tionde minut.
      </p>
      <p className="about-text">
        En notis är inte en dom och inte en utredning. Den beskriver vad polisen skrev ned när en
        anmälan togs emot, ofta innan något är klarlagt, och den rättas sällan i efterhand.
      </p>

      <h2 className="about-heading">Var uppgifterna kommer ifrån</h2>
      <ul className="about-list">
        <li>
          Händelsenotiser från{' '}
          <a href="https://polisen.se/aktuellt/handelser/" target="_blank" rel="noopener noreferrer">
            polisen.se
          </a>
          , via deras öppna API.
        </li>
        <li>
          Äldre händelser, om de har importerats, från{' '}
          <a href="https://brottsplatskartan.se" target="_blank" rel="noopener noreferrer">
            Brottsplatskartan
          </a>
          . De är daterade när de publicerades, inte när de inträffade.
        </li>
        <li>
          Viktigt meddelande till allmänheten (VMA) från{' '}
          <a href="https://sverigesradio.se/vma" target="_blank" rel="noopener noreferrer">
            Sveriges Radio
          </a>
          . Följ alltid myndigheternas egna kanaler vid fara.
        </li>
        <li>
          Kartdata från{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
            OpenStreetMap
          </a>{' '}
          och kartbilder från{' '}
          <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">
            CARTO
          </a>
          .
        </li>
      </ul>

      <h2 className="about-heading">Var punkterna sitter</h2>
      <p className="about-text">
        Polisen anger ofta en kommun eller ett län, inte en adress. Kartan sätter då punkten mitt i
        det området, vilket är den enda ärliga tolkningen av det som står. En punkt är alltså
        ungefär var anmälan skrevs, inte exakt var något hände.
      </p>

      <h2 className="about-heading">Vad som samlas in om dig</h2>
      <p className="about-text">
        Ingenting. Sidan har inga kakor, ingen inloggning för besökare, ingen analys och inga
        tredjepartsskript. Ditt val av ljust eller mörkt läge sparas lokalt i din egen webbläsare
        och skickas aldrig någonstans. Kartbilderna hämtas från CARTO eller OpenStreetMap, som
        därmed ser att din webbläsare bad om en kartruta.
      </p>

      <h2 className="about-heading">Fel och frågor</h2>
      <p className="about-text">
        Är en notis fel är den fel hos källan, och sidan kan inte rätta den. Är sidan fel går den
        att felanmäla där koden ligger.
      </p>

      <p className="about-actions">
        <Link className="btn" href="/">
          Till flödet
        </Link>
      </p>
    </main>
  );
}
