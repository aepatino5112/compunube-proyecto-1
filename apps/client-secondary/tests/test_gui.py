import os
import queue

import pytest

from compunube_client.api import ApiError
from compunube_client.autopilot import Intent
from compunube_client.gui import Controls, GuiController
from compunube_client.realtime import RaceView
from test_view import START, player, snapshot


def drain(controller, timeout=2.0):
    events = [controller.events.get(timeout=timeout)]
    while True:
        try:
            events.append(controller.events.get_nowait())
        except queue.Empty:
            return events


def test_manual_controls_send_one_jump_and_autopilot_takes_over():
    controls = Controls()
    controls.left = controls.boost = True
    controls.net_side = -1
    controls.jump_pending = True
    assert controls.intent({}, {}, "p") == Intent(-1.0, -1, True, True)
    assert controls.intent({}, {}, "p").jump is False
    controls.autopilot = True
    course = {"obstacles": [], "trash": []}
    snap = {"players": [{**player("p", 0), "jumpHeight": 0, "netSide": 1}], "trash": [], "pursuits": []}
    assert controls.intent(snap, course, "p").boost is False


class StubApi:
    def __init__(self, answers):
        self.answers = answers
        self.sent = []

    def mutate(self, mutation):
        self.sent.append(mutation)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def test_uncertain_mutation_is_repeated_with_the_same_request_id():
    controller = GuiController("http://127.0.0.1:9")
    controller.catalog = {"catalogVersion": "v1"}
    ok = {"replayed": True, "requestId": "x", "profile": {"coins": 1}}
    controller.api = StubApi([ApiError(504, "MUTATION_OUTCOME_UNKNOWN"), ok])
    controller.item_action("buy", "sol")
    assert drain(controller)[0][0] == "error"
    controller.item_action("buy", "sol")
    kinds = [kind for kind, _ in drain(controller)]
    assert kinds == ["profile", "notice"]
    first, second = controller.api.sent
    assert first is second and first.body["catalogVersion"] == "v1"
    assert controller.pending == {}


def test_definitive_rejection_forgets_the_request_id():
    controller = GuiController("http://127.0.0.1:9")
    controller.catalog = {"catalogVersion": "v1"}
    controller.api = StubApi([ApiError(422, "INSUFFICIENT_COINS"), ApiError(422, "INSUFFICIENT_COINS")])
    controller.item_action("buy", "sol")
    assert "INSUFFICIENT_COINS" in drain(controller)[0][1]
    controller.item_action("buy", "sol")
    drain(controller)
    first, second = controller.api.sent
    assert first.request_id != second.request_id


def test_ready_needs_a_reduce_choice():
    controller = GuiController("http://127.0.0.1:9")
    controller.ready("")
    kind, text = controller.events.get_nowait()
    assert kind == "error" and "hidratarte" in text


# Window ---------------------------------------------------------------------
# CI sets CLIENT_GUI_REQUIRED=1 (Xvfb on Linux, desktop on Windows) so a missing
# Tk or display fails instead of skipping; locally the test is skipped.
def tk_root():
    try:
        import tkinter
        return tkinter.Tk()
    except Exception as error:  # ImportError or TclError (no display)
        if os.environ.get("CLIENT_GUI_REQUIRED") == "1":
            raise
        pytest.skip(f"Tk not available: {error}")


class OfflineController(GuiController):
    def start_session(self):
        self.player_id = "p_me"
        self.profile = {"coins": 10, "plastic": 2, "metal": 1, "profileRevision": 3, "ownedItemIds": ["nico"],
                        "equipment": {"characterId": "nico", "boardId": "coral", "netId": "red-base"}}
        self.catalog = {"catalogVersion": "v1", "items": [
            {"itemId": "nico", "itemType": "character", "name": "Nico", "purchasable": False, "craftable": False},
            {"itemId": "sol", "itemType": "board", "name": "Sol", "purchasable": True, "priceCoins": 40,
             "craftable": False}]}
        self.events.put(("session", "p_me"))

    def item_action(self, kind, item_id):
        self.events.put(("notice", f"{kind} {item_id}"))


class FakeGame:
    def __init__(self):
        self.view = RaceView(self_player_id="p_me")


def pump(root, window):
    for _ in range(5):
        root.update()
    window.poll()
    root.update()


def test_window_renders_profile_catalog_room_and_race():
    from compunube_client.gui import build_window

    root = tk_root()
    try:
        controller = OfflineController("http://127.0.0.1:9")
        window = build_window(controller, root)
        pump(root, window)
        assert "Monedas 10" in window.profile_label.cget("text")
        assert window.catalog_list.size() == 2
        assert str(window.ready_button["state"]) == "disabled"

        window.on_item("buy")
        pump(root, window)
        assert "Selecciona" in window.status.get()
        window.catalog_list.selection_set(1)
        window.on_item("buy")
        pump(root, window)
        assert window.status.get() == "buy sol"

        game = FakeGame()
        game.view.room = {"roomId": "room-9", "mapId": "maracaibo", "state": "RACING", "capacity": 4, "members": [
            {"playerId": "p_me", "displayName": "", "connected": True, "ready": True, "participantState": "racing",
             "reduceChoice": "reusable", "equipment": {"characterId": "nico"}}]}
        game.view.start = START
        game.view.snapshot = snapshot(player("p_me", 0), player("p_other", -8))
        controller.game = game
        window.refresh()
        root.update()
        assert "Sala room-9" in window.room_label.cget("text")
        assert str(window.create_button["state"]) == "disabled"
        assert len(window.canvas.find_withtag("player")) == 4  # two ovals and two labels
        assert window.canvas.find_withtag("obstacle") and window.canvas.find_withtag("plastic")
        assert "puesto 1" in window.hud.get()

        window.on_key("left", True)
        window.on_jump()
        window.on_net(-1)
        assert controller.controls.intent({}, {}, "p_me") == Intent(-1.0, -1, False, True)
        window.autopilot.set(True)
        window.on_autopilot()
        assert controller.controls.autopilot is True
    finally:
        root.destroy()
