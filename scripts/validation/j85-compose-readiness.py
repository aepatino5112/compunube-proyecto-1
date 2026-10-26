#!/usr/bin/env python3
"""J85: isolated Compose gRPC readiness, DB/schema outage and recovery."""

import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[2]
PROJECT = os.environ.get("J85_PROJECT", "compunube-j85")
ENV = os.environ.copy()
for key, port in {
    "POSTGRES_PORT": "55485", "GO_HTTP_PORT": "58085", "ENVOY_GRPC_PORT": "55085",
    "ENVOY_ADMIN_PORT": "59085", "PROMETHEUS_PORT": "59086", "GRAFANA_PORT": "53085",
}.items():
    ENV[key] = os.environ.get("J85_" + key, port)
for key in ("POSTGRES_PASSWORD", "MATCH_DB_PASSWORD", "PLAYER_DB_PASSWORD", "MONITOR_DB_PASSWORD", "GRAFANA_ADMIN_PASSWORD"):
    if not ENV.get(key):
        ENV[key] = secrets.token_hex(24)
DC = ["docker", "compose", "-p", PROJECT, "-f", "compose.yml", "-f", "scripts/validation/compose.validation.yml"]
ADMIN = f"http://127.0.0.1:{ENV['ENVOY_ADMIN_PORT']}"
RUST = ("player-profile-rust-1", "player-profile-rust-2")
checks = 0
schema_hidden = False


