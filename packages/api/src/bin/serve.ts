#!/usr/bin/env node
import { RunStore } from '@edsai/engine';
import { ApiServer } from '../server.js';

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
});

const actual = await server.listen(port);
process.stdout.write(`edsai-api listening on http://localhost:${actual} (db ${db})\n`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void server.close().then(() => process.exit(0)));
}
