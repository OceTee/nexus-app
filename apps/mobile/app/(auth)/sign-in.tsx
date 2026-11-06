import { zodResolver } from '@hookform/resolvers/zod';
import { LoginInput } from '@nexus/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import type { z } from 'zod';
import { signIn } from '../../src/features/auth/authService';
import { authErrorMessage } from '../../src/features/auth/errors';
import { Button, ControlledTextField, Screen, Text } from '../../src/ui';

const Schema = LoginInput.omit({ device: true });

/** S-03 Sign in. Signing in from offline mode keeps the notes already on the device. */
export default function SignIn() {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof Schema>, unknown, z.output<typeof Schema>>({
    resolver: zodResolver(Schema),
    mode: 'onBlur',
    defaultValues: { email: '', password: '' },
  });

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signIn(values);
      // The (app) group unlocks on its own once the session is signed in.
    } catch (err) {
      setFormError(authErrorMessage(err));
    }
  });

  return (
    <Screen title="Sign in" form>
      <ControlledTextField
        control={control}
        name="email"
        testID="sign-in-email"
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
        testID="sign-in-password"
        label="Password"
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        error={errors.password?.message}
        onSubmitEditing={() => void submit()}
      />
      {formError ? (
        <Text
          variant="footnote"
          tone="danger"
          accessibilityLiveRegion="polite"
          style={styles.error}
        >
          {formError}
        </Text>
      ) : null}
      <Button
        testID="sign-in-submit"
        label="Sign in"
        loading={isSubmitting}
        onPress={() => void submit()}
      />
      <View style={styles.links}>
        <Button
          label="Forgot password?"
          variant="text"
          onPress={() => router.push('/forgot-password')}
        />
        <Button
          label="Create an account"
          variant="text"
          onPress={() => router.replace('/sign-up')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { marginBottom: 12 },
  links: { marginTop: 16, gap: 4 },
});
