"""Command-line interface of the secondary (Python) client.

Talks only to Go's public HTTP API and WebSocket. Examples:

    python -m compunube_client --server http://127.0.0.1:8080 profile
    python -m compunube_client play --create maracaibo
    python -m compunube_client play --join <room-code> --manual
    python -m compunube_client gui
"""

from __future__ import annotations

import argparse
import os
import sys
import threading
from pathlib import Path

from .api import ApiError, GoApi
from .autopilot import Intent, decide
from .game import GameSession
from .realtime import REDUCE_CHOICES, RealtimeError
from .view import member_name

EXIT_ERROR = 1


def load_session(api: GoApi, token_file: Path | None) -> str:
    """Reuse a stored session when it is still valid; otherwise ask Go for one."""
    token_file = token_file.expanduser() if token_file else None
    if token_file and token_file.exists():
        api.token = token_file.read_text(encoding="utf-8").strip()
        try:
            return api.current_session()["playerId"]
        except ApiError as error:
            if error.code != "SESSION_REQUIRED":
                raise
    player_id = api.create_session()["playerId"]
    if token_file:
        # The token is a secret: keep it private to the user running the client.
        token_file.touch(mode=0o600, exist_ok=True)
        token_file.write_text(api.token, encoding="utf-8")
    return player_id


def print_profile(profile: dict):
    print(f"Perfil (revisión {profile['profileRevision']}): {profile['coins']} monedas, "
          f"{profile['plastic']} plástico, {profile['metal']} chatarra")
    equipment = profile["equipment"]
    print("  Equipo: " + ", ".join(f"{key[:-2]}={value}" for key, value in equipment.items()))
    print(f"  Objetos: {len(profile['ownedItemIds'])}")


def print_room(room: dict, self_id: str):
    print(f"Sala {room['roomId']} · {room['mapId']} · {room['state']}")
    for member in room["members"]:
        marks = ["tú"] if member["playerId"] == self_id else []
        if not member["connected"]:
            marks.append("desconectado")
        print(f"  - {member_name(member)}: {member['participantState']}"
              + (f" ({', '.join(marks)})" if marks else ""))


def print_result(result: dict, self_id: str):
    print(f"Resultado de la carrera {result['raceId']} (confirmado por Go):")
    for participant in sorted(result["participants"], key=lambda p: (p["rank"] is None, p["rank"] or 0)):
        who = "tú" if participant["playerId"] == self_id else participant["playerId"][:8]
        rank = f"#{participant['rank']}" if participant["rank"] else "—"
        seconds = (f"{participant['finishTimeMs'] / 1000:.1f}s"
                   if participant["finishTimeMs"] is not None else "sin tiempo")
        credited = participant["credited"]
        print(f"  {rank:>3} {who}: {participant['outcome']} · {seconds} · acreditado "
              f"{credited['plastic']} plástico + {credited['metal']} chatarra · "
              f"settlement {participant['settlementState']}")


class ManualController:
    """Line-based controls that work in any terminal, including Windows 10."""

    HELP = "Controles: a=izquierda d=derecha s=recto j=saltar b=impulso on/off z/x=red izq/der q=salir"

    def __init__(self):
        self.steer, self.net_side, self.boost = 0.0, 1, False
        self.jump_pending = False
        self.quit = False
        self.lock = threading.Lock()

    def read_forever(self, stream=sys.stdin):
        for line in stream:
            for key in line.strip().lower():
                with self.lock:
                    if key == "a":
                        self.steer = -1.0
                    elif key == "d":
                        self.steer = 1.0
                    elif key == "s":
                        self.steer = 0.0
                    elif key == "j":
                        self.jump_pending = True
                    elif key == "b":
                        self.boost = not self.boost
                    elif key in "zx":
                        self.net_side = -1 if key == "z" else 1
                    elif key == "q":
                        self.quit = True

    def __call__(self, snapshot, course, self_id) -> Intent:
        with self.lock:
            jump, self.jump_pending = self.jump_pending, False
            return Intent(self.steer, self.net_side, self.boost, jump)


