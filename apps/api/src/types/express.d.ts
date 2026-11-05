declare global {
  namespace Express {
    interface Request {
      /** Request id from X-Request-Id or a generated UUIDv7. */
      id: string;
      /** Set by `requireAuth` from the verified access token. */
      auth: {
        userId: string;
        deviceId: string;
        emailVerified: boolean;
      };
      /** Parsed and typed input set by `validate` (Express 5 makes `req.query` read-only). */
      valid: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
