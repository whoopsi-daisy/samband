/**
 * @jest-environment node
 */

// The logger reads its level from the environment at call time, and the test
// environment defaults it to silent, so each case sets what it needs.
let log: typeof import('@/lib/log');

const captured: Record<string, string[]> = { debug: [], log: [], warn: [], error: [] };

beforeEach(async () => {
  jest.resetModules();
  for (const key of Object.keys(captured)) captured[key] = [];
  jest.spyOn(console, 'debug').mockImplementation((line) => void captured.debug.push(String(line)));
  jest.spyOn(console, 'log').mockImplementation((line) => void captured.log.push(String(line)));
  jest.spyOn(console, 'warn').mockImplementation((line) => void captured.warn.push(String(line)));
  jest.spyOn(console, 'error').mockImplementation((line) => void captured.error.push(String(line)));
  log = await import('@/lib/log');
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.SAMBAND_LOG_LEVEL;
  delete process.env.SAMBAND_LOG_FORMAT;
});

describe('logger', () => {
  it('stamps the scope on the line', () => {
    process.env.SAMBAND_LOG_LEVEL = 'info';
    log.logger('db').info('migration finished');

    expect(captured.log).toEqual(['[db] migration finished']);
  });

  it('appends structured fields as key=value', () => {
    process.env.SAMBAND_LOG_LEVEL = 'info';
    log.logger('police').warn('daily fetch limit reached', { used: 1440, limit: 1440 });

    expect(captured.warn[0]).toBe('[police] daily fetch limit reached used=1440 limit=1440');
  });

  it('quotes a field containing spaces so the line stays parseable', () => {
    process.env.SAMBAND_LOG_LEVEL = 'info';
    log.logger('ui').info('render failed', { message: 'a b' });

    expect(captured.log[0]).toBe('[ui] render failed message="a b"');
  });

  it('drops fields with nothing in them', () => {
    process.env.SAMBAND_LOG_LEVEL = 'info';
    log.logger('ui').info('report', { present: 'yes', missing: undefined, empty: null });

    expect(captured.log[0]).toBe('[ui] report present=yes');
  });

  // The reason the level exists: an operator diagnosing something wants more,
  // and a container in normal service wants less.
  it('honours the configured level', () => {
    process.env.SAMBAND_LOG_LEVEL = 'warn';
    const scoped = log.logger('db');

    scoped.debug('noisy');
    scoped.info('routine');
    scoped.warn('worth seeing');

    expect(captured.debug).toEqual([]);
    expect(captured.log).toEqual([]);
    expect(captured.warn).toHaveLength(1);
  });

  it('can be silenced completely', () => {
    process.env.SAMBAND_LOG_LEVEL = 'silent';
    const scoped = log.logger('db');
    scoped.error('even this');

    expect(captured.error).toEqual([]);
  });

  // Outside the test environment, a typo in the variable must not silence the
  // container: it falls through to the ordinary default.
  it('falls back to info when the level is not a level', () => {
    // NODE_ENV is typed readonly, and this is the one place that needs to stand
    // outside the test default to check the production fallback.
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = 'production';
    env.SAMBAND_LOG_LEVEL = 'chatty';
    try {
      log.logger('db').info('still here');

      expect(captured.log).toHaveLength(1);
      expect(log.currentLogLevel()).toBe('info');
    } finally {
      env.NODE_ENV = previous;
    }
  });

  // Tests are noisy enough without it, and a failing assertion says more than
  // the line before it.
  it('is silent under test unless a level is asked for', () => {
    log.logger('db').error('quiet please');

    expect(captured.error).toEqual([]);
    expect(log.currentLogLevel()).toBe('silent');
  });

  describe('errors', () => {
    it('folds the message into the line', () => {
      process.env.SAMBAND_LOG_LEVEL = 'error';
      log.logger('vma').error('could not reach SR', new Error('ECONNREFUSED'));

      expect(captured.error[0]).toBe('[vma] could not reach SR error=ECONNREFUSED');
    });

    it('includes the cause when there is one', () => {
      process.env.SAMBAND_LOG_LEVEL = 'error';
      const outer = new Error('open failed', { cause: new Error('disk full') });
      log.logger('db').error('initialisation failed', outer);

      expect(captured.error[0]).toContain('disk full');
    });

    it('accepts something that is not an Error', () => {
      process.env.SAMBAND_LOG_LEVEL = 'error';
      log.logger('bpk').error('import failed', 'a plain string');

      expect(captured.error[0]).toContain('a plain string');
    });

    // A stack is what you want when the fault is ours and pure noise when it is
    // a refused connection to someone else's server.
    it('keeps the stack out of the way until debug is asked for', () => {
      process.env.SAMBAND_LOG_LEVEL = 'error';
      log.logger('db').error('boom', new Error('nope'));
      expect(captured.debug).toEqual([]);

      jest.resetModules();
      process.env.SAMBAND_LOG_LEVEL = 'debug';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require('@/lib/log') as typeof import('@/lib/log');
      fresh.logger('db').error('boom', new Error('nope'));
      expect(captured.debug.join('\n')).toContain('Error: nope');
    });
  });

  it('nests a child scope under its parent', () => {
    process.env.SAMBAND_LOG_LEVEL = 'info';
    log.logger('db').child('migration').info('placed notices in a county');

    expect(captured.log[0]).toBe('[db:migration] placed notices in a county');
  });

  // For anyone shipping these somewhere that would rather parse than read.
  describe('json format', () => {
    it('emits one object per line', () => {
      process.env.SAMBAND_LOG_LEVEL = 'info';
      process.env.SAMBAND_LOG_FORMAT = 'json';
      log.logger('police').info('fetched', { events: 40 });

      const parsed = JSON.parse(captured.log[0]);
      expect(parsed).toMatchObject({
        level: 'info',
        scope: 'police',
        message: 'fetched',
        events: 40,
      });
      expect(typeof parsed.time).toBe('string');
    });

    it('carries the error message as a field', () => {
      process.env.SAMBAND_LOG_LEVEL = 'error';
      process.env.SAMBAND_LOG_FORMAT = 'json';
      log.logger('vma').error('unreachable', new Error('ETIMEDOUT'));

      expect(JSON.parse(captured.error[0]).error).toBe('ETIMEDOUT');
    });
  });
});
