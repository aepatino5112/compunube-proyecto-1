#!/usr/bin/env python3
"""I72: end-to-end races with concurrent rooms of four real clients.

Profile -> room -> ready -> race -> result -> settlement -> updated profile,
with I72_ROOMS rooms (default 3) of four Python clients racing at the same time
through Go's public HTTP/WebSocket only. One client per first room leaves
mid-race. Verifies unique pickup ownership, credits only for finished players,
durable rows in match.* and player.*, and records snapshot cadence, HTTP latency,
errors and container resources. Numbers are measurements of this run, not targets.
"""

import importlib.util
import os
from pathlib import Path
import statistics
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps/client-secondary"))
os.environ["H68_PROJECT"] = os.environ.get("I72_PROJECT", "compunube-i72")
for key, value in {
    "POSTGRES_PORT": "55472", "GO_HTTP_PORT": "58072", "ENVOY_GRPC_PORT": "55072",
    "ENVOY_ADMIN_PORT": "59072", "PROMETHEUS_PORT": "59073", "GRAFANA_PORT": "53072",
}.items():
    os.environ["H68_" + key] = os.environ.get("I72_" + key, value)
spec = importlib.util.spec_from_file_location("h68", ROOT / "scripts/validation/h68-prometheus.py")
h68 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h68)

from compunube_client.api import ApiError, GoApi  # noqa: E402
from compunube_client.game import GameSession  # noqa: E402
from compunube_client.realtime import RealtimeError  # noqa: E402

GO = "http://127.0.0.1:" + h68.ENV["GO_HTTP_PORT"]
ROOMS = int(os.environ.get("I72_ROOMS", "3"))
PLAYERS = 4
TERMINAL = {"finished", "disqualified", "left", "dnf"}


class MeasuredSession(GameSession):
    """Records arrival times of authoritative snapshots and every error frame."""

    def __init__(self, api):
        super().__init__(api, log=lambda _: None)
        self.snapshot_times = []
        self.error_codes = []

    def receive(self, timeout):
        message = super().receive(timeout)
        if message and message["type"] == "race.snapshot":
            self.snapshot_times.append(time.monotonic())
        elif message and message["type"] == "error":
            self.error_codes.append(message["error"]["code"])
        return message


def percentile(values, q):
    values = sorted(values)
    return values[min(len(values) - 1, int(round(q * (len(values) - 1))))] if values else float("nan")


def psql(sql):
    return h68.dc("exec", "-T", "postgres", "psql", "-U", h68.ENV.get("POSTGRES_USER", "compunube"),
                  "-d", h68.ENV.get("POSTGRES_DB", "compunube"), "-X", "-At", "-c", sql, timeout=30)


def sample_resources(stop, samples):
    while not stop.is_set():
        try:
            out = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"],
                                 capture_output=True, text=True, timeout=30).stdout
            for line in out.splitlines():
                name, cpu, mem = line.split("\t")
                if name.startswith(h68.PROJECT):
                    samples.setdefault(name[len(h68.PROJECT) + 1:], []).append(
                        (float(cpu.rstrip("%") or 0), mem.split(" / ")[0]))
        except (OSError, ValueError, subprocess.TimeoutExpired):
            pass
        stop.wait(3)


def play(game, choice, leave_after, outcome, errors):
    try:
        game.wait_for(lambda m: m is not None and m["type"] == "room.state"
                      and len(m["room"]["members"]) == PLAYERS, 30)
        game.ready(choice)
        if leave_after is not None:
            # After room.leave Go detaches this client; the room's result comes from the others.
            try:
                outcome["result"] = game.race(timeout=120, leave_after=leave_after)
            except (TimeoutError, RealtimeError):
                outcome["result"] = None
            return
        outcome["result"] = game.race(timeout=300, leave_after=leave_after)
        outcome["final"] = game.view.snapshot
        outcome["course_trash"] = len(game.view.start["course"]["trash"])
        outcome["settlement"] = game.wait_settlement(90)
    except Exception as error:  # reported by the main thread
        errors.append(f"{type(error).__name__}: {error}")


