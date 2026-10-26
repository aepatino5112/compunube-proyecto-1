#!/usr/bin/env python3
"""J83: public HTTP -> Go -> Envoy -> Rust -> PostgreSQL integration.

Uses an isolated Compose project and the F54 persisted-result fixture. No
direct gRPC or debug HTTP endpoint is used for profile/economy assertions.
Requires Docker Compose and Python 3. Run from any directory.
"""

import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[2]
PROJECT = os.environ.get("J83_PROJECT", "compunube-j83")
PORTS = {
    "POSTGRES_PORT": "55483",
    "GO_HTTP_PORT": "58083",
    "ENVOY_GRPC_PORT": "55083",
    "ENVOY_ADMIN_PORT": "59083",
    "PROMETHEUS_PORT": "59084",
    "GRAFANA_PORT": "53083",
}
ENV = os.environ.copy()
for key, value in PORTS.items():
    ENV.setdefault(key, value)
for key in ("POSTGRES_PASSWORD", "MATCH_DB_PASSWORD", "PLAYER_DB_PASSWORD", "MONITOR_DB_PASSWORD", "GRAFANA_ADMIN_PASSWORD"):
    if not ENV.get(key):
        ENV[key] = secrets.token_hex(24)
GO = f"http://127.0.0.1:{ENV['GO_HTTP_PORT']}"
ADMIN = f"http://127.0.0.1:{ENV['ENVOY_ADMIN_PORT']}"
DC = ["docker", "compose", "-p", PROJECT, "-f", "compose.yml", "-f", "scripts/validation/compose.validation.yml"]
CHECKS = 0


def run(*args, input_text=None, timeout=300, quiet=False):
    result = subprocess.run(
        list(args), cwd=ROOT, env=ENV, input=input_text, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False,
    )
    if result.returncode:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"{' '.join(args[:4])} failed ({result.returncode}): {detail[-1200:]}")
    if not quiet and result.stdout.strip():
        print(result.stdout.strip())
    return result.stdout.strip()


def dc(*args, **kwargs):
    return run(*DC, *args, **kwargs)


def check(condition, label):
    global CHECKS
    if not condition:
        raise AssertionError(label)
    CHECKS += 1
    print(f"PASS {label}", flush=True)


def wait_for(label, seconds, predicate):
    start = time.monotonic()
    last_error = None
    while time.monotonic() - start < seconds:
        try:
            if predicate():
                print(f"  {label}: {time.monotonic() - start:.1f}s", flush=True)
                return
        except (RuntimeError, URLError, ValueError) as exc:
            last_error = exc
        time.sleep(0.5)
    raise AssertionError(f"timeout after {seconds}s waiting for {label}: {last_error}")


def http(method, path, token=None, body=None):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = Request(GO + path, data=data, method=method, headers=headers)
    try:
        with urlopen(req, timeout=5) as response:
            raw = response.read()
            return response.status, json.loads(raw) if "application/json" in response.headers.get("Content-Type", "") else raw.decode()
    except HTTPError as error:
        return error.code, json.load(error)


def admin_hosts():
    with urlopen(ADMIN + "/clusters", timeout=3) as response:
        data = response.read().decode()
    return len(re.findall(r"player_profile_cluster::.*::health_flags::healthy", data))


def sql(statement):
    return dc(
        "exec", "-T", "postgres", "sh", "-c",
        'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -At -v ON_ERROR_STOP=1',
        input_text=statement, quiet=True, timeout=15,
    )


def db_profile(player):
    return tuple(int(v) for v in sql(
        f"SELECT coins,plastic,metal,profile_revision FROM player.profiles WHERE player_id='{player}';"
    ).split("|"))


def public_profile(token):
    status, profile = http("GET", "/v1/profile", token)
    check(status == 200, "GET /v1/profile returns 200")
    return profile


def mutate(method, path, token, request_id, **payload):
    body = {"requestId": request_id, "catalogVersion": "online-v1", **payload}
    status, result = http(method, path, token, body)
    check(status == 200 and result.get("requestId") == request_id and result.get("replayed") is False,
          f"{path} applied through public Go HTTP")
    check(result["profile"] == public_profile(token), f"{path} matches subsequent GetProfile")
    profile = result["profile"]
    check(db_profile(profile["playerId"]) == tuple(profile[k] for k in ("coins", "plastic", "metal", "profileRevision")),
          f"{path} persisted in player.profiles")
    return body, result


