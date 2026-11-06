import { Search } from 'lucide-react-native';
import { EmptyState, Screen } from '../../../../src/ui';

/** S-25 Search: placeholder until its phase lands. */
export default function SearchTab() {
  return (
    <Screen title="Search">
      <EmptyState
        icon={Search}
        title="Coming soon"
        body="Find any note by its words, even offline."
      />
    </Screen>
  );
}
