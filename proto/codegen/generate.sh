#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$ROOT/.generated-contracts}"
PROTO_DIR="$ROOT/proto"
PROTO_FILE="$PROTO_DIR/player_profile.proto"

for cmd in protoc protoc-gen-go protoc-gen-go-grpc cargo; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "ERROR: $cmd is required" >&2
    exit 1
  }
done

rm -rf "$OUT"
mkdir -p "$OUT/go" "$OUT/rust"

(
  cd "$PROTO_DIR"
  protoc     --proto_path=.     --go_out="$OUT/go"     --go_opt=paths=source_relative     --go-grpc_out="$OUT/go"     --go-grpc_opt=paths=source_relative     player_profile.proto
)

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/src"

cat >"$TMP/Cargo.toml" <<'EOF'
[package]
name = "compunube-proto-codegen"
version = "0.0.0"
edition = "2021"

[dependencies]
tonic-build = "0.12"
EOF

cat >"$TMP/src/main.rs" <<'EOF'
use std::{env, path::PathBuf};

fn main() {
    let mut args = env::args().skip(1);
    let proto_dir = PathBuf::from(args.next().expect("proto dir"));
    let out_dir = PathBuf::from(args.next().expect("out dir"));
    let proto = proto_dir.join("player_profile.proto");

    tonic_build::configure()
        .build_client(true)
        .build_server(true)
        .out_dir(out_dir)
        .compile_protos(&[proto], &[proto_dir])
        .expect("generate Rust/Tonic stubs");
}
EOF

cargo run --quiet --manifest-path "$TMP/Cargo.toml" -- "$PROTO_DIR" "$OUT/rust"

test -s "$OUT/go/player_profile.pb.go"
test -s "$OUT/go/player_profile_grpc.pb.go"
test -s "$OUT/rust/compunube.player.v1.rs"

echo "Generated contract stubs in $OUT"
