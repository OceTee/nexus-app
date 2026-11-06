import { router } from 'expo-router';
import { Lock, LogIn, MailWarning, Tags, Trash2, User } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { signOut } from '../../../../src/features/auth/authService';
import { APP_VERSION } from '../../../../src/infra/config';
import { canUseLock, unlock } from '../../../../src/infra/biometrics';
import { useSessionStore } from '../../../../src/stores/session';
import { useSettingsStore } from '../../../../src/stores/settings';
import {
  Button,
  ListRow,
  Screen,
  SegmentedControl,
  Text,
  toast,
  useTheme,
} from '../../../../src/ui';

/** S-28 Settings (Phase 7 subset: account, lock, appearance; the rest arrives in Phase 11). */
export default function SettingsTab() {
  const t = useTheme();
  const status = useSessionStore((s) => s.status);
  const user = useSessionStore((s) => s.user);
  const settings = useSettingsStore();
  const [lockAvailable, setLockAvailable] = useState(false);

  useEffect(() => {
    void canUseLock().then(setLockAvailable);
  }, []);

  const toggleLock = async (on: boolean) => {
    if (on && !(await unlock('Confirm to turn on the lock'))) return;
    settings.update({ lockEnabled: on });
    toast.show(on ? 'App lock on' : 'App lock off');
  };

  return (
    <Screen title="Settings" scroll>
      <Section label="Account">
        {status === 'authed' && user ? (
          <>
            <ListRow
              icon={User}
              title={user.displayName || user.email}
              subtitle={user.displayName ? user.email : undefined}
            />
            {!user.emailVerified ? (
              <ListRow
                icon={MailWarning}
                title="Confirm your email"
                subtitle="Needed for sync, attachments and export"
                onPress={() => router.push('/verify')}
              />
            ) : null}
          </>
        ) : (
          <ListRow
            icon={LogIn}
            title="Sign in to sync"
            subtitle="Your notes are only on this device"
            onPress={() => router.push('/sign-in')}
          />
        )}
      </Section>

      <Section label="Library">
        <ListRow icon={Tags} title="Tags" onPress={() => router.push('/tags')} />
        <ListRow
          icon={Trash2}
          title="Trash"
          onPress={() => router.push('/settings/trash')}
          divider={false}
        />
      </Section>

      <Section label="Security">
        <ListRow
          icon={Lock}
          title="App lock"
          subtitle={
            lockAvailable
              ? 'Fingerprint, face or passcode'
              : 'Set up a screen lock on this phone first'
          }
          right={
            <Switch
              accessibilityLabel="App lock"
              value={settings.lockEnabled}
              disabled={!lockAvailable}
              onValueChange={(v) => void toggleLock(v)}
              trackColor={{ true: t.colors.primary, false: t.colors.line }}
            />
          }
          divider={settings.lockEnabled}
        />
        {settings.lockEnabled ? (
          <View style={styles.pad}>
            <Text variant="footnote" tone="inkSoft" style={styles.label}>
              Lock after the app is in the background for
            </Text>
            <SegmentedControl
              label="Lock timeout"
              value={String(settings.lockTimeoutSec)}
              onChange={(v) => settings.update({ lockTimeoutSec: Number(v) })}
              options={[
                { value: '0', label: 'Immediately' },
                { value: '30', label: '30 s' },
                { value: '60', label: '1 min' },
                { value: '300', label: '5 min' },
              ]}
            />
          </View>
        ) : null}
      </Section>

      <Section label="Appearance">
        <View style={styles.pad}>
          <SegmentedControl
            label="Theme"
            value={settings.theme}
            onChange={(theme) => settings.update({ theme })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </View>
      </Section>

      {status === 'authed' ? (
        <View style={styles.signOut}>
          <Button
            label="Sign out"
            variant="secondary"
            onPress={() =>
              void signOut().then(() => toast.show('Signed out. Your notes stay on this device.'))
            }
          />
        </View>
      ) : null}
      <Text variant="footnote" tone="inkFaint" align="center" style={styles.version}>
        NEXUS {APP_VERSION}
      </Text>
    </Screen>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="caption" tone="inkSoft" style={styles.sectionLabel} accessibilityRole="header">
        {label.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 24, marginHorizontal: -16 },
  sectionLabel: { marginHorizontal: 16, marginBottom: 4 },
  pad: { paddingHorizontal: 16, paddingVertical: 8 },
  label: { marginBottom: 8 },
  signOut: { marginTop: 8 },
  version: { marginTop: 24 },
});
