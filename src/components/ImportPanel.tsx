'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImportSnapshot } from '@/lib/brottsplatskartanRunner';

// Live view of the brottsplatskartan import, on /stats.
//
// Progress arrives over server-sent events, so a running import moves here
// without the operator reloading anything. If the stream cannot be opened
// (an old proxy that buffers, a browser that gave up), it falls back to
// polling the same JSON: the panel is the way to tell whether an import is
// working, so it must not go blank.

const ENDPOINT = '/api/import/brottsplatskartan';
const POLL_INTERVAL_MS = 3000;

interface DumpFile {
  name: string;
  bytes: number;
  modified: string;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '–';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '–';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  const h = Math.floor(m / 60);
  return `${h} tim ${m % 60} min`;
}

const STATUS_LABEL: Record<string, string> = {
  idle: 'Vilande',
  running: 'Pågår',
  complete: 'Klar',
  failed: 'Misslyckad',
  cancelled: 'Avbruten',
};

const MODE_LABEL: Record<string, string> = {
  full: 'full import',
  incremental: 'inkrementell import',
  ndjson: 'dumpimport',
};

export default function ImportPanel() {
  const [snapshot, setSnapshot] = useState<ImportSnapshot | null>(null);
  const [dumps, setDumps] = useState<DumpFile[]>([]);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  const loadDumps = useCallback(async () => {
    try {
      const response = await fetch(ENDPOINT, { cache: 'no-store' });
      if (!response.ok) return;
      const data = (await response.json()) as ImportSnapshot & { dumps?: DumpFile[] };
      setSnapshot(data);
      setDumps(data.dumps ?? []);
      setSource((current) => current || data.dumps?.[0]?.name || '');
    } catch {
      // The panel keeps whatever it already has.
    }
  }, []);

  useEffect(() => {
    void loadDumps();
  }, [loadDumps]);

  // Stream progress; fall back to polling if the stream will not stay up.
  useEffect(() => {
    let stream: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | undefined;
    let closed = false;

    const startPolling = () => {
      if (poll || closed) return;
      setLive(false);
      poll = setInterval(() => {
        fetch(ENDPOINT, { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .then((data) => data && setSnapshot(data as ImportSnapshot))
          .catch(() => {});
      }, POLL_INTERVAL_MS);
    };

    try {
      stream = new EventSource(`${ENDPOINT}/stream`);
      stream.onopen = () => setLive(true);
      stream.onmessage = (event) => {
        try {
          setSnapshot(JSON.parse(event.data) as ImportSnapshot);
          setLive(true);
        } catch {
          // Ignore a truncated frame; the next one is a full snapshot.
        }
      };
      stream.onerror = () => {
        // EventSource reconnects on its own, but if the endpoint is
        // unreachable that retry loop is silent. Poll alongside it.
        setLive(false);
        startPolling();
      };
    } catch {
      startPolling();
    }

    return () => {
      closed = true;
      stream?.close();
      if (poll) clearInterval(poll);
    };
  }, []);

  // Keep the newest log line in view.
  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [snapshot?.log?.length]);

  const send = useCallback(
    async (init: RequestInit) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(ENDPOINT, {
          ...init,
          headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) setError(data.error ?? `Fel ${response.status}`);
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setBusy(false);
        void loadDumps();
      }
    },
    [loadDumps]
  );

  const start = (body: Record<string, unknown>) => send({ method: 'POST', body: JSON.stringify(body) });
  const cancel = () => send({ method: 'DELETE' });

  const state = snapshot?.state;
  const progress = snapshot?.progress ?? null;
  const running = snapshot?.running ?? false;
  const percent = progress?.percent ?? (running ? null : snapshot?.percentComplete ?? null);
  const progressLabel = running
    ? percent !== null
      ? `${percent.toFixed(1)}%`
      : 'Pågår…'
    : 'Ingen körning pågår';

  return (
    <section className="ops-section">
      <h2 className="ops-section-title">
        Import från brottsplatskartan
        <span className={`dot dot--sm${live ? ' dot--ok is-pulsing' : ''}`} title={live ? 'Direktström' : 'Pollning'} />
      </h2>

      <div className="stats-grid">
        <div className="stat">
          <span className="stat-value">{(state?.storedEvents ?? 0).toLocaleString('sv-SE')}</span>
          <span className="stat-label">Lagrade händelser</span>
        </div>
        <div className={`stat stat--${running ? 'warn' : state?.status === 'failed' ? 'alert' : 'ok'}`}>
          <span className="stat-value">{STATUS_LABEL[state?.status ?? 'idle'] ?? state?.status}</span>
          <span className="stat-label">
            {running && progress ? MODE_LABEL[progress.mode] : state?.mode ? MODE_LABEL[state.mode] : 'Status'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-value">{(progress?.imported ?? state?.imported ?? 0).toLocaleString('sv-SE')}</span>
          <span className="stat-label">Nya i körningen</span>
        </div>
        <div className="stat">
          <span className="stat-value">{snapshot?.coveragePercent !== null && snapshot?.coveragePercent !== undefined ? `${snapshot.coveragePercent}%` : '–'}</span>
          <span className="stat-label">Täckning mot API</span>
        </div>
      </div>

      <div className="card-grid">
        <div className="card">
          <h3 className="card-title">Pågående körning</h3>

          {/* The label is a sibling of the bar, not a child of it. Inside, it
              was clipped away entirely: .ops-progress is a 6px track with
              overflow:hidden, so the one number telling an operator how far a
              multi-hour import had got rendered into nothing. */}
          <div
            className="ops-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
            aria-valuetext={progressLabel}
            aria-label="Importens förlopp"
          >
            <div
              className={`ops-progress-fill ${running ? 'ops-progress-fill--active' : ''}`}
              style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }}
            />
          </div>
          <p className="ops-progress-text">{progressLabel}</p>

          <div className="info-list">
            <div className="info-row">
              <span className="info-label">Källa</span>
              <span className="info-value">{progress?.source ?? (running ? 'API' : '–')}</span>
            </div>
            {progress?.linesRead !== null && progress?.linesRead !== undefined && (
              <div className="info-row">
                <span className="info-label">Rader lästa</span>
                <span className="info-value">
                  {progress.linesRead.toLocaleString('sv-SE')} ({formatBytes(progress.bytesRead)}
                  {progress.bytesTotal ? ` av ${formatBytes(progress.bytesTotal)}` : ''})
                </span>
              </div>
            )}
            {progress?.pagesDone !== null && progress?.pagesDone !== undefined && (
              <div className="info-row">
                <span className="info-label">Sidor</span>
                <span className="info-value">
                  {progress.pagesDone.toLocaleString('sv-SE')}
                  {progress.totalPages ? ` av ${progress.totalPages.toLocaleString('sv-SE')}` : ''}
                </span>
              </div>
            )}
            <div className="info-row">
              <span className="info-label">Nya / dubbletter / överhoppade</span>
              <span className="info-value">
                {(progress?.imported ?? 0).toLocaleString('sv-SE')} / {(progress?.duplicates ?? 0).toLocaleString('sv-SE')} /{' '}
                {(progress?.skipped ?? 0).toLocaleString('sv-SE')}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Takt</span>
              <span className="info-value">
                {progress?.perSecond ? `${progress.perSecond.toLocaleString('sv-SE')} /s` : '–'}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Återstår</span>
              <span className="info-value">{formatDuration(progress?.etaSeconds ?? null)}</span>
            </div>
            {state?.lastError && (
              <div className="info-row">
                <span className="info-label">Senaste fel</span>
                <span className="info-value info-value--muted">{state.lastError}</span>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">Starta en import</h3>

          <div className="ops-controls">
            <label className="section-label" htmlFor="bpk-source">
              NDJSON-dump (fil i datakatalogen eller http(s)-URL)
            </label>
            <div className="ops-row">
              <input
                id="bpk-source"
                className="field"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="brottsplatskartan.ndjson"
                list="bpk-dumps"
                spellCheck={false}
              />
              <datalist id="bpk-dumps">
                {dumps.map((dump) => (
                  <option key={dump.name} value={dump.name}>
                    {formatBytes(dump.bytes)}
                  </option>
                ))}
              </datalist>
              <button
                type="button"
                className="btn"
                disabled={busy || running || source.trim() === ''}
                onClick={() => start({ mode: 'ndjson', source })}
              >
                Importera dump
              </button>
            </div>

            {dumps.length > 0 && (
              <p className="ops-hint">
                Hittade i datakatalogen: {dumps.map((d) => `${d.name} (${formatBytes(d.bytes)})`).join(', ')}
              </p>
            )}

            <div className="ops-row">
              <button
                type="button"
                className="btn-quiet"
                disabled={busy || running}
                onClick={() => start({ mode: 'incremental' })}
              >
                Inkrementell synk
              </button>
              <button
                type="button"
                className="btn-quiet"
                disabled={busy || running}
                onClick={() => start({ mode: 'full' })}
              >
                Full API-import
              </button>
              <button type="button" className="btn-quiet btn-quiet--danger" disabled={busy || !running} onClick={cancel}>
                Avbryt
              </button>
            </div>

            {error && <p className="ops-alert">{error}</p>}
          </div>

          <h3 className="card-title">Logg</h3>
          <div className="ops-log" ref={logRef}>
            {(snapshot?.log ?? []).length === 0 ? (
              <p className="ops-hint">Inga händelser ännu.</p>
            ) : (
              (snapshot?.log ?? []).map((entry, index) => (
                <div key={`${entry.at}-${index}`} className="ops-log-line">
                  <span className="ops-log-time">{entry.at.slice(11, 19)}</span>
                  <span>{entry.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
