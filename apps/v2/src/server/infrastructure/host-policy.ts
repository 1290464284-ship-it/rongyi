export function assertHostAllowed(host: string): void {
  const normalized = host.trim().toLowerCase();
  const loopback = normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
  if (!loopback && process.env.V2_ALLOW_INSECURE_LAN !== '1') {
    throw new Error(
      'V2_HOST outside loopback requires a TLS reverse proxy; ' +
        'set V2_ALLOW_INSECURE_LAN=1 only for trusted LANs',
    );
  }
}
