#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DiskAssetStore, RunStore } from '@edsai/engine';
import {
  Executor,
  OPENAI_DEFAULT_MODEL,
  OpenAIModelClient,
  RehearsalClient,
  REHEARSAL_MODEL,
} from '@edsai/executor';
import { buildRubric } from '@edsai/rubric';
import { ApiServer } from '../server.js';

/**
 * One process serves everything: the API, the client portal, the uploaded
 * files, and the Studio itself. There is nothing to deploy twice and nothing
 * to keep in sync between two hosts.
 *
 * Everything it needs comes from the environment, because a deployment target
 * — a container, a service, a machine someone ssh'd into — can always set
 * environment variables and cannot always be given a config file.
 */

/**
 * The model, where there is one.
 *
 * Absent credentials are not an error: a server with no key still serves the
 * Studio, the portal and every record already in the database — it just cannot
 * execute a run, and says so when asked to rather than accepting one and
 * leaving it stalled.
 */
const rubric = buildRubric();

/**
 * A rehearsal moves runs without a model. It wins over a key when both are
 * set, because it is the more deliberate of the two: a key sits in `.env`
 * for weeks, and the person who typed `EDSAI_REHEARSAL=1` meant it now.
 */
const rehearsal = process.env['EDSAI_REHEARSAL'] === '1';
const rehearsalDelay = Number.parseInt(process.env['EDSAI_REHEARSAL_DELAY_MS'] ?? '', 10);
const openaiApiKey = process.env['OPENAI_API_KEY'];

const executor = rehearsal
  ? new Executor({
    model: REHEARSAL_MODEL,
    client: new RehearsalClient({
      rubric,
      ...(Number.isFinite(rehearsalDelay) ? { delayMs: rehearsalDelay } : {}),
    }),
  })
  : openaiApiKey
    ? new Executor({
      model: process.env['EDSAI_MODEL'] ?? OPENAI_DEFAULT_MODEL,
      client: new OpenAIModelClient({ apiKey: openaiApiKey }),
    })
    : undefined;

const port = Number.parseInt(process.env['PORT'] ?? '4317', 10);
const db = process.env['EDSAI_DB'] ?? '.edsai/runs.db';

/**
 * Uploaded files, on a disk.
 *
 * The default asset store is in memory, which is correct for a library whose
 * caller said nothing — it writes nothing to a disk it was not given. It is
 * wrong for a server: a restart would lose every file a client had uploaded,
 * leaving rows in the database pointing at bytes that no longer exist. So this
 * process always names a path.
 */
const assetRoot = process.env['EDSAI_ASSETS'] ?? '.edsai/assets';

/**
 * The built Studio, if it has been built.
 *
 * Serving it is optional so that `pnpm dev` can keep using Vite's own server
 * with hot reload, and so a build that has not run yet produces a working API
 * rather than a crash on boot.
 */
const appRoot = resolve(process.env['EDSAI_APP'] ?? 'packages/studio/dist');
const app = existsSync(appRoot) ? appRoot : undefined;
const signInAllow = (process.env['EDSAI_SIGNIN_ALLOW'] ?? '')
  .split(',').map((email) => email.trim()).filter(Boolean);

const server = new ApiServer({
  store: new RunStore(db),
  assets: new DiskAssetStore(assetRoot),
  rubric,
  ...(app ? { app } : {}),
  ...(process.env['EDSAI_SCOPE'] ? { scopeId: process.env['EDSAI_SCOPE'] } : {}),
  origins: (process.env['EDSAI_ORIGINS'] ?? '').split(',').filter(Boolean),
  // Opt-in and loud: a `Secure` cookie is never sent over plain http, so a
  // local session silently does not work without this. The default stays the
  // safe one, and nothing turns it on by accident.
  ...(process.env['EDSAI_INSECURE_COOKIES'] === '1' ? { insecureCookies: true } : {}),
  // Opt-in dev convenience: no sign-in screen, every request is the owner.
  // Never set this on anything another person can reach.
  ...(process.env['EDSAI_DISABLE_AUTH'] === '1' ? { disableAuth: true } : {}),
  ...(signInAllow.length > 0 ? { signInAllow } : {}),
  ...(executor ? { executor } : {}),
});

const actual = await server.listen(port);
process.stdout.write(`edsai listening on port ${actual}\n`);
process.stdout.write(`  database ${resolve(db)}\n`);
process.stdout.write(`  files    ${resolve(assetRoot)}\n`);
process.stdout.write(app
  ? `  studio   ${app}\n`
  : `  studio   not built (${appRoot} is missing), so this serves the API only\n`);
process.stdout.write(rehearsal
  ? '  runs     REHEARSAL (EDSAI_REHEARSAL=1) — departments produce placeholders, no model is called\n'
  : executor
    ? `  runs     OpenAI Responses API on ${executor.model}\n`
    : '  runs     no OPENAI_API_KEY; runs are created but not executed\n');
process.stdout.write(server.devOwnerCreated
  ? `  auth     DISABLED (EDSAI_DISABLE_AUTH=1) — every request is the owner\n`
    + `           an owner account was still created, for when this is turned back on:\n`
    + `             email    ${server.devOwnerCreated.email}\n`
    + `             password ${server.devOwnerCreated.password}\n`
  : process.env['EDSAI_DISABLE_AUTH'] === '1'
    ? '  auth     DISABLED (EDSAI_DISABLE_AUTH=1) — every request is the owner\n'
    : '');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void server.close().then(() => process.exit(0)));
}
