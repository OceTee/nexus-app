import { useSessionStore } from '@/stores/session';

/** Routes that need the signed-in (or offline) app. */
const APP_ROUTE = /^\/(note|collection|tag|tags|graph|search|settings|attachment)(\/|\?|$)/;

/**
 * Deep links (TDD Section G, Deep linking): `nexus://…` and
 * `https://app.nexus.example/…` map onto routes by path. A link to the app
 * while signed out is kept in `pendingLink` and replayed after sign-in.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    let full = path;
    if (!path.startsWith('/')) {
      const url = new URL(path);
      // nexus://note/abc has host "note"; https links carry the route in the path.
      const route =
        url.protocol === 'nexus:'
          ? `/${url.host}${url.pathname}`.replace(/\/+$/, '')
          : url.pathname;
      full = `${route || '/'}${url.search}`;
    }
    const status = useSessionStore.getState().status;
    if (APP_ROUTE.test(full) && status !== 'authed' && status !== 'local') {
      useSessionStore.getState().setPendingLink(full);
      return '/';
    }
    return full;
  } catch {
    return path;
  }
}