def main():
    started = time.monotonic()
    h68.run("docker", "compose", "version", timeout=10)
    h68.dc("down", "-v", "--remove-orphans", timeout=90)
    print(f"I72 isolated project: {h68.PROJECT}; rooms={ROOMS} players/room={PLAYERS}", flush=True)
    if os.environ.get("I72_SKIP_BUILD") != "1":
        h68.dc("build", "player-profile-rust-1", "match-service-go", timeout=900)
    h68.dc("up", "-d", "--no-build", "--wait", "--wait-timeout", "300", timeout=360)
    h68.wait_for("both Rust replicas SERVING", 90, lambda: h68.rust_health() == {"rust-1": 1, "rust-2": 1})

    http_ms = []
    rooms = []
    for index in range(ROOMS):
        apis = [GoApi(GO) for _ in range(PLAYERS)]
        before = {}
        for api in apis:
            api.create_session()
            t = time.perf_counter()
            for attempt in range(30):
                try:
                    profile = api.profile()
                    break
                except ApiError as error:
                    if error.code != "PROFILE_UNAVAILABLE" or attempt == 29:
                        raise
                    time.sleep(1)
            http_ms.append((time.perf_counter() - t) * 1000)
            before[profile["playerId"]] = profile
        games = [MeasuredSession(api) for api in apis]
        room_id = games[0].create("orinoco" if index % 2 else "maracaibo")
        for game in games[1:]:
            game.join(room_id)
        for game in games:
            game.connect()
        rooms.append({"id": room_id, "games": games, "before": before, "outcomes": [{} for _ in games]})
    h68.check(len({r["id"] for r in rooms}) == ROOMS, f"{ROOMS} rooms of {PLAYERS} clients created")

    stop, samples = threading.Event(), {}
    sampler = threading.Thread(target=sample_resources, args=(stop, samples), daemon=True)
    sampler.start()
    threads, errors = [], []
    race_started = time.monotonic()
    for r_index, room in enumerate(rooms):
        for p_index, (game, outcome) in enumerate(zip(room["games"], room["outcomes"])):
            leave_after = 10.0 if (r_index == 0 and p_index == PLAYERS - 1) else None
            choice = "reusable" if p_index % 2 == 0 else "disposable"
            threads.append(threading.Thread(target=play, args=(game, choice, leave_after, outcome, errors)))
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(330)
    race_seconds = time.monotonic() - race_started
    stop.set()
    h68.check(not errors and all("result" in o for r in rooms for o in r["outcomes"]),
              f"all {ROOMS * PLAYERS} clients reached race.ended {errors[:3]}")

    leaver = rooms[0]["games"][PLAYERS - 1].view.self_player_id
    for r_index, room in enumerate(rooms):
        result = room["outcomes"][0]["result"]
        ids = {g.view.self_player_id for g in room["games"]}
        parts = {p["playerId"]: p for p in result["participants"]}
        h68.check(set(parts) == ids and len({o["result"]["raceId"] for o in room["outcomes"] if o["result"]}) == 1,
                  f"room {r_index}: all four clients share one authoritative result")
        for p in parts.values():
            h68.check(p["outcome"] in TERMINAL, f"room {r_index}: terminal outcome {p['outcome']}")
            if p["outcome"] == "finished":
                h68.check(isinstance(p["rank"], int) and p["credited"] == p["collected"],
                          f"room {r_index}: finished player ranked and credited its collection")
            else:
                h68.check(p["rank"] is None and p["credited"] == {"plastic": 0, "metal": 0},
                          f"room {r_index}: {p['outcome']} player has no rank and no credit")
        if r_index == 0:
            h68.check(parts[leaver]["outcome"] == "left", "voluntary mid-race leave is recorded as left")
        final = room["outcomes"][0]["final"]
        owners = {}
        for item in final["trash"]:
            if item["collectedBy"] is not None:
                owners[item["collectedBy"]] = owners.get(item["collectedBy"], 0) + 1
        h68.check(len({i["itemId"] for i in final["trash"]}) == room["outcomes"][0]["course_trash"] and all(
            owners.get(p["playerId"], 0) == p["collectedPlastic"] + p["collectedMetal"] for p in final["players"]),
            f"room {r_index}: every pickup has exactly one owner, matching counters")
        h68.check(all(o["settlement"] == "confirmed" for o in room["outcomes"] if o["result"]),
                  f"room {r_index}: settlement confirmed to every connected client")
        race_id = result["raceId"]
        rows = psql(f"SELECT count(*), count(*) FILTER (WHERE state='confirmed') FROM match.settlement_delivery WHERE race_id='{race_id}'")
        h68.check(rows == f"{PLAYERS}|{PLAYERS}", f"room {r_index}: match.settlement_delivery {rows} (all confirmed)")
        participants = psql(f"SELECT count(*) FROM match.race_participants WHERE race_id='{race_id}'")
        h68.check(participants == str(PLAYERS), f"room {r_index}: match.race_participants persisted once")
        credited = psql(f"SELECT count(*), coalesce(sum(credited_plastic),0), coalesce(sum(credited_metal),0) FROM player.settlements WHERE race_id='{race_id}'")
        expected = (f"{PLAYERS}|{sum(p['credited']['plastic'] for p in parts.values())}|"
                    f"{sum(p['credited']['metal'] for p in parts.values())}")
        h68.check(credited == expected, f"room {r_index}: player.settlements {credited} matches Go credit {expected}")
        for game in room["games"]:
            after = game.api.profile()
            start, credit = room["before"][after["playerId"]], parts[after["playerId"]]["credited"]
            h68.check(after["plastic"] == start["plastic"] + credit["plastic"] and
                      after["metal"] == start["metal"] + credit["metal"],
                      f"room {r_index}: profile credited exactly once")
            game.leave()
            game.close()

    gaps = [(b - a) * 1000 for r in rooms for g in r["games"]
            for a, b in zip(g.snapshot_times, g.snapshot_times[1:])]
    error_counts = {}
    for room in rooms:
        for game in room["games"]:
            for code in game.error_codes:
                error_counts[code] = error_counts.get(code, 0) + 1
    print(f"measure clients={ROOMS * PLAYERS} race_wall={race_seconds:.1f}s snapshots={len(gaps) + ROOMS * PLAYERS}", flush=True)
    print(f"measure snapshot_gap_ms p50={percentile(gaps, .5):.1f} p95={percentile(gaps, .95):.1f} "
          f"p99={percentile(gaps, .99):.1f} max={max(gaps):.1f} (contract cadence 100 ms)", flush=True)
    print(f"measure GET /v1/profile ms n={len(http_ms)} p50={statistics.median(http_ms):.1f} "
          f"p95={percentile(http_ms, .95):.1f} max={max(http_ms):.1f}", flush=True)
    print(f"measure realtime error frames {error_counts or 'none'}", flush=True)
    for name, values in sorted(samples.items()):
        cpus = [cpu for cpu, _ in values]
        print(f"measure resources {name}: cpu max={max(cpus):.1f}% mean={statistics.mean(cpus):.1f}% "
              f"mem last={values[-1][1]} samples={len(values)}", flush=True)
    for r_index, room in enumerate(rooms):
        for p in sorted(room["outcomes"][0]["result"]["participants"], key=lambda p: (p["rank"] is None, p["rank"] or 0)):
            seconds = f"{p['finishTimeMs'] / 1000:.1f}s" if p["finishTimeMs"] is not None else "-"
            print(f"  room {r_index} {p['playerId'][:8]}: {p['outcome']} rank={p['rank']} time={seconds} "
                  f"credited={p['credited']}", flush=True)
    print(f"elapsed: {time.monotonic() - started:.1f}s; checks: {h68.checks}", flush=True)


if __name__ == "__main__":
    result = 1
    try:
        main()
        result = 0
    except (AssertionError, RuntimeError, OSError, ValueError, KeyError, TypeError, ApiError, RealtimeError, TimeoutError) as error:
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
