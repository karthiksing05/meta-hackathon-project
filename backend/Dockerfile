# syntax=docker/dockerfile:1
# Multi-stage build. One build stage, two runtime targets:
#   docker build --target api   -t bubbles-api .
#   docker build --target games -t bubbles-games .
# No secrets are copied into or built into any image; they arrive as environment at run time.

FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/dbinit ./cmd/dbinit \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/games ./cmd/games

FROM alpine:3.21 AS base
# wget (busybox) is used by the container healthchecks.
RUN apk add --no-cache ca-certificates tzdata \
 && addgroup -g 10001 app && adduser -D -u 10001 -G app app

FROM base AS api
COPY --from=build /out/api /out/dbinit /app/
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/app/api"]

FROM base AS games
COPY --from=build /out/games /app/games
USER 10001:10001
EXPOSE 8081
ENTRYPOINT ["/app/games"]
