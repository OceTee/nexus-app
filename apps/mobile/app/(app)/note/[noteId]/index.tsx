import { LIMITS, normaliseTitle } from '@nexus/shared';
import { router, useLocalSearchParams } from 'expo-router';
import {
  FileX2,
  FolderInput,
  History,
  Info,
  MoreVertical,
  Pin,
  PinOff,
  Tags,
  Trash2,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAvoidingView, useKeyboardState } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { purgeNotes, repos, type Note } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import { AttachmentStrip } from '@/features/attachments/AttachmentStrip';
import { EditorToolbar, type ToolbarAction } from '@/features/editor/EditorToolbar';
import { MarkdownPreview } from '@/features/editor/MarkdownPreview';
import {
  activeWikiQuery,
  code,
  completeWiki,
  insert,
  togglePrefix,
  wrap,
  type Edit,
} from '@/features/editor/textOps';
import { noteStamp, useAutosave } from '@/features/editor/useAutosave';
import { events } from '@/data/events';
import { useHistory } from '@/features/editor/useHistory';
import { WikiAutocomplete } from '@/features/editor/WikiAutocomplete';
import { getDb } from '@/infra/db';
import { useSettingsStore } from '@/stores/settings';
import { useSessionStore } from '@/stores/session';
import { runSync } from '@/data/sync';
import {
  ActionSheet,
  alpha,
  Chip,
  ConfirmSheet,
  EmptyState,
  Header,
  IconButton,
  Screen,
  SegmentedControl,
  Text,
  toast,
  useTheme,
} from '@/ui';

type Mode = 'edit' | 'preview' | 'read';
type LoadState = { kind: 'loading' } | { kind: 'missing'; trashed: boolean } | { kind: 'ready' };

const MODES = [
  { value: 'edit', label: 'Edit' },
  { value: 'preview', label: 'Preview' },
  { value: 'read', label: 'Read' },
] as const;

/** Wiki-link navigation pushes editors up to this depth, then replaces (S-09). */
const MAX_STACK_DEPTH = 8;
const TITLE_COUNTER_FROM = 180;

const EMPTY: Edit = { text: '', selection: { start: 0, end: 0 } };

