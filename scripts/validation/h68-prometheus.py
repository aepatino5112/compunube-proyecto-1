#!/usr/bin/env python3
"""H68: isolated Prometheus targets, replica failover and database signals."""

import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
from urllib.parse import urlencode
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[2]
PROJECT = os.environ.get("H68_PROJECT", "compunube-h68")
ENV = os.environ.copy()
for key, port in {
    "POSTGRES_PORT": "55468", "GO_HTTP_PORT": "58068", "ENVOY_GRPC_PORT": "55068",
    "ENVOY_ADMIN_PORT": "59068", "PROMETHEUS_PORT": "59069", "GRAFANA_PORT": "53068",
}.items():
    ENV[key] = os.environ.get("H68_" + key, port)
for key in ("POSTGRES_PASSWORD", "MATCH_DB_PASSWORD", "PLAYER_DB_PASSWORD", "MONITOR_DB_PASSWORD", "GRAFANA_ADMIN_PASSWORD"):
    if not ENV.get(key):
        ENV[key] = secrets.token_hex(24)
DC = ["docker", "compose", "-p", PROJECT, "-f", "compose.yml", "-f", "scripts/validation/compose.validation.yml"]
PROM = f"http://127.0.0.1:{ENV['PROMETHEUS_PORT']}"
RUST = ("player-profile-rust-1", "player-profile-rust-2")
EXPECTED = {
    ("match-service-go", "match-service-go:8080"),
    ("player-profile-rust", "player-profile-rust-1:9100"),
    ("player-profile-rust", "player-profile-rust-2:9100"),
    ("envoy", "envoy:9901"),
    ("postgres", "postgres-exporter:9187"),
}
ALERTS = {
    "CompunubeTargetDown", "CompunubePostgreSQLDown",
    "CompunubeBothRustDown", "CompunubePlayerProfileCircuitOpen",
}
checks = 0


def run(*args, timeout=300):
    process = subprocess.run(args, cwd=ROOT, env=ENV, text=True, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, timeout=timeout, check=False)
    if process.returncode:
        detail = (process.stderr or process.stdout).strip()
        raise RuntimeError(f"{' '.join(args[:4])} failed ({process.returncode}): {detail[-1000:]}")
    return process.stdout.strip()


def dc(*args, timeout=300):
    return run(*DC, *args, timeout=timeout)


def check(value, label):
    global checks
    if not value:
        raise AssertionError(label)
    checks += 1
    print(f"PASS {label}", flush=True)


def wait_for(label, seconds, predicate):
    start = time.monotonic()
    while time.monotonic() - start < seconds:
        try:
            if predicate():
                print(f"  {label}: {time.monotonic() - start:.1f}s", flush=True)
                return
        except (RuntimeError, OSError, ValueError, KeyError):
            pass
        time.sleep(0.5)
    raise AssertionError(f"timeout after {seconds}s: {label}")


def api(path, params=None):
    url = PROM + path
    if params:
        url += "?" + urlencode(params)
    with urlopen(url, timeout=5) as response:
        result = json.load(response)
    if result.get("status") != "success":
        raise RuntimeError(f"Prometheus API failed: {path}")
    return result["data"]


def targets():
    result = {}
    for target in api("/api/v1/targets")["activeTargets"]:
        labels = target["labels"]
        key = (labels.get("job"), labels.get("instance"))
        if key in EXPECTED:
            result[key] = target["health"]
    return result


def vector(expression):
    data = api("/api/v1/query", {"query": expression})
    if data["resultType"] != "vector":
        raise AssertionError(f"unexpected Prometheus result type for {expression}")
    return data["result"]


def scalar(expression):
    rows = vector(expression)
    if len(rows) != 1:
        raise AssertionError(f"expected one series for {expression}, got {len(rows)}")
    return float(rows[0]["value"][1])


def rust_health():
    return {row["metric"]["instance_id"]: float(row["value"][1])
            for row in vector('player_profile_health_serving{job="player-profile-rust"}')}


def alert_names():
    return {rule["name"] for group in api("/api/v1/rules", {"type": "alert"})["groups"]
            for rule in group["rules"]}


def alert_firing(name):
    return any(rule["name"] == name and rule["state"] == "firing"
               for group in api("/api/v1/rules", {"type": "alert"})["groups"]
               for rule in group["rules"])


