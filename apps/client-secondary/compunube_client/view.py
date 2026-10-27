"""Pure presentation helpers for the graphical client (no Tk, no network).

They turn authoritative E43/E45 data into what the window shows. Nothing here
decides positions, pickups, lives, ranking or credit: it only formats state
already confirmed by Go (and Rust through Go).
"""

from __future__ import annotations

from dataclasses import dataclass

CHARACTER_NAMES = {"nico": "Nico", "luna": "Luna", "amara": "Amara", "samuel": "Samuel"}
REDUCE_LABELS = {"reusable": "botella reutilizable", "disposable": "botella desechable"}
OUTCOME_LABELS = {"finished": "llegó", "disqualified": "sin vidas", "left": "salió", "dnf": "no terminó"}
STATE_LABELS = {"LOBBY": "En el lobby", "COUNTDOWN": "Cuenta atrás", "RACING": "En carrera",
                "RESULTS": "Resultados", "CLOSED": "Cerrada"}
PARTICIPANT_LABELS = {"not_ready": "aún no está listo", "ready": "listo", "racing": "en carrera",
                      "reconnecting": "reconectando", "finished": "llegó", "disqualified": "sin vidas",
                      "left": "salió", "dnf": "no terminó"}
MAP_LABELS = {"maracaibo": "Lago de Maracaibo", "orinoco": "Río Orinoco"}
MATERIAL_LABELS = {"plastic": "Plástico", "metal": "Chatarra"}
ITEM_TYPE_LABELS = {"character": "Personaje", "board": "Tabla", "outfit": "Ropa", "net": "Red", "hair": "Peinado"}
# E45 error codes in words a player understands; the code itself is kept next to it.
ERROR_TEXTS = {
    "TRANSPORT_ERROR": "No hay conexión con el servidor del juego",
    "SESSION_REQUIRED": "La sesión ya no es válida; vuelve a abrir el cliente",
    "PROFILE_UNAVAILABLE": "El perfil online no está disponible ahora; inténtalo en unos segundos",
    "SERVICE_UNAVAILABLE": "El servicio no está disponible ahora; inténtalo en unos segundos",
    "INSUFFICIENT_COINS": "No te alcanzan las monedas",
    "INSUFFICIENT_MATERIALS": "Te faltan materiales",
    "ALREADY_OWNED": "Ya tienes ese objeto",
    "NOT_OWNED": "Todavía no tienes ese objeto",
    "INVALID_CATALOG_VERSION": "El catálogo cambió; vuelve a abrir el cliente",
    "INCOMPATIBLE_VERSION": "Esta versión del cliente no es compatible con el servidor",
    "ROOM_NOT_FOUND": "No hay ninguna sala con ese código",
    "ROOM_FULL": "La sala está llena",
    "INVALID_STATE": "Esa acción no está disponible en este momento",
    "INVALID_ITEM": "Ese objeto no está en el catálogo",
    "INVALID_ACTION": "Ese objeto no admite esa acción",
}
PLAYER_COLORS = ("#ef795e", "#4e97b3", "#e66f8b", "#8cb440")
LATERAL_LIMIT = 15.0     # E43 surf-mvp-1 lateralLimitUnits
VIEW_AHEAD = 60.0        # course units shown ahead of the own surfer
VIEW_BEHIND = 15.0


def member_name(member: dict) -> str:
    """Go publishes the opaque playerId (or nothing before ready) as displayName."""
    name = (member.get("displayName") or "").strip()
    if name and name != member.get("playerId"):
        return name
    character = CHARACTER_NAMES.get((member.get("equipment") or {}).get("characterId", ""))
    return f"{character or 'Surfista'} ({member.get('playerId', '')[:6]})"


def error_text(status: int, code: str, server: str = "") -> str:
    """Readable message for an E45 error, keeping the status and code for diagnosis."""
    if code == "TRANSPORT_ERROR":
        where = f" en {server}" if server else ""
        return f"{ERROR_TEXTS[code]}{where}. ¿Está levantado el juego (docker compose up)? (sin respuesta de Go)"
    return f"{ERROR_TEXTS.get(code, 'No se pudo completar la operación')} (Go respondió {status} {code})"


