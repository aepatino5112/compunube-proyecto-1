#!/usr/bin/env python3
"""G58: the Python client plays a real race against Go in an isolated Compose stack.

Two Python clients use only Go's public HTTP (E45) and WebSocket (E43): session,
profile, create/join, ready, autopilot inputs, snapshots, result, settlement and
the updated profile. The CLI then exchanges materials twice with the same
requestId to show the replay. Requires Docker Compose and the pinned packages in
apps/client-secondary/requirements.txt.
"""

import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
CLIENT = ROOT / "apps/client-secondary"
sys.path.insert(0, str(CLIENT))
os.environ["H68_PROJECT"] = os.environ.get("G58_PROJECT", "compunube-g58")
for key, value in {
    "POSTGRES_PORT": "55458", "GO_HTTP_PORT": "58058", "ENVOY_GRPC_PORT": "55058",
    "ENVOY_ADMIN_PORT": "59058", "PROMETHEUS_PORT": "59059", "GRAFANA_PORT": "53058",
}.items():
    os.environ["H68_" + key] = os.environ.get("G58_" + key, value)
spec = importlib.util.spec_from_file_location("h68", ROOT / "scripts/validation/h68-prometheus.py")
h68 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h68)

from compunube_client.api import ApiError, GoApi  # noqa: E402
from compunube_client.game import GameSession  # noqa: E402
from compunube_client.realtime import RealtimeConnection, RealtimeError  # noqa: E402

GO = "http://127.0.0.1:" + h68.ENV["GO_HTTP_PORT"]
TERMINAL = {"finished", "disqualified", "left", "dnf"}


def timed(label, function, timings):
    start = time.perf_counter()
    value = function()
    timings.setdefault(label, []).append((time.perf_counter() - start) * 1000)
    return value


def play(game, reduce_choice, outcome, errors):
    try:
        game.wait_for(lambda m: m is not None and m["type"] == "room.state"
                      and len(m["room"]["members"]) == 2, 20)
        game.ready(reduce_choice)
        outcome["result"] = game.race(timeout=150)
        outcome["final"] = game.view.snapshot
        outcome["settlement"] = game.wait_settlement(60)
    except Exception as error:  # reported by the main thread
        errors.append(f"{reduce_choice}: {type(error).__name__} {error}")


def cli(token_file, *args):
    process = subprocess.run(
        [sys.executable, "-m", "compunube_client", "--server", GO, "--token-file", str(token_file), *args],
        cwd=CLIENT, text=True, capture_output=True, timeout=60, check=False)
    return process.returncode, process.stdout + process.stderr


