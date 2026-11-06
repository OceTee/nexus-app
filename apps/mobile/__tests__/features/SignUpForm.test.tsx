import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SignUpForm } from '../../src/features/auth/SignUpForm';

describe('T-43 sign-up validation', () => {
  it('shows "Passwords differ" under the confirm field on blur and disables submit', async () => {
    const onSubmit = jest.fn();
    await render(<SignUpForm onSubmit={onSubmit} />);

    await fireEvent.changeText(screen.getByLabelText('Email'), 'amara@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'correct-horse-battery');
    const confirm = screen.getByLabelText('Confirm password');
    await fireEvent.changeText(confirm, 'correct-horse-batteryX');
    await fireEvent(confirm, 'blur');

    expect(await screen.findByText('Passwords differ')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('sign-up-submit').props.accessibilityState).toMatchObject({
        disabled: true,
      }),
    );
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits normalised values when the form is valid', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    await render(<SignUpForm onSubmit={onSubmit} />);
    await fireEvent.changeText(screen.getByLabelText('Email'), '  Amara@Example.com ');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'correct-horse-battery');
    await fireEvent.changeText(screen.getByLabelText('Confirm password'), 'correct-horse-battery');
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      email: 'amara@example.com',
      password: 'correct-horse-battery',
    });
  });

  it('maps a duplicate-email response to a form message', async () => {
    const { ApiError } = jest.requireActual('../../src/infra/apiClient');
    const onSubmit = jest.fn().mockRejectedValue(new ApiError(409, 'DUPLICATE', 'account exists'));
    await render(<SignUpForm onSubmit={onSubmit} />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'amara@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'correct-horse-battery');
    await fireEvent.changeText(screen.getByLabelText('Confirm password'), 'correct-horse-battery');
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
    expect(
      await screen.findByText('An account with this email already exists. Sign in instead.'),
    ).toBeTruthy();
  });
});
