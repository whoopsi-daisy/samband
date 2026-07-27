#!/usr/bin/env node
/**
 * Import events from brottsplatskartan.se into the local database.
 *
 *   npm run import:bpk -- --probe            inspect the API, import nothing
 *   npm run import:bpk -- --mode=incremental pull only what is new (default)
 *   npm run import:bpk -- --mode=full        walk the whole archive (hours)
 *   npm run import:bpk -- --mode=full --concurrency=6 --max-pages=50
 *
 * Progress is written to the database after every batch, so Ctrl-C is safe:
 * re-running with --mode=full continues from the last completed page.
 *
 * SAMBAND_DATA_DIR selects the database, the same as for the app itself.
 */
import { importBrottsplatskartan, probeApi } from '../src/lib/brottsplatskartan';
import { getBpkImportState } from '../src/lib/brottsplatskartanDb';
import { reconcileImportState } from '../src/lib/brottsplatskartanRunner';

interface Args {
  mode: 'full' | 'incremental';
  concurrency?: number;
  maxPages?: number;
  probe: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: 'incremental', probe: false };

  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    switch (key) {
      case 'probe':
        args.probe = true;
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
    }
    return;
  }

  reconcileImportState();

  const before = getBpkImportState();
  console.log(`Starting ${args.mode} import (already stored: ${before.storedEvents.toLocaleString('sv-SE')})`);
  if (args.mode === 'full' && before.lastPageDone > 0 && before.status !== 'complete') {
    console.log(`Resuming from page ${before.lastPageDone + 1}`);
  }

  const started = Date.now();
  let lastLine = 0;

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
        // Throttle output so a long run does not spam the log.
        if (Date.now() - lastLine < 2000) return;
        lastLine = Date.now();
        const pct = p.totalPages ? ((p.pagesDone / p.totalPages) * 100).toFixed(1) + '%' : '';
        console.log(
          `  ${pct.padStart(6)} ${p.pagesDone.toLocaleString('sv-SE')}` +
            `${p.totalPages ? '/' + p.totalPages.toLocaleString('sv-SE') : ''} pages, ` +
            `${p.imported.toLocaleString('sv-SE')} new, ${p.duplicates.toLocaleString('sv-SE')} known`
        );
      },
    });

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

main().catch((error: Error) => {
  console.error(`\nImport failed: ${error.message}`);
  process.exitCode = 1;
});
