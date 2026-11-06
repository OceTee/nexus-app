import { Folder } from 'lucide-react-native';
import { EmptyState, Screen } from '../../../../src/ui';

/** S-16 Collections: placeholder until its phase lands. */
export default function CollectionsTab() {
  return (
    <Screen title="Collections">
      <EmptyState icon={Folder} title="Coming soon" body="Group notes into nested collections." />
    </Screen>
  );
}
