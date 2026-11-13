# syntax=docker/dockerfile:1
# Multi-stage build, run from the REPOSITORY ROOT (the generator needs nothing outside backend/, but the
# context is the root so the workflow and local builds use the same command):
#   docker build -f backend/Dockerfile --target api       -t bubbles-api .
#   docker build -f backend/Dockerfile --target games     -t bubbles-games .
#   docker build -f backend/Dockerfile --target generator -t bubbles-generator .
# backend/Dockerfile.dockerignore keeps the rest of the repository (the iOS app, engine, docs) out of the context.
# No secrets are copied into or built into any image; they arrive as environment at run time.

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/cmd ./cmd
COPY backend/internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/dbinit ./cmd/dbinit \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/games ./cmd/games

FROM alpine:3.21 AS base
# wget (busybox) is used by the container healthchecks.
RUN apk add --no-cache ca-certificates tzdata \
 && addgroup -g 10001 app && adduser -D -u 10001 -G app app

FROM base AS api
LABEL org.opencontainers.image.source="https://github.com/karthiksing05/meta-hackathon-project"
COPY --from=build /out/api /out/dbinit /app/
# The one copy of Kevin's recommender, from the app's folder.
COPY FacebookClone/Bubbles/Recommend/game-recs.js /app/game-recs.js
ENV RECS_SCRIPT=/app/game-recs.js
# The game catalog (types, tools, checklists) for the harness and for dbinit's seeding.
COPY authoring/catalog/ /app/catalog/
# The one copy of the requirements code (docs/HARNESS_V2.md "Requirements"): the planner runs it in goja.
COPY authoring/expander/requirements.mjs /app/requirements.mjs
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/app/api"]

FROM base AS games
LABEL org.opencontainers.image.source="https://github.com/karthiksing05/meta-hackathon-project"
COPY --from=build /out/games /app/games
# The web player runs the app's own game runtime, copied from the app's folder (not kept as a second copy).
COPY FacebookClone/Bubbles/Runtime/web/ /app/player/runtime/
ENV PLAYER_RUNTIME_DIR=/app/player/runtime
USER 10001:10001
EXPOSE 8081
ENTRYPOINT ["/app/games"]

# The game generator: Muse writes a game, the engine checks it, bots playtest it. Plain Node, no packages
# to install. The Studio and engine bundles are copied from the app's folders (they are not kept twice).
FROM node:22-alpine AS generator
LABEL org.opencontainers.image.source="https://github.com/karthiksing05/meta-hackathon-project"
# ffmpeg (with ffprobe): a person's uploaded video -> key frames, scene cuts and the clip slideshows (src/media.mjs).
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY backend/generator/ ./
COPY FacebookClone/Bubbles/Runtime/web/bubble-kit-microgame-engine.js FacebookClone/Bubbles/Studio/web/microgame-studio.js /app/vendor/
# Compose's server-side hooks (src/hooks.mjs AUTHORING_FILES): the picture codec, the layout fixes and lint, and the
# blocking layout verifier (authoring/verify/), with what they import. No Chrome in the image, so the verifier runs
# without pixels (estimated text widths, shapes-only contrast) and only the structural layout fixes run.
COPY authoring/expander/image-codec.mjs authoring/expander/layout-fix.mjs authoring/expander/engine.mjs authoring/expander/canvas.mjs authoring/expander/requirements.mjs authoring/expander/verify-layout.mjs authoring/expander/ui-style.mjs /app/authoring/expander/
COPY authoring/playtest/layout-check.mjs authoring/playtest/bots.mjs authoring/playtest/frame-render.mjs authoring/playtest/fill-check.mjs authoring/playtest/requirements-check.mjs /app/authoring/playtest/
COPY authoring/verify/verify.mjs authoring/verify/motion.mjs authoring/verify/motion-fix.mjs authoring/verify/motion-track.mjs authoring/verify/registry.mjs authoring/verify/frames.mjs authoring/verify/scene.mjs authoring/verify/solve.mjs authoring/verify/prove.mjs /app/authoring/verify/
COPY authoring/verify/checks/fill.mjs authoring/verify/checks/hud.mjs authoring/verify/checks/shapes.mjs authoring/verify/checks/layout.mjs authoring/verify/checks/look.mjs authoring/verify/checks/motion.mjs authoring/verify/checks/readability.mjs authoring/verify/checks/requirements.mjs authoring/verify/checks/style.mjs authoring/verify/checks/targets.mjs authoring/verify/checks/textfit.mjs /app/authoring/verify/checks/
# The look kit (the verifier's look stage and S_* checks): its font metrics are compiled into font-data.mjs, and the
# font list and metrics they come from ride along. No font files: nothing renders text in the image.
COPY authoring/kit/look.mjs authoring/kit/font-data.mjs authoring/kit/vibes.mjs authoring/kit/readability.mjs authoring/kit/raster.mjs authoring/kit/jpeg.mjs authoring/kit/README.md /app/authoring/kit/
COPY authoring/fonts/fonts.json authoring/fonts/metrics.json /app/authoring/fonts/
RUN addgroup -g 10001 app && adduser -D -u 10001 -G app app
USER 10001:10001
ENV NODE_ENV=production PORT=8090 GENERATOR_VENDOR_DIR=/app/vendor GENERATOR_AUTHORING_DIR=/app/authoring
EXPOSE 8090
CMD ["node", "server.mjs"]
