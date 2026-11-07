import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import * as Sharing from 'expo-sharing';
import Export from '../../../app/(app)/settings/export';
import { useSyncStore } from '../../../src/data/sync/store';
import { repos } from '../../../src/data/repos';
import {
  exportScope,
  runExport,
  type ExportProgress,
  type ExportResult,
} from '../../../src/features/export/exporter';
import { freshDb, lastToast, renderScreen, resetStores } from '../screen-helpers/setup';

// The exporter itself is covered by __tests__/features/export; here it is faked
// so the screen's progress and result states can be driven step by step.
jest.mock('../../../src/features/export/exporter', () => ({
  exportScope: jest.fn(),
  runExport: jest.fn(),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

const mockScope = exportScope as jest.Mock;
const mockRun = runExport as jest.Mock;
const mockAvailable = Sharing.isAvailableAsync as jest.Mock;
const mockShare = Sharing.shareAsync as jest.Mock;

const result = (over: Partial<ExportResult> = {}): ExportResult =>
  ({
    file: { uri: 'file:///cache/nexus-export.zip', name: 'nexus-export.zip' },
    notes: 2,
    attachments: 1,
    omitted: [],
    ...over,
  }) as ExportResult;

let work: string;
const show = (url = '/settings/export') => renderScreen({ 'settings/export': Export }, url);

beforeEach(async () => {
  jest.clearAllMocks();
  resetStores();
  await freshDb();
  work = await repos.collections.save({ name: 'Work' });
  await repos.collections.save({ name: 'Projects', parentId: work });
  mockScope.mockImplementation(async (collectionId: string | null) => ({
    notes: collectionId ? [{}] : [{}, {}],
    attachments: [{}],
    needDownload: 1,
  }));
  mockRun.mockResolvedValue(result());
  mockAvailable.mockResolvedValue(true);
  mockShare.mockResolvedValue(undefined);
});

describe('Export', () => {
  it('estimates the export, including attachments to download', async () => {
    await show();
    expect(await screen.findByText('2 notes · 1 attachment (1 need downloading)')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Markdown bundle/ }).props.accessibilityState).toEqual(
      { checked: true },
    );
    expect(screen.queryByRole('switch', { name: 'Include version history' })).toBeNull();
  });

  it('warns that missing attachments are left out offline', async () => {
    useSyncStore.setState({ online: false });
    await show();
    expect(await screen.findByText(/You are offline: attachments not on this device/)).toBeTruthy();
  });

  it('leaves attachments out when switched off', async () => {
    await show();
    await screen.findByText(/2 notes · 1 attachment/);
    await fireEvent(
      screen.getByRole('switch', { name: 'Include attachments' }),
      'valueChange',
      false,
    );
    expect(await screen.findByText('2 notes')).toBeTruthy();
  });

  it('offers version history for JSON', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('radio', { name: /^JSON/ }));
    const versions = await screen.findByRole('switch', { name: 'Include version history' });
    await fireEvent(versions, 'valueChange', true);
    await fireEvent.press(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() =>
      expect(mockRun).toHaveBeenCalledWith(
        { format: 'json', collectionId: null, includeAttachments: true, includeVersions: true },
        expect.any(Function),
      ),
    );
  });

  it('limits the export to one collection and back to everything', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^Notes/ }));
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Work › Projects' }));
    expect(await screen.findByText('Work › Projects')).toBeTruthy();
    expect(await screen.findByText('1 note · 1 attachment (1 need downloading)')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Notes/ }));
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Everything' }));
    expect(await screen.findByText('2 notes · 1 attachment (1 need downloading)')).toBeTruthy();
  });

  it('starts scoped to the collection in the link', async () => {
    await show(`/settings/export?collectionId=${work}`);
    expect(await screen.findByText('Work')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() =>
      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({ collectionId: work }),
        expect.any(Function),
      ),
    );
  });

  it('shows progress, then shares the finished bundle', async () => {
    let report!: (p: ExportProgress) => void;
    let finish!: (r: ExportResult) => void;
    mockRun.mockImplementation(
      (_opts, onProgress: (p: ExportProgress) => void) =>
        new Promise<ExportResult>((resolve) => {
          report = onProgress;
          finish = resolve;
        }),
    );
    await show();
    await screen.findByText(/2 notes/);
    await fireEvent.press(screen.getByTestId('export-start'));
    expect(await screen.findByText('Exporting…')).toBeTruthy();
    expect(screen.getByText('Writing notes 0 of 2')).toBeTruthy();
    expect(screen.getByTestId('export-start').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await act(async () => report({ phase: 'attachments', done: 1, total: 1 }));
    expect(screen.getByText('Adding attachments')).toBeTruthy();
    await act(async () => report({ phase: 'zip', done: 3, total: 4 }));
    expect(screen.getByText('Compressing 3 of 4')).toBeTruthy();
    await act(async () => {
      report({ phase: 'done', done: 1, total: 1 });
      finish(result({ omitted: ['scan.pdf'] }));
    });

    expect(await screen.findByText('Export ready')).toBeTruthy();
    expect(screen.getByText('2 notes and 1 attachment in nexus-export.zip.')).toBeTruthy();
    expect(screen.getByText('Left out (not on this device): scan.pdf')).toBeTruthy();
    expect(mockShare).toHaveBeenCalledWith('file:///cache/nexus-export.zip', {
      mimeType: 'application/zip',
      dialogTitle: 'Export NEXUS',
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Share again' }));
    await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(2));
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByText('Export ready')).toBeNull());
  });

  it('closes the finished sheet from the backdrop', async () => {
    mockRun.mockImplementation(async (_o, onProgress: (p: ExportProgress) => void) => {
      onProgress({ phase: 'done', done: 1, total: 1 });
      return result({ notes: 1, attachments: 0 });
    });
    await show();
    await screen.findByText(/2 notes/);
    await fireEvent.press(screen.getByTestId('export-start'));
    expect(await screen.findByText('1 note and 0 attachments in nexus-export.zip.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText('Export ready')).toBeNull());
  });

  it('says when sharing is not available', async () => {
    mockAvailable.mockResolvedValue(false);
    await show();
    await screen.findByText(/2 notes/);
    await fireEvent.press(screen.getByTestId('export-start'));
    await waitFor(() => expect(lastToast()).toBe('Sharing is not available on this device'));
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('says when the export fails', async () => {
    mockRun.mockRejectedValue(new Error('disk full'));
    await show();
    await screen.findByText(/2 notes/);
    await fireEvent.press(screen.getByTestId('export-start'));
    await waitFor(() =>
      expect(lastToast()).toBe('The export failed. Free some space and try again.'),
    );
    expect(screen.queryByText('Exporting…')).toBeNull();
  });
});
