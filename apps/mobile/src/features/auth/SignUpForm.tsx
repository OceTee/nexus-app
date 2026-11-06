import { zodResolver } from '@hookform/resolvers/zod';
import { RegisterInput } from '@nexus/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, ControlledTextField, Text } from '../../ui';
import { authErrorMessage, fieldErrors } from './errors';

/** Same schema the API validates with, plus a confirmation field (TDD Section G, Form validation). */
export const SignUpSchema = RegisterInput.omit({ device: true })
  .extend({ confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords differ' });
export type SignUpValues = z.input<typeof SignUpSchema>;

export function SignUpForm({
  onSubmit,
}: {
  onSubmit: (v: z.output<typeof SignUpSchema>) => Promise<void>;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues, unknown, z.output<typeof SignUpSchema>>({
    resolver: zodResolver(SignUpSchema),
    mode: 'onBlur',
    defaultValues: { email: '', password: '', confirm: '', displayName: '' },
  });

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      const fields = fieldErrors(err);
      for (const [name, message] of Object.entries(fields)) {
        if (name === 'email' || name === 'password' || name === 'displayName')
          setError(name, { message });
      }
      if (Object.keys(fields).length === 0) setFormError(authErrorMessage(err));
    }
  });

  const hasErrors = Object.keys(errors).length > 0;
  return (
    <>
      <ControlledTextField
        control={control}
        name="displayName"
        label="Name (optional)"
        autoComplete="name"
        textContentType="name"
        error={errors.displayName?.message}
      />
      <ControlledTextField
        control={control}
        name="email"
        testID="sign-up-email"
        label="Email"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        error={errors.email?.message}
      />
      <ControlledTextField
        control={control}
        name="password"
        testID="sign-up-password"
        label="Password"
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        hint="At least 8 characters. A short phrase works well."
        error={errors.password?.message}
      />
      <ControlledTextField
        control={control}
        name="confirm"
        testID="sign-up-confirm"
        label="Confirm password"
        secureTextEntry
        autoComplete="new-password"
        error={errors.confirm?.message}
      />
      {formError ? (
        <Text
          variant="footnote"
          tone="danger"
          accessibilityLiveRegion="polite"
          style={{ marginBottom: 12 }}
        >
          {formError}
        </Text>
      ) : null}
      <Button
        label="Create account"
        loading={isSubmitting}
        disabled={hasErrors}
        onPress={() => void submit()}
        testID="sign-up-submit"
      />
    </>
  );
}
