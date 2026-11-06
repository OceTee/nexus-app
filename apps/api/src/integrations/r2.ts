// Object storage (TDD Sections D and F, File storage). Cloudflare R2 in
// staging and production, MinIO locally; both speak the S3 API. The API never
// handles attachment bytes: devices upload and download with presigned URLs.

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const PUT_URL_TTL_SECONDS = 15 * 60;
export const GET_URL_TTL_SECONDS = 60 * 60;

export interface StorageConfig {
  /** R2: https://<account>.r2.cloudflarestorage.com; MinIO: http://localhost:9000. */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

export interface ObjectInfo {
  size: number;
  contentType: string | undefined;
}

export interface PresignedPut {
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export interface Storage {
  presignPut(key: string, contentType: string, contentLength: number): Promise<PresignedPut>;
  presignGet(
    key: string,
    opts?: { downloadAs?: string },
  ): Promise<{ url: string; expiresAt: string }>;
  /** Null when the object does not exist. */
  head(key: string): Promise<ObjectInfo | null>;
  /** First `length` bytes (ranged GET), for type sniffing. */
  readStart(key: string, length: number): Promise<Uint8Array>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Whole object, or null when missing (exports and tests only; attachments never pass through the API). */
  getBytes(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  /** Deletes every object under `prefix`; returns how many were removed. */
  deletePrefix(prefix: string): Promise<number>;
  list(prefix: string): Promise<{ key: string; lastModified: Date | undefined }[]>;
}

const expiry = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

export class S3Storage implements Storage {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(config: StorageConfig) {
    this.bucket = config.bucket;
    this.s3 = new S3Client({
      endpoint: config.endpoint,
      region: config.region ?? 'auto',
      // R2 and MinIO address buckets by path.
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Presigned PUTs must not require client-side checksums the app cannot compute.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /** PUT bound to the declared type and exact length (TDD Section H, File upload security). */
  async presignPut(key: string, contentType: string, contentLength: number): Promise<PresignedPut> {
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      {
        expiresIn: PUT_URL_TTL_SECONDS,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return {
      url,
      headers: { 'content-type': contentType, 'content-length': String(contentLength) },
      expiresAt: expiry(PUT_URL_TTL_SECONDS),
    };
  }

  async presignGet(key: string, opts: { downloadAs?: string } = {}) {
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(opts.downloadAs
          ? {
              ResponseContentDisposition: `attachment; filename="${opts.downloadAs.replace(/"/g, '')}"`,
            }
          : {}),
      }),
      { expiresIn: GET_URL_TTL_SECONDS },
    );
    return { url, expiresAt: expiry(GET_URL_TTL_SECONDS) };
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async readStart(key: string, length: number): Promise<Uint8Array> {
    const r = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${length - 1}` }),
    );
    return r.Body ? await r.Body.transformToByteArray() : new Uint8Array();
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getBytes(key: string): Promise<Uint8Array | null> {
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return r.Body ? await r.Body.transformToByteArray() : new Uint8Array();
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async list(prefix: string) {
    const out: { key: string; lastModified: Date | undefined }[] = [];
    let token: string | undefined;
    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of page.Contents ?? [])
        if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified });
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  /** Lists with pagination and deletes in batches of 1,000 (TDD Section H, Account deletion). */
  async deletePrefix(prefix: string): Promise<number> {
    const keys = (await this.list(prefix)).map((o) => o.key);
    for (let i = 0; i < keys.length; i += 1000) {
      await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
    return keys.length;
  }
}

/** Storage key for an attachment: `u/<userId>/<attachmentId>/<sanitised name>`. */
export function attachmentKey(userId: string, attachmentId: string, filename: string): string {
  return `u/${userId}/${attachmentId}/${sanitiseFilename(filename)}`;
}

/** Keeps `[A-Za-z0-9._-]`, collapses the rest to `_`, max 255 (TDD Section H). */
export function sanitiseFilename(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 255);
  return cleaned || 'file';
}

/** Stand-in used when R2 settings are missing: attachment routes answer 503. */
export class UnconfiguredStorage implements Storage {
  private fail(): never {
    throw Object.assign(new Error('Attachment storage is not configured'), {
      status: 503,
      code: 'UNAVAILABLE',
    });
  }
  presignPut(): never {
    return this.fail();
  }
  presignGet(): never {
    return this.fail();
  }
  head(): never {
    return this.fail();
  }
  readStart(): never {
    return this.fail();
  }
  put(): never {
    return this.fail();
  }
  getBytes(): never {
    return this.fail();
  }
  delete(): never {
    return this.fail();
  }
  deletePrefix(): never {
    return this.fail();
  }
  list(): never {
    return this.fail();
  }
}
