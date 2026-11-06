// Vitest global setup for the `db` project: starts PostgreSQL 18 in Docker,
// applies the committed migrations as the owner, and enables login for the
// least-privileged `nexus_api` role so tests exercise row-level security.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../../src/db/migrate';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Owner connection (superuser; bypasses RLS) for fixtures and assertions. */
    ownerUrl: string;
    /** `nexus_api` connection (RLS applies), as the API uses in production. */
    apiUrl: string;
    /** MinIO (S3 API) standing in for R2. */
    s3Endpoint: string;
    s3AccessKey: string;
    s3SecretKey: string;
    s3Bucket: string;
  }
}

export const API_TEST_PASSWORD = 'nexus-api-test';

let container: StartedPostgreSqlContainer | undefined;
let minio: StartedMinioContainer | undefined;
const BUCKET = 'nexus-attachments-test';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const minioStart = new MinioContainer('chainguard/minio:latest')
    .withUsername('nexus')
    .withPassword('nexus-test-secret')
    .start();
  container = await new PostgreSqlContainer('postgres:18')
    .withDatabase('nexus')
    .withUsername('nexus_owner')
    .withPassword('nexus_owner')
    .start();

  const ownerUrl = container.getConnectionUri();
  await runMigrations(ownerUrl);

  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  await client.query(`ALTER ROLE nexus_api LOGIN PASSWORD '${API_TEST_PASSWORD}'`);
  await client.end();

  const apiUrl = new URL(ownerUrl);
  apiUrl.username = 'nexus_api';
  apiUrl.password = API_TEST_PASSWORD;

  minio = await minioStart;
  const s3Endpoint = minio.getConnectionUrl();
  await new S3Client({
    endpoint: s3Endpoint,
    region: 'auto',
    forcePathStyle: true,
    credentials: { accessKeyId: 'nexus', secretAccessKey: 'nexus-test-secret' },
  }).send(new CreateBucketCommand({ Bucket: BUCKET }));
  project.provide('s3Endpoint', s3Endpoint);
  project.provide('s3AccessKey', 'nexus');
  project.provide('s3SecretKey', 'nexus-test-secret');
  project.provide('s3Bucket', BUCKET);

  project.provide('ownerUrl', ownerUrl);
  project.provide('apiUrl', apiUrl.toString());

  return async () => {
    await container?.stop();
    await minio?.stop();
  };
}
