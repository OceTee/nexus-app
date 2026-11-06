import { useEffect } from 'react';
import { useSyncStore } from '@/data/sync';
import { uploadPending } from './attachments';

/** Uploads pending attachments whenever a sync finishes, so uploads resume after reconnecting. */
export function useAttachmentUploads(): void {
  useEffect(
    () =>
      useSyncStore.subscribe((s, prev) => {
        if (s.state.kind === 'idle' && prev.state.kind === 'running') void uploadPending();
      }),
    [],
  );
}
