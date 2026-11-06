import { LIMITS } from '@nexus/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CollectionPlacementError, repos } from '@/data/repos';
import { Button, Header, Screen, TextField, toast } from '@/ui';

/** S-18 Collection editor (modal): create, optionally inside a parent, or rename. */
export default function CollectionEditor() {
  const { id, parentId } = useLocalSearchParams<{ id?: string; parentId?: string }>();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    void repos.collections.get(id).then((c) => c && setName(c.name));
  }, [id]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a name');
    if (trimmed.length > LIMITS.collectionNameMax) {
      return setError(`Use ${LIMITS.collectionNameMax} characters or fewer`);
    }
    setBusy(true);
    try {
      await repos.collections.save({
        ...(id ? { id } : {}),
        name: trimmed,
        ...(id ? {} : { parentId: parentId ?? null }),
      });
      toast.show(id ? 'Collection renamed' : `Created “${trimmed}”`);
      router.back();
    } catch (e) {
      setError(e instanceof CollectionPlacementError ? e.message : 'Could not save the collection');
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title={id ? 'Rename collection' : 'New collection'} backLabel="Cancel" />
      <View style={styles.pad}>
        <TextField
          label="Name"
          testID="collection-name"
          value={name}
          onChangeText={(v) => {
            setName(v);
            setError(null);
          }}
          autoFocus
          maxLength={LIMITS.collectionNameMax}
          returnKeyType="done"
          onSubmitEditing={() => void save()}
          error={error ?? undefined}
        />
        <Button label={id ? 'Save' : 'Create'} onPress={() => void save()} loading={busy} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ pad: { padding: 16 } });
