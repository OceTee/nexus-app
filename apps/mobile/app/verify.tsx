import { router, useLocalSearchParams } from 'expo-router';
import { MailCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { resendVerification, tokenFromInput, verifyEmail } from '../src/features/auth/authService';
import { authErrorMessage } from '../src/features/auth/errors';
import { useSessionStore } from '../src/stores/session';
import { Button, Card, EmptyState, Screen, Text, TextField, toast } from '../src/ui';

/**
 * S-04 Verify email, at /verify so the emailed link
 * (https://app.nexus.example/verify?token=…) opens it directly, signed in or out.
 */
export default function VerifyEmail() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const status = useSessionStore((s) => s.status);
  const user = useSessionStore((s) => s.user);
  const [input, setInput] = useState('');
  const [state, setState] = useState<'idle' | 'working' | 'done'>(token ? 'working' : 'idle');
  const [error, setError] = useState<string | null>(null);

  const verify = async (raw: string) => {
    setState('working');
    setError(null);
    try {
      await verifyEmail(tokenFromInput(raw));
      setState('done');
    } catch (err) {
      setError(authErrorMessage(err));
      setState('idle');
    }
  };

  // A token in the link verifies straight away; state starts as 'working'.
  useEffect(() => {
    if (!token) return;
    verifyEmail(tokenFromInput(token)).then(
      () => setState('done'),
      (err: unknown) => {
        setError(authErrorMessage(err));
        setState('idle');
      },
    );
  }, [token]);

  const leave = () =>
    router.replace(status === 'authed' || status === 'local' ? '/notes' : '/sign-in');

  if (state === 'done') {
    return (
      <Screen edges={['top', 'bottom']}>
        <EmptyState
          icon={MailCheck}
          title="Email confirmed"
          body="Sync, attachments and export are now on."
          action={{ label: 'Continue', onPress: leave }}
        />
      </Screen>
    );
  }

  return (
    <Screen title="Confirm your email" form>
      <Text variant="callout" tone="inkSoft" style={styles.lead}>
        {user?.email ? `We sent a link to ${user.email}.` : 'Open the link we emailed you.'} Tap it
        on this phone, or paste it below.
      </Text>
      <TextField
        label="Link or code from the email"
        value={input}
        onChangeText={setInput}
        autoCapitalize="none"
        autoCorrect={false}
        error={error ?? undefined}
      />
      <Button
        label="Confirm email"
        loading={state === 'working'}
        disabled={!input.trim()}
        onPress={() => void verify(input)}
      />
      <View style={styles.more}>
        {status === 'authed' && user && !user.emailVerified ? (
          <Card>
            <Text variant="footnote" tone="inkSoft">
              No email? Check spam, or send a new link (one every 5 minutes).
            </Text>
            <Button
              label="Send a new link"
              variant="text"
              onPress={() =>
                resendVerification().then(
                  () => toast.show('A new link is on its way'),
                  (err: unknown) => toast.show(authErrorMessage(err)),
                )
              }
            />
          </Card>
        ) : null}
        <Button label="Later" variant="text" onPress={leave} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginBottom: 24 },
  more: { marginTop: 16, gap: 8 },
});
