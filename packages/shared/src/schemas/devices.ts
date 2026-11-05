import { z } from 'zod';
import { LIMITS } from '../limits';
import { IsoDateTime, UuidV7 } from './common';

export const Platform = z.enum(['ios', 'android']);
export type Platform = z.infer<typeof Platform>;

const DeviceName = z.string().trim().min(1).max(LIMITS.deviceNameMax);
const AppVersion = z.string().regex(/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/, 'must be semver');
const PushToken = z.string().min(1).max(512);

/** Sent at register, login and `POST /v1/devices` (idempotent upsert). */
export const DeviceRegisterInput = z.object({
  id: UuidV7,
  name: DeviceName,
  platform: Platform,
  appVersion: AppVersion,
  pushToken: PushToken.optional(),
});
export type DeviceRegisterInput = z.infer<typeof DeviceRegisterInput>;

/** `PATCH /v1/devices/:deviceId`; `pushToken: null` clears the token. */
export const DeviceUpdateInput = z
  .object({ name: DeviceName.optional(), pushToken: PushToken.nullable().optional() })
  .refine((v) => v.name !== undefined || v.pushToken !== undefined, 'nothing to update');
export type DeviceUpdateInput = z.infer<typeof DeviceUpdateInput>;

export const DeviceParams = z.object({ deviceId: UuidV7 });

export const DeviceDto = z.object({
  id: UuidV7,
  name: z.string(),
  platform: Platform,
  appVersion: z.string(),
  lastSeenAt: IsoDateTime,
  createdAt: IsoDateTime,
  isCurrent: z.boolean(),
  hasPush: z.boolean(),
});
export type DeviceDto = z.infer<typeof DeviceDto>;

export const DeviceListDto = z.object({ items: z.array(DeviceDto) });
