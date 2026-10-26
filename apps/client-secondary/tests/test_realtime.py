import json
import threading

import pytest
from websockets.sync.server import serve

from compunube_client.api import GoApi
from compunube_client.game import GameSession
from compunube_client.realtime import (InputSequencer, RaceView, RealtimeConnection, RealtimeError,
                                       SUBPROTOCOL, parse)


def test_parse_enforces_envelope_and_version():
    assert parse('{"type":"error","protocolVersion":1,"error":{},"extra":1}')["type"] == "error"
    for raw, code in (('{"type":"room.state","protocolVersion":2}', "INCOMPATIBLE_VERSION"),
                      ('{"type":"profile.updated","protocolVersion":1}', "INVALID_MESSAGE"),
                      (b"{}", "INVALID_MESSAGE")):
        with pytest.raises(RealtimeError) as error:
            parse(raw)
        assert error.value.code == code


def test_sequences_are_monotonic_and_survive_reentry():
    seq = InputSequencer()
    seq.start("race-1")
    first = seq.next(0.4, 1, False, jump=True)
    assert (first["seq"], first["jumpSeq"]) == (1, 1)
    seq.sync(40, 3)  # snapshot after reentry reports what Go already processed
    after = seq.next(5.0, -7, True, jump=False)
    assert (after["seq"], after["jumpSeq"], after["steer"], after["netSide"]) == (41, 3, 1.0, -1)
    seq.sync(10, 1)  # an older snapshot never moves counters backwards
    assert seq.next(0, 1, False, jump=True)["seq"] == 42
    seq.start("race-1")
    assert seq.seq == 42
    seq.start("race-2")
    assert (seq.seq, seq.jump_seq) == (0, 0)


def test_race_view_keeps_latest_tick_dedups_events_and_tracks_settlement():
    view = RaceView()
    view.apply({"type": "race.start", "raceId": "r1"})
    view.apply({"type": "race.snapshot", "snapshot": {"raceId": "r1", "tick": 4, "players": []}})
    view.apply({"type": "race.snapshot", "snapshot": {"raceId": "r1", "tick": 2, "players": []}})
    view.apply({"type": "race.snapshot", "snapshot": {"raceId": "other", "tick": 9, "players": []}})
    assert view.snapshot["tick"] == 4
    event = {"type": "race.event", "event": {"eventId": "e1"}}
    view.apply(event)
    view.apply(event)
    assert len(view.events) == 1
    view.apply({"type": "race.ended", "result": {"participants": [{"settlementState": "pending"}]}})
    view.apply({"type": "race.ended", "result": {"participants": [{"settlementState": "confirmed"}]}})
    assert view.result["participants"][0]["settlementState"] == "confirmed"


def test_ready_requires_confirmed_revision_and_reduce_choice():
    connection = RealtimeConnection("ws://unused", "t")
    with pytest.raises(ValueError):
        connection.ready("room", True, None, "reusable")
    with pytest.raises(ValueError):
        connection.ready("room", True, 3, "plastic-bag")


class FakeGo:
    """Minimal WebSocket peer that checks the handshake like Go does."""

    def __init__(self, script):
        self.script = script
        self.received = []
        self.headers = []
        self.server = serve(self.handler, "127.0.0.1", 0, subprotocols=[SUBPROTOCOL],
                            select_subprotocol=self.select)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"ws://127.0.0.1:{self.server.socket.getsockname()[1]}/v1/realtime"

    def select(self, connection, subprotocols):
        return SUBPROTOCOL if SUBPROTOCOL in subprotocols else None

    def handler(self, ws):
        headers = ws.request.headers
        self.headers.append({key: headers.get(key) for key in ("Authorization", "Sec-WebSocket-Protocol")})
        self.script(self, ws)

    def close(self):
        self.server.shutdown()


def snapshot(tick, seq, jump):
    return {"type": "race.snapshot", "protocolVersion": 1, "snapshot": {
        "raceId": "race-1", "tick": tick, "players": [{
            "playerId": "me", "participantState": "racing", "lastProcessedInputSeq": seq,
            "lastProcessedJumpSeq": jump}], "trash": [], "lifesavers": [], "pursuits": []}}


def test_handshake_uses_subprotocol_and_bearer_and_reentry_resyncs_sequences():
    def script(peer, ws):
        if len(peer.headers) == 1:
            ws.send(json.dumps({"type": "room.state", "protocolVersion": 1, "selfPlayerId": "me",
                                "room": {"roomId": "room-1", "state": "RACING"}}))
            ws.send(json.dumps({"type": "race.start", "protocolVersion": 1, "raceId": "race-1"}))
            ws.send(json.dumps(snapshot(2, 0, 0)))
            peer.received.append(json.loads(ws.recv()))
            ws.close()  # simulated network drop during the race
        else:
            ws.send(json.dumps({"type": "room.state", "protocolVersion": 1, "selfPlayerId": "me",
                                "room": {"roomId": "room-1", "state": "RACING"}}))
            ws.send(json.dumps(snapshot(10, 57, 4)))
            peer.received.append(json.loads(ws.recv()))

    peer = FakeGo(script)
    try:
        api = GoApi("http://127.0.0.1:1", token="secret-token")
        game = GameSession(api, log=lambda _: None)
        game.realtime_url = peer.url
        game.connect()
        game.room_id = "room-1"
        for _ in range(3):
            game.receive(2)
        from compunube_client.autopilot import Intent
        game.send_intent(Intent(jump=True))
        assert game.receive(2) is None  # drop detected, reconnected
        assert game.reconnects == 1
        for _ in range(2):
            game.receive(2)
        game.send_intent(Intent())
        game.receive(1)
        first, second = peer.received
        assert (first["seq"], first["jumpSeq"]) == (1, 1)
        assert (second["seq"], second["jumpSeq"]) == (58, 4)
        assert all(h["Authorization"] == "Bearer secret-token" for h in peer.headers)
        assert all(h["Sec-WebSocket-Protocol"] == SUBPROTOCOL for h in peer.headers)
        game.close()
    finally:
        peer.close()


def test_server_without_the_subprotocol_is_rejected():
    server = serve(lambda ws: ws.recv(), "127.0.0.1", 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        url = f"ws://127.0.0.1:{server.socket.getsockname()[1]}/v1/realtime"
        with pytest.raises(RealtimeError) as error:
            RealtimeConnection(url, "t").open()
        assert error.value.code == "INCOMPATIBLE_VERSION"
    finally:
        server.shutdown()
