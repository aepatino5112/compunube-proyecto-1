FROM rust:1.82-bookworm AS build

WORKDIR /src
COPY services/player-profile-service-rust/Cargo.toml ./
COPY services/player-profile-service-rust/src ./src
RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update     && apt-get install -y --no-install-recommends ca-certificates netcat-openbsd     && rm -rf /var/lib/apt/lists/*

RUN useradd --system --no-create-home --shell /usr/sbin/nologin app
USER app

COPY --from=build /src/target/release/player-profile-service /usr/local/bin/player-profile-service

EXPOSE 50051
ENTRYPOINT ["/usr/local/bin/player-profile-service"]
