// The Reanimated swipeable needs native worklets; render both action panels inline.
import { forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { View } from 'react-native';

interface Props {
  children: ReactNode;
  renderLeftActions?: () => ReactNode;
  renderRightActions?: () => ReactNode;
}

const Swipeable = forwardRef<{ close(): void }, Props>(function Swipeable(p, ref) {
  useImperativeHandle(ref, () => ({ close: () => undefined }));
  return (
    <View>
      {p.renderLeftActions?.()}
      {p.children}
      {p.renderRightActions?.()}
    </View>
  );
});

export default Swipeable;
