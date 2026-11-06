import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { register } from '../../src/features/auth/authService';
import { SignUpForm } from '../../src/features/auth/SignUpForm';
import { Button, Screen, Text } from '../../src/ui';

/** S-02 Sign up. */
export default function SignUp() {
  return (
    <Screen title="Create account" form>
      <Text variant="callout" tone="inkSoft" style={styles.lead}>
        An account lets your notes sync between devices. We will email you a link to confirm the
        address.
      </Text>
      <SignUpForm
        onSubmit={async (v) => {
          await register({
            email: v.email,
            password: v.password,
            ...(v.displayName ? { displayName: v.displayName } : {}),
          });
          router.replace('/verify');
        }}
      />
      <View style={styles.footer}>
        <Button
          label="I already have an account"
          variant="text"
          onPress={() => router.replace('/sign-in')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginBottom: 24 },
  footer: { marginTop: 16 },
});
