class ClientError extends Error {
  constructor(message: string, readonly code = 'REQUEST_FAILED', readonly traceId?: string, readonly status?: number) {
    super(message);
  }
}

export { ClientError };
