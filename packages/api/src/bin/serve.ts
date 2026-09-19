#!/usr/bin/env node
import { RunStore } from '@edsai/engine';
import { Executor } from '@edsai/executor';
import { ApiServer } from '../server.js';

/**
 * The model, where there is one.
 *
 * Absent credentials are not an error: a server with no key still serves the
 * Studio, the portal and every record already in the database — it just cannot
 * execute a run, and says so when asked to rather than accepting one and
 * leaving it stalled.
 */
const executor = process.env['ANTHROPIC_API_KEY']
  ? new Executor({
    ...(process.env['EDSAI_MODEL'] ? { model: process.env['EDSAI_MODEL'] } : {}),
  })
  : undefined;

const port = Number.parseInt(process.env['PORT'] ?? '4317', 10);
const db = process.env['EDSAI_DB'] ?? '.edsai/runs.db';

const server = new ApiServer({
  store: new RunStore(db),
  ...(process.env['EDSAI_SCOPE'] ? { scopeId: process.env['EDSAI_SCOPE'] } : {}),
  origins: (process.env['EDSAI_ORIGINS'] ?? '').split(',').filter(Boolean),
  // Opt-in and loud: a `Secure` cookie is never sent over plain http, so a
  // local session silently does not work without this. The default stays the
  // safe one, and nothing turns it on by accident.
  ...(process.env['EDSAI_INSECURE_COOKIES'] === '1' ? { insecureCookies: true } : {}),
  ...(executor ? { executor } : {}),
});

const actual = await server.listen(port);
process.stdout.write(`edsai-api listening on http://localhost:${actual} (db ${db})\n`);
process.stdout.write(executor
  ? `runs execute on ${executor.model}\n`
  : 'no ANTHROPIC_API_KEY, so runs will be created but not executed\n');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void server.close().then(() => process.exit(0)));
}
