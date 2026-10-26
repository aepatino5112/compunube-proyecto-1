"""Room and race flow over the public Go boundary: HTTP E45 + WebSocket E43."""

from __future__ import annotations

import time
from typing import Callable

from .api import GoApi
from .autopilot import Intent, decide
from .realtime import InputSequencer, RaceView, RealtimeConnection, RealtimeError

INPUT_INTERVAL = 0.05     # at most 20 intents per second, as the web client
REENTRY_WINDOW = 15.0     # B17/E43 reentry window; Go remains the authority
TERMINAL = {"finished", "disqualified", "left", "dnf"}


class GameSession:
    def __init__(self, api: GoApi, log: Callable[[str], None] = print,
                 connection_factory=RealtimeConnection):
        self.api = api
        self.log = log
        self.view = RaceView()
        self.inputs = InputSequencer()
        self.connection: RealtimeConnection | None = None
        self.room_id: str | None = None
        self.reconnects = 0
        self.realtime_url = api.realtime_url
        self._factory = connection_factory

    # Connection --------------------------------------------------------------
    def connect(self):
        self.connection = self._factory(self.realtime_url, self.api.token).open()
        return self

    def reconnect(self) -> bool:
        """Reattach the same identity; Go replays room.state and a full snapshot."""
        deadline = time.monotonic() + REENTRY_WINDOW
        delay = 0.25
        while time.monotonic() < deadline:
            try:
                if self.connection:
                    self.connection.close()
                self.connect()
                self.reconnects += 1
                self.log("Reconectado: esperando el estado vigente de la sala.")
                return True
            except (RealtimeError, OSError):
                time.sleep(delay)
                delay = min(2.0, delay * 2)
        return False

    def receive(self, timeout: float) -> dict | None:
        try:
            message = self.connection.receive(timeout=timeout)
        except TimeoutError:
            return None
        except RealtimeError as error:
            if error.code != "DISCONNECTED":
                raise
            self.log("Conexión perdida. Intentando volver a la sala…")
            if not self.reconnect():
                raise
            return None
        self.view.apply(message)
        kind = message["type"]
        if kind == "race.start":
            self.inputs.start(message["raceId"])
        elif kind == "race.snapshot":
            me = self.view.me()
            if me:
                # Reentry: never reuse a sequence Go already processed.
                self.inputs.sync(me["lastProcessedInputSeq"], me["lastProcessedJumpSeq"])
        elif kind == "error":
            error = message["error"]
            # An intent sent while Go was closing the race is simply discarded.
            if error.get("relatedType") != "race.input" or error["code"] not in ("RACE_NOT_ACTIVE", "RATE_LIMITED"):
                self.log(f"Go rechazó {error.get('relatedType') or 'el mensaje'}: {error['code']}")
            if error.get("fatal"):
                raise RealtimeError(error["code"], "fatal")
        return message

    def wait_for(self, predicate, timeout: float, on_tick=None):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            message = self.receive(min(0.2, max(0.01, deadline - time.monotonic())))
            if on_tick:
                on_tick()
            if message and predicate(message):
                return message
            if message is None and predicate(None):
                return None
        raise TimeoutError("timed out waiting for the room")

    # Room flow -----------------------------------------------------------------
    def create(self, map_id: str) -> str:
        membership = self.api.create_room(map_id)
        self.room_id = membership["roomId"]
        return self.room_id

    def join(self, room_id: str) -> str:
        membership = self.api.join_room(room_id)
        self.room_id = membership["roomId"]
        return self.room_id

    def wait_room_state(self, timeout: float = 10.0) -> dict:
        self.wait_for(lambda m: m is not None and m["type"] == "room.state", timeout)
        return self.view.room

    def ready(self, reduce_choice: str, profile_revision: int | None = None):
        if profile_revision is None:
            profile_revision = self.api.profile()["profileRevision"]
        self.connection.ready(self.room_id, True, profile_revision, reduce_choice)

    def leave(self):
        if self.connection and self.room_id:
            try:
                self.connection.leave(self.room_id)
            except RealtimeError:
                pass

    def close(self):
        if self.connection:
            self.connection.close()

    # Race ----------------------------------------------------------------------
    def send_intent(self, intent: Intent):
        message = self.inputs.next(intent.steer, intent.net_side, intent.boost, intent.jump)
        try:
            self.connection.send(message)
        except RealtimeError:
            # The race keeps running in Go; reentry resynchronizes the sequences.
            pass

    def race(self, controller: Callable[[dict, dict, str], Intent] = decide,
             timeout: float = 180.0, leave_after: float | None = None) -> dict:
        """Play until race.ended arrives; returns the authoritative RaceResult."""
        if self.view.start is None or self.view.result is not None:
            self.wait_for(lambda m: m is not None and m["type"] == "race.start", 60.0)
        started = time.monotonic()
        last_sent = 0.0
        left = False

        def tick():
            nonlocal last_sent, left
            me = self.view.me()
            if not me or me["participantState"] in TERMINAL or left:
                return
            if leave_after is not None and time.monotonic() - started >= leave_after:
                self.leave()
                left = True
                return
            now = time.monotonic()
            if now - last_sent >= INPUT_INTERVAL:
                last_sent = now
                self.send_intent(controller(self.view.snapshot, self.view.start["course"],
                                            self.view.self_player_id))

        self.wait_for(lambda m: m is not None and m["type"] == "race.ended", timeout, on_tick=tick)
        return self.view.result

    def wait_settlement(self, timeout: float = 30.0) -> str:
        """Wait for Go to republish race.ended with settlementState=confirmed."""
        mine = lambda: next(p for p in self.view.result["participants"]
                            if p["playerId"] == self.view.self_player_id)
        if mine()["settlementState"] == "confirmed":
            return "confirmed"
        try:
            self.wait_for(lambda m: m is not None and m["type"] == "race.ended"
                          and mine()["settlementState"] == "confirmed", timeout)
        except TimeoutError:
            pass
        return mine()["settlementState"]
