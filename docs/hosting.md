# Hosting EDSAI Studio

The whole product is one Node process. It answers the API, renders the client
portal, serves uploaded files and serves the Studio interface — all on one
port, from one origin.

That is a decision, not a convenience. The session cookie is `SameSite=Lax`;
splitting the interface onto a static host and the API onto another would mean
`SameSite=None`, a CORS configuration and two deployments to keep in step. And
the link a client follows into the portal is built from the browser's own
origin, so wherever this runs is the address in the link, with nothing to
configure and nothing to get out of sync.

The one split this document does describe — the Studio on Vercel, below —
keeps that property by proxying rather than by cross-origin calls: the
browser still talks to one origin.

## What it needs

- **Node 22 or newer.** The database is `node:sqlite`, which is built in.
- **A writable directory.** The database file and every uploaded file live
  there. In the container it is `/data`.
- **Automated execution is optional.** The bundled server deliberately has no
  external provider. It still serves everything and accepts runs; it simply
  makes clear that those runs will not execute automatically.

## Settings

Everything is an environment variable, because every deployment target can set
those and not all of them can be given a file.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `4317` | The port to listen on. |
| `EDSAI_DB` | `.edsai/runs.db` | The database file. |
| `EDSAI_ASSETS` | `.edsai/assets` | Where uploaded files are written. |
| `EDSAI_APP` | `packages/studio/dist` | The built Studio. Absent or missing means the API is served alone. |
| `EDSAI_REHEARSAL` | off | Set to `1` for clearly marked placeholder output while checking the full pipeline. |
| `EDSAI_REHEARSAL_DELAY_MS` | `1500` | Delay before each rehearsal department completes, in milliseconds. |
| `EDSAI_ORIGINS` | — | Extra browser origins allowed to call the API. Not needed for the one-origin layout. |
| `EDSAI_INSECURE_COOKIES` | off | Drops `Secure` from the session cookie. Plain-http local development only. |
| `EDSAI_SIGNIN_ALLOW` | -- | Comma-separated email allowlist for first-run setup and sign-in. Set it to your email before making a one-person studio public. |
| `EDSAI_SCOPE` | — | Restricts this process to one scope. |

Two of those are worth being careful about.

**`EDSAI_INSECURE_COOKIES`** exists because a `Secure` cookie is never sent
over plain http, so signing in at `http://localhost` silently does not work
without it. It is off by default and has to be asked for. Anywhere reachable
over a network, leave it off and put TLS in front — a session cookie without
`Secure` can be read off any link the traffic crosses.

**`EDSAI_ORIGINS`** is only for a browser on a *different* origin than this
server. A write from the page this server itself served is same-origin and is
always accepted, so the one-process deployment needs nothing here. This was not
always true, and the failure it caused is worth remembering: a Studio that
loaded perfectly and then refused every save with a 403.

**`EDSAI_SIGNIN_ALLOW`** reserves both the first owner account and future
sign-ins for the listed email addresses. It contains an email, never a password.
An unlisted address receives the same generic credential failure as a wrong
password, and a second failed attempt from that address is held with an
increasing `Retry-After` delay.

## Automated execution

The bundled server intentionally includes no external model provider or API
credential. Use `EDSAI_REHEARSAL=1` to walk the complete pipeline with
clearly marked placeholders. A production integration should provide a
`ModelClient` adapter in server code; this keeps the vendor, credentials,
and pricing policy explicit instead of making them a hidden deployment toggle.

## In a container

```
docker compose up -d --build
```

One service, one volume. `/data` holds the database and every uploaded client
file — back that up and everything else can be rebuilt from this repository.

Behind a reverse proxy that terminates TLS, bind the published port to the
loopback (`127.0.0.1:4317:4317`) so the plain-http port is not reachable from
outside the machine.

The image runs as an unprivileged user. Nothing in it needs root, and it takes
file uploads from people outside the studio.

## On Railway

The least work of the options here. Railway builds the `Dockerfile`, keeps
one container running, and mounts a disk; `railway.json` tells it where the
health check is and never to run more than one replica.

1. **New Project → Deploy from GitHub repo.** Pick this repository. Railway
   detects the Dockerfile and starts a build.
2. **Variables** on the service:

   | Variable | Value |
   | --- | --- |
   | `PORT` | `4317` |
   | `EDSAI_ORIGINS` | the Studio's address on Vercel, once it exists (see below) |

3. **Volume.** Service → Volumes → Add Volume, mount path **`/data`**. That
   is the database and every upload. Without it, a redeploy is a new studio.
4. **Domain.** Settings → Networking → Generate Domain. Open it once, create
   the owner account, and note the host for `vercel.json`.

The container handles the volume's ownership itself: a Railway volume
arrives owned by root, so the image starts as root, hands `/data` to the
unprivileged `node` user, and drops to `node` before the server starts.
Nothing to set for that.

Railway does not sleep the service, which matters: a stopped container is a
portal link that does not open.

