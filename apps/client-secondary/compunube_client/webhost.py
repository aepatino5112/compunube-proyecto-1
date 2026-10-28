"""Python instance of the Surf Club web client.

Serves the same interface as apps/web (its built dist/) and forwards /v1, HTTP
and the realtime WebSocket, to Go, like apps/web/server.mjs does in Node. The
browser stays same-origin, so Go's HttpOnly session cookie and its Origin check
work unchanged. Standard library only:

    python -m compunube_client.webhost --server http://<go>:8080
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import unquote, urlsplit

DIST = Path(__file__).resolve().parents[2] / "web" / "dist"
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".glb": "model/gltf-binary",
         ".json": "application/json; charset=utf-8", ".yaml": "application/yaml; charset=utf-8",
         ".png": "image/png", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8",
         ".ogg": "audio/ogg", ".mp3": "audio/mpeg"}
MAX_HEAD = 64 * 1024


def go_origin(url: str) -> tuple[str, int]:
    parts = urlsplit(url)
    if parts.scheme != "http" or not parts.hostname or parts.path not in ("", "/") or parts.query:
        raise ValueError("--server must be an http:// origin such as http://127.0.0.1:8080")
    return parts.hostname, parts.port or 80


def is_api(target: str) -> bool:
    path = target.split("?", 1)[0]
    return path == "/v1" or path.startswith("/v1/")


def static_file(root: Path, target: str) -> tuple[int, Path | None]:
    """Maps a request target to a file inside root: (status, path)."""
    pathname = unquote(urlsplit(target).path)
    if pathname.endswith("/"):
        pathname += "index.html"
    resolved = (root / ("." + pathname)).resolve()
    if not resolved.is_relative_to(root):
        return 403, None
    return (200, resolved) if resolved.is_file() else (404, None)


def response(status: int, reason: str, body: bytes = b"", headers: dict[str, str] | None = None,
             head_only: bool = False) -> bytes:
    lines = [f"HTTP/1.1 {status} {reason}", f"Content-Length: {len(body)}", "Connection: close"]
    lines += [f"{key}: {value}" for key, value in (headers or {}).items()]
    return ("\r\n".join(lines) + "\r\n\r\n").encode("latin-1") + (b"" if head_only else body)


UNAVAILABLE = response(503, "Service Unavailable", json.dumps(
    {"code": "SERVICE_UNAVAILABLE", "message": "Online service is not configured"}).encode(),
    {"Content-Type": "application/json", "Cache-Control": "no-store"})


class WebHost:
    def __init__(self, go: str | None, root: Path = DIST):
        self.go = go_origin(go) if go else None
        self.root = root.resolve()

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            head = await reader.readuntil(b"\r\n\r\n")
            if len(head) > MAX_HEAD:
                raise ValueError("request head too large")
            request_line, *header_lines = head.decode("latin-1").split("\r\n")
            method, target, _ = request_line.split(" ", 2)
            if is_api(target):
                await self.forward(head, header_lines, reader, writer)
            else:
                writer.write(self.serve(method, target))
                await writer.drain()
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, ConnectionError, ValueError):
            pass
        finally:
            writer.close()

    def serve(self, method: str, target: str) -> bytes:
        if urlsplit(target).path == "/api-docs":
            return response(301, "Moved Permanently", headers={"Location": "/api-docs/"})
        status, path = static_file(self.root, target)
        if status == 403:
            return response(403, "Forbidden")
        if status == 404:
            return response(404, "Not Found", b"Not found")
        headers = {"Content-Type": TYPES.get(path.suffix, "application/octet-stream"), "Cache-Control": "no-store"}
        return response(200, "OK", path.read_bytes(), headers, head_only=method == "HEAD")

    async def forward(self, head: bytes, header_lines: list[str], reader, writer) -> None:
        """Tunnels one request (or one WebSocket session) to Go byte for byte.

        The original Host header is kept so Go compares Origin with this page's
        host. Plain requests get `Connection: close`, so a keep-alive browser
        connection never carries a later static request to Go.
        """
        if not self.go:
            writer.write(UNAVAILABLE)
            await writer.drain()
            return
        upgrade = any(line.lower().startswith("upgrade:") for line in header_lines)
        if not upgrade:
            kept = [line for line in header_lines if line and not line.lower().startswith(("connection:", "keep-alive:"))]
            request_line = head.decode("latin-1").split("\r\n", 1)[0]
            head = ("\r\n".join([request_line, *kept, "Connection: close"]) + "\r\n\r\n").encode("latin-1")
        try:
            go_reader, go_writer = await asyncio.wait_for(asyncio.open_connection(*self.go), timeout=5)
        except (OSError, asyncio.TimeoutError):
            writer.write(UNAVAILABLE)
            await writer.drain()
            return
        go_writer.write(head)

        async def pipe(source: asyncio.StreamReader, sink: asyncio.StreamWriter) -> None:
            try:
                while chunk := await source.read(65536):
                    sink.write(chunk)
                    await sink.drain()
            except ConnectionError:
                pass
            finally:
                if sink.can_write_eof():
                    try:
                        sink.write_eof()
                    except OSError:
                        pass

        upstream = asyncio.create_task(pipe(reader, go_writer))
        await pipe(go_reader, writer)
        upstream.cancel()
        go_writer.close()


async def serve(go: str | None, host: str, port: int, root: Path = DIST) -> asyncio.Server:
    app = WebHost(go, root)
    return await asyncio.start_server(app.handle, host, port, limit=MAX_HEAD)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m compunube_client.webhost",
                                     description="Surf Club web client served by Python (same UI as apps/web)")
    parser.add_argument("--server", default=os.environ.get("COMPUNUBE_GO_URL") or os.environ.get("COMPUNUBE_SERVER"),
                        help="Go Match Service origin, e.g. http://127.0.0.1:8080")
    parser.add_argument("--host", default=os.environ.get("COMPUNUBE_WEB_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("COMPUNUBE_WEB_PORT", "4173")))
    parser.add_argument("--dist", type=Path, default=DIST, help="built web interface (apps/web/dist)")
    args = parser.parse_args(argv)
    try:
        go_origin(args.server) if args.server else None
    except ValueError as error:
        parser.error(str(error))
    if not (args.dist / "index.html").is_file():
        parser.error(f"{args.dist} has no index.html (the web interface)")

    async def run() -> None:
        server = await serve(args.server, args.host, args.port, args.dist)
        online = f" · online via {args.server.rstrip('/')}" if args.server else ""
        print(f"Surf Club (Python): http://{args.host}:{args.port}{online}", flush=True)
        async with server:
            await server.serve_forever()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
