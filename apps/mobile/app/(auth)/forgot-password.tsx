import { zodResolver } from '@hookform/resolvers/zod';
import { ForgotPasswordInput } from '@nexus/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { StyleSheet } from 'react-native';
import type { z } from 'zod';
import { forgotPassword } from '../../src/features/auth/authService';
import { authErrorMessage } from '../../src/features/auth/errors';
import { Button, Card, ControlledTextField, Screen, Text } from '../../src/ui';

/** S-05 Forgot password. The reply never reveals whether the account exists. */
export default function ForgotPassword() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof ForgotPasswordInput>, unknown, z.output<typeof ForgotPasswordInput>>({
    resolver: zodResolver(ForgotPasswordInput),
    mode: 'onBlur',
    defaultValues: { email: '' },
  });

  const submit = handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await forgotPassword(email);
      setSentTo(email);
    } catch (err) {
      setFormError(authErrorMessage(err));
    }
  });

  return (
    <Screen title="Reset password" form>
      {sentTo ? (
        <Card>
          <Text variant="headline">Check your email</Text>
          <Text variant="callout" tone="inkSoft" style={styles.gap}>
            If {sentTo} has a NEXUS account, a reset link is on its way. It works once, for 30
            minutes.
          </Text>
          <Button
            label="I have the link"
            variant="secondary"
            onPress={() => router.push('/reset')}
          />
        </Card>
      ) : (
        <>
          <Text variant="callout" tone="inkSoft" style={styles.lead}>
            Enter the email you signed up with and we will send a link to choose a new password.
          </Text>
          <ControlledTextField
            control={control}
            name="email"
            label="Email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            error={errors.email?.message}
          />
          {formError ? (
            <Text variant="footnote" tone="danger" style={styles.gap}>
              {formError}
            </Text>
          ) : null}
          <Button label="Send reset link" loading={isSubmitting} onPress={() => void submit()} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginBottom: 24 },
  gap: { marginVertical: 12 },
});
