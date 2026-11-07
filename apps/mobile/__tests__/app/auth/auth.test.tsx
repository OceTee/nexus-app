import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import AuthLayout from '../../../app/(auth)/_layout';
import ForgotPassword from '../../../app/(auth)/forgot-password';
import SignIn from '../../../app/(auth)/sign-in';
import SignUp from '../../../app/(auth)/sign-up';
import Welcome from '../../../app/(auth)/welcome';
import { forgotPassword, register, signIn } from '../../../src/features/auth/authService';
import { ApiError } from '../../../src/infra/apiClient';
import { useSessionStore } from '../../../src/stores/session';
import { resetStores, stub } from '../screen-helpers/setup';

jest.mock('../../../src/features/auth/authService', () => ({
  signIn: jest.fn(),
  register: jest.fn(),
  forgotPassword: jest.fn(),
}));

const mockSignIn = signIn as jest.Mock;
const mockRegister = register as jest.Mock;
const mockForgot = forgotPassword as jest.Mock;

const routes = {
  '(auth)/_layout': AuthLayout,
  '(auth)/welcome': Welcome,
  '(auth)/sign-in': SignIn,
  '(auth)/sign-up': SignUp,
  '(auth)/forgot-password': ForgotPassword,
  reset: stub('Reset'),
  verify: stub('Verify'),
  notes: stub('Notes'),
};
const open = (url: string) => renderRouter(routes, { initialUrl: url });

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
  useSessionStore.setState({ status: 'anon' });
  mockSignIn.mockResolvedValue(undefined);
  mockRegister.mockResolvedValue(undefined);
  mockForgot.mockResolvedValue(undefined);
});

describe('Welcome', () => {
  it.each([
    ['Create account', 'Create account'],
    ['Sign in', 'Sign in'],
  ])('"%s" opens %s', async (button, header) => {
    await open('/welcome');
    await fireEvent.press(await screen.findByRole('button', { name: button }));
    expect(await screen.findByRole('header', { name: header })).toBeTruthy();
  });

  it('goes back to the notes in local mode', async () => {
    useSessionStore.setState({ status: 'local' });
    await open('/welcome');
    expect(screen.queryByRole('button', { name: 'Continue offline' })).toBeNull();
    await fireEvent.press(await screen.findByRole('button', { name: 'Back to my notes' }));
    expect(await screen.findByText('Notes screen')).toBeTruthy();
  });
});

describe('Sign in', () => {
  const fill = async (email: string, password: string) => {
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), email);
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), password);
  };

  it('labels its fields', async () => {
    await open('/sign-in');
    expect(await screen.findByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('shows validation errors and does not call the server', async () => {
    await open('/sign-in');
    await screen.findByLabelText('Email');
    await fill('not-an-email', '');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(await screen.findByText('must be a valid email address')).toBeTruthy();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('validates a field when it loses focus', async () => {
    await open('/sign-in');
    const email = await screen.findByLabelText('Email');
    await fireEvent.changeText(email, 'nope');
    await fireEvent(email, 'blur');
    expect(await screen.findByText('must be a valid email address')).toBeTruthy();
  });

  it('signs in with normalised values', async () => {
    await open('/sign-in');
    await screen.findByLabelText('Email');
    await fill('  Amara@Example.com ', 'secret-pass');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    await waitFor(() =>
      expect(mockSignIn).toHaveBeenCalledWith({
        email: 'amara@example.com',
        password: 'secret-pass',
      }),
    );
  });

  it('submits from the keyboard', async () => {
    await open('/sign-in');
    await screen.findByLabelText('Email');
    await fill('amara@example.com', 'secret-pass');
    await fireEvent(screen.getByTestId('sign-in-password'), 'submitEditing');
    await waitFor(() => expect(mockSignIn).toHaveBeenCalled());
  });

  it('shows a server error', async () => {
    mockSignIn.mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'nope'));
    await open('/sign-in');
    await screen.findByLabelText('Email');
    await fill('amara@example.com', 'wrong');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(await screen.findByText('Email or password is incorrect.')).toBeTruthy();
  });

  it('opens forgot password and sign up', async () => {
    await open('/sign-in');
    await fireEvent.press(await screen.findByRole('button', { name: 'Forgot password?' }));
    expect(await screen.findByRole('header', { name: 'Reset password' })).toBeTruthy();

    await open('/sign-in');
    await fireEvent.press(await screen.findByRole('button', { name: 'Create an account' }));
    expect(await screen.findByRole('header', { name: 'Create account' })).toBeTruthy();
  });
});

describe('Sign up', () => {
  it('registers and moves on to email confirmation', async () => {
    await open('/sign-up');
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'amara@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'correct-horse-battery');
    await fireEvent.changeText(screen.getByLabelText('Confirm password'), 'correct-horse-battery');
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    expect(await screen.findByText('Verify screen')).toBeTruthy();
    expect(mockRegister).toHaveBeenCalledWith({
      email: 'amara@example.com',
      password: 'correct-horse-battery',
    });
  });

  it('sends the display name when given', async () => {
    await open('/sign-up');
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'amara@example.com');
    await fireEvent.changeText(screen.getByLabelText('Name (optional)'), 'Amara');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'correct-horse-battery');
    await fireEvent.changeText(screen.getByLabelText('Confirm password'), 'correct-horse-battery');
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    await waitFor(() =>
      expect(mockRegister).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Amara' })),
    );
  });

  it('goes to sign in for an existing account', async () => {
    await open('/sign-up');
    await fireEvent.press(await screen.findByRole('button', { name: 'I already have an account' }));
    expect(await screen.findByRole('header', { name: 'Sign in' })).toBeTruthy();
  });
});

describe('Forgot password', () => {
  it('rejects an invalid email', async () => {
    await open('/forgot-password');
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'nope');
    await fireEvent.press(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('must be a valid email address')).toBeTruthy();
    expect(mockForgot).not.toHaveBeenCalled();
  });

  it('confirms the link was sent, without revealing whether the account exists', async () => {
    await open('/forgot-password');
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'Amara@Example.com');
    await fireEvent.press(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Check your email')).toBeTruthy();
    expect(screen.getByText(/If amara@example.com has a NEXUS account/)).toBeTruthy();
    expect(mockForgot).toHaveBeenCalledWith('amara@example.com');
    await fireEvent.press(screen.getByRole('button', { name: 'I have the link' }));
    expect(await screen.findByText('Reset screen')).toBeTruthy();
  });

  it('shows a server error', async () => {
    mockForgot.mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'slow down', undefined, 120));
    await open('/forgot-password');
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'amara@example.com');
    await fireEvent.press(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Too many requests. Try again in 2 minute(s).')).toBeTruthy();
  });
});
