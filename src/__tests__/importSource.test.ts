/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

let tempDir: string;
let importSource: typeof import('@/lib/importSource');

beforeEach(async () => {
  jest.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-src-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  importSource = await import('@/lib/importSource');
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('resolveImportSource', () => {
  it('resolves a bare name against the data directory', () => {
    const file = path.join(tempDir, 'dump.ndjson');
    fs.writeFileSync(file, '');

    expect(importSource.resolveImportSource('dump.ndjson')).toEqual({
      kind: 'file',
      value: file,
      label: 'dump.ndjson',
    });
  });

  it('accepts http and https URLs', () => {
    const resolved = importSource.resolveImportSource('https://example.com/bpk.ndjson');
    expect(resolved.kind).toBe('url');
    expect(resolved.value).toBe('https://example.com/bpk.ndjson');
  });

  it('refuses schemes that are not http(s)', () => {
    expect(() => importSource.resolveImportSource('file:///etc/passwd')).toThrow(/Only http\(s\)/);
    expect(() => importSource.resolveImportSource('ftp://example.com/dump')).toThrow(/Only http\(s\)/);
  });

  // The dashboard endpoint hands whatever a request asked for straight to this
  // function, so escaping the data directory has to fail closed.
  it('refuses paths outside the data directory by default', () => {
    expect(() => importSource.resolveImportSource('/etc/passwd')).toThrow(/inside the data directory/);
    expect(() => importSource.resolveImportSource('../../etc/passwd')).toThrow(/inside the data directory/);
  });

  it('allows any path when the caller is the operator', () => {
    const outside = path.join(os.tmpdir(), `samband-outside-${process.pid}.ndjson`);
    fs.writeFileSync(outside, '');
    try {
      const resolved = importSource.resolveImportSource(outside, { allowAnyPath: true });
      expect(resolved.kind).toBe('file');
      expect(resolved.value).toBe(outside);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it('reports a missing file and a directory clearly', () => {
    expect(() => importSource.resolveImportSource('nope.ndjson')).toThrow(/No such file/);
    fs.mkdirSync(path.join(tempDir, 'subdir'));
    expect(() => importSource.resolveImportSource('subdir')).toThrow(/Not a file/);
  });

  it('rejects an empty source', () => {
    expect(() => importSource.resolveImportSource('   ')).toThrow(/No source given/);
  });
});

describe('listLocalDumps', () => {
  it('lists dumps in the data directory, newest first', () => {
    fs.writeFileSync(path.join(tempDir, 'old.ndjson'), 'a');
    fs.writeFileSync(path.join(tempDir, 'new.jsonl'), 'b');
    fs.writeFileSync(path.join(tempDir, 'events.db'), 'not a dump');
    const older = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(tempDir, 'old.ndjson'), older, older);

    const dumps = importSource.listLocalDumps();

    expect(dumps.map((d) => d.name)).toEqual(['new.jsonl', 'old.ndjson']);
    expect(dumps[0].bytes).toBe(1);
  });

  it('returns nothing rather than throwing when the directory is unreadable', () => {
    fs.rmSync(tempDir, { recursive: true, force: true });

    expect(importSource.listLocalDumps()).toEqual([]);
  });

  /**
   * A dump can be swapped out between the readdir and the stat, and an operator
   * doing exactly that is when this endpoint gets polled. Unguarded, the stat
   * threw and took the whole dashboard panel down with it.
   */
  it('skips a dump that disappears between listing and measuring it', () => {
    fs.writeFileSync(path.join(tempDir, 'stable.ndjson'), 'a');
    fs.writeFileSync(path.join(tempDir, 'vanishing.ndjson'), 'b');

    const realStat = fs.statSync;
    jest.spyOn(fs, 'statSync').mockImplementation(((target: fs.PathLike, options?: object) => {
      if (String(target).endsWith('vanishing.ndjson')) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return realStat(target, options as never);
    }) as typeof fs.statSync);

    const dumps = importSource.listLocalDumps();

    expect(dumps.map((d) => d.name)).toEqual(['stable.ndjson']);
    jest.restoreAllMocks();
  });
});
