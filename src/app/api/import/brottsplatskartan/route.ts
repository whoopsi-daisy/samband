import { NextRequest, NextResponse } from 'next/server';
import { getBpkImportState } from '@/lib/brottsplatskartanDb';
import { startImport, cancelImport, isImportRunning, getRunningMode } from '@/lib/brottsplatskartanRunner';
import type { BpkImportMode } from '@/types';

// Control and observe the brottsplatskartan.se import.
//
//   GET    -> progress
//   POST   -> start ({ "mode": "full" | "incremental", "concurrency": 1-8 })
//   DELETE -> cancel the running import (progress is kept, so it can resume)
//
// Guarded by the same STATS_USER/STATS_PASSWORD credentials as /stats; see
// src/middleware.ts.
export const dynamic = 'force-dynamic';

export async function GET() {
  const state = getBpkImportState();
  const percent =
    state.totalPages && state.totalPages > 0
      ? Math.min(100, Math.round((state.lastPageDone / state.totalPages) * 1000) / 10)
      : null;

  return NextResponse.json({
    ...state,
    running: isImportRunning(),
    runningMode: getRunningMode(),
    percentComplete: percent,
  });
}

export async function POST(request: NextRequest) {
  let mode: BpkImportMode = 'incremental';
  let concurrency: number | undefined;

  try {
    const body = await request.json();
    if (body?.mode === 'full' || body?.mode === 'incremental') {
      mode = body.mode;
    } else if (body?.mode !== undefined) {
      return NextResponse.json({ error: "mode must be 'full' or 'incremental'" }, { status: 400 });
    }
    if (body?.concurrency !== undefined) {
      const n = Number(body.concurrency);
      if (!Number.isInteger(n) || n < 1 || n > 8) {
        return NextResponse.json({ error: 'concurrency must be an integer between 1 and 8' }, { status: 400 });
      }
      concurrency = n;
    }
  } catch {
    // No body is fine — defaults to an incremental sync.
  }

  const outcome = startImport(mode, concurrency);
  if (!outcome.started) {
    return NextResponse.json({ error: outcome.reason }, { status: 409 });
  }

  return NextResponse.json({ started: true, mode }, { status: 202 });
}

export async function DELETE() {
  const cancelled = cancelImport();
  if (!cancelled) {
    return NextResponse.json({ error: 'No import is running' }, { status: 409 });
  }
  return NextResponse.json({ cancelled: true });
}
