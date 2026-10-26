#!/usr/bin/env python3
"""H69: provisioned Grafana and live operational signals in isolated Compose."""

import base64
import importlib.util
import json
import os
from pathlib import Path
import secrets
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
os.environ["H68_PROJECT"] = os.environ.get("H69_PROJECT", "compunube-h69")
for key, value in {
    "POSTGRES_PORT": "55469", "GO_HTTP_PORT": "58069", "ENVOY_GRPC_PORT": "55069",
    "ENVOY_ADMIN_PORT": "59070", "PROMETHEUS_PORT": "59071", "GRAFANA_PORT": "53069",
}.items():
    os.environ["H68_" + key] = os.environ.get("H69_" + key, value)
os.environ["GRAFANA_ADMIN_PASSWORD"] = secrets.token_hex(24)
os.environ["GRAFANA_ADMIN_USER"] = "admin"
spec = importlib.util.spec_from_file_location("h68", ROOT / "scripts/validation/h68-prometheus.py")
h68 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h68)
GRAFANA = "http://127.0.0.1:" + h68.ENV["GRAFANA_PORT"]
GO = "http://127.0.0.1:" + h68.ENV["GO_HTTP_PORT"]
AUTH = "Basic " + base64.b64encode(
    ("admin:" + h68.ENV["GRAFANA_ADMIN_PASSWORD"]).encode()).decode()


def grafana(path):
    request = Request(GRAFANA + path, headers={"Authorization": AUTH})
    with urlopen(request, timeout=5) as response:
        return json.load(response)


def go(method, path, token=None, body=None):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = Request(GO + path, method=method, headers=headers,
                      data=json.dumps(body).encode() if body is not None else None)
    try:
        with urlopen(request, timeout=6) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


def rust_up():
    return h68.scalar('sum(up{job="player-profile-rust"})')


