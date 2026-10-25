FROM rust:1.99-bookworm AS build

# The build context is the repository root (compose.yml uses `context: .`).
# build.rs reads the shared contract from ../../proto relative to the crate, so
# the crate keeps its repository-relative location inside the image.
WORKDIR /src
COPY proto ./proto
WORKDIR /src/services/player-profile-service-rust

# Dependency layer: manifests, lockfile and build script with placeholder
# sources. It is rebuilt only when Cargo.toml, Cargo.lock, build.rs or the proto
# contract change, so editing src/ does not recompile every third-party crate.
COPY services/player-profile-service-rust/Cargo.toml services/player-profile-service-rust/Cargo.lock services/player-profile-service-rust/build.rs ./
RUN mkdir src \
    && echo 'fn main() {}' > src/main.rs \
    && : > src/lib.rs \
    && cargo build --locked --release \
    && rm -r src

COPY services/player-profile-service-rust/src ./src
# COPY keeps the host mtimes, which may be older than the placeholder build;
# touch the crate roots so cargo always rebuilds the crate from the real sources.
RUN touch src/lib.rs src/main.rs \
    && cargo build --locked --release

FROM golang:1.24-alpine AS healthcheck
WORKDIR /src
COPY services/match-service-go/go.mod services/match-service-go/go.sum ./
RUN go mod download
COPY services/match-service-go/cmd/player-profile-healthcheck ./cmd/player-profile-healthcheck
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/player-profile-healthcheck ./cmd/player-profile-healthcheck

FROM debian:bookworm-slim

# J78's validation harness still reads the internal metrics socket with nc;
# Docker's health decision is made exclusively by the gRPC probe below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --no-create-home --shell /usr/sbin/nologin app
USER app

COPY --from=build /src/services/player-profile-service-rust/target/release/player-profile-service /usr/local/bin/player-profile-service
COPY --from=healthcheck /out/player-profile-healthcheck /usr/local/bin/player-profile-healthcheck

EXPOSE 50051 9100
ENTRYPOINT ["/usr/local/bin/player-profile-service"]
