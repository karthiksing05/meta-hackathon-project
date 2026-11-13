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
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/seed ./cmd/seed  && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/games ./cmd/games

FROM alpine:3.21 AS base
# wget (busybox) is used by the container healthchecks.
RUN apk add --no-cache ca-certificates tzdata \
 && addgroup -g 10001 app && adduser -D -u 10001 -G app app

FROM base AS api
LABEL org.opencontainers.image.source="https://github.com/karthiksing05/meta-hackathon-project"
COPY --from=build /out/api /out/dbinit /out/seed /app/
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/app/api"]

FROM base AS games
LABEL org.opencontainers.image.source="https://github.com/karthiksing05/meta-hackathon-project"
COPY --from=build /out/games /app/games
USER 10001:10001
EXPOSE 8081
ENTRYPOINT ["/app/games"]

# The game generator: Muse writes a game, the engine checks it, bots playtest it. Plain Node, no packages
# to install; the Studio and engine bundles are vendored in backend/generator/vendor.
FROM node:22-alpine AS generator
LABEL org.opencontainers.image.source="https://github.com/karthiksing05/meta-hackathon-project"
WORKDIR /app
COPY backend/generator/ ./
RUN addgroup -g 10001 app && adduser -D -u 10001 -G app app
USER 10001:10001
ENV NODE_ENV=production PORT=8090
EXPOSE 8090
CMD ["node", "server.mjs"]
