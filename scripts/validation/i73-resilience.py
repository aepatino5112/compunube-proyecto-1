#!/usr/bin/env python3
"""I73: resilience and failover with real clients in an isolated Compose project.

Race A (two Python clients): a client's socket drops and it reenters; rust-1 is
killed (Envoy fails over to rust-2); rust-2 is killed (profile/economy degrade,
the race keeps running in Go); the result stays pending and durable in
match.settlement_delivery; Go restarts with that pending settlement and the
sessions issued before the restart stay valid (match.sessions, F48/ADR 0005);
Rust comes back and the credit is applied exactly once.
Race B: PostgreSQL is stopped during a race; the race finishes; when PostgreSQL
returns the result is persisted and settled.
Only the isolated project's throwaway data is touched.
"""

import importlib.util
import os
from pathlib import Path
import socket
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps/client-secondary"))
os.environ["H68_PROJECT"] = os.environ.get("I73_PROJECT", "compunube-i73")
for key, value in {
    "POSTGRES_PORT": "55473", "GO_HTTP_PORT": "58073", "ENVOY_GRPC_PORT": "55073",
    "ENVOY_ADMIN_PORT": "59074", "PROMETHEUS_PORT": "59075", "GRAFANA_PORT": "53073",
}.items():
    os.environ["H68_" + key] = os.environ.get("I73_" + key, value)
spec = importlib.util.spec_from_file_location("h68", ROOT / "scripts/validation/h68-prometheus.py")
h68 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h68)

from compunube_client.api import ApiError, GoApi  # noqa: E402
from compunube_client.game import GameSession  # noqa: E402
from compunube_client.realtime import RealtimeError  # noqa: E402

GO = "http://127.0.0.1:" + h68.ENV["GO_HTTP_PORT"]
LOG = []


def note(line):
    print(f"  [{time.strftime('%H:%M:%S')}] {line}", flush=True)
    LOG.append(line)


def psql(sql):
    return h68.dc("exec", "-T", "postgres", "psql", "-U", h68.ENV.get("POSTGRES_USER", "compunube"),
                  "-d", h68.ENV.get("POSTGRES_DB", "compunube"), "-X", "-At", "-c", sql, timeout=30)


def profile_with_retry(api, seconds=60):
    deadline = time.monotonic() + seconds
    while True:
        try:
            return api.profile()
        except ApiError as error:
            if time.monotonic() > deadline:
                raise
            time.sleep(1)


class Racer:
    def __init__(self, label):
        self.api = GoApi(GO)
        self.api.create_session()
        self.before = profile_with_retry(self.api)
        self.game = GameSession(self.api, log=lambda line: note(f"{label}: {line}"))
        self.snapshots = 0
        self.result = None
        self.error = None
        self.label = label
        original = self.game.receive

        def counted(timeout):
            message = original(timeout)
            if message and message["type"] == "race.snapshot":
                self.snapshots += 1
            return message
        self.game.receive = counted

    def run(self, choice):
        try:
            self.game.wait_for(lambda m: m is not None and m["type"] == "room.state"
                               and len(m["room"]["members"]) == 2, 30)
            self.game.ready(choice)
            self.result = self.game.race(timeout=240)
            self.game.wait_settlement(3)
        except Exception as error:  # reported by the main thread
            self.error = f"{type(error).__name__}: {error}"

    @property
    def me(self):
        return self.game.view.me()


def start_race(map_id):
    host, guest = Racer("host"), Racer("guest")
    room = host.game.create(map_id)
    guest.game.join(room)
    for racer in (host, guest):
        racer.game.connect()
    threads = [threading.Thread(target=r.run, args=(c,)) for r, c in ((host, "reusable"), (guest, "disposable"))]
    for thread in threads:
        thread.start()
    h68.wait_for("race started for both clients", 45,
                 lambda: host.game.view.start is not None and guest.game.view.start is not None)
    return host, guest, threads


def still_racing(racer, seconds=4):
    before = racer.snapshots
    time.sleep(seconds)
    return racer.snapshots > before


def kill(service):
    container = h68.dc("ps", "-q", service)
    h68.run("docker", "update", "--restart=no", container, timeout=15)
    h68.run("docker", "kill", container, timeout=15)