/** S-09 Note editor: write, preview and read Markdown. */
export default function NoteEditor() {
  const t = useTheme();
  const params = useLocalSearchParams<{ noteId: string; depth?: string; fresh?: string }>();
  const noteId = params.noteId;
  const depth = Number(params.depth ?? 0);

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<Mode>('edit');
  const [forcedSelection, setForcedSelection] = useState<Edit['selection'] | undefined>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [ghost, setGhost] = useState<string | null>(null);
  const history = useHistory(EMPTY);
  const autosave = useAutosave(noteId);
  const body = history.present.text;
  const fontSize = useSettingsStore((s) => s.editorFontSize);
  const keyboardOpen = useKeyboardState((k) => k.isVisible);
  const insets = useSafeAreaInsets();
  const serif = useSettingsStore((s) => s.serifReading);

  // Load once per note; our own saves must not reset the text being typed.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      let n = await repos.notes.get(noteId);
      // A deep link to a note this device has not seen yet: sync once, then retry.
      if (!n && useSessionStore.getState().status === 'authed') {
        await runSync('manual');
        n = await repos.notes.get(noteId);
      }
      return n;
    };
    void load().then((n) => {
      if (!alive) return;
      if (!n || n.deletedAt) {
        setLoad({ kind: 'missing', trashed: Boolean(n?.deletedAt) });
        return;
      }
      setNote(n);
      autosave.markLoaded(noteStamp(n));
      setTitle(n.title);
      history.reset({
        text: n.bodyMd,
        selection: { start: n.bodyMd.length, end: n.bodyMd.length },
      });
      setMode(params.fresh || !n.bodyMd ? 'edit' : 'read');
      setLoad({ kind: 'ready' });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per note
  }, [noteId]);

  // Another device's edit arrived by sync (or a version was restored): show it
  // unless this editor has unsaved typing, which then wins and syncs on top.
  useEffect(
    () =>
      events.on(['notes'], () => {
        void repos.notes.get(noteId).then((n) => {
          if (!n || n.deletedAt || autosave.isBusy()) return;
          if (noteStamp(n) === autosave.knownStamp()) return;
          autosave.markLoaded(noteStamp(n));
          setNote(n);
          setTitle(n.title);
          history.reset({
            text: n.bodyMd,
            selection: { start: n.bodyMd.length, end: n.bodyMd.length },
          });
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- history.reset and autosave helpers are stable
    [noteId],
  );

  // Live facts shown around the editor.
  const { data: live } = useLocalQuery(
    ['notes', 'note_links', 'note_tags', 'tags', 'conflicts'],
    async () => {
      const db = getDb();
      const [current, tags, backlinks, resolved, conflicts] = await Promise.all([
        repos.notes.get(noteId),
        repos.tags.forNote(noteId),
        db.getFirstAsync<{ n: number }>(
          `SELECT count(*) AS n FROM note_links l JOIN notes s ON s.id = l.source_note_id
           WHERE l.target_note_id = ? AND s.deleted_at IS NULL`,
          [noteId],
        ),
        db.getAllAsync<{ t: string }>(
          `SELECT target_title_norm AS t FROM note_links
           WHERE source_note_id = ? AND target_note_id IS NOT NULL`,
          [noteId],
        ),
        repos.conflicts.open(noteId),
      ]);
      return {
        current,
        conflicts: conflicts.length,
        tags,
        backlinks: Number(backlinks?.n ?? 0),
        resolved: new Set(resolved.map((r) => r.t)),
      };
    },
    [noteId],
  );

  const { data: duplicate } = useLocalQuery(
    ['notes'],
    async () => (title.trim() ? Boolean(await repos.notes.findByTitle(title, noteId)) : false),
    [title, noteId],
  );

  const save = useCallback(
    (nextTitle: string, nextBody: string) =>
      autosave.schedule({ title: nextTitle, bodyMd: nextBody }),
    [autosave],
  );

  /** Leaves the editor: saves now, and drops a brand-new note that stayed empty. */
  const leave = useCallback(async () => {
    await autosave.flush();
    if (params.fresh && !title.trim() && !body.trim()) {
      await repos.notes.trashNote(noteId);
      await purgeNotes(getDb(), [noteId]);
    }
  }, [autosave, params.fresh, title, body, noteId]);

  // Leaving by any route (back gesture, tab switch, replace) saves on unmount.
  const leaveRef = useRef(leave);
  useEffect(() => {
    leaveRef.current = leave;
  });
  useEffect(() => () => void leaveRef.current(), []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') void autosave.flush();
    });
    return () => sub.remove();
  }, [autosave]);

  const apply = (next: Edit, discrete = true) => {
    if (next.text.length > LIMITS.noteBodyMax) {
      toast.show('Notes can hold up to 200,000 characters');
      return;
    }
    history.record(next, discrete);
    setForcedSelection(next.selection);
    save(title, next.text);
  };

  const onToolbar = (a: ToolbarAction) => {
    const cur = history.present;
    switch (a) {
      case 'bold':
        return apply(wrap(cur.text, cur.selection, '**'));
      case 'italic':
        return apply(wrap(cur.text, cur.selection, '_'));
      case 'heading':
        return apply(togglePrefix(cur.text, cur.selection, '## '));
      case 'list':
        return apply(togglePrefix(cur.text, cur.selection, '- '));
      case 'task':
        return apply(togglePrefix(cur.text, cur.selection, '- [ ] '));
      case 'code':
        return apply(code(cur.text, cur.selection));
      case 'link':
        return apply(insert(cur.text, cur.selection, '[[]]', 2));
      case 'attach':
        // The picker appends the link to the saved note; the editor reloads it.
        void autosave
          .flush()
          .then(() => router.push({ pathname: '/attachment/pick', params: { noteId } }));
        return;
      case 'undo':
      case 'redo': {
        const restored = a === 'undo' ? history.undo() : history.redo();
        if (restored) {
          setForcedSelection(restored.selection);
          save(title, restored.text);
        }
      }
    }
  };

  const wiki =
    mode === 'edit' && history.present.selection.start === history.present.selection.end
      ? activeWikiQuery(body, history.present.selection.start)
      : null;

  /** Opens a linked note by title, or offers to create it (ghost link). */
  const openLink = async (target: string) => {
    await autosave.flush();
    const found = await repos.notes.findByTitle(target);
    if (!found) {
      setGhost(target);
      return;
    }
    if (found.id === noteId) return;
    const next = {
      pathname: '/note/[noteId]',
      params: { noteId: found.id, depth: String(depth + 1) },
    } as const;
    if (depth + 1 >= MAX_STACK_DEPTH) router.replace(next);
    else router.push(next);
  };

  const createFromGhost = async (target: string) => {
    const created = await repos.notes.save({ title: target, bodyMd: '' });
    router.push({
      pathname: '/note/[noteId]',
      params: { noteId: created.id, depth: String(depth + 1), fresh: '1' },
    });
  };

  const resolved = useMemo(() => live?.resolved ?? new Set<string>(), [live?.resolved]);
  const current = live?.current ?? note;

  if (load.kind === 'loading') return <Screen>{null}</Screen>;
  if (load.kind === 'missing') {
    return (
      <Screen>
        <Header />
        <EmptyState
          icon={FileX2}
          title="This note was deleted"
          {...(load.trashed
            ? {
                action: {
                  label: 'Restore from trash',
                  onPress: () =>
                    void repos.notes
                      .restore(noteId)
                      .then(() =>
                        router.replace({ pathname: '/note/[noteId]', params: { noteId } }),
                      ),
                },
              }
            : { body: 'It may have been deleted on another device.' })}
        />
      </Screen>
    );
  }

  const failed = autosave.state === 'failed';
  const footer =
    (live?.backlinks ?? 0) > 0 ? (
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/note/[noteId]/backlinks', params: { noteId } })}
        style={[
          styles.backlinks,
          // The preview already pads its content; the editor does not.
          mode === 'edit' && styles.backlinksInset,
          { borderColor: t.colors.line },
        ]}
      >
        <Text variant="callout" style={{ color: t.colors.primary }}>
          {live?.backlinks === 1 ? '1 note links here' : `${live?.backlinks} notes link here`} ›
        </Text>
      </Pressable>
    ) : null;

  return (
    // The bottom inset applies only while the keyboard is closed; counting it
    // under the keyboard too pushed the toolbar behind the keyboard.
    <Screen edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior="padding"
        // Edge-to-edge: the view is measured from below the status bar, which
        // otherwise leaves the toolbar under the keyboard by that much.
        keyboardVerticalOffset={insets.top}
        style={styles.flex}
      >
        <Header
          onBack={() => {
            void leave().then(() =>
              router.canGoBack() ? router.back() : router.replace('/notes'),
            );
          }}
          right={
            <>
              <Text
                variant="footnote"
                tone={failed ? 'danger' : 'inkFaint'}
                style={styles.saveState}
              >
                {autosave.state === 'saved' ? '' : failed ? 'Not saved' : 'Saving…'}
              </Text>
              <IconButton
                icon={MoreVertical}
                label="More actions"
                onPress={() => setMenuOpen(true)}
              />
            </>
          }
        >
          <TextInput
            accessibilityLabel="Title"
            value={title}
            editable={!failed}
            onChangeText={(v) => {
              setTitle(v);
              save(v, body);
            }}
            placeholder="Untitled"
            placeholderTextColor={t.colors.inkFaint}
            maxLength={LIMITS.noteTitleMax}
            returnKeyType="next"
            style={[t.type('headline'), styles.title, { color: t.colors.ink }]}
          />
        </Header>

        {live && live.conflicts > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens the conflict screen"
            onPress={() =>
              void autosave
                .flush()
                .then(() =>
                  router.push({ pathname: '/note/[noteId]/conflict', params: { noteId } }),
                )
            }
            style={[styles.banner, { backgroundColor: alpha(t.colors.accent, 0.18) }]}
          >
            <Text variant="callout" style={styles.flex}>
              This note was also edited on another device. Your copy is kept.
            </Text>
            <Text variant="headline" style={{ color: t.colors.primary }}>
              Resolve
            </Text>
          </Pressable>
        ) : null}

        {failed ? (
          <View style={[styles.banner, { backgroundColor: t.colors.danger }]}>
            <Text variant="callout" style={{ color: '#FFFFFF' }}>
              Your changes could not be saved. Free some space on this device, then try again.
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void autosave.flush()}>
              <Text variant="headline" style={{ color: '#FFFFFF' }}>
                Retry
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.sub}>
          {title.length >= TITLE_COUNTER_FROM ? (
            <Text
              variant="footnote"
              tone={title.length >= LIMITS.noteTitleMax ? 'danger' : 'inkFaint'}
            >
              {title.length}/{LIMITS.noteTitleMax}
            </Text>
          ) : null}
          {duplicate ? (
            <Text variant="footnote" tone="inkSoft">
              Another note has this title, so [[links]] go to the older one.
            </Text>
          ) : null}
          {live && live.tags.length > 0 ? (
            <View style={styles.chips}>
              {live.tags.map((tag) => (
                <Chip
                  key={tag.id}
                  label={tag.name}
                  colour={tag.colour}
                  onPress={() =>
                    router.push({ pathname: '/tag/[tagId]', params: { tagId: tag.id } })
                  }
                />
              ))}
            </View>
          ) : null}
          <AttachmentStrip noteId={noteId} />
          <SegmentedControl label="Mode" options={MODES} value={mode} onChange={setMode} />
        </View>

        {mode === 'edit' ? (
          <>
            <TextInput
              accessibilityLabel="Note body"
              multiline
              value={body}
              editable={!failed}
              {...(forcedSelection ? { selection: forcedSelection } : {})}
              onChangeText={(text) => {
                const grew = text.length - body.length;
                const at = Math.max(0, history.present.selection.start + grew);
                apply({ text, selection: { start: at, end: at } }, false);
                setForcedSelection(undefined);
              }}
              onSelectionChange={(e) => {
                setForcedSelection(undefined);
                history.select(e.nativeEvent.selection);
              }}
              placeholder="Start writing. Type [[ to link a note."
              placeholderTextColor={t.colors.inkFaint}
              textAlignVertical="top"
              autoFocus={Boolean(params.fresh)}
              selectionColor={alpha(t.colors.primary, 0.3)}
              cursorColor={t.colors.primary}
              style={[
                t.type('body'),
                styles.body,
                { color: t.colors.ink, fontSize, lineHeight: Math.round(fontSize * 1.45) },
              ]}
            />
            {footer}
            {wiki ? (
              <WikiAutocomplete
                query={wiki.query}
                excludeId={noteId}
                onPick={(picked) =>
                  apply(completeWiki(body, wiki.start, history.present.selection.start, picked))
                }
              />
            ) : null}
            <EditorToolbar
              onAction={onToolbar}
              canUndo={history.canUndo}
              canRedo={history.canRedo}
            />
          </>
        ) : (
          <MarkdownPreview
            body={body}
            reading={mode === 'read' && serif}
            onWikiLink={(target) => void openLink(target)}
            resolved={resolved}
            normalise={normaliseTitle}
            footer={footer}
          />
        )}
        <View style={{ height: keyboardOpen ? 0 : insets.bottom }} />
      </KeyboardAvoidingView>

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        actions={[
          {
            label: current?.isPinned ? 'Unpin' : 'Pin',
            icon: current?.isPinned ? PinOff : Pin,
            onPress: () =>
              void autosave.flush().then(() => repos.notes.setPinned(noteId, !current?.isPinned)),
          },
          {
            label: 'Move to collection',
            icon: FolderInput,
            onPress: () =>
              void autosave
                .flush()
                .then(() => router.push({ pathname: '/collection/picker', params: { noteId } })),
          },
          {
            label: 'Tags',
            icon: Tags,
            onPress: () => router.push({ pathname: '/note/[noteId]/tags', params: { noteId } }),
          },
          {
            label: 'Info',
            icon: Info,
            onPress: () =>
              void autosave
                .flush()
                .then(() => router.push({ pathname: '/note/[noteId]/info', params: { noteId } })),
          },
          {
            label: 'History',
            icon: History,
            onPress: () =>
              void autosave
                .flush()
                .then(() =>
                  router.push({ pathname: '/note/[noteId]/versions', params: { noteId } }),
                ),
          },
          {
            label: 'Delete',
            icon: Trash2,
            destructive: true,
            onPress: () =>
              void autosave.flush().then(async () => {
                await repos.notes.trashNote(noteId);
                toast.show(`“${title || 'Untitled'}” moved to Trash`);
                router.back();
              }),
          },
        ]}
      />

      <ConfirmSheet
        visible={ghost !== null}
        onClose={() => setGhost(null)}
        title={`Create “${ghost ?? ''}”?`}
        body="No note has this title yet. Creating it turns the link into a real one."
        confirmLabel="Create note"
        onConfirm={() => ghost && void createFromGhost(ghost)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { paddingVertical: 8 },
  saveState: { marginRight: 4 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sub: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  backlinksInset: { marginHorizontal: 16 },
  backlinks: {
    marginVertical: 8,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
