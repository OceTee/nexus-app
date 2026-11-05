declare global {
  namespace Express {
    interface Request {
      /** Request id from X-Request-Id or a generated UUIDv7. */
      id: string;
    }
  }
}

export {};
