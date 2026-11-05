import {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  LogoutInput,
  RefreshInput,
  RegisterInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from '@nexus/shared';
import { Router, type RequestHandler } from 'express';
import { requestContext } from '../../http/context';
import { byIp, consume, rateLimit, type Limiters } from '../../http/middleware/rateLimit';
import { validate } from '../../http/middleware/validate';
import type { AuthService } from './auth.service';

/** `/v1/auth/*` (10 endpoints; TDD Section F, Auth). */
export function authRouter(
  svc: AuthService,
  limiters: Limiters,
  requireAuth: RequestHandler,
): Router {
  const r = Router();
  const burst = rateLimit(limiters.authBurst, byIp);

  r.post('/register', burst, validate({ body: RegisterInput }), async (req, res) => {
    res.status(201).json(await svc.register(req.body, requestContext(req)));
  });

  r.post('/login', burst, validate({ body: LoginInput }), async (req, res) => {
    res.json(await svc.login(req.body, requestContext(req)));
  });

  r.post('/refresh', validate({ body: RefreshInput }), async (req, res) => {
    await consume(limiters.refresh, `device:${req.body.deviceId}`, res);
    res.json(await svc.refresh(req.body, requestContext(req)));
  });

  r.post('/logout', requireAuth, validate({ body: LogoutInput }), async (req, res) => {
    await svc.logout(req.auth.userId, req.body.refreshToken);
    res.status(204).end();
  });

  r.post('/logout-all', requireAuth, async (req, res) => {
    await svc.logoutAll(req.auth.userId, requestContext(req));
    res.status(204).end();
  });

  r.post('/verify-email', validate({ body: VerifyEmailInput }), async (req, res) => {
    await svc.verifyEmail(req.body.token, requestContext(req));
    res.json({ emailVerified: true });
  });

  r.post('/resend-verification', requireAuth, async (req, res) => {
    await svc.resendVerification(req.auth.userId);
    res.status(202).end();
  });

  r.post('/forgot-password', burst, validate({ body: ForgotPasswordInput }), async (req, res) => {
    await svc.forgotPassword(req.body.email);
    res.status(202).end();
  });

  r.post('/reset-password', burst, validate({ body: ResetPasswordInput }), async (req, res) => {
    await svc.resetPassword(req.body, requestContext(req));
    res.status(204).end();
  });

  r.post(
    '/change-password',
    requireAuth,
    validate({ body: ChangePasswordInput }),
    async (req, res) => {
      res.json(
        await svc.changePassword(req.auth.userId, req.auth.deviceId, req.body, requestContext(req)),
      );
    },
  );

  return r;
}