def room_lines(room: dict | None, self_id: str | None) -> list[str]:
    if not room:
        return []
    lines = [f"Sala {room['roomId']} · {MAP_LABELS.get(room['mapId'], room['mapId'])} · "
             f"{STATE_LABELS.get(room['state'], room['state'])} "
             f"· {len(room['members'])}/{room.get('capacity', 4)}"]
    for member in room["members"]:
        tags = []
        if member["playerId"] == self_id:
            tags.append("tú")
        if not member.get("connected", True):
            tags.append("desconectado")
        if member.get("reduceChoice"):
            tags.append(REDUCE_LABELS.get(member["reduceChoice"], member["reduceChoice"]))
        state = "listo" if member.get("ready") and member.get("participantState") in (None, "ready") \
            else PARTICIPANT_LABELS.get(member.get("participantState", ""), member.get("participantState", ""))
        lines.append(f"  • {member_name(member)}: {state}" + (f"  [{', '.join(tags)}]" if tags else ""))
    return lines


def profile_stats(profile: dict | None) -> dict[str, str]:
    """Balance tiles: coins, plastic and metal as confirmed by Rust through Go."""
    if not profile:
        return {"coins": "—", "plastic": "—", "metal": "—"}
    return {key: str(profile[key]) for key in ("coins", "plastic", "metal")}


def equipment_line(profile: dict | None, catalog: dict | None = None) -> str:
    if not profile:
        return "Perfil online sin cargar."
    names = {item["itemId"]: item["name"] for item in (catalog or {}).get("items", [])}
    equipment = profile["equipment"]
    character = CHARACTER_NAMES.get(equipment["characterId"], names.get(equipment["characterId"],
                                                                        equipment["characterId"]))
    return (f"{character} · tabla {names.get(equipment['boardId'], equipment['boardId'])} · "
            f"red {names.get(equipment['netId'], equipment['netId'])} · revisión {profile['profileRevision']}")


@dataclass(frozen=True)
class CatalogRow:
    item_id: str
    kind: str          # item type in Spanish
    name: str
    status: str
    state: str         # equipped | owned | available | locked


def catalog_rows(catalog: dict | None, profile: dict | None) -> list[CatalogRow]:
    """One row per catalog item; the price/recipe shown is the catalog's, Rust decides."""
    if not catalog:
        return []
    owned = set((profile or {}).get("ownedItemIds", []))
    equipped = set((profile or {}).get("equipment", {}).values())
    rows = []
    for item in catalog["items"]:
        if item["itemId"] in equipped:
            status, state = "Equipado", "equipped"
        elif item["itemId"] in owned:
            status, state = "En tu equipo", "owned"
        elif item["purchasable"]:
            status, state = f"{item['priceCoins']} monedas", "available"
        elif item["craftable"]:
            status, state = f"{item['recipePlastic']} plástico + {item['recipeMetal']} chatarra", "available"
        else:
            status, state = "No disponible", "locked"
        rows.append(CatalogRow(item["itemId"], ITEM_TYPE_LABELS.get(item["itemType"], item["itemType"]),
                               item["name"], status, state))
    return rows


def result_lines(result: dict | None, self_id: str | None) -> list[str]:
    if not result:
        return []
    lines = []
    ranked = sorted(result["participants"], key=lambda p: (p["rank"] is None, p["rank"] or 0))
    for participant in ranked:
        who = "Tú" if participant["playerId"] == self_id else participant["playerId"][:8]
        rank = f"#{participant['rank']}" if participant["rank"] else "—"
        seconds = (f"{participant['finishTimeMs'] / 1000:.1f} s" if participant["finishTimeMs"] is not None
                   else "sin tiempo")
        credited = participant["credited"]
        settlement = "acreditado" if participant["settlementState"] == "confirmed" else "acreditación pendiente"
        lines.append(f"{rank:>3} {who}: {OUTCOME_LABELS.get(participant['outcome'], participant['outcome'])} · "
                     f"{seconds} · {credited['plastic']} plástico + {credited['metal']} chatarra ({settlement})")
    own = next((p for p in result["participants"] if p["playerId"] == self_id), None)
    if own and own.get("reduceChoice") == "reusable":
        lines.append("Reducir: elegiste una botella reutilizable antes de la carrera.")
    elif own and own.get("reduceChoice") == "disposable":
        lines.append("Reducir: esta vez elegiste una botella desechable; prueba una reutilizable en la próxima.")
    return lines


