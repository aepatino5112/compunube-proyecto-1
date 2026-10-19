FROM rust:1.99-bookworm AS build

# The build context is the repository root (compose.yml uses `context: .`).
# build.rs reads the shared contract from ../../proto relative to the crate, so
# the crate keeps its repository-relative location inside the image.
WORKDIR /src
COPY proto ./proto
WORKDIR /src/services/player-profile-service-rust
COPY services/player-profile-service-rust/Cargo.toml services/player-profile-service-rust/Cargo.lock services/player-profile-service-rust/build.rs ./
COPY services/player-profile-service-rust/src ./src
RUN cargo build --locked --release

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --no-create-home --shell /usr/sbin/nologin app
USER app

COPY --from=build /src/services/player-profile-service-rust/target/release/player-profile-service /usr/local/bin/player-profile-service

EXPOSE 50051
ENTRYPOINT ["/usr/local/bin/player-profile-service"]
