import { LIMITS } from '@nexus/shared';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useAudit, useMe, useUpdateMe, useUsage } from '@/features/account/api';
import { formatBytes, relativeDate } from '@/features/notes/format';
import { OfflineNotice } from '@/features/sync/OfflineNotice';
import { useSessionStore } from '@/stores/session';
import { Button, Card, Header, Screen, Text, TextField, toast, useTheme } from '@/ui';

const ACTION_LABEL: Record<string, string> = {
  'auth.register': 'Account created',
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in attempt',
  'auth.refresh_reuse': 'Session reuse blocked',
  'auth.logout_all': 'Signed out everywhere',
  'auth.password_changed': 'Password changed',
  'auth.password_reset': 'Password reset',
  'auth.email_verified': 'Email confirmed',
  'device.revoke': 'Device removed',
  'account.deletion_requested': 'Deletion requested',
  'account.deletion_cancelled': 'Deletion cancelled',
  'export.download': 'Export downloaded',
};

/** S-29 Account: display name, email, usage and recent security events. */
export default function Account() {
  const t = useTheme();
  const cached = useSessionStore((s) => s.user);
  const me = useMe();
  const usage = useUsage();
  const audit = useAudit();
  const update = useUpdateMe();
  const [name, setName] = useState<string | null>(null);
  const shownName = name ?? me.data?.displayName ?? cached?.displayName ?? '';
  const dirty = name !== null && name.trim() !== (me.data?.displayName ?? '');

  return (
    <Screen>
      <Header title="Account" />
      <OfflineNotice what="Editing your account" />
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <TextField
          label="Display name"
          value={shownName}
          onChangeText={setName}
          maxLength={LIMITS.displayNameMax}
          hint="Shown on your devices and in emails"
        />
        {dirty ? (
          <Button
            label="Save name"
            loading={update.isPending}
            onPress={() =>
              update.mutate(
                { displayName: shownName.trim() },
                {
                  onSuccess: () => {
                    setName(null);
                    toast.show('Name saved');
                  },
                  onError: () => toast.show('Could not save. Check your connection.'),
                },
              )
            }
          />
        ) : null}

        <Text variant="footnote" tone="inkSoft" style={styles.label}>
          Email
        </Text>
        <Text variant="body">{me.data?.email ?? cached?.email}</Text>
        {me.data ? (
          <Text variant="footnote" tone="inkFaint" style={styles.gap}>
            Member since{' '}
            {new Date(me.data.createdAt).toLocaleDateString(undefined, {
              month: 'long',
              year: 'numeric',
            })}
            {me.data.emailVerified ? ' · email confirmed' : ' · email not confirmed'}
          </Text>
        ) : null}

        <Text variant="caption" tone="inkSoft" style={styles.section}>
          ON THE SERVER
        </Text>
        {usage.data ? (
          <Card>
            {[
              ['Notes', usage.data.notes],
              ['Collections', usage.data.collections],
              ['Tags', usage.data.tags],
              ['Versions kept', usage.data.versions],
              [
                'Attachments',
                `${usage.data.attachments} · ${formatBytes(usage.data.attachmentBytes)} of ${formatBytes(usage.data.quotaBytes)}`,
              ],
            ].map(([k, v]) => (
              <View key={String(k)} style={styles.kv}>
                <Text variant="callout" tone="inkSoft">
                  {k}
                </Text>
                <Text variant="callout">{v}</Text>
              </View>
            ))}
          </Card>
        ) : usage.isLoading ? (
          <ActivityIndicator color={t.colors.primary} />
        ) : (
          <Text variant="callout" tone="inkFaint">
            Available when online.
          </Text>
        )}

        <Text variant="caption" tone="inkSoft" style={styles.section}>
          SECURITY EVENTS
        </Text>
        {(audit.data?.items ?? []).map((e) => (
          <View key={e.id} style={[styles.event, { borderBottomColor: t.colors.line }]}>
            <Text variant="callout">{ACTION_LABEL[e.action] ?? e.action}</Text>
            <Text variant="footnote" tone="inkSoft">
              {relativeDate(e.createdAt)}
              {e.deviceName ? ` · ${e.deviceName}` : ''}
            </Text>
          </View>
        ))}
        {audit.data && audit.data.items.length === 0 ? (
          <Text variant="callout" tone="inkFaint">
            No events yet.
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 48 },
  label: { marginTop: 8, marginBottom: 4 },
  gap: { marginTop: 4 },
  section: { marginTop: 24, marginBottom: 8 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  event: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
});
