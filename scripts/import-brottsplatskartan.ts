#!/usr/bin/env node
/**
 * Import events from brottsplatskartan.se into the local database.
 *
 *   npm run import:bpk -- --from-ndjson=FILE  load a dump (file path or URL)
 *   npm run import:bpk -- --probe            inspect the API, import nothing
 *   npm run import:bpk -- --mode=incremental pull only what is new (default)
 *   npm run import:bpk -- --mode=full        walk the whole archive (hours)
 *   npm run import:bpk -- --mode=full --concurrency=6 --max-pages=50
 *
 * A bare name or relative path for --from-ndjson is resolved against the data
 * directory, so `--from-ndjson=brottsplatskartan.ndjson` finds the dump next to
 * the database. Absolute paths and http(s) URLs work too.
 *
 * Progress prints live and is written to the database after every batch, so
 * Ctrl-C is safe: re-running with --mode=full continues from the last
 * completed page, and re-running a dump skips what it already stored.
 *
 * SAMBAND_DATA_DIR selects the database, the same as for the app itself.
 */
import { importBrottsplatskartan, probeApi } from '../src/lib/brottsplatskartan';
import { importNdjson } from '../src/lib/brottsplatskartanNdjson';
import { getBpkImportState } from '../src/lib/brottsplatskartanDb';
import { reconcileImportState } from '../src/lib/brottsplatskartanRunner';

