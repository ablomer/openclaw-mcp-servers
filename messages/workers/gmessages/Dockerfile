FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY workers/gmessages/go.mod workers/gmessages/go.sum ./
RUN go mod download
COPY workers/gmessages/ ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /gmessages-worker ./cmd/gmessages-worker

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /gmessages-worker /usr/local/bin/gmessages-worker
USER 1000:65532
ENV MESSAGES_DB_PATH=/data/messages.sqlite
ENV SESSIONS_DIR=/sessions
ENTRYPOINT ["/usr/local/bin/gmessages-worker"]
