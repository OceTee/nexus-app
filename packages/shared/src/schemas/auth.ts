import { z } from 'zod';
import { LIMITS } from '../limits';
import { IsoDateTime, Uuid, UuidV7 } from './common';
import { DeviceRegisterInput } from './devices';

/** Trimmed, lower-cased email address. */
export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(LIMITS.emailMax)
  .pipe(z.email({ message: 'must be a valid email address' }));

/**
 * Password length rules (8–128). Strength (zxcvbn score ≥ 2) is checked on the
 * server, which has the dictionary; the client shows a strength meter.
 */
export const Password = z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax);

/** Login uses any non-empty password so policy changes never lock users out. */
const AnyPassword = z.string().min(1).max(LIMITS.passwordMax);

export const DisplayName = z.string().trim().max(LIMITS.displayNameMax);

/** Opaque single-use token from a verification or reset email. */
const EmailToken = z.string().min(16).max(256);

/** Opaque refresh token (32 random bytes, base64url). */
export const RefreshToken = z.string().min(16).max(256);

export const UserSettings = z.object({
  /** Send anonymous crash and performance data. */
  telemetryOptIn: z.boolean().default(false),
  /** Push notification preferences. */
  push: z.object({ newDeviceSignIn: z.boolean().default(true) }).default({ newDeviceSignIn: true }),
});
export type UserSettings = z.infer<typeof UserSettings>;

export const UserDto = z.object({
  id: Uuid,
  email: z.string(),
  displayName: z.string(),
  emailVerified: z.boolean(),
  settings: UserSettings,
  deletionRequestedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type UserDto = z.infer<typeof UserDto>;

export const RegisterInput = z.object({
  email: Email,
  password: Password,
  displayName: DisplayName.optional(),
  device: DeviceRegisterInput,
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: Email,
  password: AnyPassword,
  device: DeviceRegisterInput,
});
export type LoginInput = z.infer<typeof LoginInput>;

/** Response to register and login. */
export const AuthSessionDto = z.object({
  user: UserDto,
  accessToken: z.string(),
  refreshToken: z.string(),
  deviceId: UuidV7,
});
export type AuthSessionDto = z.infer<typeof AuthSessionDto>;

export const RefreshInput = z.object({ refreshToken: RefreshToken, deviceId: UuidV7 });
export type RefreshInput = z.infer<typeof RefreshInput>;

/** Response to refresh and change-password. */
export const TokenPairDto = z.object({ accessToken: z.string(), refreshToken: z.string() });
export type TokenPairDto = z.infer<typeof TokenPairDto>;

export const LogoutInput = z.object({ refreshToken: RefreshToken });

export const VerifyEmailInput = z.object({ token: EmailToken });
export const VerifyEmailDto = z.object({ emailVerified: z.literal(true) });

export const ForgotPasswordInput = z.object({ email: Email });

export const ResetPasswordInput = z.object({ token: EmailToken, password: Password });
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;

export const ChangePasswordInput = z
  .object({ currentPassword: AnyPassword, newPassword: Password })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'new password must differ from the current one',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

/** Claims carried in the access token (JWT, 15 minutes). */
export const AccessTokenClaims = z.object({
  sub: Uuid,
  dev: UuidV7,
  ver: z.boolean(),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaims>;
