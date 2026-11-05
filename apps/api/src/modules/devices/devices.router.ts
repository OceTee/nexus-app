import { DeviceParams, DeviceRegisterInput, DeviceUpdateInput } from '@nexus/shared';
import { Router } from 'express';
import { requestContext } from '../../http/context';
import { input, validate } from '../../http/middleware/validate';
import type { DevicesService } from './devices.service';

type Params = { deviceId: string };

/** `/v1/devices` (4 endpoints). Mounted behind requireAuth. */
export function devicesRouter(svc: DevicesService): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    res.json(await svc.list(req.auth.userId, req.auth.deviceId));
  });

  r.post('/', validate({ body: DeviceRegisterInput }), async (req, res) => {
    res.json(await svc.register(req.auth.userId, req.auth.deviceId, req.body));
  });

  r.patch(
    '/:deviceId',
    validate({ params: DeviceParams, body: DeviceUpdateInput }),
    async (req, res) => {
      const { deviceId } = input<Params>(req.valid.params);
      res.json(await svc.update(req.auth.userId, req.auth.deviceId, deviceId, req.body));
    },
  );

  r.delete('/:deviceId', validate({ params: DeviceParams }), async (req, res) => {
    const { deviceId } = input<Params>(req.valid.params);
    await svc.revoke(req.auth.userId, req.auth.deviceId, deviceId, requestContext(req));
    res.status(204).end();
  });

  return r;
}
