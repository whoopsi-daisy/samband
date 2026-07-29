import { NextRequest, NextResponse } from 'next/server';
import { startImport, cancelImport, getImportSnapshot, type ImportRequest } from '@/lib/brottsplatskartanRunner';
import { ImportSourceError, listLocalDumps } from '@/lib/importSource';

// Control and observe the brottsplatskartan.se import.
//
//   GET    -> progress, live counters, recent log lines, available dumps
//   POST   -> start:
//               { "mode": "incremental" }
//               { "mode": "full", "concurrency": 1-8 }
//               { "mode": "ndjson", "source": "brottsplatskartan.ndjson" }
//   DELETE -> cancel the running import (progress is kept, so it can resume)
//
// Live progress also streams from GET /api/import/brottsplatskartan/stream.
//
// Guarded by the same STATS_USER/STATS_PASSWORD credentials as /stats; see
// src/middleware.ts.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { ...getImportSnapshot(), dumps: listLocalDumps() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // No body is fine: defaults to an incremental sync.
  }

  const mode = body.mode === undefined ? 'incremental' : body.mode;
  if (mode !== 'full' && mode !== 'incremental' && mode !== 'ndjson') {
    return NextResponse.json({ error: "mode must be 'full', 'incremental' or 'ndjson'" }, { status: 400 });
  }

  let importRequest: ImportRequest;

  if (mode === 'ndjson') {
    if (typeof body.source !== 'string' || body.source.trim() === '') {
      return NextResponse.json(
        { error: "ndjson imports need a 'source': a dump in the data directory, or an http(s) URL" },
        { status: 400 }
      );
    }
    // allowAnyPath stays false: a request may only name files the operator has
    // already put in the data directory.
    importRequest = { mode: 'ndjson', source: body.source };
  } else {
    let concurrency: number | undefined;
    if (body.concurrency !== undefined) {
      const n = Number(body.concurrency);
      if (!Number.isInteger(n) || n < 1 || n > 8) {
        return NextResponse.json({ error: 'concurrency must be an integer between 1 and 8' }, { status: 400 });
      }
      concurrency = n;
    }
    importRequest = { mode, concurrency };
  }

  let outcome;
  try {
    outcome = startImport(importRequest);
  } catch (error) {
    if (error instanceof ImportSourceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  if (!outcome.started) {
    return NextResponse.json({ error: outcome.reason }, { status: 409 });
  }

  return NextResponse.json({ started: true, mode, source: outcome.source ?? null }, { status: 202 });
}

export async function DELETE() {
  const cancelled = cancelImport();
  if (!cancelled) {
    return NextResponse.json({ error: 'No import is running' }, { status: 409 });
  }
  return NextResponse.json({ cancelled: true });
}