def settlement_rows(race_id):
    return psql(f"SELECT state, count(*) FROM match.settlement_delivery WHERE race_id='{race_id}' GROUP BY state ORDER BY state")


def answers(call):
    """True when the public call succeeds; Go may be restarting or degraded."""
    try:
        call()
        return True
    except (ApiError, OSError):
        return False


def verify_credit(label, race_id, racers):
    # The Rust-owned balances are read from player.profiles; callers also read
    # them through Go with sessions issued before the Go restart.
    parts = {p["playerId"]: p for p in racers[0].result["participants"]}
    rows = psql(f"SELECT count(*), coalesce(sum(credited_plastic),0), coalesce(sum(credited_metal),0) FROM player.settlements WHERE race_id='{race_id}'")
    expected = f"2|{sum(p['credited']['plastic'] for p in parts.values())}|{sum(p['credited']['metal'] for p in parts.values())}"
    h68.check(rows == expected, f"{label}: player.settlements {rows} equals Go's credit {expected} (one row per player)")
    for racer in racers:
        player_id = racer.before["playerId"]
        plastic, metal = map(int, psql(f"SELECT plastic, metal FROM player.profiles WHERE player_id='{player_id}'").split("|"))
        credit = parts[player_id]["credited"]
        h68.check(plastic == racer.before["plastic"] + credit["plastic"] and metal == racer.before["metal"] + credit["metal"],
                  f"{label}: {racer.label} balance credited exactly once ({plastic} plastic, {metal} metal)")


