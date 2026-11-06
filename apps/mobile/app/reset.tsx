import { zodResolver } from '@hookform/resolvers/zod';
import { Password } from '@nexus/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { KeyRound } from 'lucide-react-native';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { StyleSheet } from 'react-native';
import { z } from 'zod';
import { resetPassword, tokenFromInput } from '../src/features/auth/authService';
import { authErrorMessage, fieldErrors } from '../src/features/auth/errors';
import { useSessionStore } from '../src/stores/session';
import { Button, ControlledTextField, EmptyState, Screen, Text } from '../src/ui';

const Schema = z
  .object({
    link: z.string().min(1, 'Paste the link from the email'),
    password: Password,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords differ' });

/** S-06 Reset password, at /reset so the emailed link opens it directly. */
export default function ResetPassword() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const status = useSessionStore((s) => s.status);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof Schema>, unknown, z.output<typeof Schema>>({
    resolver: zodResolver(Schema),
    mode: 'onBlur',
    defaultValues: { link: token ?? '', password: '', confirm: '' },
  });

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await resetPassword(tokenFromInput(v.link), v.password);
      setDone(true);
    } catch (err) {
      const f = fieldErrors(err);
      if (f.password) setError('password', { message: f.password });
      else setFormError(authErrorMessage(err));
    }
  });

  if (done) {
    return (
      <Screen edges={['top', 'bottom']}>
        <EmptyState
          icon={KeyRound}
          title="Password changed"
          body="Every device was signed out. Sign in with your new password."
          action={{
            label: 'Sign in',
            onPress: () => router.replace(status === 'authed' ? '/notes' : '/sign-in'),
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen title="Choose a new password" form>
      {token ? null : (
        <ControlledTextField
          control={control}
          name="link"
          label="Link from the email"
          autoCapitalize="none"
          autoCorrect={false}
          error={errors.link?.message}
        />
      )}
      <ControlledTextField
        control={control}
        name="password"
        label="New password"
        secureTextEntry
        autoComplete="new-password"
        error={errors.password?.message}
      />
      <ControlledTextField
        control={control}
        name="confirm"
        label="Confirm new password"
        secureTextEntry
        autoComplete="new-password"
        error={errors.confirm?.message}
      />
      {formError ? (
        <Text variant="footnote" tone="danger" style={styles.error}>
          {formError}
        </Text>
      ) : null}
      <Button label="Change password" loading={isSubmitting} onPress={() => void submit()} />
    </Screen>
  );
}

const styles = StyleSheet.create({ error: { marginBottom: 12 } });
