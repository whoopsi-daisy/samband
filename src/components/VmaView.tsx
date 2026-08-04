'use client';

import { memo } from 'react';
import { VmaAlert, VmaSeverity } from '@/types';
import { useMounted } from '@/hooks/useMounted';

interface VmaViewProps {
  alerts: VmaAlert[];
  live: VmaAlert[];
  failed: boolean;
  loading: boolean;
  onRetry: () => void;
}

/** How serious SR says it is, in words rather than a CAP enum. */
const SEVERITY_LABEL: Record<VmaSeverity, string> = {
  Extreme: 'Extrem fara',
  Severe: 'Allvarlig fara',
  Moderate: 'Måttlig fara',
  Minor: 'Mindre fara',
  Unknown: 'Okänd allvarlighetsgrad',
};

const URGENCY_LABEL: Record<string, string> = {
  immediate: 'Agera omedelbart',
  expected: 'Agera snart',
  future: 'Agera senare',
  past: 'Faran är över',
};

/**
 * Why a message is not a live warning, in the reader's words.
 *
 * SR sends three non-live kinds over the same endpoint and they are not the
 * same thing: `Exercise` is the quarterly siren drill people actually hear,
 * `Test` is an internal system test, and a `Cancel` ends an announcement that
 * was real. Calling a drill a "test" would tell someone who just heard the
 * sirens the wrong thing, so each keeps its own word.
 */
const STATUS_LABEL: Record<string, string> = {
  exercise: 'Övning',
  test: 'Systemtest',
  draft: 'Utkast',
  system: 'Systemmeddelande',
};

function badgeLabel(alert: VmaAlert, live: boolean): string {
  if (alert.msgType.toLowerCase() === 'cancel') return 'Återkallat';
  const status = alert.status.toLowerCase();
  if (status !== 'actual') return STATUS_LABEL[status] ?? 'Inte skarpt';
  // A real warning that has run out: a record of something that happened, and
  // it must not read like the severity badge on a live one.
  if (!live) return 'Avslutat';
  return SEVERITY_LABEL[alert.severity];
}

