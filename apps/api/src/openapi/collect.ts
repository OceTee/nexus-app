// Reads the route table off a built Express app, for the OpenAPI document.
// Express 5 doesn't keep the path a router was mounted at, so mount paths are
// recorded while the app is assembled: call `recordMountPaths()` before
// `createApp()`. Build-time only; the running API never calls this.

import { Router } from 'express';
import type { z } from 'zod';

export interface CollectedRoute {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Express path, e.g. `/v1/notes/:noteId`. */
  path: string;
  schemas: { params?: z.ZodType; query?: z.ZodType; body?: z.ZodType };
  requiresAuth: boolean;
}

type Handle = ((...args: unknown[]) => unknown) & {
  stack?: Layer[];
  schemas?: CollectedRoute['schemas'];
  requiresAuth?: boolean;
};
interface Layer {
  handle: Handle;
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] };
  mountPath?: unknown;
}
interface RouterProto {
  use: (...args: unknown[]) => unknown;
  stack: Layer[];
}

let recording = false;

/** Patches Router#use (once) so each layer remembers the path it was mounted at. */
export function recordMountPaths(): void {
  if (recording) return;
  recording = true;
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(Router())) as RouterProto;
  const use = proto.use;
  proto.use = function (this: RouterProto, ...args: unknown[]) {
    const before = this.stack.length;
    const result = use.apply(this, args);
    const path = typeof args[0] === 'string' || Array.isArray(args[0]) ? args[0] : '/';
    for (const layer of this.stack.slice(before)) layer.mountPath = path;
    return result;
  };
}

const join = (a: string, b: string) => `${a}/${b}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

/** Every route on the app, with the Zod schemas its `validate()` middleware uses. */
export function collectRoutes(app: { router: { stack: Layer[] } }): CollectedRoute[] {
  const out: CollectedRoute[] = [];
  const walk = (stack: Layer[], prefix: string, authed: boolean) => {
    for (const layer of stack) {
      // Middleware such as requireAuth guards the layers after it in the same stack.
      if (!layer.route && layer.handle.requiresAuth) authed = true;
      if (layer.route) {
        const handles = layer.route.stack.map((l) => l.handle);
        const schemas = handles.find((h) => h.schemas)?.schemas ?? {};
        const routeAuthed = authed || handles.some((h) => h.requiresAuth);
        for (const [method, on] of Object.entries(layer.route.methods)) {
          if (!on || method === '_all') continue;
          out.push({
            method: method as CollectedRoute['method'],
            path: join(prefix, layer.route.path),
            schemas,
            requiresAuth: routeAuthed,
          });
        }
      } else if (layer.handle.stack && typeof layer.mountPath === 'string') {
        walk(layer.handle.stack, join(prefix, layer.mountPath), authed);
      }
    }
  };
  walk(app.router.stack, '/', false);
  return out;
}