def main():
    started = time.monotonic()
    run("docker", "compose", "version", quiet=True, timeout=10)
    # An interrupted prior run is removed before startup; cleanup repeats on exit.
    dc("down", "-v", "--remove-orphans", quiet=True, timeout=60)
    print(f"J83 isolated project: {PROJECT}", flush=True)
    if ENV.get("J83_SKIP_BUILD") != "1":
        dc("build", "player-profile-rust-1", "match-service-go", quiet=True, timeout=900)
    dc("up", "-d", "--no-build", "--wait", "--wait-timeout", "120", "postgres", quiet=True, timeout=180)
    dc("up", "-d", "--no-build", "--wait", "--wait-timeout", "180",
       "player-profile-rust-1", "player-profile-rust-2", "envoy", "match-service-go",
       quiet=True, timeout=240)
    wait_for("Envoy sees two Rust replicas", 90, lambda: admin_hosts() == 2)
    check("PLAYER_PROFILE_GRPC_ADDR=envoy:50051" in dc("exec", "-T", "match-service-go", "env", quiet=True),
          "Go points only to Envoy")

    status, session = http("POST", "/v1/sessions")
    check(status == 201 and bool(session.get("playerId")) and bool(session.get("token")),
          "POST /v1/sessions creates a bearer session")
    player, token = session["playerId"], session["token"]
    correlation_id = "h67-" + uuid4().hex
    correlated = Request(
        GO + "/v1/profile", method="GET",
        headers={"Authorization": f"Bearer {token}", "X-Request-ID": correlation_id},
    )
    with urlopen(correlated, timeout=5) as response:
        check(response.status == 200 and response.headers.get("X-Request-ID") == correlation_id,
              "Go preserves safe X-Request-ID on public profile response")
        response.read()
    def rust_correlated():
        logs = dc("logs", "--no-color", "--tail", "100",
                  "player-profile-rust-1", "player-profile-rust-2", quiet=True)
        return f'"correlation_id":"{correlation_id}"' in logs
    wait_for("Rust rpc completed log carries public correlation ID", 15, rust_correlated)
    check(rust_correlated(), "Go -> Envoy -> Rust correlation metadata reaches structured RPC log")
    go_logs = dc("logs", "--no-color", "--tail", "100", "match-service-go", quiet=True)
    check(f'"correlation_id":"{correlation_id}"' in go_logs and token not in go_logs,
          "Go HTTP log carries correlation ID without bearer token")
    # identity.randomID uses unpadded base64url, whose alphabet includes '_'.
    check(bool(re.fullmatch(r"[A-Za-z0-9_-]{1,128}", player)), "server-issued playerId is SQL fixture safe")
    profile = public_profile(token)
    check(profile["playerId"] == player and db_profile(player) == (0, 0, 0, 1),
          "Rust provisioned the session player in player.profiles")
    status, catalog = http("GET", "/v1/catalog", token)
    check(status == 200 and catalog.get("catalogVersion") == "online-v1", "GET /v1/catalog returns online-v1")
    items = {item["itemId"]: item for item in catalog["items"]}
    check(items["manglar"]["priceCoins"] == 60 and items["red-reuso"]["recipePlastic"] == 6,
          "published catalog contains the expected economy items")

    # Same shape as matchstore.Postgres.Save, as in F54. From this point the
    # normal Go coordinator and Rust SettleRace own the delivery and credit.
    race = "j83-" + uuid4().hex
    room = "j83-room-" + uuid4().hex
    settlement_started = time.monotonic()
    sql(f"""
INSERT INTO match.rooms(room_id,map_id) VALUES('{room}','maracaibo');
INSERT INTO match.races(race_id,room_id,rules_version,course_version,started_at,ended_at)
VALUES('{race}','{room}','rules-j83','course-j83',now()-interval '2 minutes',now()-interval '1 minute');
INSERT INTO match.race_participants(race_id,player_id,outcome,rank,finish_time_ms,collected_plastic,collected_metal,credited_plastic,credited_metal,reduce_choice)
VALUES('{race}','{player}','finished',1,61000,30,12,30,12,'reusable');
INSERT INTO match.settlement_delivery(race_id,player_id,state) VALUES('{race}','{player}','pending');
""")
    wait_for("Go confirmed the fixture via SettleRace", 90,
             lambda: sql(f"SELECT state FROM match.settlement_delivery WHERE race_id='{race}' AND player_id='{player}';") == "confirmed")
    print(f"settlement confirmation: {time.monotonic() - settlement_started:.1f}s", flush=True)
    check(db_profile(player) == (0, 30, 12, 2), "Rust credited exactly 30 plastic and 12 metal")
    check(sql(f"SELECT count(*) FROM player.settlements WHERE race_id='{race}' AND player_id='{player}';") == "1",
          "one durable player.settlements row")
    check(tuple(public_profile(token)[k] for k in ("coins", "plastic", "metal")) == (0, 30, 12),
          "Go HTTP sees the settlement credit")

    exchange_body, exchange_result = mutate("POST", "/v1/profile/exchanges", token, "j83-exchange",
                                            material="plastic", amount=15)
    check(tuple(exchange_result["profile"][k] for k in ("coins", "plastic", "metal")) == (60, 15, 12),
          "exchange used online-v1 rate once")
    status, replay = http("POST", "/v1/profile/exchanges", token, exchange_body)
    check(status == 200 and replay["replayed"] is True and replay["profile"] == exchange_result["profile"],
          "same requestId and payload replays without a second effect")
    check(db_profile(player) == (60, 15, 12, 3), "replay preserved balance and revision")
    status, conflict = http("POST", "/v1/profile/exchanges", token, {**exchange_body, "amount": 14})
    check(status == 409 and conflict.get("code") == "IDEMPOTENCY_CONFLICT",
          "same requestId with a different payload returns HTTP 409")
    check(db_profile(player) == (60, 15, 12, 3), "conflict preserved balance and revision")
    check(sql(f"SELECT count(*) FROM player.economic_operations WHERE player_id='{player}' AND request_id='j83-exchange';") == "1",
          "one durable operation for replay and conflict")

    _, bought = mutate("POST", "/v1/profile/purchases", token, "j83-purchase", itemId="manglar")
    check("manglar" in bought["profile"]["ownedItemIds"] and bought["profile"]["coins"] == 0,
          "purchase acquired manglar and spent 60 coins")
    _, crafted = mutate("POST", "/v1/profile/crafts", token, "j83-craft", itemId="red-reuso")
    check("red-reuso" in crafted["profile"]["ownedItemIds"] and
          (crafted["profile"]["plastic"], crafted["profile"]["metal"]) == (9, 9),
          "craft acquired red-reuso and spent its materials")
    _, equipped = mutate("POST", "/v1/profile/equipment", token, "j83-equip", itemId="manglar")
    check(equipped["profile"]["equipment"]["boardId"] == "manglar", "equipment updated board slot")
    _, appeared = mutate("PUT", "/v1/profile/appearance", token, "j83-appearance",
                         skinId="deep", hairColorId="black")
    check(appeared["profile"]["appearance"] == {"skinId": "deep", "hairColorId": "black"},
          "appearance persisted")

    rejection_body = {"requestId": "j83-insufficient", "catalogVersion": "online-v1", "itemId": "sol"}
    status, rejected = http("POST", "/v1/profile/purchases", token, rejection_body)
    check(status == 422 and rejected.get("code") == "INSUFFICIENT_COINS",
          "business rejection crosses Rust, Envoy and Go as HTTP 422")
    final_profile = public_profile(token)
    check(final_profile == appeared["profile"], "business rejection did not mutate profile")
    check(sql(f"SELECT count(*) FROM player.economic_operations WHERE player_id='{player}' AND status='applied';") == "5",
          "five applied mutations persisted in player.economic_operations")
    check(sql(f"SELECT count(*) FROM player.economic_operations WHERE player_id='{player}' AND status='rejected';") == "1",
          "business rejection persisted in player.economic_operations")
    check(sql(f"SELECT count(*) FROM match.races WHERE race_id='{race}';") == "1" and
          sql(f"SELECT state FROM match.settlement_delivery WHERE race_id='{race}';") == "confirmed",
          "match fixture remains a single confirmed delivery after economy traffic")

    dc("stop", "player-profile-rust-1", "player-profile-rust-2", quiet=True, timeout=60)
    outage_started = time.monotonic()
    wait_for("Envoy excludes both Rust replicas", 60, lambda: admin_hosts() == 0)
    for path in ("/v1/profile", "/v1/catalog"):
        status, unavailable = http("GET", path, token)
        check(status == 503 and unavailable.get("code") == "PROFILE_UNAVAILABLE",
              f"{path} reports PROFILE_UNAVAILABLE")
    print(f"Rust outage detection: {time.monotonic() - outage_started:.1f}s", flush=True)
    for path in ("/healthz", "/readyz"):
        status, _ = http("GET", path)
        check(status == 200, f"Go {path} stays healthy without Rust")
    print(f"elapsed: {time.monotonic() - started:.1f}s; checks: {CHECKS}", flush=True)


if __name__ == "__main__":
    outcome = 1
    try:
        main()
        outcome = 0
    except (AssertionError, RuntimeError, OSError, subprocess.TimeoutExpired, ValueError, KeyError) as exc:
        print(f"FAIL {exc}", file=sys.stderr, flush=True)
    finally:
        try:
            dc("down", "-v", "--remove-orphans", quiet=True, timeout=90)
            print(f"teardown: {PROJECT} containers, network and volumes removed", flush=True)
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
            print(f"FAIL teardown: {exc}", file=sys.stderr, flush=True)
            outcome = 1
        print("RESULT: PASS" if outcome == 0 else "RESULT: FAIL", flush=True)
    sys.exit(outcome)
