import { v7 as uuidv7 } from 'uuid';

/** Time-ordered UUIDv7, used for request ids and entity ids. */
export const newId = (): string => uuidv7();
