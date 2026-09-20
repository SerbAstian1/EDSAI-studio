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

## What it needs

- **Node 22 or newer.** The database is `node:sqlite`, which is built in.
- **A writable directory.** The database file and every uploaded file live
  there. In the container it is `/data`.
- **An `ANTHROPIC_API_KEY`**, to execute runs. Without one the studio still
  serves everything and still accepts a run — it just says, out loud, that it
  cannot execute it.

## Settings

Everything is an environment variable, because every deployment target can set
those and not all of them can be given a file.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `4317` | The port to listen on. |
| `EDSAI_DB` | `.edsai/runs.db` | The database file. |
| `EDSAI_ASSETS` | `.edsai/assets` | Where uploaded files are written. |
| `EDSAI_APP` | `packages/studio/dist` | The built Studio. Absent or missing means the API is served alone. |
| `ANTHROPIC_API_KEY` | — | Absent means runs are created but not executed. |
| `EDSAI_MODEL` | `claude-opus-5` | The model runs execute on. |
| `EDSAI_ORIGINS` | — | Extra browser origins allowed to call the API. Not needed for the one-origin layout. |
| `EDSAI_INSECURE_COOKIES` | off | Drops `Secure` from the session cookie. Plain-http local development only. |
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

## On Fly.io

```
fly launch --no-deploy --copy-config
fly volumes create edsai_data --size 3
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly deploy
```

Fly terminates TLS in front of the machine, so the cookie keeps its `Secure`
attribute and `EDSAI_INSECURE_COOKIES` stays unset.

`fly.toml` pins one machine and keeps it running. The database is a file on a
disk: two machines would be two different studios, and a machine that stops to
save money is a portal link that does not open. Scaling out means moving the
store off SQLite first, which the `RunStore` seam allows and nothing here
needs yet.

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
before the address is public.

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
