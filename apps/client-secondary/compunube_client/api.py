"""E45 public HTTP client for the Go Match Service.

The client never chooses its playerId: Go derives it from the session token.
Economic mutations keep their requestId across retries, so an uncertain outcome
(timeout, dropped connection or 504 MUTATION_OUTCOME_UNKNOWN) is resolved by
asking for the same logical operation again instead of creating a new one.
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

MAP_IDS = ("maracaibo", "orinoco")
MATERIALS = ("plastic", "metal")
UNCERTAIN = "MUTATION_OUTCOME_UNKNOWN"


class ApiError(Exception):
    """A response that follows the E45 error envelope (or a transport failure)."""

    def __init__(self, status: int, code: str, message: str = "", request_id: str | None = None):
        super().__init__(f"{status} {code}")
        self.status = status
        self.code = code
        self.message = message
        self.request_id = request_id

    @property
    def uncertain(self) -> bool:
        # Only E45 4xx answers prove a mutation was not applied. Status 0 is a
        # transport failure, and Go may answer 503 PROFILE_UNAVAILABLE after the
        # call already reached Rust, so 5xx keeps the same requestId for a retry.
        return self.code == UNCERTAIN or self.status == 0 or self.status >= 500


@dataclass(frozen=True)
class Mutation:
    """One logical economic operation; retries must reuse it unchanged."""

    path: str
    method: str
    body: dict

    @property
    def request_id(self) -> str:
        return self.body["requestId"]


def new_request_id() -> str:
    return str(uuid.uuid4())


def check_base_url(base_url: str) -> str:
    parts = urlsplit(base_url)
    if parts.scheme not in ("http", "https") or not parts.netloc or parts.query or parts.fragment:
        raise ValueError("server must be an http(s) origin such as http://127.0.0.1:8080")
    return f"{parts.scheme}://{parts.netloc}"


class GoApi:
    def __init__(self, base_url: str, token: str | None = None, timeout: float = 8.0):
        self.base_url = check_base_url(base_url)
        self.token = token
        self.timeout = timeout

    @property
    def realtime_url(self) -> str:
        scheme = "wss" if self.base_url.startswith("https:") else "ws"
        return scheme + self.base_url[self.base_url.index(":"):] + "/v1/realtime"

    def _call(self, method: str, path: str, body: dict | None = None, auth: bool = True):
        headers = {"Accept": "application/json"}
        if auth:
            if not self.token:
                raise ApiError(401, "SESSION_REQUIRED", "No session token")
            headers["Authorization"] = "Bearer " + self.token
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        request = Request(self.base_url + path, method=method, headers=headers, data=data)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            try:
                envelope = json.load(error)
            except (ValueError, OSError):
                envelope = {}
            raise ApiError(error.code, str(envelope.get("code") or "HTTP_ERROR"),
                           str(envelope.get("message") or ""), envelope.get("requestId")) from None
        except (URLError, TimeoutError, OSError) as error:
            raise ApiError(0, "TRANSPORT_ERROR", type(error).__name__) from None

    # Session -----------------------------------------------------------------
    def create_session(self) -> dict:
        _, session = self._call("POST", "/v1/sessions", auth=False)
        self.token = session["token"]
        return {"playerId": session["playerId"]}

    def current_session(self) -> dict:
        return self._call("GET", "/v1/sessions/current")[1]

    # Profile and catalog -------------------------------------------------------
    def profile(self) -> dict:
        return self._call("GET", "/v1/profile")[1]

    def catalog(self) -> dict:
        return self._call("GET", "/v1/catalog")[1]

    @staticmethod
    def item_mutation(kind: str, item_id: str, catalog_version: str, request_id: str | None = None) -> Mutation:
        path = {"buy": "/v1/profile/purchases", "craft": "/v1/profile/crafts",
                "equip": "/v1/profile/equipment"}[kind]
        return Mutation(path, "POST", {"requestId": request_id or new_request_id(),
                                       "catalogVersion": catalog_version, "itemId": item_id})

    @staticmethod
    def exchange_mutation(material: str, amount: int, catalog_version: str,
                          request_id: str | None = None) -> Mutation:
        if material not in MATERIALS or not isinstance(amount, int) or amount < 1:
            raise ValueError("exchange needs plastic|metal and a positive amount")
        return Mutation("/v1/profile/exchanges", "POST", {
            "requestId": request_id or new_request_id(), "catalogVersion": catalog_version,
            "material": material, "amount": amount})

    @staticmethod
    def appearance_mutation(skin_id: str, hair_color_id: str, catalog_version: str,
                            request_id: str | None = None) -> Mutation:
        return Mutation("/v1/profile/appearance", "PUT", {
            "requestId": request_id or new_request_id(), "catalogVersion": catalog_version,
            "skinId": skin_id, "hairColorId": hair_color_id})

    def mutate(self, mutation: Mutation, attempts: int = 4, backoff: float = 0.5,
               sleep=time.sleep) -> dict:
        """Send a mutation; an uncertain outcome is retried with the same requestId.

        Definitive rejections (4xx) are raised immediately. After the last
        attempt the uncertain ApiError is raised and the caller can retry the
        same Mutation later; it must not build a new one for the same intent.
        """
        for attempt in range(1, attempts + 1):
            try:
                result = self._call(mutation.method, mutation.path, mutation.body)[1]
            except ApiError as error:
                if not error.uncertain or attempt == attempts:
                    raise
                sleep(backoff * attempt)
                continue
            if result.get("requestId") != mutation.request_id:
                raise ApiError(0, "INVALID_RESPONSE", "requestId mismatch", mutation.request_id)
            return result
        raise AssertionError("unreachable")

    # Rooms ---------------------------------------------------------------------
    def create_room(self, map_id: str) -> dict:
        if map_id not in MAP_IDS:
            raise ValueError("map must be maracaibo or orinoco")
        return self._call("POST", "/v1/rooms", {"mapId": map_id})[1]

    def join_room(self, room_id: str) -> dict:
        if not room_id or len(room_id) > 128:
            raise ValueError("invalid room code")
        return self._call("POST", f"/v1/rooms/{quote(room_id, safe='')}/memberships")[1]