def main():
    started = time.monotonic()
    run("docker", "compose", "version", timeout=10)
    dc("down", "-v", "--remove-orphans", timeout=90)
    print(f"H68 isolated project: {PROJECT}", flush=True)
    if ENV.get("H68_SKIP_BUILD") != "1":
        dc("build", "player-profile-rust-1", "match-service-go", timeout=900)
    dc("up", "-d", "--no-build", "--wait", "--wait-timeout", "300", timeout=360)
    wait_for("five expected Prometheus targets UP", 90,
             lambda: targets() == {key: "up" for key in EXPECTED})
    check(targets() == {key: "up" for key in EXPECTED}, "Go, both Rust, Envoy and exporter targets UP")
    check({row["metric"]["instance_id"] for row in
           vector('player_profile_up{job="player-profile-rust"}')} == {"rust-1", "rust-2"},
          "Rust replicas retain distinct instance_id labels")
    for expression, label in [
        ("compunube_match_rooms_active", "Go active rooms"),
        ("compunube_match_connections_active", "Go active connections"),
        ('compunube_player_profile_circuit_state{state="closed"}', "Go circuit state"),
        ('player_profile_rpc_duration_seconds_count{job="player-profile-rust"}', "Rust RPC latency"),
        ('player_profile_health_serving{job="player-profile-rust"}', "Rust readiness"),
        ('count({__name__=~"envoy_cluster_.*membership_healthy"})', "Envoy healthy hosts metric"),
        ('pg_up{job="postgres"}', "PostgreSQL exporter health"),
    ]:
        check(bool(vector(expression)), f"PromQL: {label}")
    check(scalar('pg_up{job="postgres"}') == 1, "PostgreSQL initially reachable")
    check(ALERTS <= alert_names(), "four versioned alert rules loaded by Prometheus")

    rust1 = dc("ps", "-q", RUST[0])
    run("docker", "update", "--restart=no", rust1, timeout=15)
    run("docker", "kill", rust1, timeout=15)
    wait_for("rust-1 target DOWN; rust-2 UP", 60,
             lambda: targets().get(("player-profile-rust", "player-profile-rust-1:9100")) == "down"
             and targets().get(("player-profile-rust", "player-profile-rust-2:9100")) == "up")
    check(rust_health().get("rust-2") == 1, "rust-2 remains SERVING during rust-1 outage")
    dc("start", RUST[0], timeout=60)
    wait_for("rust-1 target returns UP", 90,
             lambda: targets().get(("player-profile-rust", "player-profile-rust-1:9100")) == "up"
             and rust_health().get("rust-1") == 1)

    dc("stop", "postgres", timeout=60)
    wait_for("pg_up becomes zero while exporter target stays UP", 90,
             lambda: scalar('pg_up{job="postgres"}') == 0
             and targets().get(("postgres", "postgres-exporter:9187")) == "up")
    wait_for("both Rust readiness metrics become zero", 90,
             lambda: rust_health() == {"rust-1": 0, "rust-2": 0})
    check(targets().get(("match-service-go", "match-service-go:8080")) == "up",
          "Go metrics remain scrapeable while PostgreSQL is down")
    wait_for("PostgreSQL down alert fires after its 30s window", 75,
             lambda: alert_firing("CompunubePostgreSQLDown"))
    dc("start", "postgres", timeout=60)
    wait_for("pg_up returns to one", 90, lambda: scalar('pg_up{job="postgres"}') == 1)
    wait_for("both Rust readiness metrics recover", 90,
             lambda: rust_health() == {"rust-1": 1, "rust-2": 1})
    wait_for("PostgreSQL alert resolves", 30,
             lambda: not alert_firing("CompunubePostgreSQLDown"))
    check(targets() == {key: "up" for key in EXPECTED}, "all five targets UP after recovery")
    print(f"elapsed: {time.monotonic() - started:.1f}s; checks: {checks}", flush=True)


if __name__ == "__main__":
    result = 1
    try:
        main()
        result = 0
    except (AssertionError, RuntimeError, OSError, subprocess.TimeoutExpired, ValueError) as error:
        print(f"FAIL {error}", file=sys.stderr, flush=True)
    finally:
        try:
            dc("down", "-v", "--remove-orphans", timeout=90)
            print(f"teardown: {PROJECT} containers, network and volumes removed", flush=True)
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
            print(f"FAIL teardown: {error}", file=sys.stderr, flush=True)
            result = 1
        print("RESULT: PASS" if result == 0 else "RESULT: FAIL", flush=True)
    sys.exit(result)