def main():
    started = time.monotonic()
    h68.run("docker", "compose", "version", timeout=10)
    h68.dc("down", "-v", "--remove-orphans", timeout=90)
    print(f"I73 isolated project: {h68.PROJECT}", flush=True)
    if os.environ.get("I73_SKIP_BUILD") != "1":
        h68.dc("build", "player-profile-rust-1", "match-service-go", timeout=900)
    h68.dc("up", "-d", "--no-build", "--wait", "--wait-timeout", "300", timeout=360)
    h68.wait_for("both Rust replicas SERVING", 90, lambda: h68.rust_health() == {"rust-1": 1, "rust-2": 1})
    observer = GoApi(GO)
    observer_id = observer.create_session()["playerId"]
    profile_with_retry(observer)

    # ---- Race A -------------------------------------------------------------
    host, guest, threads = start_race("maracaibo")
    race_a = host.game.view.start["raceId"]
    note(f"race A {race_a} started")
    time.sleep(4)
    guest.game.connection._socket.socket.shutdown(socket.SHUT_RDWR)  # abrupt network drop
    h68.wait_for("guest reentered the race", 20, lambda: guest.game.reconnects >= 1 and guest.me
                 and guest.me["participantState"] == "racing")
    h68.check(guest.me["lastProcessedInputSeq"] <= guest.game.inputs.seq,
              "after reentry the guest's next input sequence is above what Go processed")
    h68.check(still_racing(guest), "reentered client receives fresh snapshots")

    kill("player-profile-rust-1")
    note("rust-1 killed")
    h68.wait_for("profile served through Envoy by rust-2", 30, lambda: answers(observer.profile))
    h68.check(still_racing(host), "race keeps running with one Rust replica")

    kill("player-profile-rust-2")
    note("rust-2 killed")
    def degraded():
        try:
            observer.profile()
            return False
        except ApiError as error:
            return error.code == "PROFILE_UNAVAILABLE"
    h68.wait_for("profile/economy degraded with both Rust down", 40, degraded)
    h68.check(still_racing(host) and still_racing(guest), "active race continues with both Rust replicas down")

    for thread in threads:
        thread.join(240)
    h68.check(not host.error and not guest.error and host.result and guest.result,
              f"race A ended for both clients ({host.error or guest.error})")
    h68.check(all(p["settlementState"] == "pending" for p in host.result["participants"]),
              "race.ended reports settlement pending while Rust is down")
    h68.wait_for("race A persisted with pending settlement", 30, lambda: settlement_rows(race_a) == "pending|2")
    h68.check(True, "settlement is durable in match.settlement_delivery (2 pending)")
    for racer in (host, guest):
        racer.game.close()

    h68.dc("restart", "match-service-go", timeout=120)
    h68.wait_for("Go healthy again after restart", 60, lambda: answers(GoApi(GO).create_session))
    h68.check(observer.current_session()["playerId"] == observer_id
              and all(r.api.current_session()["playerId"] == r.before["playerId"] for r in (host, guest)),
              "sessions issued before the Go restart are still valid with the same playerId (match.sessions)")
    h68.check(psql(f"SELECT count(*), min(octet_length(token_hash)) FROM match.sessions WHERE player_id='{observer_id}'") == "1|32",
              "match.sessions keeps one 32-byte token hash per player, never the token")
    h68.check(settlement_rows(race_a) == "pending|2", "Go restart keeps the pending settlement rows")

    h68.dc("start", "player-profile-rust-1", "player-profile-rust-2", timeout=120)
    note("both Rust replicas started")
    h68.wait_for("Rust recovered", 120, lambda: h68.rust_health() == {"rust-1": 1, "rust-2": 1})
    h68.wait_for("pending settlement drained after recovery", 120, lambda: settlement_rows(race_a) == "confirmed|2")
    h68.check(True, "settlement confirmed after Rust and Go recovery")
    verify_credit("race A", race_a, (host, guest))
    parts = {p["playerId"]: p["credited"] for p in host.result["participants"]}
    for racer in (host, guest):
        after = profile_with_retry(racer.api)
        credit = parts[racer.before["playerId"]]
        h68.check(after["playerId"] == racer.before["playerId"]
                  and after["plastic"] == racer.before["plastic"] + credit["plastic"]
                  and after["metal"] == racer.before["metal"] + credit["metal"],
                  f"race A: {racer.label} reads the credited profile through Go with its pre-restart session")

    # ---- Race B: PostgreSQL outage during a race -------------------------------
    host, guest, threads = start_race("orinoco")
    race_b = host.game.view.start["raceId"]
    note(f"race B {race_b} started")
    time.sleep(3)
    h68.dc("stop", "postgres", timeout=60)
    note("postgres stopped")
    h68.check(still_racing(host) and still_racing(guest), "race keeps running with PostgreSQL stopped (no per-tick writes)")
    for thread in threads:
        thread.join(240)
    h68.check(not host.error and not guest.error and host.result is not None,
              f"race B ended with PostgreSQL down ({host.error or guest.error})")
    h68.dc("start", "postgres", timeout=60)
    note("postgres started")
    h68.wait_for("race B persisted and settled after PostgreSQL returns", 180,
                 lambda: settlement_rows(race_b) == "confirmed|2")
    h68.check(True, "result persisted after the outage and settlement confirmed")
    def client_confirmed():
        host.game.receive(0.5)
        return all(p["settlementState"] == "confirmed" for p in host.game.view.result["participants"])
    h68.wait_for("connected client receives race.ended with settlement confirmed", 30, client_confirmed)
    verify_credit("race B", race_b, (host, guest))
    for racer in (host, guest):
        racer.game.close()
    print(f"elapsed: {time.monotonic() - started:.1f}s; checks: {h68.checks}", flush=True)


if __name__ == "__main__":
    result = 1
    try:
        main()
        result = 0
    except (AssertionError, RuntimeError, OSError, ValueError, KeyError, ApiError, RealtimeError, TimeoutError) as error:
        print(f"FAIL {type(error).__name__}: {error}", file=sys.stderr, flush=True)
        try:
            print(h68.dc("logs", "--no-color", "--tail", "60", "match-service-go"), file=sys.stderr, flush=True)
        except (RuntimeError, OSError):
            pass
    finally:
        try:
            h68.dc("down", "-v", "--remove-orphans", timeout=90)
            print(f"teardown: {h68.PROJECT} containers, network and volumes removed", flush=True)
        except (RuntimeError, OSError) as error:
            print(f"FAIL teardown: {error}", file=sys.stderr, flush=True)
            result = 1
        print("RESULT: PASS" if result == 0 else "RESULT: FAIL", flush=True)
    sys.exit(result)