interface Args {
  mode: 'full' | 'incremental';
  concurrency?: number;
  maxPages?: number;
  probe: boolean;
  fromNdjson?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: 'incremental', probe: false };

  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    switch (key) {
      case 'probe':
        args.probe = true;
        break;
      case 'from-ndjson':
        if (!value) throw new Error('--from-ndjson needs a file path or URL');
        args.fromNdjson = value;
        break;
      case 'mode':
        if (value !== 'full' && value !== 'incremental') {
          throw new Error(`--mode must be 'full' or 'incremental', got '${value}'`);
        }
        args.mode = value;
        break;
      case 'concurrency': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 8) {
          throw new Error('--concurrency must be an integer between 1 and 8');
        }
        args.concurrency = n;
        break;
      }
      case 'max-pages': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1) throw new Error('--max-pages must be a positive integer');
        args.maxPages = n;
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatBytes(bytes: number): string {
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

// On a terminal, rewrite one line in place so progress reads as a live meter.
// Piped to a file or a log collector, print a new line every few seconds
// instead — carriage returns there produce an unreadable single-line blob.
function makeProgressPrinter(): (text: string, force?: boolean) => void {
  const isTty = Boolean(process.stdout.isTTY);
  const intervalMs = isTty ? 250 : 5000;
  let lastAt = 0;
  let dirty = false;

  return (text: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastAt < intervalMs) return;
    lastAt = now;
    if (isTty) {
      process.stdout.write(`\r[2K  ${text}`);
      dirty = true;
      if (force && dirty) process.stdout.write('\n');
    } else {
      process.stdout.write(`  ${text}\n`);
    }
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.probe) {
    const meta = await probeApi();
    console.log('Brottsplatskartan API');
    console.log(`  events reported : ${meta.totalEvents?.toLocaleString('sv-SE') ?? 'unknown'}`);
    console.log(`  events per page : ${meta.perPage}`);
    console.log(`  pages to fetch  : ${meta.totalPages?.toLocaleString('sv-SE') ?? 'unknown'}`);
    if (meta.perPage > 10) {
      console.log(`\n  The API honoured a larger page size, so a full import needs`);
      console.log(`  ${meta.totalPages?.toLocaleString('sv-SE')} requests instead of ~33,000.`);
      console.log(`  An NDJSON dump avoids those requests entirely:`);
      console.log(`    npm run import:bpk -- --from-ndjson=<file or URL>`);
    }
    return;
  }

  reconcileImportState();

  if (args.fromNdjson) {
    await runNdjsonImport(args.fromNdjson);
    return;
  }

  const before = getBpkImportState();
  console.log(`Starting ${args.mode} import (already stored: ${before.storedEvents.toLocaleString('sv-SE')})`);
  if (args.mode === 'full' && before.lastPageDone > 0 && before.status !== 'complete') {
    console.log(`Resuming from page ${before.lastPageDone + 1}`);
  }

  const started = Date.now();
  const print = makeProgressPrinter();

  const controller = new AbortController();
  const onSignal = () => {
    console.log('\nStopping after the current batch; progress is saved.');
    controller.abort();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    const result = await importBrottsplatskartan({
      mode: args.mode,
      concurrency: args.concurrency,
      maxPages: args.maxPages,
      signal: controller.signal,
      onProgress: (p) => {
        const elapsed = Date.now() - started;
        const pct = p.totalPages ? ((p.pagesDone / p.totalPages) * 100).toFixed(1) + '%' : '';
        const perSecond = elapsed > 1000 ? p.pagesDone / (elapsed / 1000) : 0;
        const left = p.totalPages !== null ? Math.max(0, p.totalPages - p.pagesDone) : null;
        const eta = left !== null && perSecond > 0 ? ` ETA ${formatDuration((left / perSecond) * 1000)}` : '';
        print(
          `${pct.padStart(6)} ${p.pagesDone.toLocaleString('sv-SE')}` +
            `${p.totalPages ? '/' + p.totalPages.toLocaleString('sv-SE') : ''} pages, ` +
            `${p.imported.toLocaleString('sv-SE')} new, ${p.duplicates.toLocaleString('sv-SE')} known` +
            `${perSecond > 0 ? `, ${perSecond.toFixed(1)} pages/s` : ''}${eta}`
        );
      },
    });

    print('', true);
    console.log('\nFinished.');
    console.log(`  mode        ${result.mode}`);
    console.log(`  pages       ${result.pagesFetched.toLocaleString('sv-SE')} at ${result.perPage}/page`);
    console.log(`  imported    ${result.imported.toLocaleString('sv-SE')}`);
    console.log(`  already had ${result.duplicates.toLocaleString('sv-SE')}`);
    console.log(`  elapsed     ${formatDuration(Date.now() - started)}`);
    console.log(`  stored now  ${result.storedTotal.toLocaleString('sv-SE')}`);

    if (result.reportedTotal !== null) {
      const pct = ((result.storedTotal / result.reportedTotal) * 100).toFixed(2);
      console.log(`  API reports ${result.reportedTotal.toLocaleString('sv-SE')} events -> ${pct}% coverage`);
      const shortfall = result.reportedTotal - result.storedTotal;
      if (shortfall > 0 && !result.stoppedEarly) {
        console.log(
          `\n  ${shortfall.toLocaleString('sv-SE')} fewer stored than the API reports. Some of that is` +
            `\n  expected (records the API serves without a usable id or date are` +
            `\n  skipped). Re-run --mode=full to sweep again; the count should not move.`
        );
      }
    }

    if (result.stoppedEarly) {
      console.log('\n  Stopped before the end. Re-run to continue.');
    }
  } catch (error: unknown) {
    if ((error as { name?: string })?.name === 'AbortError') {
      console.log(`Cancelled after ${formatDuration(Date.now() - started)}. Re-run to resume.`);
      process.exitCode = 130;
      return;
    }
    throw error;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

async function runNdjsonImport(source: string): Promise<void> {
  console.log(`Importing from ${source}`);
  const started = Date.now();
  const print = makeProgressPrinter();

  const controller = new AbortController();
  const onSignal = () => {
    console.log('\nStopping; rows already inserted are kept.');
    controller.abort();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    const result = await importNdjson({
      source,
      signal: controller.signal,
      onProgress: (p) => {
        const elapsed = Date.now() - started;
        const pct = p.bytesTotal ? ((p.bytesRead / p.bytesTotal) * 100).toFixed(1) + '%' : '';
        const bytesPerSecond = elapsed > 1000 ? p.bytesRead / (elapsed / 1000) : 0;
        const left = p.bytesTotal !== null ? Math.max(0, p.bytesTotal - p.bytesRead) : null;
        const eta =
          left !== null && bytesPerSecond > 0 ? ` ETA ${formatDuration((left / bytesPerSecond) * 1000)}` : '';
        print(
          `${pct.padStart(6)} ${formatBytes(p.bytesRead)}` +
            `${p.bytesTotal ? '/' + formatBytes(p.bytesTotal) : ''}, ` +
            `${p.linesRead.toLocaleString('sv-SE')} lines, ` +
            `${p.imported.toLocaleString('sv-SE')} new, ${p.duplicates.toLocaleString('sv-SE')} known${eta}`
        );
      },
    });

    print('', true);
    console.log('\nFinished.');
    console.log(`  source      ${result.source}`);
    console.log(`  lines read  ${result.linesRead.toLocaleString('sv-SE')}`);
    console.log(`  imported    ${result.imported.toLocaleString('sv-SE')}`);
    console.log(`  already had ${result.duplicates.toLocaleString('sv-SE')}`);
    if (result.malformed > 0) console.log(`  unparseable ${result.malformed.toLocaleString('sv-SE')} lines`);
    if (result.unusable > 0) console.log(`  no id/date  ${result.unusable.toLocaleString('sv-SE')} records`);
    console.log(`  elapsed     ${formatDuration(Date.now() - started)}`);
    console.log(`  stored now  ${result.storedTotal.toLocaleString('sv-SE')}`);
    console.log(
      `\n  Run an incremental sync to pick up anything published since the dump:` +
        `\n    npm run import:bpk -- --mode=incremental`
    );
  } catch (error: unknown) {
    if ((error as { name?: string })?.name === 'AbortError') {
      console.log(`Cancelled after ${formatDuration(Date.now() - started)}. Re-run to continue.`);
      process.exitCode = 130;
      return;
    }
    throw error;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

main().catch((error: Error) => {
  console.error(`\nImport failed: ${error.message}`);
  process.exitCode = 1;
});