def command_play(api: GoApi, args) -> int:
    game = GameSession(api)
    room_id = game.create(args.create) if args.create else game.join(args.join)
    print(f"Código de sala: {room_id}  (compártelo para que otros entren)")
    game.connect()
    print_room(game.wait_room_state(), game.view.self_player_id)
    game.ready(args.reduce)
    print("Listo enviado. Esperando a que todos los miembros estén listos…")

    controller = decide
    if args.manual:
        manual = ManualController()
        print(ManualController.HELP)
        threading.Thread(target=manual.read_forever, daemon=True).start()
        controller = manual
    last_state = None

    def on_room(message):
        nonlocal last_state
        if message and message["type"] == "room.state" and message["room"]["state"] != last_state:
            last_state = message["room"]["state"]
            print_room(message["room"], game.view.self_player_id)
        return message is not None and message["type"] == "race.start"

    game.wait_for(on_room, args.lobby_timeout)
    print("¡Carrera iniciada! Go es la autoridad de la simulación.")
    result = game.race(controller, timeout=args.race_timeout)
    print_result(result, game.view.self_player_id)
    state = game.wait_settlement(args.settlement_timeout)
    print(f"Settlement de tu participación: {state}")
    try:
        print_profile(api.profile())
    except ApiError as error:
        print(f"Perfil no disponible ahora ({error.code}); el resultado de Go se conserva.")
    game.leave()
    game.close()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="compunube-client", description=__doc__.splitlines()[0])
    parser.add_argument("--server", default=os.environ.get("COMPUNUBE_SERVER", "http://127.0.0.1:8080"),
                        help="Go Match Service origin (default: %(default)s)")
    parser.add_argument("--token-file", type=Path,
                        help="optional file to reuse the Go session between runs (kept private)")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("session", help="create or show the session identity")
    commands.add_parser("profile", help="show the confirmed profile")
    commands.add_parser("catalog", help="list the active catalog")
    mutations = []
    for kind in ("buy", "craft", "equip"):
        mutations.append(commands.add_parser(kind, help=f"{kind} one catalog item"))
        mutations[-1].add_argument("item_id")
    exchange = commands.add_parser("exchange", help="exchange materials for coins")
    exchange.add_argument("material", choices=("plastic", "metal"))
    exchange.add_argument("amount", type=int)
    appearance = commands.add_parser("appearance", help="set skin and hair color")
    appearance.add_argument("skin_id")
    appearance.add_argument("hair_color_id")
    for command in (*mutations, exchange, appearance):
        command.add_argument("--request-id", help="resume an uncertain operation with its original requestId")
    play = commands.add_parser("play", help="create or join a room and race")
    where = play.add_mutually_exclusive_group(required=True)
    where.add_argument("--create", choices=("maracaibo", "orinoco"))
    where.add_argument("--join", metavar="ROOM_ID")
    play.add_argument("--reduce", choices=REDUCE_CHOICES, default="reusable")
    play.add_argument("--manual", action="store_true", help="steer with keyboard lines instead of the autopilot")
    play.add_argument("--lobby-timeout", type=float, default=300.0)
    play.add_argument("--race-timeout", type=float, default=240.0)
    play.add_argument("--settlement-timeout", type=float, default=30.0)
    commands.add_parser("gui", help="open the graphical window (Tkinter)")
    return parser


def run(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "gui":
        try:
            from .gui import run_gui
            return run_gui(args.server, args.token_file)
        except ImportError as error:
            print(f"La ventana necesita Tkinter ({error}). En Debian/Ubuntu: sudo apt install python3-tk; "
                  "el instalador de python.org lo incluye en Windows.", file=sys.stderr)
            return EXIT_ERROR
        except ValueError as error:
            print(f"Error: {error}", file=sys.stderr)
            return EXIT_ERROR
    api = GoApi(args.server)
    try:
        player_id = load_session(api, args.token_file)
        if args.command == "session":
            print(f"Sesión activa. playerId={player_id}")
        elif args.command == "profile":
            print_profile(api.profile())
        elif args.command == "catalog":
            catalog = api.catalog()
            print(f"Catálogo {catalog['catalogVersion']}")
            for item in catalog["items"]:
                price = f"{item['priceCoins']} monedas" if item["purchasable"] else (
                    f"{item['recipePlastic']} plástico + {item['recipeMetal']} chatarra" if item["craftable"] else "inicial")
                print(f"  {item['itemType']:<9} {item['itemId']:<11} {item['name']} · {price}")
        elif args.command == "play":
            return command_play(api, args)
        else:
            version = api.catalog()["catalogVersion"]
            if args.command in ("buy", "craft", "equip"):
                mutation = api.item_mutation(args.command, args.item_id, version, args.request_id)
            elif args.command == "exchange":
                mutation = api.exchange_mutation(args.material, args.amount, version, args.request_id)
            else:
                mutation = api.appearance_mutation(args.skin_id, args.hair_color_id, version, args.request_id)
            try:
                result = api.mutate(mutation)
            except ApiError as error:
                if error.uncertain:
                    print(f"Resultado incierto. Repite la MISMA orden con --request-id {mutation.request_id} "
                          "(sin un requestId nuevo) para confirmarla sin duplicarla.", file=sys.stderr)
                raise
            print(("Operación ya registrada (replay)" if result["replayed"] else "Operación confirmada")
                  + f" · requestId {result['requestId']}")
            print_profile(result["profile"])
    except ApiError as error:
        print(f"Error {error.status} {error.code}.", file=sys.stderr)
        return EXIT_ERROR
    except (RealtimeError, TimeoutError) as error:
        print(f"Error de tiempo real: {error}", file=sys.stderr)
        return EXIT_ERROR
    return 0
