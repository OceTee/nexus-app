import { z } from 'zod';
import { IsoDateTime } from './common';

/** `GET /v1/meta`: API version, minimum supported clients and server time. */
export const MetaDto = z.object({
  apiVersion: z.string(),
  minClientSchema: z.number().int().min(1),
  minAppVersion: z.string(),
  serverTime: IsoDateTime,
});
export type MetaDto = z.infer<typeof MetaDto>;

export const HealthDto = z.object({ status: z.literal('ok') });
