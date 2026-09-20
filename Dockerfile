# syntax=docker/dockerfile:1

# EDSAI Studio, as one image.
#
# The whole product is a single Node process: it answers the API, renders the
# client portal, serves the uploaded files and serves the built Studio. So
# there is one image, one container, and one port.
#
# Two stages, for one reason: the build needs TypeScript, Vite and ~400MB of
# development dependencies, and the thing that runs in production needs none of
# them. The second stage installs from the same lockfile with `--prod` instead
# of copying `node_modules` across, so what ships is what the lockfile says and
# not whatever the build happened to leave behind.

FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# Manifests first, source second. Docker caches by layer, so an edit to a
# TypeScript file does not re-run the install — which is the slow half.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/api/package.json packages/api/
COPY packages/auth/package.json packages/auth/
COPY packages/engine/package.json packages/engine/
COPY packages/executor/package.json packages/executor/
COPY packages/export/package.json packages/export/
COPY packages/figma/package.json packages/figma/
COPY packages/hub/package.json packages/hub/
COPY packages/instruments/package.json packages/instruments/
COPY packages/measure/package.json packages/measure/
COPY packages/prompts/package.json packages/prompts/
COPY packages/rubric/package.json packages/rubric/
COPY packages/studio/package.json packages/studio/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY corpus corpus
COPY packages packages
RUN pnpm -r build


FROM node:22-slim AS runtime
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production
RUN corepack enable

WORKDIR /app

COPY --from=build /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=build /app/packages/api/package.json packages/api/
COPY --from=build /app/packages/auth/package.json packages/auth/
COPY --from=build /app/packages/engine/package.json packages/engine/
COPY --from=build /app/packages/executor/package.json packages/executor/
COPY --from=build /app/packages/export/package.json packages/export/
COPY --from=build /app/packages/figma/package.json packages/figma/
COPY --from=build /app/packages/hub/package.json packages/hub/
COPY --from=build /app/packages/instruments/package.json packages/instruments/
COPY --from=build /app/packages/measure/package.json packages/measure/
COPY --from=build /app/packages/prompts/package.json packages/prompts/
COPY --from=build /app/packages/rubric/package.json packages/rubric/
COPY --from=build /app/packages/studio/package.json packages/studio/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# The compiled output of every package, and the Studio's built assets.
COPY --from=build /app/packages/api/dist packages/api/dist
COPY --from=build /app/packages/auth/dist packages/auth/dist
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=build /app/packages/executor/dist packages/executor/dist
COPY --from=build /app/packages/export/dist packages/export/dist
COPY --from=build /app/packages/figma/dist packages/figma/dist
COPY --from=build /app/packages/hub/dist packages/hub/dist
COPY --from=build /app/packages/instruments/dist packages/instruments/dist
COPY --from=build /app/packages/measure/dist packages/measure/dist
COPY --from=build /app/packages/prompts/dist packages/prompts/dist
COPY --from=build /app/packages/rubric/dist packages/rubric/dist
COPY --from=build /app/packages/studio/dist packages/studio/dist

# Not an extra: the rubric reads the corpus at runtime, because the corpus is
# the only source for what the rubric says. An image without it starts and then
# fails on the first request that needs a reference.
COPY --from=build /app/corpus corpus

# Everything this process writes lives here, so a host mounts one volume and
# the container keeps nothing else.
ENV EDSAI_DB=/data/runs.db
ENV EDSAI_ASSETS=/data/assets
ENV EDSAI_APP=/app/packages/studio/dist
ENV PORT=4317
RUN mkdir -p /data && chown -R node:node /data

# Unprivileged, because nothing here needs root and the server takes uploads
# from strangers.
USER node
EXPOSE 4317
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4317)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "packages/api/dist/bin/serve.js"]
