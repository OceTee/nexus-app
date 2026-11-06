import { router } from 'expo-router';
import { SearchX } from 'lucide-react-native';
import { EmptyState, Screen } from '../src/ui';

export default function NotFound() {
  return (
    <Screen>
      <EmptyState
        icon={SearchX}
        title="Nothing here"
        body="This link does not point to anything in NEXUS."
        action={{ label: 'Go to notes', onPress: () => router.replace('/notes') }}
      />
    </Screen>
  );
}
