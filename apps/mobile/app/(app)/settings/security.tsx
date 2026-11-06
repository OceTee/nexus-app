import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordInput, LIMITS } from '@nexus/shared';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { z } from 'zod';
import { changePassword } from '@/features/auth/authService';
import { authErrorMessage } from '@/features/auth/errors';
import { OfflineNotice } from '@/features/sync/OfflineNotice';
import { canUseLock, unlock } from '@/infra/biometrics';
import { useSessionStore } from '@/stores/session';
import { useSettingsStore } from '@/stores/settings';
import {
  Button,
  ControlledTextField,
  Header,
  ListRow,
  Screen,
  SegmentedControl,
  Text,
  toast,
  useTheme,
} from '@/ui';
import { Lock } from 'lucide-react-native';

const Form = ChangePasswordInput.and(z.object({ confirm: z.string() })).refine(
  (v) => v.newPassword === v.confirm,
  { message: 'Passwords differ', path: ['confirm'] },
);
type FormValues = z.infer<typeof Form>;

/** S-30 Security: change password and app lock. */
export default function Security() {
  const t = useTheme();
  const authed = useSessionStore((s) => s.status === 'authed');
  const settings = useSettingsStore();
  const [lockAvailable, setLockAvailable] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(Form),
    mode: 'onBlur',
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });

  useEffect(() => {
    void canUseLock().then(setLockAvailable);
  }, []);

  const toggleLock = async (on: boolean) => {
    if (on && !(await unlock('Confirm to turn on the lock'))) return;
    settings.update({ lockEnabled: on });
    toast.show(on ? 'App lock on' : 'App lock off');
  };

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword });
      reset();
      toast.show('Password changed. Other devices are signed out.');
    } catch (e) {
      setFormError(authErrorMessage(e));
    }
  });

  return (
    <Screen>
      <Header title="Security" />
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <View style={styles.bleed}>
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
                testID="app-lock-switch"
                value={settings.lockEnabled}
                disabled={!lockAvailable}
                onValueChange={(v) => void toggleLock(v)}
                trackColor={{ true: t.colors.primary, false: t.colors.line }}
              />
            }
            divider={false}
          />
        </View>
        {settings.lockEnabled ? (
          <>
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
          </>
        ) : null}

        {authed ? (
          <>
            <Text
              variant="caption"
              tone="inkSoft"
              style={styles.section}
              accessibilityRole="header"
            >
              CHANGE PASSWORD
            </Text>
            <OfflineNotice what="Changing your password" />
            <ControlledTextField
              control={control}
              name="currentPassword"
              label="Current password"
              secureTextEntry
              autoComplete="current-password"
              error={formState.errors.currentPassword?.message}
            />
            <ControlledTextField
              control={control}
              name="newPassword"
              label="New password"
              secureTextEntry
              autoComplete="new-password"
              maxLength={LIMITS.passwordMax}
              hint="At least 8 characters. A short phrase works well."
              error={formState.errors.newPassword?.message}
            />
            <ControlledTextField
              control={control}
              name="confirm"
              label="Confirm new password"
              secureTextEntry
              autoComplete="new-password"
              error={formState.errors.confirm?.message}
            />
            {formError ? (
              <Text variant="callout" tone="danger" style={styles.label}>
                {formError}
              </Text>
            ) : null}
            <Button
              label="Change password"
              loading={formState.isSubmitting}
              onPress={() => void submit()}
            />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 48 },
  bleed: { marginHorizontal: -16 },
  label: { marginTop: 8, marginBottom: 8 },
  section: { marginTop: 24, marginBottom: 8 },
});
