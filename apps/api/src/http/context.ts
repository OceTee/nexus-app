import type { Request } from 'express';
import type { RequestContext } from '../modules/audit/audit.service';

/** IP and user agent for audit rows and token records. */
export function requestContext(req: Request): RequestContext {
  const ip = req.ip?.replace(/^::ffff:/, '') ?? null;
  return { ip: ip && ip.length > 0 ? ip : null, userAgent: req.get('user-agent') ?? null };
}