@dataclass(frozen=True)
class Shape:
    kind: str          # obstacle | plastic | metal | lifesaver | player | finish
    x: float           # canvas pixels
    y: float
    radius: float
    color: str
    label: str = ""


def project(x: float, z: float, self_z: float, width: int, height: int) -> tuple[float, float] | None:
    """Top-down view centred on the own surfer; Z decreases forward (E43)."""
    ahead = self_z - z
    if ahead > VIEW_AHEAD or ahead < -VIEW_BEHIND:
        return None
    px = (x + LATERAL_LIMIT) / (2 * LATERAL_LIMIT) * width
    py = height - (ahead + VIEW_BEHIND) / (VIEW_AHEAD + VIEW_BEHIND) * height
    return px, py


def race_shapes(start: dict, snapshot: dict, self_id: str, width: int, height: int) -> list[Shape]:
    """Everything visible around the own surfer, from the manifest and the latest snapshot."""
    course = start["course"]
    me = next((p for p in snapshot["players"] if p["playerId"] == self_id), None)
    self_z = me["z"] if me else 0.0
    scale = width / (2 * LATERAL_LIMIT)
    shapes: list[Shape] = []
    finish = project(0.0, -course["lengthUnits"], self_z, width, height)
    if finish:
        shapes.append(Shape("finish", width / 2, finish[1], width / 2, "#1f4e4a", "META"))
    for obstacle in course["obstacles"]:
        point = project(obstacle["x"], obstacle["z"], self_z, width, height)
        if point:
            shapes.append(Shape("obstacle", *point, obstacle["radius"] * scale, "#6b6f73"))
    collected = {item["itemId"] for item in snapshot["trash"] if item["collectedBy"] is not None}
    for trash in course["trash"]:
        point = project(trash["x"], trash["z"], self_z, width, height)
        if point and trash["itemId"] not in collected:
            color = "#3d8fd6" if trash["material"] == "plastic" else "#e08a2c"
            shapes.append(Shape(trash["material"], *point, max(3.0, 0.6 * scale), color))
    taken = {item["itemId"] for item in snapshot["lifesavers"] if item["collectedBy"] is not None}
    for lifesaver in course["lifesavers"]:
        point = project(lifesaver["x"], lifesaver["z"], self_z, width, height)
        if point and lifesaver["itemId"] not in taken:
            shapes.append(Shape("lifesaver", *point, max(4.0, 0.8 * scale), "#e24c4c"))
    roster = [entry["playerId"] for entry in start["roster"]]
    for player in snapshot["players"]:
        point = project(player["x"], player["z"], self_z, width, height)
        if not point or player["participantState"] == "left":
            continue
        color = PLAYER_COLORS[roster.index(player["playerId"]) % 4] if player["playerId"] in roster else "#888888"
        label = "Tú" if player["playerId"] == self_id else player["playerId"][:6]
        shapes.append(Shape("player", *point, max(6.0, 0.9 * scale), color, label))
    return shapes


def hud_text(snapshot: dict | None, self_id: str | None, length: float = 900.0) -> str:
    if not snapshot:
        return "Esperando el primer estado de la carrera…"
    me = next((p for p in snapshot["players"] if p["playerId"] == self_id), None)
    if not me:
        return "Observando la carrera."
    progress = max(0.0, min(length, -me["z"]))
    position = 1 + sum(1 for p in snapshot["players"] if p["playerId"] != self_id and p["z"] < me["z"])
    return (f"Tiempo {snapshot['elapsedMs'] / 1000:.1f} s · {progress:.0f}/{length:.0f} m · puesto {position}\n"
            f"vidas {me['lives']} · impulso {me['energy'] * 100:.0f}% · "
            f"recogidos {me['collectedPlastic']} plástico + {me['collectedMetal']} chatarra · "
            f"{PARTICIPANT_LABELS.get(me['participantState'], me['participantState'])}")
