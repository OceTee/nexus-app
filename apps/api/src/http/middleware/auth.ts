import type { RequestHandler } from 'express';
import { ForbiddenError, UnauthenticatedError } from '../../lib/errors';
import type { AccessTokenSigner } from '../../lib/tokens';

/** Verifies the Bearer access token and sets `req.auth` (no database read). */
export function requireAuth(signer: AccessTokenSigner): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new UnauthenticatedError();
    const claims = await signer.verify(token);
    req.auth = { userId: claims.sub, deviceId: claims.dev, emailVerified: claims.ver };
    next();
  };
}

/** Blocks sync, attachments and exports until the email is verified (403 EMAIL_UNVERIFIED). */
export const requireVerified: RequestHandler = (req, _res, next) => {
  if (!req.auth?.emailVerified) throw new ForbiddenError('EMAIL_UNVERIFIED');
  next();
};
