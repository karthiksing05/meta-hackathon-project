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
WORKDIR /app
COPY backend/generator/ ./
COPY FacebookClone/Bubbles/Runtime/web/bubble-kit-microgame-engine.js FacebookClone/Bubbles/Studio/web/microgame-studio.js /app/vendor/
RUN addgroup -g 10001 app && adduser -D -u 10001 -G app app
USER 10001:10001
ENV NODE_ENV=production PORT=8090 GENERATOR_VENDOR_DIR=/app/vendor
EXPOSE 8090
CMD ["node", "server.mjs"]
