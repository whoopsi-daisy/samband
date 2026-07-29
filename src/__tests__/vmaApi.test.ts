import { isLiveAlert, latestPerIncident, liveAlerts, normaliseAlert } from '@/lib/vmaApi';
import { VmaAlert } from '@/types';

// The shape SR's v3 schema documents: camelCase, `incidents` alongside the CAP
// `identifier`, and everything a reader sees inside a per-language `info`.
function rawAlert(
  overrides: Record<string, unknown> = {},
  info: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
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
        category: ['Safety'],
        event: 'Viktigt meddelande till allmänheten',
        urgency: 'Immediate',
        severity: 'Severe',
        certainty: 'Observed',
        expires: '2099-01-01T00:00:00+01:00',
        senderName: 'SOS Alarm',
        description: 'Det brinner i en industribyggnad i Ljungby.',
        instruction: 'Gå inomhus och stäng dörrar, fönster och ventilation.',
        web: 'https://sverigesradio.se/vma',
        area: [{ areaDesc: 'Ljungby kommun', geocode: [] }],
        ...info,
      },
    ],
    ...overrides,
  };
}

const alert = (overrides: Partial<VmaAlert> = {}): VmaAlert => ({
  id: 'SRCAP-1',
  incidents: ['SRVMA-1'],
  sent: '2026-07-29T10:00:00+02:00',
  status: 'Actual',
  msgType: 'Alert',
  scope: 'Public',
  event: 'Viktigt meddelande',
  headline: '',
  description: '',
  instruction: '',
  severity: 'Severe',
  urgency: 'Immediate',
  certainty: 'Observed',
  senderName: 'SOS Alarm',
  areas: [],
  web: '',
  expires: null,
  ...overrides,
});

describe('normaliseAlert', () => {
  it('reads the fields SR documents', () => {
    const result = normaliseAlert(rawAlert())!;

    expect(result.id).toBe('SRCAP-1');
    expect(result.incidents).toEqual(['SRVMA-1']);
    expect(result.status).toBe('Actual');
    expect(result.msgType).toBe('Alert');
    expect(result.scope).toBe('Public');
    expect(result.event).toBe('Viktigt meddelande till allmänheten');
    expect(result.severity).toBe('Severe');
    expect(result.instruction).toBe('Gå inomhus och stäng dörrar, fönster och ventilation.');
    expect(result.areas).toEqual(['Ljungby kommun']);
    expect(result.senderName).toBe('SOS Alarm');
  });

  // CAP is specified in PascalCase and JSON serialisations of it disagree about
  // whether that survives. Nothing here should turn on a capital letter.
  it('does not care how the keys are cased', () => {
    const pascal = {
      Identifier: 'SRCAP-2',
      Sent: '2026-07-29T10:00:00+02:00',
      Status: 'Actual',
      MsgType: 'Alert',
      Scope: 'Public',
      Incidents: ['SRVMA-2'],
      Info: [{ Language: 'sv-SE', Event: 'Gasutsläpp', Severity: 'Extreme', Area: [{ AreaDesc: 'Borås' }] }],
    };

    const result = normaliseAlert(pascal)!;
    expect(result.id).toBe('SRCAP-2');
    expect(result.event).toBe('Gasutsläpp');
    expect(result.severity).toBe('Extreme');
    expect(result.areas).toEqual(['Borås']);
  });

  // CAP repeats the whole message once per language.
  it('prefers the Swedish info block', () => {
    const raw = rawAlert({}, {});
    raw.info = [
      { language: 'en-US', event: 'Important public announcement', area: [] },
      { language: 'sv-SE', event: 'Viktigt meddelande', area: [] },
    ];

    expect(normaliseAlert(raw)!.event).toBe('Viktigt meddelande');
  });

  it('falls back to the only block there is rather than showing nothing', () => {
    const raw = rawAlert();
    raw.info = [{ language: 'en-US', event: 'Important public announcement', area: [] }];

    expect(normaliseAlert(raw)!.event).toBe('Important public announcement');
  });

  it('rejects a message with no identifier', () => {
    expect(normaliseAlert({ status: 'Actual' })).toBeNull();
    expect(normaliseAlert(null)).toBeNull();
  });
});

describe('isLiveAlert', () => {
  it('accepts a current public warning', () => {
    expect(isLiveAlert(alert({ expires: '2099-01-01T00:00:00Z' }))).toBe(true);
  });

  // SR sends the quarterly siren test over the same endpoint. Rendering a drill
  // as a live emergency is the worst thing this feature could do.
  it('never treats a test or an exercise as real', () => {
    expect(isLiveAlert(alert({ status: 'Test' }))).toBe(false);
    expect(isLiveAlert(alert({ status: 'Exercise' }))).toBe(false);
    expect(isLiveAlert(alert({ status: 'System' }))).toBe(false);
  });

  it('ignores anything not meant for the public', () => {
    expect(isLiveAlert(alert({ scope: 'Restricted' }))).toBe(false);
    expect(isLiveAlert(alert({ scope: 'Private' }))).toBe(false);
  });

  it('treats a cancellation as not a warning', () => {
    expect(isLiveAlert(alert({ msgType: 'Cancel' }))).toBe(false);
  });

  // Not every announcement is cancelled promptly.
  it('drops one whose expiry has passed', () => {
    expect(isLiveAlert(alert({ expires: '2020-01-01T00:00:00Z' }))).toBe(false);
  });

  it('keeps one with no expiry at all', () => {
    expect(isLiveAlert(alert({ expires: null }))).toBe(true);
  });
});

describe('latestPerIncident', () => {
  // An announcement is at least two messages: the Alert and the Cancel that
  // ends it. Both are returned by the endpoint, so without grouping the feed
  // shows a warning next to its own cancellation, both looking current.
  it('lets a cancellation replace the alert it ends', () => {
    const opened = alert({ id: 'SRCAP-1', sent: '2026-07-29T10:00:00Z' });
    const cancelled = alert({
      id: 'SRCAP-2',
      msgType: 'Cancel',
      sent: '2026-07-29T12:00:00Z',
    });

    const result = latestPerIncident([opened, cancelled]);

    expect(result.map((a) => a.id)).toEqual(['SRCAP-2']);
    expect(liveAlerts(result)).toEqual([]);
  });

  it('keeps the alert while it is the only message', () => {
    const opened = alert({ id: 'SRCAP-1' });
    expect(latestPerIncident([opened]).map((a) => a.id)).toEqual(['SRCAP-1']);
  });

  it('does not let one announcement hide another', () => {
    const first = alert({ id: 'SRCAP-1', incidents: ['SRVMA-1'] });
    const second = alert({ id: 'SRCAP-9', incidents: ['SRVMA-9'] });

    expect(latestPerIncident([first, second]).map((a) => a.id).sort()).toEqual([
      'SRCAP-1',
      'SRCAP-9',
    ]);
  });

  // A message without one is not expected, but it is still something SR
  // published and must not vanish.
  it('keeps a message that carries no incident id', () => {
    const orphan = alert({ id: 'SRCAP-3', incidents: [] });
    expect(latestPerIncident([orphan]).map((a) => a.id)).toEqual(['SRCAP-3']);
  });

  it('returns a message listing several incidents only once', () => {
    const both = alert({ id: 'SRCAP-4', incidents: ['SRVMA-1', 'SRVMA-2'] });
    expect(latestPerIncident([both])).toHaveLength(1);
  });
});
