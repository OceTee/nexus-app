import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { qk } from '@/data/queries/client';
import { repos } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import { cancelDeletion, requestDeletion, useMe } from '@/features/account/api';
import { authErrorMessage } from '@/features/auth/errors';
import { OfflineNotice, useIsOffline } from '@/features/sync/OfflineNotice';
import { getDb } from '@/infra/db';
import { Button, Card, Header, Screen, Text, TextField, toast } from '@/ui';

const DAY = 86_400_000;

/** S-36 Delete account: request with a 30-day grace period, or cancel. */
export default function DeleteAccount() {
  const qc = useQueryClient();
  const me = useMe();
  const offline = useIsOffline();
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: pending = 0 } = useLocalQuery(['outbox'], () => repos.outbox.pendingCount(getDb()));

  const scheduled = me.data?.deletionRequestedAt;
  const purgeDate = scheduled ? new Date(Date.parse(scheduled) + 30 * DAY) : null;

  const request = async () => {
    setError(null);
    setBusy(true);
    try {
      await requestDeletion(password);
      await qc.invalidateQueries({ queryKey: qk.me() });
      setPassword('');
      setConfirmText('');
      toast.show('Deletion scheduled. You can cancel for 30 days.');
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await cancelDeletion();
      await qc.invalidateQueries({ queryKey: qk.me() });
      toast.show('Deletion cancelled');
      router.back();
    } catch {
      toast.show('Could not cancel. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title="Delete account" />
      <OfflineNotice what="Deleting your account" />
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        {scheduled && purgeDate ? (
          <>
            <Card>
              <Text variant="headline">Deletion is scheduled</Text>
              <Text variant="callout" tone="inkSoft" style={styles.gap}>
                Your account and everything on the server will be erased on{' '}
                {purgeDate.toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
                . Until then you can keep using NEXUS and cancel at any time.
              </Text>
            </Card>
            <Button
              label="Cancel deletion"
              loading={busy}
              disabled={offline}
              onPress={() => void cancel()}
            />
          </>
        ) : (
          <>
            <Text variant="callout">
              Deleting your account erases your notes, collections, tags, versions and attachments
              from the server after a 30-day grace period. Notes already on your devices stay there.
            </Text>
            <Card>
              <Text variant="headline">Before you go</Text>
              <Text variant="callout" tone="inkSoft" style={styles.gap}>
                Export a copy first if you want to keep your notes elsewhere.
              </Text>
              <Button
                label="Export first"
                variant="text"
                block={false}
                onPress={() => router.push('/settings/export')}
              />
            </Card>
            {pending > 0 ? (
              <Text variant="callout" tone="danger">
                Unsynced changes on this device will be lost ({pending} waiting).
              </Text>
            ) : null}
            <TextField
              label='Type "DELETE" to confirm'
              value={confirmText}
              onChangeText={setConfirmText}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              error={error ?? undefined}
            />
            <Button
              label="Delete my account"
              variant="destructive"
              loading={busy}
              disabled={confirmText !== 'DELETE' || !password || offline}
              onPress={() => void request()}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 48, gap: 16 },
  gap: { marginTop: 4 },
});
