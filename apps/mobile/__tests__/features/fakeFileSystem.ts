// In-memory stand-in for the parts of expo-file-system the features use.
// Use with: jest.mock('expo-file-system', () => jest.requireActual('../fakeFileSystem'));

type Part = string | { uri: string };

export const store = {
  files: new Map<string, Uint8Array>(),
  dirs: new Set<string>(),
  downloads: [] as string[],
  uploads: [] as { uri: string; url: string; options: unknown }[],
  uploadStatus: 200,
  reset() {
    this.files.clear();
    this.dirs.clear();
    this.downloads = [];
    this.uploads = [];
    this.uploadStatus = 200;
  },
};

const join = (parts: Part[]) => parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');

export class Directory {
  readonly uri: string;
  constructor(...parts: Part[]) {
    this.uri = join(parts);
  }
  get exists() {
    return store.dirs.has(this.uri);
  }
  create() {
    store.dirs.add(this.uri);
  }
}

export class File {
  readonly uri: string;
  constructor(...parts: Part[]) {
    this.uri = join(parts);
  }
  get exists() {
    return store.files.has(this.uri);
  }
  get size() {
    return store.files.get(this.uri)?.length ?? null;
  }
  create() {
    store.files.set(this.uri, new Uint8Array());
  }
  write(data: Uint8Array | string) {
    store.files.set(this.uri, typeof data === 'string' ? new TextEncoder().encode(data) : data);
  }
  delete() {
    if (!store.files.delete(this.uri)) throw new Error(`No file at ${this.uri}`);
  }
  async bytes() {
    const b = store.files.get(this.uri);
    if (!b) throw new Error(`No file at ${this.uri}`);
    return b;
  }
  copy(target: File) {
    store.files.set(target.uri, store.files.get(this.uri)!);
  }
  move(target: File) {
    this.copy(target);
    store.files.delete(this.uri);
  }
  async digest() {
    return `SHA-OF-${this.uri.split('/').pop()}`;
  }
  async upload(url: string, options: unknown) {
    store.uploads.push({ uri: this.uri, url, options });
    return { status: store.uploadStatus, body: '' };
  }
  static async downloadFileAsync(url: string, target: File) {
    store.downloads.push(url);
    store.files.set(target.uri, new TextEncoder().encode(`downloaded:${url}`));
    return target;
  }
}

export const Paths = {
  cache: new Directory('file:///cache'),
  document: new Directory('file:///document'),
};

export const UploadType = { BINARY_CONTENT: 0, MULTIPART: 1 };
