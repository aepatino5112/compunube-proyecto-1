#!/bin/sh
# H66: self-signed certificate for apps/web/server.mjs over HTTPS in the lab.
# Usage: scripts/deploy/web-tls-cert.sh OUT_DIR HOST_OR_IP [HOST_OR_IP...]
# Writes OUT_DIR/web.crt and OUT_DIR/web.key (private, 0600). Browsers show a
# warning once per machine unless the certificate (or a mkcert CA) is trusted;
# see docs/deployment/https-lab.md. Never commit the generated files.
set -eu
[ "$#" -ge 2 ] || { echo "usage: $0 OUT_DIR HOST_OR_IP [HOST_OR_IP...]" >&2; exit 2; }
out=$1; shift
san=""
for name in "$@"; do
  case "$name" in
    *[!0-9.]*|"") entry="DNS:$name" ;;
    *) entry="IP:$name" ;;
  esac
  san="${san:+$san,}$entry"
done
mkdir -p "$out"
umask 077
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 30 \
  -subj "/CN=Compunube lab $1" -addext "subjectAltName=$san" \
  -addext "extendedKeyUsage=serverAuth" \
  -keyout "$out/web.key" -out "$out/web.crt" 2>/dev/null
chmod 600 "$out/web.key"
echo "certificate: $out/web.crt (SAN $san, 30 days)"
echo "key:         $out/web.key"
