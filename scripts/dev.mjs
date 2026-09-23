#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * `npm run dev`, as two processes instead of one.
 *
 * The API and the Studio are separate processes even in development — the
 * API needs Node's `node:sqlite`, which only exists from Node 22, and the
 * Studio's own dev server (Vite) has no such requirement. Running both from
 * one script is what makes `npm run dev` actually work rather than needing
 * two terminals and a README paragraph explaining why.
 *
 * The origin fix is the reason this script exists rather than two plain
 * `pnpm` calls: Vite's dev proxy forwards a browser's `Origin: /:5173` header
 * unchanged while rewriting the `Host` header the API process sees to its own
 * port. The API's CSRF check (`@edsai/auth`'s `isCsrfSafe`, by design) refuses
 * a state-changing request whose Origin does not match a Host it recognizes —
 * correctly, for a request that really did come from somewhere else, but
 * every mutation this app itself makes through the proxy looks like exactly
 * that unless the Studio's own dev origin is told to the API explicitly.
 * `EDSAI_ORIGINS` is the way to tell it, already built for a proxied or
 * multi-origin deployment; this script is what sets it for `npm run dev`
 * specifically.
 */

const STUDIO_PORT = Number.parseInt(process.env.STUDIO_PORT ?? '5173', 10);
// Vite tries the next port up when one is busy, so a handful are trusted —
// this is still a short, explicit allow-list, not a wildcard.
const devOrigins = Array.from(
  { length: 5 }, (_, i) => `http://localhost:${STUDIO_PORT + i}`,
).join(',');

const [major] = process.versions.node.split('.').map(Number);
if ((major ?? 0) < 22) {
  process.stderr.write(
    `This script starts the API, which needs Node 22+ for node:sqlite — `
    + `the node running right now is ${process.versions.node}. Run it with a `
    + `Node 22 binary on PATH (or ahead of it), e.g.:\n`
    + `  PATH="/path/to/node-22/bin:$PATH" npm run dev\n`,
  );
  process.exit(1);
}

if (!existsSync('packages/api/dist/bin/serve.js')) {
  process.stdout.write('No build yet — running `pnpm -r build` once before starting…\n');
  const build = spawn('pnpm', ['-r', 'build'], { stdio: 'inherit', shell: true });
  await new Promise((resolve, reject) => {
    build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build failed (${code})`))));
  });
}

// `--rehearse` runs the pipeline without a model: every department lands
// with a labelled placeholder, so the whole flow can be watched for a real
// client before a key is spent. A flag rather than only an env var because
// `VAR=1 npm run dev` is not a thing on a Windows shell.
const rehearse = process.argv.includes('--rehearse') || process.env.EDSAI_REHEARSAL === '1';

const env = {
  ...process.env,
  ...(rehearse ? { EDSAI_REHEARSAL: '1' } : {}),
  EDSAI_ORIGINS: process.env.EDSAI_ORIGINS || devOrigins,
  // Off only for plain-http local development — see packages/auth/src/cookie.ts.
  EDSAI_INSECURE_COOKIES: process.env.EDSAI_INSECURE_COOKIES || '1',
};

// Node does not read .env on its own. Loading it here makes optional local
// settings, such as EDSAI_REHEARSAL=1, available without a dotenv dependency.
const envFile = existsSync('.env') ? ['--env-file=.env'] : [];
const api = spawn(process.execPath, [...envFile, 'packages/api/dist/bin/serve.js'], { stdio: 'inherit', env });
const studio = spawn('pnpm', ['--filter', '@edsai/studio', 'dev'], { stdio: 'inherit', shell: true, env });

let stopping = false;
function stopBoth(code = 0) {
  if (stopping) return;
  stopping = true;
  api.kill();
  studio.kill();
  process.exit(code);
}

process.on('SIGINT', () => stopBoth(0));
process.on('SIGTERM', () => stopBoth(0));
api.on('exit', (code) => { if (!stopping && code !== 0) stopBoth(code ?? 1); });
studio.on('exit', (code) => { if (!stopping && code !== 0) stopBoth(code ?? 1); });
