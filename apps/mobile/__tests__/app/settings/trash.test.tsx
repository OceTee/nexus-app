import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import Trash from '../../../app/(app)/settings/trash';
import { repos } from '../../../src/data/repos';
import { freshDb, lastToast, renderScreen, resetStores, stub } from '../screen-helpers/setup';

const routes = { 'settings/trash': Trash, notes: stub('Notes') };
const show = () => renderScreen(routes, '/settings/trash');

const trashed = async (title: string) => {
  const n = await repos.notes.save({ title, bodyMd: '' });
  await repos.notes.trashNote(n.id);
  return n.id;
};

beforeEach(async () => {
  resetStores();
  await freshDb();
});

describe('Trash', () => {
  it('says when the trash is empty', async () => {
    await repos.notes.save({ title: 'Alive', bodyMd: '' });
    await show();
    expect(await screen.findByText('Trash is empty')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Empty trash' })).toBeNull();
  });

  it('lists deleted notes with the days left', async () => {
    await trashed('Old draft');
    await show();
    expect(
      await screen.findByRole('button', { name: /^Old draft, Deleted just now · 30 days left/ }),
    ).toBeTruthy();
  });

  it('restores a note from its row button', async () => {
    const id = await trashed('Old draft');
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Restore Old draft' }));
    expect(await screen.findByText('Trash is empty')).toBeTruthy();
    expect(lastToast()).toBe('Restored “Old draft”');
    expect((await repos.notes.get(id))?.deletedAt).toBeNull();
  });

  it('restores an untitled note from the action sheet', async () => {
    await trashed('');
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^Untitled, Deleted/ }));
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Restore' }));
    expect(await screen.findByText('Trash is empty')).toBeTruthy();
    expect(lastToast()).toBe('Restored “Untitled”');
  });

  // Regression (fixed): choosing "Delete permanently" in the action sheet closes the sheet
  // first (ActionSheet calls onClose, which is setTarget(null)) and only then
  // opens the confirmation, so the confirm handler finds no target, purges
  // nothing and toasts "0 notes deleted". The note stays in the trash.
  it('deletes one note permanently after confirming', async () => {
    const id = await trashed('Old draft');
    await trashed('Keep me');
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^Old draft, Deleted/ }));
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Delete permanently' }));
    expect(await screen.findByText('Delete this note permanently?')).toBeTruthy();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(lastToast()).toBe('Note deleted'));
    expect(await repos.notes.get(id)).toBeNull();
    expect(await screen.findByText('Keep me')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Old draft')).toBeNull());
  });

  it('cancels a permanent delete', async () => {
    const id = await trashed('Old draft');
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^Old draft, Deleted/ }));
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Delete permanently' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await repos.notes.get(id)).not.toBeNull();
  });

  it('empties the whole trash', async () => {
    await trashed('One');
    await trashed('Two');
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Empty trash' }));
    expect(await screen.findByText('Empty the trash?')).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Empty trash' }).at(-1) as never);
    await waitFor(() => expect(lastToast()).toBe('2 notes deleted'));
    expect(await screen.findByText('Trash is empty')).toBeTruthy();
  });

  it('goes back to Notes from the header', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Notes screen')).toBeTruthy();
  });
});