def main():
    started = time.monotonic()
    h68.run("docker", "compose", "version", timeout=10)
    h68.dc("down", "-v", "--remove-orphans", timeout=90)
    print(f"H69 isolated project: {h68.PROJECT}", flush=True)
    if os.environ.get("H69_SKIP_BUILD") != "1":
        h68.dc("build", "player-profile-rust-1", "match-service-go", timeout=900)
    h68.dc("up", "-d", "--no-build", "--wait", "--wait-timeout", "300", timeout=360)
    h68.wait_for("five Prometheus targets UP", 90,
                 lambda: h68.targets() == {key: "up" for key in h68.EXPECTED})
    h68.wait_for("Grafana datasource and dashboard provisioned", 60,
                 lambda: grafana("/api/datasources/uid/compunube-prometheus")["url"]
                 == "http://prometheus:9090" and
                 grafana("/api/dashboards/uid/compunube-operations")["dashboard"]["uid"]
                 == "compunube-operations")
    datasource = grafana("/api/datasources/uid/compunube-prometheus")
    board = grafana("/api/dashboards/uid/compunube-operations")
    panels = {panel["title"]: panel for panel in board["dashboard"]["panels"]}
    required = {
        "Target health", "PostgreSQL available", "Rust replicas unavailable",
        "Player/Profile unavailable", "Active rooms", "Active connections",
        "Admission and rejections", "Input drops", "Workpool queue depth",
        "Workpool rejections", "Circuit breaker state", "Settlement outcomes",
        "Rust RPC rate", "Rust RPC errors", "Rust RPC p95 latency", "Rust readiness",
        "Envoy healthy Rust hosts", "Envoy upstream 5xx", "PostgreSQL connections",
        "Prometheus operational alerts",
    }
    h68.check(datasource["isDefault"] and datasource["uid"] == "compunube-prometheus",
              "Prometheus datasource provisioned with stable UID")
    h68.check(board["meta"]["provisioned"] and required <= panels.keys(),
              "versioned operational dashboard and required panels provisioned")
    h68.check(all(panel["datasource"]["uid"] == datasource["uid"] for panel in panels.values()),
              "all dashboard panels use provisioned datasource")
    for panel in panels.values():
        for target in panel["targets"]:
            h68.vector(target["expr"])
    h68.check(True, "all provisioned panel PromQL expressions parse in live Prometheus")

    status, session = go("POST", "/v1/sessions")
    h68.check(status == 201, "public Go session created for dashboard traffic")
    token = session["token"]
    status, _ = go("POST", "/v1/rooms", token, {"mapId": "maracaibo"})
    h68.check(status == 201, "public Go room created")
    for _ in range(6):
        status, _ = go("GET", "/v1/profile", token)
        h68.check(status == 200, "public profile call reaches Rust through Envoy")
    h68.wait_for("room and Rust RPC series reflect public traffic", 45,
                 lambda: h68.scalar("compunube_match_rooms_active") >= 1 and
                 h68.scalar("sum(player_profile_rpc_requests_total)") >= 6)
    h68.check({row["metric"]["instance_id"] for row in
               h68.vector("player_profile_rpc_duration_seconds_count")} == {"rust-1", "rust-2"},
              "Rust panels can distinguish both instance_id values")

    rust1 = h68.dc("ps", "-q", "player-profile-rust-1")
    rust2 = h68.dc("ps", "-q", "player-profile-rust-2")
    for container in (rust1, rust2):
        h68.run("docker", "update", "--restart=no", container, timeout=15)
    h68.run("docker", "kill", rust1, timeout=15)
    h68.wait_for("one Rust down indicator", 60, lambda: rust_up() == 1)
    h68.check(h68.rust_health().get("rust-2") == 1,
              "rust-2 remains SERVING while one Rust target is down")
    h68.run("docker", "kill", rust2, timeout=15)
    h68.wait_for("both Rust down indicator", 60, lambda: rust_up() == 0)
    for _ in range(12):
        go("GET", "/v1/profile", token)
    h68.wait_for("Go Circuit Breaker opens", 20,
                 lambda: h68.scalar('max_over_time(compunube_player_profile_circuit_state{state="open"}[1m])') == 1)
    h68.check(True, "Go Circuit Breaker reflects Player/Profile outage")
    h68.wait_for("both Rust down alert firing", 75,
                 lambda: h68.alert_firing("CompunubeBothRustDown"))
    h68.dc("start", "player-profile-rust-1", "player-profile-rust-2", timeout=90)
    h68.wait_for("both Rust targets and health recover", 90,
                 lambda: rust_up() == 2 and h68.rust_health() == {"rust-1": 1, "rust-2": 1})

    h68.dc("stop", "postgres", timeout=60)
    h68.wait_for("PostgreSQL down indicator", 90,
                 lambda: h68.scalar('pg_up{job="postgres"}') == 0)
    h68.wait_for("PostgreSQL alert firing", 75,
                 lambda: h68.alert_firing("CompunubePostgreSQLDown"))
    h68.check(h68.targets().get(("match-service-go", "match-service-go:8080")) == "up",
              "Go operational dashboard remains scrapeable with PostgreSQL down")
    h68.dc("start", "postgres", timeout=60)
    h68.wait_for("PostgreSQL and Rust readiness recover", 90,
                 lambda: h68.scalar('pg_up{job="postgres"}') == 1 and
                 h68.rust_health() == {"rust-1": 1, "rust-2": 1})
    h68.wait_for("PostgreSQL alert resolves", 35,
                 lambda: not h68.alert_firing("CompunubePostgreSQLDown"))
    h68.check(h68.targets() == {key: "up" for key in h68.EXPECTED},
              "all monitored targets UP after restoration")
    print(f"elapsed: {time.monotonic() - started:.1f}s; checks: {h68.checks}", flush=True)


if __name__ == "__main__":
    result = 1
    try:
        main()
        result = 0
    except (AssertionError, RuntimeError, OSError, ValueError, KeyError) as error:
        print(f"FAIL {error}", file=sys.stderr, flush=True)
    finally:
        try:
            h68.dc("down", "-v", "--remove-orphans", timeout=90)
            print(f"teardown: {h68.PROJECT} containers, network and volumes removed", flush=True)
        except (RuntimeError, OSError) as error:
            print(f"FAIL teardown: {error}", file=sys.stderr, flush=True)
            result = 1
        print("RESULT: PASS" if result == 0 else "RESULT: FAIL", flush=True)
    sys.exit(result)
