// Public surface of @nexus/shared: request/response schemas, Markdown helpers,
// set-merge rules, cursors and limits, used by both the API and the mobile app.

/** Version of the HTTP API contract described by these schemas. */
export const API_VERSION = '1' as const;

export * from './schemas';
export * from './markdown';
export * from './merge/setMerge';
export * from './cursor';
export * from './limits';
