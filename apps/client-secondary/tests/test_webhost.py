import asyncio
import http.client
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from websockets.sync.client import connect
from websockets.sync.server import serve as ws_serve

from compunube_client.webhost import DIST, go_origin, is_api, serve, static_file


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@pytest.fixture
def fake_go():
    """Go stand-in for plain HTTP: records each request and answers 201 with a cookie."""
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            seen.append({"path": self.path, "host": self.headers["Host"], "origin": self.headers["Origin"],
                         "connection": self.headers["Connection"], "body": body})
            reply = json.dumps({"ok": True}).encode()
            self.send_response(201)
            self.send_header("Content-Length", str(len(reply)))
            self.send_header("Set-Cookie", "compunube_session=abc; HttpOnly; Secure; SameSite=Strict")
            self.end_headers()
            self.wfile.write(reply)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}", seen
    server.shutdown()


@pytest.fixture
def fake_realtime():
    """Go stand-in for the WebSocket: echoes every message."""
    def echo(connection):
        for message in connection:
            connection.send(f"go:{message}")

    port = free_port()
    with ws_serve(echo, "127.0.0.1", port, subprotocols=["compunube.realtime.v1"]) as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        yield f"http://127.0.0.1:{port}"
        server.shutdown()


def start_host(go, root=DIST):
    port = free_port()
    loop = asyncio.new_event_loop()
    ready = threading.Event()

    async def main():
        server = await serve(go, "127.0.0.1", port, root)
        ready.set()
        async with server:
            await server.serve_forever()

    thread = threading.Thread(target=lambda: loop.run_until_complete(main()), daemon=True)
    thread.start()
    assert ready.wait(5)
    return port


def get(port, method, path, headers=None, body=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    conn.request(method, path, body=body, headers=headers or {})
    answer = conn.getresponse()
    return answer.status, dict(answer.getheaders()), answer.read()


def test_serves_the_same_interface_as_the_node_server():
    port = start_host(None)
    status, headers, body = get(port, "GET", "/")
    assert status == 200 and headers["Content-Type"] == "text/html; charset=utf-8"
    assert body == (DIST / "index.html").read_bytes()
    status, headers, _ = get(port, "GET", "/game.js")
    assert status == 200 and headers["Content-Type"].startswith("text/javascript") and headers["Cache-Control"] == "no-store"
    assert get(port, "GET", "/api-docs")[1]["Location"] == "/api-docs/"
    assert get(port, "GET", "/missing.js")[0] == 404
    assert get(port, "HEAD", "/")[2] == b""


def test_never_serves_files_outside_the_interface():
    assert static_file(DIST, "/../../README.md")[0] == 403
    assert static_file(DIST, "/%2e%2e/%2e%2e/README.md")[0] == 403
    assert static_file(DIST, "/index.html")[0] == 200


def test_api_without_go_answers_service_unavailable():
    status, _, body = get(start_host(None), "POST", "/v1/sessions")
    assert status == 503 and json.loads(body)["code"] == "SERVICE_UNAVAILABLE"


def test_forwards_api_requests_keeping_host_origin_and_cookie(fake_go):
    go, seen = fake_go
    port = start_host(go)
    origin = f"http://127.0.0.1:{port}"
    status, headers, body = get(port, "POST", "/v1/rooms?x=1", {"Origin": origin, "Content-Type": "application/json",
                                                                  "Connection": "keep-alive"}, b'{"mapId":"maracaibo"}')
    assert status == 201 and json.loads(body) == {"ok": True}
    assert "HttpOnly" in headers["Set-Cookie"]
    # Go compares Origin with the page's own host, as with apps/web/server.mjs.
    assert seen[-1] == {"path": "/v1/rooms?x=1", "host": f"127.0.0.1:{port}", "origin": origin,
                        "connection": "close", "body": b'{"mapId":"maracaibo"}'}


def test_tunnels_the_realtime_websocket(fake_realtime):
    port = start_host(fake_realtime)
    with connect(f"ws://127.0.0.1:{port}/v1/realtime", subprotocols=["compunube.realtime.v1"]) as ws:
        ws.send("hello")
        assert ws.recv(timeout=5) == "go:hello"
        ws.send("again")
        assert ws.recv(timeout=5) == "go:again"


def test_go_unreachable_is_service_unavailable():
    status, _, _ = get(start_host(f"http://127.0.0.1:{free_port()}"), "GET", "/v1/profile")
    assert status == 503


def test_only_http_origins_are_accepted():
    assert go_origin("http://10.0.0.15:8080") == ("10.0.0.15", 8080)
    for bad in ("https://10.0.0.15", "http://10.0.0.15:8080/v1", "10.0.0.15:8080"):
        with pytest.raises(ValueError):
            go_origin(bad)
    assert is_api("/v1/rooms?x") and is_api("/v1") and not is_api("/v1x") and not is_api("/")
