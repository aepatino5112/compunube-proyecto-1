#!/usr/bin/env python3
"""G58: the Python graphical window (Tkinter) plays a real race against Go.

Drives the real window (buttons, catalog selection, Reduce choice, autopilot)
against a running stack: the window equips an item through Go -> Envoy -> Rust,
creates a room, races a second Python client that joins with the code shown,
draws the authoritative snapshots and shows the settled result. Requires
COMPUNUBE_GO_URL, Tk and a display (CI runs it under Xvfb). Writes the canvas
mid-race to $G58_GUI_EVIDENCE (PostScript) when set.
"""

import os
from pathlib import Path
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps/client-secondary"))

from compunube_client.api import ApiError, GoApi  # noqa: E402
from compunube_client.game import GameSession  # noqa: E402
from compunube_client.gui import GuiController, build_window  # noqa: E402
from compunube_client.realtime import RealtimeError  # noqa: E402

GO = os.environ.get("COMPUNUBE_GO_URL", "")
checks = 0


def check(value, label):
    global checks
    if not value:
        raise AssertionError(label)
    checks += 1
    print(f"PASS {label}", flush=True)


def pump_until(root, label, seconds, predicate):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        root.update()
        if predicate():
            return
        time.sleep(0.02)
    raise TimeoutError(f"{label} (after {seconds}s)")


def guest_plays(room_id, outcome, errors):
    try:
        api = GoApi(GO)
        api.create_session()
        game = GameSession(api, log=lambda line: print("  guest:", line, flush=True))
        game.join(room_id)
        game.connect()
        game.wait_for(lambda m: m is not None and m["type"] == "room.state"
                      and len(m["room"]["members"]) == 2, 20)
        game.ready("disposable")
        outcome["result"] = game.race(timeout=300)
        outcome["settlement"] = game.wait_settlement(60)
        game.leave()
        game.close()
    except Exception as error:  # reported by the main thread
        errors.append(f"{type(error).__name__} {error}")


