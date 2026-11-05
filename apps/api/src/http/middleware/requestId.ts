import type { RequestHandler } from 'express';
import { newId } from '../../lib/ids';

const VALID = /^[A-Za-z0-9-]{8,64}$/;

/** Reads X-Request-Id (if well-formed) or generates a UUIDv7, and echoes it back. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.id = incoming && VALID.test(incoming) ? incoming : newId();
  res.setHeader('X-Request-Id', req.id);
  next();
};
