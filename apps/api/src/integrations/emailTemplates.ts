import type { EmailTemplateName } from '../jobs/queue';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function layout(title: string, paragraphs: string[], action?: { label: string; url: string }) {
  const text = [
    title,
    '',
    ...paragraphs,
    ...(action ? ['', `${action.label}: ${action.url}`] : []),
    '',
    '— NEXUS',
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;color:#1C2340;max-width:560px;margin:auto;padding:24px">
<h1 style="font-size:22px">${escape(title)}</h1>
${paragraphs.map((p) => `<p style="font-size:16px;line-height:24px">${escape(p)}</p>`).join('\n')}
${action ? `<p><a href="${escape(action.url)}" style="background:#3B5BDB;color:#FFFFFF;padding:12px 20px;border-radius:10px;text-decoration:none;display:inline-block">${escape(action.label)}</a></p>` : ''}
<p style="font-size:13px;color:#4A5170">NEXUS · Your thinking, connected.</p>
</body></html>`;
  return { text, html };
}

/** Email copy for every template (TDD Phase 4 checklist: verify, reset, new device, deletion). */
export function renderEmail(
  template: EmailTemplateName,
  vars: Record<string, string>,
): RenderedEmail {
  const v = (k: string) => vars[k] ?? '';
  switch (template) {
    case 'verify-email':
      return {
        subject: 'Confirm your email for NEXUS',
        ...layout(
          'Confirm your email',
          [
            'Confirm this address to turn on sync, attachments and export. The link works for 24 hours.',
          ],
          { label: 'Confirm email', url: v('url') },
        ),
      };
    case 'reset-password':
      return {
        subject: 'Reset your NEXUS password',
        ...layout(
          'Reset your password',
          [
            'Someone asked to reset the password for this account. The link works once, for 30 minutes.',
            'If it was not you, ignore this email; your password stays the same.',
          ],
          { label: 'Choose a new password', url: v('url') },
        ),
      };
    case 'password-changed':
      return {
        subject: 'Your NEXUS password was changed',
        ...layout('Your password was changed', [
          'The password for this account was just changed and other devices were signed out.',
          'If this was not you, reset your password now and review your devices.',
        ]),
      };
    case 'new-device':
      return {
        subject: 'New sign-in to NEXUS',
        ...layout('New device signed in', [
          `${v('deviceName')} (${v('platform')}) signed in to your account.`,
          'If this was not you, revoke the device from Settings → Devices and change your password.',
        ]),
      };
    case 'deletion-requested':
      return {
        subject: 'Your NEXUS account will be deleted',
        ...layout('Account deletion requested', [
          `Your account and all its notes will be permanently deleted on ${v('purgeDate')}.`,
          'You can cancel at any time before then from Settings → Account.',
        ]),
      };
    case 'deletion-reminder':
      return {
        subject: 'Your NEXUS account will be deleted in 7 days',
        ...layout('Account deletion reminder', [
          `Your account and all its notes will be permanently deleted on ${v('purgeDate')}.`,
          'Export anything you want to keep, or cancel the deletion from Settings → Account.',
        ]),
      };
    case 'account-deleted':
      return {
        subject: 'Your NEXUS account has been deleted',
        ...layout('Account deleted', [
          'Your account, notes and attachments have been permanently deleted, as you requested.',
          'Backups that contained them expire within 30 days.',
        ]),
      };
  }
}