def run(*args, input_text=None, timeout=300, quiet=True):
    process = subprocess.run(args, cwd=ROOT, env=ENV, input=input_text, text=True,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if process.returncode:
        raise RuntimeError(f"{' '.join(args[:4])} failed ({process.returncode}): {(process.stderr or process.stdout)[-1000:]}")
    if not quiet and process.stdout.strip():
        print(process.stdout.strip(), flush=True)
    return process.stdout.strip()


def dc(*args, **kwargs):
    return run(*DC, *args, **kwargs)


def check(value, label):
    global checks
    if not value:
        raise AssertionError(label)
    checks += 1
    print(f"PASS {label}", flush=True)


def wait_for(label, timeout, predicate):
    started = time.monotonic()
    while time.monotonic() - started < timeout:
        try:
            if predicate():
                print(f"  {label}: {time.monotonic() - started:.1f}s", flush=True)
                return
        except (RuntimeError, OSError, ValueError):
            pass
        time.sleep(0.5)
    raise AssertionError(f"timeout after {timeout}s: {label}")


def health(service):
    container = dc("ps", "-q", service)
    return run("docker", "inspect", "-f", "{{.State.Health.Status}}", container)


def running(service):
    container = dc("ps", "-q", service)
    return run("docker", "inspect", "-f", "{{.State.Running}}", container) == "true"


def hosts():
    with urlopen(ADMIN + "/clusters", timeout=3) as response:
        data = response.read().decode()
    return len(re.findall(r"player_profile_cluster::.*::health_flags::healthy", data))


def host_flags():
    with urlopen(ADMIN + "/clusters", timeout=3) as response:
        data = response.read().decode()
    return [line for line in data.splitlines() if "player_profile_cluster::" in line and "::health_flags::" in line]


def sql(statement):
    return dc("exec", "-T", "postgres", "sh", "-c",
              'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -At -v ON_ERROR_STOP=1',
              input_text=statement, timeout=15)


def main():
    global schema_hidden
    started = time.monotonic()
    run("docker", "compose", "version", timeout=10)
    dc("down", "-v", "--remove-orphans", timeout=90)
    print(f"J85 isolated project: {PROJECT}", flush=True)
    if ENV.get("J85_SKIP_BUILD") != "1":
        dc("build", "player-profile-rust-1", "match-service-go", timeout=900)
    dc("up", "-d", "--no-build", "--wait", "--wait-timeout", "300", timeout=360)
    check(all(health(service) == "healthy" for service in RUST), "clean Compose up --wait: both Rust healthy")
    check(dc("ps", "-a", "db-migrate").count("Exited (0)") == 1 or
          run("docker", "inspect", "-f", "{{.State.ExitCode}}", dc("ps", "-aq", "db-migrate")) == "0",
          "one-shot migration completed before Rust readiness")
    wait_for("Envoy has 2 healthy Rust hosts", 120, lambda: hosts() == 2)
    check("player-profile-healthcheck" in dc("config", quiet=True), "Compose uses gRPC healthcheck binary")

    outage = time.monotonic()
    dc("stop", "postgres", timeout=60)
    wait_for("both Rust containers become unhealthy after DB down", 90,
             lambda: all(health(service) == "unhealthy" for service in RUST))
    check(all(running(service) for service in RUST), "both Rust processes remain running while gRPC is NOT_SERVING")
    wait_for("Envoy has 0 healthy hosts after DB down", 90, lambda: hosts() == 0)
    print(f"DB down to unhealthy/0 hosts: {time.monotonic() - outage:.1f}s", flush=True)
    dc("start", "postgres", timeout=60)
    recovery = time.monotonic()
    wait_for("PostgreSQL returns healthy", 90, lambda: health("postgres") == "healthy")
    wait_for("both Rust containers recover to healthy", 90,
             lambda: all(health(service) == "healthy" for service in RUST))
    wait_for("Envoy restores 2 healthy hosts", 120, lambda: hosts() == 2)
    print(f"DB up to healthy/2 hosts: {time.monotonic() - recovery:.1f}s", flush=True)

    # A missing required player table must lower real gRPC health, even while
    # the TCP listener remains open. The isolated table is restored in finally.
    sql("ALTER TABLE player.profiles RENAME TO profiles_j85_hidden;")
    schema_hidden = True
    wait_for("both Rust containers become unhealthy with invalid schema", 90,
             lambda: all(health(service) == "unhealthy" for service in RUST))
    wait_for("Envoy has 0 healthy hosts with invalid schema", 90, lambda: hosts() == 0)
    sql("ALTER TABLE player.profiles_j85_hidden RENAME TO profiles;")
    schema_hidden = False
    wait_for("both Rust containers recover after schema restore", 90,
             lambda: all(health(service) == "healthy" for service in RUST))
    wait_for("Envoy restores both hosts after schema restore", 120, lambda: hosts() == 2)

    # J78 established SIGKILL as the reproducible single-replica failure.
    # Disable Docker auto-restart until this harness explicitly starts it.
    rust1 = dc("ps", "-q", RUST[0])
    run("docker", "update", "--restart=no", rust1, timeout=15)
    run("docker", "kill", rust1, timeout=15)
    seen = set()
    try:
        wait_for("Envoy retains only rust-2", 120, lambda: seen.add(hosts()) or 1 in seen)
    except AssertionError as error:
        raise AssertionError(f"{error}; observed host counts={sorted(seen)}; flags={host_flags()}") from error
    check(health(RUST[1]) == "healthy", "rust-2 remains healthy with rust-1 stopped")
    dc("start", RUST[0], timeout=60)
    wait_for("rust-1 recovers after start", 90, lambda: health(RUST[0]) == "healthy")
    wait_for("Envoy restores 2 hosts after rust-1 start", 120, lambda: hosts() == 2)
    dc("restart", RUST[0], timeout=60)
    wait_for("rust-1 returns healthy after restart", 90, lambda: health(RUST[0]) == "healthy")
    wait_for("Envoy returns to 2 hosts after rust-1 restart", 120, lambda: hosts() == 2)
    check(health(RUST[1]) == "healthy", "rust-2 stayed healthy during rust-1 restart")
    print(f"elapsed: {time.monotonic() - started:.1f}s; checks: {checks}", flush=True)


if __name__ == "__main__":
    result = 1
    try:
        main()
        result = 0
    except (AssertionError, RuntimeError, OSError, subprocess.TimeoutExpired, ValueError) as error:
        print(f"FAIL {error}", file=sys.stderr, flush=True)
    finally:
        if schema_hidden:
            try:
                sql("ALTER TABLE player.profiles_j85_hidden RENAME TO profiles;")
            except (RuntimeError, OSError, subprocess.TimeoutExpired):
                pass
        try:
            dc("down", "-v", "--remove-orphans", timeout=90)
            print(f"teardown: {PROJECT} containers, network and volumes removed", flush=True)
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
            print(f"FAIL teardown: {error}", file=sys.stderr, flush=True)
            result = 1
        print("RESULT: PASS" if result == 0 else "RESULT: FAIL", flush=True)
    sys.exit(result)
