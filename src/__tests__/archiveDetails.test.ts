/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

// Imported events carry their own text. Expanding one must not depend on
// polisen.se still serving the page it came from: the archive reaches back to
// 2016 and those pages are removed, which is exactly when someone is reading
// the archive rather than the live feed.

let tempDir: string;
let bpkDb: typeof import('@/lib/brottsplatskartanDb');

// The record as brottsplatskartan serves it, kept verbatim.
const REAL_EVENT = {
  id: 445554,
  pubdate: '2025-12-09T13:41:08.000Z',
  pubdateUnix: 1765287668,
  titleType: 'Bråk',
  titleLocation: 'Surahammar',
  headline: 'Samtal om bråk på bibliotek.',
  description: 'Samtal om bråk på bibliotek.',
  content:
    '<p>Personal på ett bibliotek i Surahammar kontaktar polisen med anledning av ett bråk. Enligt personalen ska det befinna sig berusade personer på platsen som stör och trakasserar besökare.</p>\n<p>En kvinna transporteras frivilligt från platsen.</p>\n<p>Ingen anmälan upprättas.</p>',
  locationString: 'Surahammar, Västmanlands län',
  county: 'Västmanlands län',
  lat: 59.7072262,
  lng: 16.2268409,
  externalSourceLink:
    'https://polisen.se/aktuellt/handelser/2025/december/9/09-december-13.28-brak-surahammar/',
  permalink: 'https://brottsplatskartan.se/vastmanlands-lan/brak-surahammar-samtal-om-brak-pa-bibliotek-445554',
};

beforeEach(async () => {
  jest.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-det-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  bpkDb = await import('@/lib/brottsplatskartanDb');
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('getBpkEventText', () => {
  it('returns the stored body as readable paragraphs', () => {
    bpkDb.insertBpkEvents([REAL_EVENT]);

    // Negative, because that is how the feed presents archive rows.
    const text = bpkDb.getBpkEventText(-445554);

    expect(text).toBe(
      'Personal på ett bibliotek i Surahammar kontaktar polisen med anledning av ett bråk. ' +
        'Enligt personalen ska det befinna sig berusade personer på platsen som stör och trakasserar besökare.\n\n' +
        'En kvinna transporteras frivilligt från platsen.\n\n' +
        'Ingen anmälan upprättas.'
    );
  });

  it('decodes entities the stored markup carries', () => {
    bpkDb.insertBpkEvents([
      { ...REAL_EVENT, id: 1, content: '<p>Polisen &amp; r&auml;ddningstj&auml;nst larmas till platsen.</p>' },
    ]);

    expect(bpkDb.getBpkEventText(-1)).toBe('Polisen & räddningstjänst larmas till platsen.');
  });

  it('falls back to the description when an event has no body', () => {
    bpkDb.insertBpkEvents([{ ...REAL_EVENT, id: 2, content: null }]);

    expect(bpkDb.getBpkEventText(-2)).toBe('Samtal om bråk på bibliotek.');
  });

  it('returns null when there is nothing to show at all', () => {
    bpkDb.insertBpkEvents([{ ...REAL_EVENT, id: 3, content: null, description: null }]);

    expect(bpkDb.getBpkEventText(-3)).toBeNull();
  });

  it('ignores ids that are not an archive row', () => {
    bpkDb.insertBpkEvents([REAL_EVENT]);

    // Positive ids belong to the live polisen.se table, which is scraped.
    expect(bpkDb.getBpkEventText(445554)).toBeNull();
    expect(bpkDb.getBpkEventText(-999999)).toBeNull();
    expect(bpkDb.getBpkEventText(-1.5)).toBeNull();
  });
});
