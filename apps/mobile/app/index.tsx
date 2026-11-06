import { Redirect } from 'expo-router';
import { useSessionStore } from '../src/stores/session';

/**
 * "/" exists in every session state: it sends people to Welcome when signed
 * out and to Notes otherwise. Protected groups fall back here when their guard
 * flips (sign in, sign out), and a cold start lands here.
 */
export default function Index() {
  const status = useSessionStore((s) => s.status);
  if (status === 'loading') return null;
  return <Redirect href={status === 'anon' ? '/welcome' : '/notes'} />;
}
