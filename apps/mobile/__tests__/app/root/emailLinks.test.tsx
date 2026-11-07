import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import ResetPassword from '../../../app/reset';
import VerifyEmail from '../../../app/verify';
import {
  resendVerification,
  resetPassword,
  verifyEmail,
} from '../../../src/features/auth/authService';
import { ApiError } from '../../../src/infra/apiClient';
import { useSessionStore } from '../../../src/stores/session';
import { lastToast, resetStores, signInAs, stub } from '../screen-helpers/setup';

jest.mock('../../../src/features/auth/authService', () => ({
  ...jest.requireActual('../../../src/features/auth/authService'),
  verifyEmail: jest.fn(),
  resendVerification: jest.fn(),
  resetPassword: jest.fn(),
}));

const mockVerify = verifyEmail as jest.Mock;
const mockResend = resendVerification as jest.Mock;
const mockReset = resetPassword as jest.Mock;

const TOKEN = 'abcdefghijklmnop1234';
const routes = {
  verify: VerifyEmail,
  reset: ResetPassword,
  notes: stub('Notes'),
  'sign-in': stub('Sign in'),
};
const open = (url: string) => renderRouter(routes, { initialUrl: url });
const invalid = () => new ApiError(400, 'TOKEN_INVALID', 'bad token');

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
  useSessionStore.setState({ status: 'anon' });
  mockVerify.mockResolvedValue(undefined);
  mockResend.mockResolvedValue(undefined);
  mockReset.mockResolvedValue(undefined);
});

describe('Verify email', () => {
  it('confirms straight from the emailed link', async () => {
    await open(`/verify?token=${TOKEN}`);
    expect(await screen.findByText('Email confirmed')).toBeTruthy();
    expect(mockVerify).toHaveBeenCalledWith(TOKEN);
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Sign in screen')).toBeTruthy();
  });

  it('shows why a link failed and lets people paste another', async () => {
    mockVerify.mockRejectedValueOnce(invalid());
    await open(`/verify?token=${TOKEN}`);
    expect(await screen.findByText('This link is not valid or was already used.')).toBeTruthy();
    expect(screen.getByText(/Open the link we emailed you/)).toBeTruthy();
  });

  it('accepts a pasted link', async () => {
    useSessionStore.setState({ status: 'local' });
    await open('/verify');
    const confirm = await screen.findByRole('button', { name: 'Confirm email' });
    expect(confirm.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(
      screen.getByLabelText('Link or code from the email'),
      ` https://app.nexus.example/verify?token=${TOKEN} `,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm email' }));
    expect(await screen.findByText('Email confirmed')).toBeTruthy();
    expect(mockVerify).toHaveBeenCalledWith(TOKEN);
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Notes screen')).toBeTruthy();
  });

  it('shows an error for a bad pasted code', async () => {
    mockVerify.mockRejectedValue(new ApiError(400, 'TOKEN_EXPIRED', 'expired'));
    await open('/verify');
    await fireEvent.changeText(await screen.findByLabelText('Link or code from the email'), TOKEN);
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm email' }));
    expect(await screen.findByText('This link has expired. Request a new one.')).toBeTruthy();
  });

  it('can be left for later', async () => {
    await open('/verify');
    await fireEvent.press(await screen.findByRole('button', { name: 'Later' }));
    expect(await screen.findByText('Sign in screen')).toBeTruthy();
  });

  describe('signed in, unconfirmed', () => {
    beforeEach(() => signInAs({ emailVerified: false }));

    it('names the address and sends a new link', async () => {
      await open('/verify');
      expect(
        await screen.findByText(/We sent a link to amara@example.com\. Tap it on this phone/),
      ).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Send a new link' }));
      await waitFor(() => expect(lastToast()).toBe('A new link is on its way'));
    });

    it('says when a new link cannot be sent', async () => {
      mockResend.mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'slow down', undefined, 300));
      await open('/verify');
      await fireEvent.press(await screen.findByRole('button', { name: 'Send a new link' }));
      await waitFor(() => expect(lastToast()).toBe('Too many requests. Try again in 5 minute(s).'));
    });

    it('goes to the notes afterwards', async () => {
      await open('/verify');
      await fireEvent.press(await screen.findByRole('button', { name: 'Later' }));
      expect(await screen.findByText('Notes screen')).toBeTruthy();
    });
  });
});

describe('Reset password', () => {
  const fill = async (password: string, confirm: string) => {
    await fireEvent.changeText(await screen.findByLabelText('New password'), password);
    await fireEvent.changeText(screen.getByLabelText('Confirm new password'), confirm);
  };
  const submit = () => fireEvent.press(screen.getByRole('button', { name: 'Change password' }));

  it('uses the token from the link and changes the password', async () => {
    await open(`/reset?token=${TOKEN}`);
    expect(screen.queryByLabelText('Link from the email')).toBeNull();
    await fill('correct-horse-battery', 'correct-horse-battery');
    await submit();
    expect(await screen.findByText('Password changed')).toBeTruthy();
    expect(mockReset).toHaveBeenCalledWith(TOKEN, 'correct-horse-battery');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Sign in screen')).toBeTruthy();
  });

  it('returns to the notes when still signed in', async () => {
    signInAs();
    await open(`/reset?token=${TOKEN}`);
    await fill('correct-horse-battery', 'correct-horse-battery');
    await submit();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Notes screen')).toBeTruthy();
  });

  it('asks for the link when opened without one', async () => {
    await open('/reset');
    await fill('correct-horse-battery', 'correct-horse-battery');
    await submit();
    expect(await screen.findByText('Paste the link from the email')).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('Link from the email'),
      `https://app.nexus.example/reset?token=${TOKEN}`,
    );
    await submit();
    await waitFor(() => expect(mockReset).toHaveBeenCalledWith(TOKEN, 'correct-horse-battery'));
  });

  it('checks the passwords match', async () => {
    await open(`/reset?token=${TOKEN}`);
    await fill('correct-horse-battery', 'correct-horse-batterz');
    await submit();
    expect(await screen.findByText('Passwords differ')).toBeTruthy();
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('shows a server password rule under the field', async () => {
    mockReset.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'invalid', [
        { path: ['password'], message: 'too guessable' },
      ]),
    );
    await open(`/reset?token=${TOKEN}`);
    await fill('password1234', 'password1234');
    await submit();
    expect(await screen.findByText('too guessable')).toBeTruthy();
  });

  it('shows other server errors under the form', async () => {
    mockReset.mockRejectedValue(invalid());
    await open(`/reset?token=${TOKEN}`);
    await fill('correct-horse-battery', 'correct-horse-battery');
    await submit();
    expect(await screen.findByText('This link is not valid or was already used.')).toBeTruthy();
  });
});
