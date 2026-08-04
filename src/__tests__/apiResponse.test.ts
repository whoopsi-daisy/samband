/**
 * @jest-environment node
 */
import zlib from 'zlib';
import { jsonResponse } from '@/lib/apiResponse';

/**
 * Next compresses pages and static assets and does not compress Route
 * Handlers, which is where nearly all of this app's bytes are. A month of map
 * data measured 192 kB served against 9.5 kB gzipped.
 */
const asking = (encoding = 'gzip, deflate, br') =>
  new Request('http://localhost/api/map', { headers: { 'accept-encoding': encoding } });

const big = { events: Array.from({ length: 400 }, (_, i) => ({ gps: '56.75,14.50', type: 'Stöld', i })) };

describe('a JSON API response', () => {
  it('is gzipped when the client accepts it', async () => {
    const response = jsonResponse(asking(), big);

    expect(response.headers.get('Content-Encoding')).toBe('gzip');
    const packed = Buffer.from(await response.arrayBuffer());
    expect(JSON.parse(zlib.gunzipSync(packed).toString('utf8'))).toEqual(big);
  });

  it('actually saves something worth the trouble', async () => {
    const raw = JSON.stringify(big).length;
    const packed = (await jsonResponse(asking(), big).arrayBuffer()).byteLength;

    expect(packed).toBeLessThan(raw / 4);
  });

  it('sends it plain to a client that did not ask', async () => {
    const response = jsonResponse(new Request('http://localhost/api/map'), big);

    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(await response.json()).toEqual(big);
  });

  it('is not fooled by an encoding it cannot do', async () => {
    const response = jsonResponse(asking('br, deflate'), big);
    expect(response.headers.get('Content-Encoding')).toBeNull();
  });

  // A gzip member costs about twenty bytes of header and trailer, so below a
  // point compressing makes the response bigger as well as slower.
  it('leaves a small body alone', () => {
    const response = jsonResponse(asking(), { ok: true });
    expect(response.headers.get('Content-Encoding')).toBeNull();
  });

  /*
   * Vary is set either way, and that is not optional.
   *
   * A shared cache that stored the plain response and then served it to a
   * client that asked for gzip — or the reverse, handing gzipped bytes to
   * something that cannot decode them — is exactly the failure this header
   * exists to prevent, and it has to be present on both branches for the
   * cache to key on it at all.
   */
  it('varies on the encoding whether or not it compressed', () => {
    expect(jsonResponse(asking(), big).headers.get('Vary')).toBe('Accept-Encoding');
    expect(jsonResponse(asking('identity'), big).headers.get('Vary')).toBe('Accept-Encoding');
  });

  it('keeps the status and any headers it was given', () => {
    const response = jsonResponse(asking(), big, {
      status: 202,
      headers: { 'Cache-Control': 'no-store' },
    });

    expect(response.status).toBe(202);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });
});
