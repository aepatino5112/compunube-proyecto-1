"""E43 realtime channel: WebSocket /v1/realtime, subprotocol compunube.realtime.v1.

The client only sends intents (room.ready, room.leave, race.input) and keeps the
latest state confirmed by Go. It never decides pickups, lives, ranking or rewards.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field

from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import connect
from websockets.typing import Subprotocol

SUBPROTOCOL = "compunube.realtime.v1"
PROTOCOL_VERSION = 1
SERVER_TYPES = {"room.state", "race.start", "race.snapshot", "race.event", "race.ended", "error"}
REDUCE_CHOICES = ("reusable", "disposable")
MAX_SAFE_INTEGER = 9007199254740991


class RealtimeError(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code} {detail}".strip())
        self.code = code


def parse(raw: str | bytes) -> dict:
    """Validate the E43 envelope; unknown extra fields are ignored as v1 allows."""
    if isinstance(raw, bytes):
        raise RealtimeError("INVALID_MESSAGE", "binary frames are not part of v1")
    message = json.loads(raw)
    if not isinstance(message, dict) or message.get("type") not in SERVER_TYPES:
        raise RealtimeError("INVALID_MESSAGE", "unknown message type")
    if message.get("protocolVersion") != PROTOCOL_VERSION:
        raise RealtimeError("INCOMPATIBLE_VERSION", "protocolVersion")
    return message


class InputSequencer:
    """Monotonic seq/jumpSeq per race that survive reentry (E43 reentry rule)."""

    def __init__(self):
        self.race_id: str | None = None
        self.seq = 0
        self.jump_seq = 0

    def start(self, race_id: str):
        if race_id != self.race_id:
            self.race_id, self.seq, self.jump_seq = race_id, 0, 0

    def sync(self, last_input_seq: int, last_jump_seq: int):
        self.seq = max(self.seq, last_input_seq)
        self.jump_seq = max(self.jump_seq, last_jump_seq)

    def next(self, steer: float, net_side: int, boost: bool, jump: bool) -> dict:
        if self.race_id is None:
            raise RealtimeError("RACE_NOT_ACTIVE")
        if self.seq >= MAX_SAFE_INTEGER:
            raise RealtimeError("INVALID_INPUT", "sequence exhausted")
        self.seq += 1
        if jump:
            self.jump_seq += 1
        return {"type": "race.input", "protocolVersion": PROTOCOL_VERSION, "raceId": self.race_id,
                "seq": self.seq, "steer": max(-1.0, min(1.0, float(steer))),
                "netSide": -1 if net_side < 0 else 1, "boost": bool(boost), "jumpSeq": self.jump_seq}


@dataclass
class RaceView:
    """Latest authoritative state, replaced wholesale by each full snapshot."""

    self_player_id: str | None = None
    room: dict | None = None
    start: dict | None = None
    snapshot: dict | None = None
    result: dict | None = None
    events: list = field(default_factory=list)
    errors: list = field(default_factory=list)
    seen_events: set = field(default_factory=set)

    def apply(self, message: dict):
        kind = message["type"]
        if kind == "room.state":
            self.self_player_id = message["selfPlayerId"]
            self.room = message["room"]
        elif kind == "race.start":
            if not self.start or self.start["raceId"] != message["raceId"]:
                self.snapshot = self.result = None
                self.seen_events.clear()
            self.start = message
        elif kind == "race.snapshot":
            snapshot = message["snapshot"]
            current = self.snapshot
            same_race = self.start and snapshot["raceId"] == self.start["raceId"]
            if same_race and (not current or snapshot["tick"] > current["tick"]):
                self.snapshot = snapshot
        elif kind == "race.event":
            event = message["event"]
            if event["eventId"] not in self.seen_events:
                self.seen_events.add(event["eventId"])
                self.events.append(event)
        elif kind == "race.ended":
            # A repeated race.ended only advances settlementState (pending -> confirmed).
            self.result = message["result"]
        elif kind == "error":
            self.errors.append(message["error"])

    def me(self) -> dict | None:
        if not self.snapshot:
            return None
        return next((p for p in self.snapshot["players"] if p["playerId"] == self.self_player_id), None)


class RealtimeConnection:
    def __init__(self, url: str, token: str, open_timeout: float = 8.0, subprotocol: str = SUBPROTOCOL):
        self.url = url
        self.token = token
        self.open_timeout = open_timeout
        self.subprotocol = subprotocol
        self._socket = None
        self._send_lock = threading.Lock()

    def open(self):
        try:
            self._socket = connect(
                self.url, subprotocols=[Subprotocol(self.subprotocol)],
                additional_headers={"Authorization": "Bearer " + self.token} if self.token else {},
                open_timeout=self.open_timeout, max_size=2**20)
        except InvalidStatus as error:
            status = error.response.status_code
            code = {401: "SESSION_REQUIRED", 400: "INCOMPATIBLE_VERSION", 503: "SERVICE_UNAVAILABLE"}
            raise RealtimeError(code.get(status, "HANDSHAKE_REJECTED"), str(status)) from None
        if self._socket.subprotocol != self.subprotocol:
            self.close()
            raise RealtimeError("INCOMPATIBLE_VERSION", "subprotocol not accepted")
        return self

    def receive(self, timeout: float | None = None) -> dict:
        try:
            return parse(self._socket.recv(timeout=timeout))
        except ConnectionClosed:
            raise RealtimeError("DISCONNECTED") from None

    def send(self, message: dict):
        try:
            with self._send_lock:
                self._socket.send(json.dumps(message, separators=(",", ":")))
        except ConnectionClosed:
            raise RealtimeError("DISCONNECTED") from None

    def ready(self, room_id: str, ready: bool, profile_revision: int | None = None,
              reduce_choice: str | None = None):
        message = {"type": "room.ready", "protocolVersion": PROTOCOL_VERSION, "roomId": room_id, "ready": ready}
        if ready:
            if reduce_choice not in REDUCE_CHOICES or not isinstance(profile_revision, int):
                raise ValueError("ready needs the confirmed profileRevision and a reduce choice")
            message.update(profileRevision=profile_revision, reduceChoice=reduce_choice)
        self.send(message)

    def leave(self, room_id: str):
        self.send({"type": "room.leave", "protocolVersion": PROTOCOL_VERSION, "roomId": room_id})

    def close(self):
        if self._socket is not None:
            self._socket.close()
            self._socket = None
