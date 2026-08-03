// Node-only startup work. Loaded by instrumentation.ts behind a runtime check.
//
// This lives in its own module because Next.js compiles instrumentation.ts for
// the Edge runtime as well, and everything reachable from it gets traced into
// that bundle. Anything touching better-sqlite3, fs or process.cwd, which is
// all of the below: fails that build. Keeping it behind a single dynamic
// import means the Edge bundle never reaches it.

import { refreshEventsIfNeeded } from '@/lib/policeApi';
import { pruneFetchLog, warmAggregateCaches } from '@/lib/db';
import { getBpkImportState } from '@/lib/brottsplatskartanDb';
import { reconcileImportState, startImport } from '@/lib/brottsplatskartanRunner';
import { getEnvCredentials, getSetupToken, hasStoredAdmin, isSetupOpen } from '@/lib/adminAuth';
import { isSiteUrlConfigured, siteUrl } from '@/lib/site';

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 min: matches the API cache window
const FETCH_LOG_RETENTION_DAYS = 30;

export function start(): void {
  checkSiteUrl();
  announceAdminSetup();
  startRefreshScheduler();
  startBrottsplatskartanImport();
}

// Share cards, the canonical link, robots.txt and the sitemap all have to name
// a host, and only this variable knows it. Wrong, it is invisible from inside
// the app and only shows up when somebody posts a link somewhere public.
function checkSiteUrl(): void {
  if (isSiteUrlConfigured()) return;
  console.warn(
    `[site] SITE_URL is not set; using ${siteUrl()} for share images, ` +
      'the canonical link and the sitemap. Set it to this deployment\'s own address.'
  );
}

// Print the installation key at boot, when there is still no way to log in to
// /stats. Minting it here rather than on the first request means it is on the
// same screen as the startup lines, which is where an operator is looking.
function announceAdminSetup(): void {
  try {
    if (getEnvCredentials() || hasStoredAdmin()) return;
    if (process.env.STATS_PUBLIC === 'true') return;
    if (isSetupOpen()) {
      console.warn(
        '[auth] no admin account yet. /stats/setup is open to anyone who reaches it ' +
          '(ADMIN_SETUP_OPEN=true).'
      );
      return;
    }
    getSetupToken();
  } catch (error) {
    // Never let the login banner be the reason the container fails to start.
    console.error('[auth] could not prepare the setup key:', error);
  }
}

// The app refreshes police events lazily inside the request path, which means
// that with no traffic the data goes stale. Since this is deployed as a
// long-running container, refresh on a timer regardless of traffic.
function startRefreshScheduler(): void {
  const tick = async (): Promise<void> => {
    try {
      await refreshEventsIfNeeded();
      pruneFetchLog(FETCH_LOG_RETENTION_DAYS);
      // The refresh drops the cached aggregates. Rebuild them here rather than
      // leaving the next visitor to wait out a scan of the whole archive.
      warmAggregateCaches();
    } catch (error) {
      console.error('[scheduler] refresh tick failed:', error);
    }
  };

  void tick();
  const timer = setInterval(tick, REFRESH_INTERVAL_MS);
  // Don't keep the event loop alive solely for this timer.
  if (typeof timer.unref === 'function') timer.unref();
}

// Opt-in brottsplatskartan.se import.
//
// BPK_IMPORT_ON_START=ndjson      - load the dump named by BPK_IMPORT_SOURCE
//                                   (minutes), then keep it current on later
//                                   boots. The recommended way to seed.
// BPK_IMPORT_ON_START=full        - walk the whole API archive (hours), then
//                                   keep it current on later boots
// BPK_IMPORT_ON_START=incremental - only pull what is new since last time
//
// Left unset, nothing here touches the network or the disk. A seeding import
// only starts if one has not already succeeded, so restarting the container
// does not kick off another; an interrupted API run resumes from its recorded
// page instead.
function startBrottsplatskartanImport(): void {
  const setting = process.env.BPK_IMPORT_ON_START?.trim().toLowerCase();
  if (setting !== 'full' && setting !== 'incremental' && setting !== 'ndjson') return;

  // A previous process may have died mid-import, leaving status = 'running'.
  reconcileImportState();

  const state = getBpkImportState();
  const concurrency = parseInt(process.env.BPK_IMPORT_CONCURRENCY || '', 10) || undefined;

  if (setting === 'incremental') {
    startImport({ mode: 'incremental', concurrency });
    return;
  }

  const alreadySeeded = state.storedEvents > 0 && (state.status === 'complete' || setting === 'ndjson');
  if (alreadySeeded) {
    console.log(
      `[bpk] archive already holds ${state.storedEvents.toLocaleString('sv-SE')} events; running an incremental sync`
    );
    startImport({ mode: 'incremental', concurrency });
    return;
  }

  if (setting === 'ndjson') {
    const source = process.env.BPK_IMPORT_SOURCE?.trim();
    if (!source) {
      console.error('[bpk] BPK_IMPORT_ON_START=ndjson needs BPK_IMPORT_SOURCE (a dump path or URL); skipping import');
      return;
    }
    try {
      // Operator-supplied, so it may point anywhere the container can read.
      startImport({ mode: 'ndjson', source, allowAnyPath: true });
    } catch (error) {
      // A bad path must not take the whole app down on boot.
      console.error(`[bpk] dump import not started: ${(error as Error).message}`);
    }
    return;
  }

  console.log(
    state.lastPageDone > 0
      ? `[bpk] resuming full import from page ${state.lastPageDone + 1}`
      : '[bpk] starting full import; this takes a few hours'
  );
  startImport({ mode: 'full', concurrency });
}
