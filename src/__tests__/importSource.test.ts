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

/**
 * A URL arriving over HTTP is attacker-controlled the moment the dashboard
 * credentials leak, which is exactly the reasoning that confined file paths to
 * the data directory. Any http(s) URL was accepted and fetched by the server
 * regardless: metadata endpoints, loopback, anything else the container could
 * reach.
 */
describe('resolveImportSource, on URLs arriving over HTTP', () => {
  const refused = [
    ['the cloud metadata endpoint', 'http://169.254.169.254/latest/meta-data/'],
    ['another metadata endpoint', 'http://100.100.100.200/latest/meta-data/'],
    ['loopback by address', 'http://127.0.0.1:3000/dump.ndjson'],
    ['loopback by name', 'http://localhost:3000/dump.ndjson'],
    ['IPv6 loopback', 'http://[::1]:3000/dump.ndjson'],
    ['a private class A host', 'http://10.0.0.5/dump.ndjson'],
    ['a private class B host', 'http://172.20.1.1/dump.ndjson'],
    ['a private class C host', 'http://192.168.1.5/dump.ndjson'],
    ['an IPv6 link-local host', 'http://[fe80::1]/dump.ndjson'],
    ['an IPv6 unique-local host', 'http://[fd00::1]/dump.ndjson'],
    ['an IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]/dump.ndjson'],
  ] as const;

  it.each(refused)('refuses %s', (_label, url) => {
    expect(() => importSource.resolveImportSource(url)).toThrow(importSource.ImportSourceError);
  });

  it('still accepts an ordinary public URL', () => {
    expect(importSource.resolveImportSource('https://example.com/dump.ndjson')).toEqual({
      kind: 'url',
      value: 'https://example.com/dump.ndjson',
      label: 'https://example.com/dump.ndjson',
    });
  });

  it('still refuses a non-http scheme', () => {
    expect(() => importSource.resolveImportSource('file:///etc/passwd')).toThrow(
      /Only http\(s\) URLs/
    );
  });

  // The operator paths (the CLI, BPK_IMPORT_SOURCE) may point anywhere: an
  // operator serving a dump off their own LAN is an ordinary thing to do, and
  // this is the same split that already governs file paths.
  it('lets an operator-controlled source reach a private host', () => {
    expect(
      importSource.resolveImportSource('http://192.168.1.5/dump.ndjson', { allowAnyPath: true })
    ).toEqual({
      kind: 'url',
      value: 'http://192.168.1.5/dump.ndjson',
      label: 'http://192.168.1.5/dump.ndjson',
    });
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
