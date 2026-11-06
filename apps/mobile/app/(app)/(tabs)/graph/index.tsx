import { Share2 } from 'lucide-react-native';
import { EmptyState, Screen } from '../../../../src/ui';

/** S-23 Graph: placeholder until its phase lands. */
export default function GraphTab() {
  return (
    <Screen title="Graph">
      <EmptyState icon={Share2} title="Coming soon" body="See how your notes connect." />
    </Screen>
  );
}
