// Gesture Handler attaches gestures natively. This stand-in records each
// gesture's callbacks so tests can call them, and renders the detector's child.
// Use with: jest.mock('react-native-gesture-handler', () =>
//   jest.requireActual('../notes-helpers/gestureHandler'));
import type { ReactNode } from 'react';

type Handler = (event?: object) => void;
export interface FakeGesture {
  handlers: Record<string, Handler>;
  gestures?: FakeGesture[];
}

function builder() {
  const g = {
    handlers: {} as Record<string, Handler>,
    onUpdate(f: Handler) {
      g.handlers.onUpdate = f;
      return g;
    },
    onEnd(f: Handler) {
      g.handlers.onEnd = f;
      return g;
    },
    averageTouches() {
      return g;
    },
    numberOfTaps() {
      return g;
    },
  };
  return g;
}

export const Gesture = {
  Pinch: builder,
  Pan: builder,
  Tap: builder,
  Simultaneous: (...gestures: FakeGesture[]): FakeGesture => ({ handlers: {}, gestures }),
};

const seen: FakeGesture[] = [];
const record = (g: FakeGesture) => seen.push(g);

/** The gesture most recently given to a GestureDetector. */
export const lastGesture = (): FakeGesture | undefined => seen.at(-1);

export function GestureDetector({
  gesture,
  children,
}: {
  gesture: FakeGesture;
  children: ReactNode;
}) {
  record(gesture);
  return <>{children}</>;
}
