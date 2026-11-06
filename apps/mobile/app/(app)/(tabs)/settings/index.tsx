import { router, type Href } from 'expo-router';
import {
  Download,
  Info,
  LogIn,
  MailWarning,
  Palette,
  RefreshCw,
  Shield,
  ShieldCheck,
  Smartphone,
  Tags,
  Trash2,
  User,
  type LucideIcon,
} from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { signOut } from '@/features/auth/authService';
import { DeletionBanner } from '@/features/account/DeletionBanner';
import { APP_VERSION } from '@/infra/config';
import { unregisterPush } from '@/infra/push';
import { useSessionStore } from '@/stores/session';
import { Button, ListRow, Screen, Text, toast } from '@/ui';

const go = (href: Href) => () => router.push(href);

/** S-28 Settings home. */
export default function SettingsTab() {
  const status = useSessionStore((s) => s.status);
  const user = useSessionStore((s) => s.user);
  const authed = status === 'authed' && user;

  const row = (icon: LucideIcon, title: string, href: Href, subtitle?: string, last = false) => (
    <ListRow icon={icon} title={title} subtitle={subtitle} onPress={go(href)} divider={!last} />
  );

  return (
    <Screen title="Settings" scroll>
      <DeletionBanner />
      <Section label="Account">
        {authed ? (
          <>
            {row(
              User,
              user.displayName || user.email,
              '/settings/account',
              user.displayName ? user.email : 'Profile and security events',
            )}
            {!user.emailVerified
              ? row(
                  MailWarning,
                  'Confirm your email',
                  '/verify',
                  'Needed for sync, attachments and export',
                )
              : null}
            {row(RefreshCw, 'Sync', '/settings/sync', 'Status, queued changes and errors', true)}
          </>
        ) : (
          <ListRow
            icon={LogIn}
            title="Sign in to sync"
            subtitle="Your notes are only on this device"
            onPress={go('/sign-in')}
            divider={false}
          />
        )}
      </Section>

      <Section label="Security">
        {row(
          Shield,
          'Security',
          '/settings/security',
          authed ? 'Password and app lock' : 'App lock',
          !authed,
        )}
        {authed
          ? row(Smartphone, 'Devices', '/settings/devices', 'Where you are signed in', true)
          : null}
      </Section>

      <Section label="Library">
        {row(Tags, 'Tags', '/tags')}
        {row(Trash2, 'Trash', '/settings/trash')}
        {row(Download, 'Export', '/settings/export', 'Markdown bundle or JSON', true)}
      </Section>

      <Section label="App">
        {row(Palette, 'Appearance', '/settings/appearance', 'Theme, text size, contrast')}
        {row(ShieldCheck, 'Privacy and data', '/settings/privacy', 'What is stored, telemetry')}
        {row(Info, 'About', '/settings/about', `NEXUS ${APP_VERSION} · licences`, true)}
      </Section>

      {authed ? (
        <View style={styles.signOut}>
          <Button
            label="Sign out"
            variant="secondary"
            onPress={() =>
              void unregisterPush()
                .then(signOut)
                .then(() => toast.show('Signed out. Your notes stay on this device.'))
            }
          />
        </View>
      ) : null}
      <View style={styles.footer}>
        <Text variant="footnote" tone="inkFaint" align="center">
          NEXUS {APP_VERSION}
        </Text>
      </View>
    </Screen>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
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
  signOut: { marginTop: 8 },
  footer: { marginTop: 24, alignItems: 'center' },
});