function formatTime(iso: string): string {
  const at = new Date(iso);
  if (isNaN(at.getTime())) return '';
  return at.toLocaleString('sv-SE', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function AlertCard({ alert, live }: { alert: VmaAlert; live: boolean }) {
  const mounted = useMounted();
  const when = mounted ? formatTime(alert.sent) : '';
  const urgency = URGENCY_LABEL[alert.urgency.toLowerCase()];

  return (
    <article className={`vma-card${live ? ' vma-card--live' : ''}`}>
      <div className="vma-card-head">
        <span className={`badge ${live ? 'badge--alert' : 'badge--neutral'}`}>
          {badgeLabel(alert, live)}
        </span>
        {urgency && live && <span className="badge badge--neutral">{urgency}</span>}
        {when && <span className="vma-card-time">{when}</span>}
      </div>

      <h3 className="vma-card-title">{alert.headline || alert.event || 'Viktigt meddelande'}</h3>

      {alert.areas.length > 0 && <p className="vma-card-areas">{alert.areas.join(', ')}</p>}

      {alert.description && <p className="vma-card-text">{alert.description}</p>}

      {/* What to actually do. CAP separates this from the description for a
          reason, and it is the part a reader needs first, so it is set apart
          rather than run together with the rest. */}
      {alert.instruction && (
        <div className="vma-card-instruction">
          <p className="section-label">Det här ska du göra</p>
          <p>{alert.instruction}</p>
        </div>
      )}

      <p className="vma-card-source">
        {alert.senderName ? `${alert.senderName} via ` : ''}Sveriges Radio
        {alert.web && (
          <>
            {' · '}
            <a href={alert.web} target="_blank" rel="noopener noreferrer">
              Mer information
            </a>
          </>
        )}
      </p>
    </article>
  );
}

function VmaView({ alerts, live, failed, loading, onRetry }: VmaViewProps) {
  const liveIds = new Set(live.map((a) => a.id));
  const others = alerts.filter((a) => !liveIds.has(a.id));

  if (loading && alerts.length === 0) {
    return (
      <div className="loading-center">
        <span className="spinner" />
      </div>
    );
  }

  return (
    <section aria-label="Viktigt meddelande till allmänheten">
      {/* If SR could not be reached and there is nothing to show, the page must
          say that and nothing else. "Inget VMA är utfärdat just nu" is a claim
          about the world, and it is not one this page can make while it is
          unable to ask. */}
      {failed && live.length === 0 && (
        <div className="vma-clear vma-clear--failed" role="alert">
          <p className="vma-clear-title">Vi vet inte just nu</p>
          {/* Tightened, not trimmed. This block is the page's role="alert", so
              it is what a screen reader announces; the footnote below is not.
              Everything a reader needs while the source is unreachable has to
              be inside it, including the 112 the footnote also carries. */}
          <p className="vma-clear-text">
            Sveriges Radios VMA-tjänst går inte att nå, så sidan kan inte säga om ett VMA är
            utfärdat. Lyssna på P4 eller se{' '}
            <a href="https://sverigesradio.se/vma" target="_blank" rel="noopener noreferrer">
              sverigesradio.se/vma
            </a>
            . Ring 112 vid akut fara.
          </p>
          <p className="vma-clear-actions">
            <button type="button" className="btn-ghost" onClick={onRetry}>
              Försök igen
            </button>
          </p>
        </div>
      )}

      {live.length > 0 && (
        <div className="vma-list">
          {live.map((alert) => (
            <AlertCard key={alert.id} alert={alert} live />
          ))}
        </div>
      )}

      {!failed && live.length === 0 && (
        /* No warning is the normal state, and the page has to say so plainly
           rather than looking like it failed to load. */
        <div className="vma-clear vma-clear--quiet">
          {/* The normal state, and it should look like one. A card styled the
              same as a live warning makes a reader check twice to work out
              that nothing is happening. */}
          <p className="vma-clear-title">
            <span className="dot dot--sm" aria-hidden="true" />
            Inget VMA är utfärdat just nu
          </p>
          {/* The state this page is in almost always, so it is a line and not
              a paragraph. The examples that used to be here explained what a
              VMA is to someone who is not currently in one. */}
          <p className="vma-clear-text">
            Ett VMA skickas ut vid omedelbar fara för liv, hälsa eller egendom. Sidan hämtar dem
            från Sveriges Radio varje minut.
          </p>
        </div>
      )}

      {/* With a warning on screen, the outage is a caveat on what is shown
          rather than the whole story. */}
      {failed && live.length > 0 && (
        <p className="notice notice--alert" role="alert">
          Kunde inte nå Sveriges Radios VMA-tjänst. Det som visas här kan vara inaktuellt.{' '}
          <button type="button" className="clear-all" onClick={onRetry}>
            Försök igen
          </button>
        </p>
      )}

      {others.length > 0 && (
        <div className="vma-past">
          {/* Not "tidigare": an exercise running right now lands here too, and
              the one thing every message in this section has in common is that
              none of them is a warning to act on. */}
          <h2 className="section-label">Inte aktuella just nu</h2>
          <div className="vma-list">
            {others.map((alert) => (
              <AlertCard key={alert.id} alert={alert} live={false} />
            ))}
          </div>
        </div>
      )}

      <p className="vma-footnote">
        Källa: Sveriges Radios VMA-API. Vid fara, följ myndigheternas kanaler:{' '}
        <a href="https://sverigesradio.se/vma" target="_blank" rel="noopener noreferrer">
          sverigesradio.se/vma
        </a>{' '}
        och{' '}
        <a href="https://www.krisinformation.se" target="_blank" rel="noopener noreferrer">
          krisinformation.se
        </a>
        .
      </p>
    </section>
  );
}

export default memo(VmaView);
