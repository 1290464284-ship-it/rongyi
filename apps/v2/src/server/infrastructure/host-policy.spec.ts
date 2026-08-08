import { afterEach, describe, expect, it } from 'vitest';
import { assertHostAllowed } from './host-policy';

describe('assertHostAllowed', () => {
  const previous = process.env.V2_ALLOW_INSECURE_LAN;
  afterEach(() => {
    if (previous === undefined) delete process.env.V2_ALLOW_INSECURE_LAN;
    else process.env.V2_ALLOW_INSECURE_LAN = previous;
  });

  it('allows loopback in production', () => {
    expect(() => assertHostAllowed('127.0.0.1', 'production')).not.toThrow();
    expect(() => assertHostAllowed('localhost', 'production')).not.toThrow();
  });

  it('refuses non-loopback in production unless explicitly allowed', () => {
    delete process.env.V2_ALLOW_INSECURE_LAN;
    expect(() => assertHostAllowed('0.0.0.0', 'production')).toThrow(/TLS reverse proxy/);
    process.env.V2_ALLOW_INSECURE_LAN = '1';
    expect(() => assertHostAllowed('0.0.0.0', 'production')).not.toThrow();
  });

  it('refuses non-loopback outside production unless explicitly allowed', () => {
    delete process.env.V2_ALLOW_INSECURE_LAN;
    expect(() => assertHostAllowed('0.0.0.0', 'development')).toThrow(/TLS reverse proxy/);
    process.env.V2_ALLOW_INSECURE_LAN = '1';
    expect(() => assertHostAllowed('0.0.0.0', 'development')).not.toThrow();
  });
});