def main():
    if not GO:
        raise ValueError("COMPUNUBE_GO_URL is required (no silent skip)")
    import tkinter

    started = time.monotonic()
    root = tkinter.Tk()
    controller = GuiController(GO)
    window = build_window(controller, root)
    try:
        pump_until(root, "session, profile and catalog", 30,
                   lambda: controller.catalog is not None and window.catalog_list.size() > 0)
        check(controller.player_id and controller.player_id in window.status.get(),
              "window shows the Go-issued session")
        check(window.catalog_list.size() == len(controller.catalog["items"]) == 22,
              "window lists the 22 catalog items served through Go -> Envoy -> Rust")
        before = controller.profile
        check(window.stats["coins"].get() == str(before["coins"]), "window shows the confirmed profile")

        rows = [item["itemId"] for item in controller.catalog["items"]]
        target = "luna" if before["equipment"]["characterId"] != "luna" else "nico"
        window.catalog_list.selection_set(rows.index(target))
        window.item_buttons["equip"].invoke()
        pump_until(root, "equip confirmed in the window", 20,
                   lambda: "Operación confirmada" in window.status.get() or "Go respondió" in window.status.get())
        check(controller.profile["equipment"]["characterId"] == target, f"profile now equips {target}")
        check("Operación confirmada" in window.status.get(), "Equipar button confirmed by Go with a requestId")
        check(controller.profile["profileRevision"] > before["profileRevision"], "profile revision advanced once")

        check(window.ready_button.instate(["disabled"]) and window.leave_button.instate(["disabled"]),
              "Listo and Salir are disabled without a room")
        window.map_id.set("maracaibo")
        window.create_button.invoke()
        pump_until(root, "room created", 20, lambda: controller.game is not None and window.room_code.get())
        room_id = window.room_code.get()
        check(room_id == controller.game.room_id and room_id in window.status.get(), "room code shown to share")

        outcome, errors = {}, []
        guest = threading.Thread(target=guest_plays, args=(room_id, outcome, errors), daemon=True)
        guest.start()
        pump_until(root, "guest shown in the room panel", 30,
                   lambda: window.room_label.cget("text").startswith(f"Sala {room_id}")
                   and len(window.room_label.cget("text").splitlines()) == 3)
        check(True, "room panel lists the room and both members from room.state")
        check(window.create_button.instate(["disabled"]) and window.join_button.instate(["disabled"]),
              "create/join are disabled while in a room")

        window.ready_button.invoke()
        pump_until(root, "Listo refused without the Reduce choice", 5, lambda: "hidratarte" in window.status.get())
        check(True, "Listo requires the Reduce choice")
        window.reduce.set("reusable")
        window.autopilot.set(True)
        window.on_autopilot()
        window.ready_button.invoke()

        drawn = {"players": 0, "pickups": 0, "hud": "", "saved": False}
        evidence = os.environ.get("G58_GUI_EVIDENCE")

        def racing_drawn():
            canvas = window.canvas
            players = len(canvas.find_withtag("player"))
            pickups = len(canvas.find_withtag("plastic")) + len(canvas.find_withtag("metal"))
            if players > drawn["players"] or (players == drawn["players"] and pickups > drawn["pickups"]):
                drawn.update(players=players, pickups=pickups, hud=window.hud.get())
            snap = controller.game.view.snapshot
            if evidence and not drawn["saved"] and snap and snap["elapsedMs"] > 5000 and players >= 4:
                canvas.postscript(file=evidence, colormode="color")
                drawn["saved"] = True
            return controller.game.view.result is not None

        pump_until(root, "race ended in the window", 300, racing_drawn)
        check(drawn["players"] >= 4, "canvas drew both surfers from the authoritative snapshots")
        check(drawn["pickups"] > 0, "canvas drew uncollected pickups from the course manifest")
        check("Tiempo" in drawn["hud"] and "vidas" in drawn["hud"], f"HUD showed race state: {drawn['hud']}")

        def own():
            result = controller.game.view.result
            return next(p for p in result["participants"] if p["playerId"] == controller.player_id)

        def own_line():
            return next((line for line in window.result_label.cget("text").splitlines() if " Tú: " in line), "")

        pump_until(root, "settled own result shown", 90,
                   lambda: own()["settlementState"] == "confirmed" and own_line().endswith("(acreditado)"))
        result_text = window.result_label.cget("text")
        print("  window result:\n    " + result_text.replace("\n", "\n    "), flush=True)
        check(" Tú: " in result_text and "acreditado" in result_text, "result panel shows the settled own result")
        check("reutilizable" in result_text, "result panel echoes the Reduce choice")
        guest.join(120)
        check(not errors and outcome.get("settlement") == "confirmed", f"guest client completed the race {errors}")
        check(outcome["result"]["raceId"] == controller.game.view.result["raceId"],
              "window and guest received the same authoritative result")
        credited = own()["credited"]
        expected = (str(before["plastic"] + credited["plastic"]), str(before["metal"] + credited["metal"]))
        pump_until(root, "profile panel credited", 30,
                   lambda: (window.stats["plastic"].get(), window.stats["metal"].get()) == expected)
        after = controller.profile
        check(after["plastic"] == before["plastic"] + credited["plastic"]
              and after["metal"] == before["metal"] + credited["metal"],
              f"profile panel shows exactly the credited materials once {credited}")
        check(window.stats["plastic"].get() == str(after["plastic"]), "profile panel refreshed")

        # RF-035: about 10 s after the confirmed settlement Go returns the room
        # to LOBBY; the guest already left, so only the window remains.
        pump_until(root, "room back in LOBBY", 60,
                   lambda: window.room_label.cget("text").startswith(f"Sala {room_id} · Lago de Maracaibo · En el lobby"))
        lines = window.room_label.cget("text").splitlines()
        check(len(lines) == 2 and "aún no está listo" in lines[1],
              "room returned to LOBBY with the window not_ready")
        check(not window.ready_button.instate(["disabled"]) and window.canvas.find_withtag("placeholder"),
              "window offers Listo again for another race in the same room")

        window.leave_button.invoke()
        pump_until(root, "left the room", 10, lambda: window.room_label.cget("text") == "Sin sala.")
        check(not window.create_button.instate(["disabled"]), "after leaving the room can be created again")
    finally:
        controller.close()
        root.destroy()
    print(f"elapsed: {time.monotonic() - started:.1f}s; checks: {checks}", flush=True)


if __name__ == "__main__":
    result = 1
    try:
        main()
        result = 0
    except (AssertionError, RuntimeError, OSError, ValueError, KeyError, ApiError, RealtimeError,
            TimeoutError, ImportError) as error:
        print(f"FAIL {type(error).__name__}: {error}", file=sys.stderr, flush=True)
    print("RESULT: PASS" if result == 0 else "RESULT: FAIL", flush=True)
    sys.exit(result)
