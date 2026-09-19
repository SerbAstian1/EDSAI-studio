#!/usr/bin/env node
/**
 * Capture a preview fixture from a running API.
 *
 * The Studio is a client of an HTTP API, and there is no second implementation
 * of that API anywhere in this repository — including here. This script signs
 * in to a real server, performs real reads, and writes down exactly what came
 * back. The preview build replays those recordings and nothing else.
 *
 * That distinction is the whole point. A hand-written mock is a second opinion
 * about how the server behaves, and it drifts silently: the preview keeps
 * working while the product breaks. A recording can only ever be wrong in one
 * direction — stale — and staleness is visible, because re-running this script
 * against a current server produces a different file.
 *
 *   node scripts/capture-preview.mjs http://localhost:4317 > src/preview-data.json
 *
 * Reads only. Nothing here captures a write, because the preview refuses
 * writes rather than pretending to accept them.
 */

const base = process.argv[2] ?? 'http://localhost:4317';
const EMAIL = process.env.EDSAI_EMAIL ?? 'w@example.com';
const PASSWORD = process.env.EDSAI_PASSWORD ?? 'a-long-enough-password';

let cookie = '';

async function call(path, init = {}) {
  const res = await fetch(base + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

const signIn = await call('/api/session', {
  method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (signIn.status !== 200) {
  process.stderr.write(`Could not sign in to ${base}: ${signIn.status}\n`);
  process.exit(1);
}

const captured = {};
const record = async (path) => {
  const { status, body } = await call(path);
  // A refusal is worth recording too: the preview should show what the server
  // shows, including "nothing here", rather than an invented empty list.
  captured[path] = { status, body };
  return body;
};

await record('/api/health');
await record('/api/session');
await record('/api/rubric');
await record('/api/assets');
const runs = await record('/api/runs');
const clients = await record('/api/clients');
await record('/api/projects');

for (const client of clients?.clients ?? []) {
  await record(`/api/clients/${client.id}`);
  await record(`/api/clients/${client.id}/assets`);
  await record(`/api/clients/${client.id}/brand`);
  await record(`/api/clients/${client.id}/onboarding`);
  await record(`/api/clients/${client.id}/portal-keys`);
}

for (const run of runs?.runs ?? []) {
  await record(`/api/runs/${run.id}`);
  await record(`/api/runs/${run.id}/next`);
}

process.stdout.write(`${JSON.stringify({
  capturedAt: new Date().toISOString(),
  from: base,
  responses: captured,
}, null, 2)}\n`);
