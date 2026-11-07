// The Reanimated swipeable needs native worklets; render the row alone in route tests.
// Use with: jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () =>
//   jest.requireActual('../notes-helpers/swipeable'));
import { forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { View } from 'react-native';

const Swipeable = forwardRef<{ close(): void }, { children: ReactNode }>(function Swipeable(
  { children },
  ref,
) {
  useImperativeHandle(ref, () => ({ close: () => undefined }));
  return <View>{children}</View>;
});

export default Swipeable;
