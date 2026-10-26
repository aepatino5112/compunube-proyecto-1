import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from compunube_client.api import ApiError, GoApi, check_base_url


class Recorder:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []


@pytest.fixture
def server():
    recorder = Recorder([])

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def handle_any(self):
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length)) if length else None
            recorder.requests.append((self.command, self.path, dict(self.headers), body))
            status, payload = recorder.responses.pop(0)
            if status is None:
                self.connection.close()  # drop the connection without a response
                return
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_POST = do_PUT = handle_any

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield recorder, f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def profile(revision=1):
    return {"playerId": "p1", "profileRevision": revision, "coins": 0, "plastic": 0, "metal": 0,
            "ownedItemIds": [], "equipment": {}, "appearance": {}}


def test_session_token_is_sent_as_bearer_and_never_in_url(server):
    recorder, url = server
    recorder.responses += [(201, {"playerId": "p1", "token": "secret"}), (200, profile())]
    api = GoApi(url)
    assert api.create_session() == {"playerId": "p1"}
    api.profile()
    method, path, headers, _ = recorder.requests[1]
    assert (method, path) == ("GET", "/v1/profile")
    assert headers["Authorization"] == "Bearer secret"
    assert "secret" not in path


def test_uncertain_mutation_is_retried_with_the_same_request_id(server):
    recorder, url = server
    mutation = GoApi.item_mutation("buy", "manglar", "catalog-1")
    recorder.responses += [
        (504, {"code": "MUTATION_OUTCOME_UNKNOWN", "message": "x", "requestId": mutation.request_id}),
        (None, None),
        (200, {"requestId": mutation.request_id, "replayed": True, "profile": profile(2)}),
    ]
    result = GoApi(url, token="t").mutate(mutation, sleep=lambda _: None)
    assert result["replayed"] is True
    bodies = [body for _, _, _, body in recorder.requests]
    assert len(bodies) == 3 and all(body == mutation.body for body in bodies)


def test_definitive_rejection_is_not_retried(server):
    recorder, url = server
    recorder.responses += [(422, {"code": "INSUFFICIENT_COINS", "message": "no"})]
    with pytest.raises(ApiError) as error:
        GoApi(url, token="t").mutate(GoApi.item_mutation("buy", "sol", "c"), sleep=lambda _: None)
    assert (error.value.status, error.value.code, error.value.uncertain) == (422, "INSUFFICIENT_COINS", False)
    assert len(recorder.requests) == 1


def test_exhausted_uncertain_mutation_surfaces_for_a_later_same_id_retry(server):
    recorder, url = server
    mutation = GoApi.exchange_mutation("plastic", 2, "c")
    recorder.responses += [(504, {"code": "MUTATION_OUTCOME_UNKNOWN", "message": ""})] * 2
    with pytest.raises(ApiError) as error:
        GoApi(url, token="t").mutate(mutation, attempts=2, sleep=lambda _: None)
    assert error.value.uncertain
    assert mutation.body["requestId"] == recorder.requests[0][3]["requestId"] == recorder.requests[1][3]["requestId"]


def test_profile_unavailable_on_a_mutation_is_retried_with_the_same_request_id(server):
    recorder, url = server
    mutation = GoApi.appearance_mutation("dark", "black", "c")
    recorder.responses += [(503, {"code": "PROFILE_UNAVAILABLE", "message": "down"}),
                           (200, {"requestId": mutation.request_id, "replayed": True, "profile": profile(3)})]
    assert GoApi(url, token="t").mutate(mutation, sleep=lambda _: None)["replayed"] is True
    assert [body for *_, body in recorder.requests] == [mutation.body, mutation.body]


def test_profile_unavailable_on_a_read_is_raised_as_degraded(server):
    recorder, url = server
    recorder.responses += [(503, {"code": "PROFILE_UNAVAILABLE", "message": "down"})]
    with pytest.raises(ApiError) as error:
        GoApi(url, token="t").profile()
    assert error.value.code == "PROFILE_UNAVAILABLE" and len(recorder.requests) == 1


def test_room_requests_follow_e45(server):
    recorder, url = server
    recorder.responses += [(201, {"roomId": "r/1", "mapId": "orinoco", "state": "LOBBY", "playerId": "p1"}),
                           (200, {"roomId": "r/1", "mapId": "orinoco", "state": "LOBBY", "playerId": "p1"})]
    api = GoApi(url, token="t")
    api.create_room("orinoco")
    api.join_room("r/1")
    assert recorder.requests[0][1] == "/v1/rooms" and recorder.requests[0][3] == {"mapId": "orinoco"}
    assert recorder.requests[1][:2] == ("POST", "/v1/rooms/r%2F1/memberships")
    assert recorder.requests[1][3] is None


def test_mutation_requests_carry_request_id_and_catalog_version():
    for mutation in (GoApi.item_mutation("craft", "red-reuso", "v1"), GoApi.item_mutation("equip", "sol", "v1"),
                     GoApi.exchange_mutation("metal", 1, "v1"), GoApi.appearance_mutation("dark", "black", "v1")):
        assert mutation.body["catalogVersion"] == "v1" and mutation.request_id
        assert "playerId" not in mutation.body
    with pytest.raises(ValueError):
        GoApi.exchange_mutation("glass", 1, "v1")


def test_base_url_must_be_an_origin():
    assert check_base_url("http://127.0.0.1:8080/") == "http://127.0.0.1:8080"
    assert GoApi("https://go.example:8443").realtime_url == "wss://go.example:8443/v1/realtime"
    for bad in ("127.0.0.1:8080", "ftp://x", "http://x/?token=1"):
        with pytest.raises(ValueError):
            check_base_url(bad)


def test_resumed_operation_keeps_its_original_request_id():
    original = GoApi.exchange_mutation("plastic", 1, "v1")
    resumed = GoApi.exchange_mutation("plastic", 1, "v1", request_id=original.request_id)
    assert resumed == original