## On Fly.io

```
fly launch --no-deploy --copy-config
fly volumes create edsai_data --size 3
fly deploy
```

Fly terminates TLS in front of the machine, so the cookie keeps its `Secure`
attribute and `EDSAI_INSECURE_COOKIES` stays unset.

`fly.toml` pins one machine and keeps it running. The database is a file on a
disk: two machines would be two different studios, and a machine that stops to
save money is a portal link that does not open. Scaling out means moving the
store off SQLite first, which the `RunStore` seam allows and nothing here
needs yet.

## On Vercel

Vercel hosts the **Studio interface**. It cannot host the API: the API is
one long-lived process with a SQLite file and an uploads directory on disk,
and it runs a pipeline for minutes in the background after answering a
request. A serverless function has none of those — no disk that survives an
invocation, no process that outlives one — so putting the API there would
mean rewriting the store, the uploads and the run loop first.

So the layout is two parts that the browser sees as one:

```
browser ──▶ studio.example.com (Vercel, static)
                │
                ├── /api/*     ─── rewrite ──▶ <api host>/api/*
                └── /portal/*  ─── rewrite ──▶ <api host>/portal/*
```

`vercel.json` rewrites every `/api` and `/portal` request to the API host.
Vercel proxies them, so from the browser's side the API is same-origin: the
session cookie stays `SameSite=Lax`, no CORS is involved, and streamed run
events pass through. Deep links and the portal link a client follows are the
Vercel address.

### Steps

1. **Deploy the API** on Railway or Fly (above), or anywhere with a disk.
   Note its address.
2. **Point the rewrites at it.** In `vercel.json`, replace
   `REPLACE-WITH-YOUR-API-HOST` with the API's host in all three rewrites.
   Vercel cannot read that from an environment variable; it has to be in the
   file. Commit it.
3. **Tell the API about the Studio's origin.** The API refuses a write whose
   `Origin` it does not know, and through the proxy the browser's origin is
   the Vercel one:

   ```
   EDSAI_ORIGINS=https://studio.example.com,https://edsai-studio.vercel.app
   ```

   (a Variable on Railway; `fly secrets set` on Fly.)

   Every address the Studio is served from — the `*.vercel.app` one and any
   custom domain — goes in that list. Forgetting one produces the failure
   described under Settings: a Studio that loads and refuses every save.
4. **Import the repository in Vercel.** Root directory is the repository
   root; `vercel.json` sets the install command, the build command
   (`pnpm --filter @edsai/studio... build`) and the output directory
   (`packages/studio/dist`). Set the project's Node.js version to **22.x**.
   No environment variables are needed on the Vercel side — the Studio
   carries no secrets and reaches the API by relative path.
5. **Open the Vercel address** and sign in. The first-run account is created
   on the API, the same as any other deployment.

### What to know

- The API still serves its own copy of the Studio at its own address. Both
  work; the Vercel one is the one to give people.
- Preview deployments each get their own `*.vercel.app` origin. Either add
  them to `EDSAI_ORIGINS` as you go, or treat previews as read-only — every
  GET works without being listed; only writes are refused.
- A deploy of the Studio does not touch the API, and vice versa. The API's
  contract is the boundary; when both change, deploy the API first.
- Uploaded files are served through the same rewrite, so their URLs stay
  relative and the `private, max-age=300` cache the API sets is what the
  browser sees.

## Without a container

```
pnpm install
pnpm -r build
EDSAI_DB=/srv/edsai/runs.db \
EDSAI_ASSETS=/srv/edsai/assets \
node packages/api/dist/bin/serve.js
```

The corpus has to stay where it is, next to the packages: the rubric reads it
at runtime, because the corpus is the only source for what the rubric says.

## The first time it runs

Open it and it asks for a name, an email and a password. That first account is
the owner, and the endpoint that creates it refuses once a user exists. Do this
before the address is public. For a public one-person deployment, set
`EDSAI_SIGNIN_ALLOW=you@example.com` first; only that email can claim the
first-run form or sign in afterwards.

## Caching, and what a deploy must not break

Assets carry a content hash in their names, so they are served
`immutable` for a year. `index.html` names them and is served `no-cache`. A
browser holding a stale `index.html` would ask for assets a deploy has already
replaced, and the studio would fail to boot — which is the classic way a good
release looks broken.

Which files are hashed is read from the build's own manifest rather than
guessed from their names. Vite emits `index-C_lsOoT-.js`; a pattern loose
enough to recognise that also matches `use-media-query.js`, which is not hashed
at all, and caching that one forever is a bug that outlives the deploy.

## Backups

Everything that matters is in the writable directory: `runs.db` and the
`assets/` tree. The files under `assets/` are content-addressed — the database
row names the digest — so the two have to be backed up together. A database
without its assets is a portal full of links to files that are not there.

`sqlite3 runs.db ".backup out.db"` takes a consistent copy while the server is
running. Copying the file directly while it is being written does not.
