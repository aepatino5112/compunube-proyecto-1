"""Demonstration autopilot: turns the latest authoritative snapshot into an intent.

It only chooses steer/jump/boost/netSide, exactly like a human pressing keys.
Go still decides movement, collisions, pickups, lives, ranking and rewards.
"""

from __future__ import annotations

from dataclasses import dataclass

NET_REACH = 2.05      # lateral offset of the net contact point (E43 course units)
LANE_LIMIT = 14.0
LOOKAHEAD = 16.0
DODGE_MARGIN = 2.5     # lateral margin (beyond the radius) that keeps an obstacle blocking
DODGE_OFFSET = 2.2     # where the dodge aims, inside that margin
BOOST_CLEARANCE = 26.0  # no boost with an obstacle this close in the lane
LIFESAVER_RANGE = 30.0
JUMP_WINDOW = (2.5, 5.5)


@dataclass(frozen=True)
class Intent:
    steer: float = 0.0
    net_side: int = 1
    boost: bool = False
    jump: bool = False


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _lifesaver_ahead(snapshot: dict, course: dict, x: float, z: float) -> dict | None:
    taken = {item["itemId"] for item in snapshot.get("lifesavers", []) if item["collectedBy"] is not None}
    ahead = [l for l in course.get("lifesavers", []) if l["itemId"] not in taken and 2 <= z - l["z"] <= LIFESAVER_RANGE]
    return min(ahead, key=lambda l: z - l["z"]) if ahead else None


def decide(snapshot: dict, course: dict, self_id: str) -> Intent:
    me = next((p for p in snapshot["players"] if p["playerId"] == self_id), None)
    if not me or me["participantState"] not in ("racing", "reconnecting"):
        return Intent()
    x, z = me["x"], me["z"]
    # Hysteresis: the dodge target sits inside this margin, so an obstacle being
    # dodged stays "blocking" until it is behind, instead of the autopilot
    # steering back into it for the next piece of trash.
    blocking = [o for o in course["obstacles"]
                if 0 <= z - o["z"] <= LOOKAHEAD and abs(o["x"] - x) < o["radius"] + DODGE_MARGIN]
    jump = me["jumpHeight"] == 0 and any(
        JUMP_WINDOW[0] <= z - o["z"] <= JUMP_WINDOW[1] and abs(o["x"] - x) < o["radius"] + 0.9
        for o in blocking)

    owned = {item["itemId"] for item in snapshot["trash"] if item["collectedBy"] is not None}
    targets = [t for t in course["trash"] if t["itemId"] not in owned and 2 <= z - t["z"] <= 25]
    net_side, target_x = me["netSide"], x
    if blocking:
        nearest = min(blocking, key=lambda o: z - o["z"])
        # Dodge toward the wider side of the channel.
        direction = -1 if nearest["x"] > x or x > LANE_LIMIT - 3 else 1
        if x < -LANE_LIMIT + 3:
            direction = 1
        target_x = nearest["x"] + direction * (nearest["radius"] + DODGE_OFFSET)
    elif me.get("lives", 3) < 3 and (lifesaver := _lifesaver_ahead(snapshot, course, x, z)):
        target_x = lifesaver["x"]
    elif targets:
        target = min(targets, key=lambda t: (z - t["z"]) + abs(t["x"] - x))
        net_side = 1 if target["x"] >= x else -1
        target_x = target["x"] - net_side * NET_REACH
    steer = _clamp((_clamp(target_x, -LANE_LIMIT, LANE_LIMIT) - x) / 3.0, -1.0, 1.0)

    gap = next((p["gap"] for p in snapshot.get("pursuits", []) if p["targetPlayerId"] == self_id), 64.0)
    obstacle_near = any(0 <= z - o["z"] <= BOOST_CLEARANCE and abs(o["x"] - x) < o["radius"] + 3.0
                        for o in course["obstacles"])
    boost = (me["energy"] > 0.6 and not obstacle_near) or (me["energy"] > 0.1 and gap < 12)
    return Intent(steer=round(steer, 3), net_side=net_side, boost=boost, jump=jump)
