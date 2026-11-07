import { fireEvent, render, screen } from '@testing-library/react-native';
import { repos } from '../../../src/data/repos';
import { WikiAutocomplete } from '../../../src/features/editor/WikiAutocomplete';

let autocomplete: jest.SpyInstance;

beforeEach(() => {
  autocomplete = jest.spyOn(repos.links, 'autocomplete');
});
afterEach(() => jest.restoreAllMocks());

describe('WikiAutocomplete', () => {
  it('shows a hint before anything is typed', async () => {
    autocomplete.mockResolvedValue([]);
    await render(<WikiAutocomplete query="" excludeId="self" onPick={jest.fn()} />);
    expect(screen.getByText('Type a note title to link it')).toBeTruthy();
  });

  it('lists matches (without the current note) and offers to create a new one', async () => {
    autocomplete.mockResolvedValue([
      { id: 'self', title: 'Kalman notes' },
      { id: 'n2', title: 'Kalman filter' },
    ]);
    const onPick = jest.fn();
    await render(<WikiAutocomplete query=" Kal " excludeId="self" onPick={onPick} />);

    expect(await screen.findByLabelText('Link Kalman filter')).toBeTruthy();
    expect(screen.queryByText('Kalman notes')).toBeNull();
    expect(screen.getByText('Create “Kal”')).toBeTruthy();
    expect(autocomplete).toHaveBeenCalledWith(' Kal ');

    await fireEvent.press(screen.getByLabelText('Link Kalman filter'));
    expect(onPick).toHaveBeenCalledWith('Kalman filter');
    await fireEvent.press(screen.getByLabelText('Create link to new note Kal'));
    expect(onPick).toHaveBeenLastCalledWith('Kal');
  });

  it('does not offer Create when a title matches exactly', async () => {
    autocomplete.mockResolvedValue([{ id: 'n2', title: 'Kalman Filter' }]);
    await render(<WikiAutocomplete query="kalman filter" excludeId="self" onPick={jest.fn()} />);
    expect(await screen.findByText('Kalman Filter')).toBeTruthy();
    expect(screen.queryByText(/Create/)).toBeNull();
  });
});