def main():
    started = time.monotonic()
    h68.run("docker", "compose", "version", timeout=10)
    h68.dc("down", "-v", "--remove-orphans", timeout=90)
    print(f"G58 isolated project: {h68.PROJECT}", flush=True)
    if os.environ.get("G58_SKIP_BUILD") != "1":
        h68.dc("build", "player-profile-rust-1", "match-service-go", timeout=900)
    h68.dc("up", "-d", "--no-build", "--wait", "--wait-timeout", "300", timeout=360)
    h68.wait_for("both Rust replicas SERVING", 90,
                 lambda: h68.rust_health() == {"rust-1": 1, "rust-2": 1})

    timings = {}
    host, guest = GoApi(GO), GoApi(GO)
    for api in (host, guest):
        timed("POST /v1/sessions", api.create_session, timings)
    h68.check(host.current_session()["playerId"] != guest.current_session()["playerId"],
              "two independent Go-issued sessions")
    before = {}
    for api in (host, guest):
        profile = h68_wait_profile(api, timings)
        before[profile["playerId"]] = profile
    catalog = timed("GET /v1/catalog", host.catalog, timings)
    h68.check(len(catalog["items"]) == 22, "catalog served through Go -> Envoy -> Rust")

    for token, expected in ((None, "SESSION_REQUIRED"), ("forged-token", "SESSION_REQUIRED")):
        try:
            RealtimeConnection(host.realtime_url, token).open()
            raise AssertionError("handshake without a valid session was accepted")
        except RealtimeError as error:
            h68.check(error.code == expected, f"WebSocket rejects {'missing' if token is None else 'forged'} session")
    try:
        RealtimeConnection(host.realtime_url, host.token, subprotocol="compunube.realtime.v2").open()
        raise AssertionError("unsupported subprotocol accepted")
    except RealtimeError as error:
        h68.check(error.code == "INCOMPATIBLE_VERSION", "WebSocket rejects an unsupported subprotocol")

    games = [GameSession(api, log=lambda line: print("  client:", line, flush=True)) for api in (host, guest)]
    room_id = timed("POST /v1/rooms", lambda: games[0].create("maracaibo"), timings)
    timed("POST /v1/rooms/{id}/memberships", lambda: games[1].join(room_id), timings)
    for game in games:
        game.connect()
    outcomes, errors, threads = [{}, {}], [], []
    for game, choice, outcome in zip(games, ("reusable", "disposable"), outcomes):
        threads.append(threading.Thread(target=play, args=(game, choice, outcome, errors)))
        threads[-1].start()
    for thread in threads:
        thread.join(240)
    h68.check(not errors and all("result" in o for o in outcomes), f"both Python clients completed the race {errors}")

    result = outcomes[0]["result"]
    ids = {game.view.self_player_id for game in games}
    participants = {p["playerId"]: p for p in result["participants"]}
    h68.check(set(participants) == ids and result["roomId"] == room_id,
              "race.ended lists exactly the two sessions of this room")
    h68.check(outcomes[1]["result"]["raceId"] == result["raceId"], "both clients received the same authoritative result")
    finished = [p for p in participants.values() if p["outcome"] == "finished"]
    for p in sorted(participants.values(), key=lambda p: (p["rank"] is None, p["rank"] or 0)):
        seconds = f"{p['finishTimeMs'] / 1000:.1f}s" if p["finishTimeMs"] is not None else "-"
        print(f"  result {p['playerId'][:8]}: {p['outcome']} rank={p['rank']} time={seconds} "
              f"collected={p['collected']} credited={p['credited']} reduce={p['reduceChoice']}", flush=True)
    for p in participants.values():
        h68.check(p["outcome"] in TERMINAL, f"terminal outcome {p['outcome']}")
        if p["outcome"] == "finished":
            h68.check(isinstance(p["rank"], int) and p["credited"] == p["collected"],
                      "finished participant ranked and credited what it collected")
        else:
            h68.check(p["rank"] is None and p["credited"] == {"plastic": 0, "metal": 0},
                      "non-finished participant has no rank and no credit")
    h68.check(len(finished) >= 1, "at least one Python client finished the course")

    final = outcomes[0]["final"]
    owners = {}
    for item in final["trash"]:
        if item["collectedBy"] is not None:
            owners[item["collectedBy"]] = owners.get(item["collectedBy"], 0) + 1
    h68.check(len(final["trash"]) == 103 and len({i["itemId"] for i in final["trash"]}) == 103,
              "final snapshot lists each of the 103 pickups once")
    for player in final["players"]:
        counted = player["collectedPlastic"] + player["collectedMetal"]
        collected = participants[player["playerId"]]["collected"]
        h68.check(owners.get(player["playerId"], 0) == counted <= collected["plastic"] + collected["metal"],
                  "each pickup has a single owner matching that participant's counters")

    h68.check(all(o["settlement"] == "confirmed" for o in outcomes),
              "Go republished race.ended with settlementState=confirmed")
    for api in (host, guest):
        after = api.profile()
        start, credit = before[after["playerId"]], participants[after["playerId"]]["credited"]
        h68.check(after["plastic"] == start["plastic"] + credit["plastic"]
                  and after["metal"] == start["metal"] + credit["metal"],
                  "Rust profile shows exactly the credited materials once")
    for game in games:
        game.leave()
        game.close()

    rich = max((host, guest), key=lambda api: api.profile()["plastic"])
    if rich.profile()["plastic"] >= 1:
        with tempfile.TemporaryDirectory() as directory:
            token_file = Path(directory) / "token"
            token_file.write_text(rich.token)
            token_file.chmod(0o600)
            coins = rich.profile()["coins"]
            request_id = "g58-cli-" + h68.secrets.token_hex(8)
            first = cli(token_file, "exchange", "plastic", "1", "--request-id", request_id)
            second = cli(token_file, "exchange", "plastic", "1", "--request-id", request_id)
            h68.check(first[0] == 0 and "Operación confirmada" in first[1], "CLI exchange confirmed by Go")
            h68.check(second[0] == 0 and "replay" in second[1], "CLI retry with the same requestId is a replay")
            h68.check(rich.profile()["coins"] == coins + 4, "replayed exchange credited coins only once")
            code, output = cli(token_file, "buy", "sol")
            h68.check(code == 1 and "INSUFFICIENT_COINS" in output, "CLI surfaces the E45 business error")
    else:
        print("SKIP CLI exchange replay: no participant collected plastic (not counted as PASS)", flush=True)

    for label, values in timings.items():
        print(f"latency {label}: n={len(values)} max={max(values):.1f}ms", flush=True)
    print(f"elapsed: {time.monotonic() - started:.1f}s; checks: {h68.checks}", flush=True)


def h68_wait_profile(api, timings):
    deadline = time.monotonic() + 30
    while True:
        try:
            return timed("GET /v1/profile", api.profile, timings)
        except ApiError as error:
            if error.code != "PROFILE_UNAVAILABLE" or time.monotonic() > deadline:
                raise
            time.sleep(1)


if __name__ == "__main__":
    result = 1
    try:
        main()
        result = 0
    except (AssertionError, RuntimeError, OSError, ValueError, KeyError, ApiError, RealtimeError,
            TimeoutError) as error:
        print(f"FAIL {type(error).__name__}: {error}", file=sys.stderr, flush=True)
    finally:
        try:
            h68.dc("down", "-v", "--remove-orphans", timeout=90)
            print(f"teardown: {h68.PROJECT} containers, network and volumes removed", flush=True)
        except (RuntimeError, OSError) as error:
            print(f"FAIL teardown: {error}", file=sys.stderr, flush=True)
            result = 1
        print("RESULT: PASS" if result == 0 else "RESULT: FAIL", flush=True)
    sys.exit(result)
