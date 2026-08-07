export function assertHostAllowed(host: string, nodeEnv: string): void {
  const normalized = host.trim().toLowerCase();
  const loopback = normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
  if (nodeEnv === 'production' && !loopback && process.env.V2_ALLOW_INSECURE_LAN !== '1') {
    throw new Error(
      'V2_HOST outside loopback in production requires a TLS reverse proxy; ' +
        'set V2_ALLOW_INSECURE_LAN=1 only for trusted LANs',
    );
  }
}
