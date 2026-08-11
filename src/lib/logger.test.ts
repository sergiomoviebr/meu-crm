import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

describe('logger', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes .error to console.error as a single JSON line', () => {
    logger.error('boom', { operation: 'test/thing', accountId: 'acct-1' });
    expect(errorSpy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({
      level: 'error',
      message: 'boom',
      operation: 'test/thing',
      accountId: 'acct-1',
    });
    expect(typeof parsed.timestamp).toBe('string');
  });

  it('routes .warn to console.warn and .info/.debug to console.log', () => {
    logger.warn('careful');
    expect(warnSpy).toHaveBeenCalledOnce();
    logger.info('fyi');
    logger.debug('detail');
    expect(logSpy).toHaveBeenCalledTimes(2);
  });

  it('serializes an Error context field into name/message/stack instead of dropping it', () => {
    logger.error('failed', { error: new Error('root cause') });
    const parsed = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(parsed.error).toMatchObject({ name: 'Error', message: 'root cause' });
    expect(typeof parsed.error.stack).toBe('string');
  });

  it('passes non-Error context values through unchanged', () => {
    logger.error('failed', { error: 'plain string reason' });
    const parsed = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(parsed.error).toBe('plain string reason');
  });

  it('omits context entirely when none is given', () => {
    logger.info('no context here');
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed).toEqual({
      level: 'info',
      message: 'no context here',
      timestamp: parsed.timestamp,
    });
  });
});
