#!/usr/bin/env sh
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../../../.." && pwd)
out_dir="$repo_root/services/match-service-go/internal/playerprofile/pb"
command -v protoc >/dev/null
command -v protoc-gen-go >/dev/null
command -v protoc-gen-go-grpc >/dev/null
protoc --proto_path="$repo_root/proto" \
  --go_out="$out_dir" --go_opt=paths=source_relative \
  --go-grpc_out="$out_dir" --go-grpc_opt=paths=source_relative \
  "$repo_root/proto/player_profile.proto"
