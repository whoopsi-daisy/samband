/**
 * @jest-environment node
 */

// The cache in front of Sveriges Radio's VMA API.
//
// A success is worth a minute. A *failure* is not an answer at all, and holding
// it for the same minute was the bug: one refused connection pinned "vi vet inte
// just nu" in front of every reader for sixty seconds, and the browser polls on
// the same minute, so a live warning could arrive two minutes after SR came
// back. On the one feature here whose whole justification is immediacy.

let vmaApi: typeof import('@/lib/vmaApi');

const alertBody = [
  {
    identifier: 'SRCAP-1',
    sender: 'https://vmaapi.sr.se',
    sent: '2026-07-29T10:00:00+02:00',
    status: 'Actual',
    msgType: 'Alert',
    scope: 'Public',
    incidents: ['SRVMA-1'],
    info: [
      {
        language: 'sv-SE',
        event: 'Viktigt meddelande',
        severity: 'Severe',
        urgency: 'Immediate',
        area: [{ areaDesc: 'Ljungby kommun' }],
      },
    ],
  },
];

const ok = () =>
  ({ ok: true, status: 200, json: async () => alertBody }) as unknown as Response;

beforeEach(async () => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  vmaApi = await import('@/lib/vmaApi');
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('getVmaAlerts', () => {
  it('serves a second reader from the cache rather than asking SR again', async () => {
    const fetchMock = jest.fn(async () => ok());
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = await vmaApi.getVmaAlerts();
    const second = await vmaApi.getVmaAlerts();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.failed).toBe(false);
    expect(second.alerts).toHaveLength(1);
  });

  it('gives concurrent readers one upstream request', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = jest.fn(async () => {
      await gate;
      return ok();
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const pending = Array.from({ length: 4 }, () => vmaApi.getVmaAlerts());
    release?.();
    await Promise.all(pending);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says it could not ask, rather than that there is nothing', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const result = await vmaApi.getVmaAlerts();

    expect(result.failed).toBe(true);
    expect(result.alerts).toEqual([]);
  });

  // The fix. A failure is held for seconds, not for the success TTL.
  it('retries within seconds of a failure instead of holding it for a minute', async () => {
    jest.useFakeTimers();

    const failing = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    global.fetch = failing as unknown as typeof fetch;

    expect((await vmaApi.getVmaAlerts()).failed).toBe(true);

    // Well past the failure TTL, well inside the success one.
    jest.advanceTimersByTime(6_000);

    const succeeding = jest.fn(async () => ok());
    global.fetch = succeeding as unknown as typeof fetch;

    const recovered = await vmaApi.getVmaAlerts();

    expect(succeeding).toHaveBeenCalledTimes(1);
    expect(recovered.failed).toBe(false);
    expect(recovered.alerts).toHaveLength(1);
  });

  it('does not re-ask on every single request while SR is down', async () => {
    const failing = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    global.fetch = failing as unknown as typeof fetch;

    await vmaApi.getVmaAlerts();
    await vmaApi.getVmaAlerts();
    await vmaApi.getVmaAlerts();

    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('holds a successful answer for the full minute', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn(async () => ok());
    global.fetch = fetchMock as unknown as typeof fetch;

    await vmaApi.getVmaAlerts();
    jest.advanceTimersByTime(30_000);
    await vmaApi.getVmaAlerts();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(31_000);
    await vmaApi.getVmaAlerts();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a non-OK response as a failure to reach SR', async () => {
    global.fetch = jest.fn(
      async () => ({ ok: false, status: 503 }) as unknown as Response
    ) as unknown as typeof fetch;

    expect((await vmaApi.getVmaAlerts()).failed).toBe(true);
  });

  it('drops the cached answer on invalidate', async () => {
    const fetchMock = jest.fn(async () => ok());
    global.fetch = fetchMock as unknown as typeof fetch;

    await vmaApi.getVmaAlerts();
    vmaApi.getVmaAlerts.invalidate();
    await vmaApi.getVmaAlerts();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
