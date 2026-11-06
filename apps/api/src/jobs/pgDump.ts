import { spawn } from 'node:child_process';

/**
 * Runs `pg_dump -Fc` and returns the archive. Needs the PostgreSQL client in
 * the runtime image (the Dockerfile installs postgresql-client-18).
 */
export function pgDump(connectionString: string): () => Promise<Uint8Array> {
  return () =>
    new Promise((resolve, reject) => {
      const child = spawn(
        'pg_dump',
        ['--format=custom', '--no-owner', '--no-privileges', connectionString],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const chunks: Buffer[] = [];
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve(new Uint8Array(Buffer.concat(chunks)));
        else reject(new Error(`pg_dump exited ${code}: ${stderr.slice(0, 300)}`));
      });
    });
}
