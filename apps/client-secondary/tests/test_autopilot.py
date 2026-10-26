from compunube_client.autopilot import decide


def state(**player):
    me = {"playerId": "me", "participantState": "racing", "x": 0.0, "z": -100.0, "jumpHeight": 0.0,
          "energy": 0.0, "netSide": 1}
    me.update(player)
    return {"players": [me], "trash": [], "pursuits": [{"targetPlayerId": "me", "gap": 48.0}]}


EMPTY = {"obstacles": [], "trash": [], "lifesavers": []}


def test_jumps_an_obstacle_inside_the_jump_window_and_steers_away():
    course = {**EMPTY, "obstacles": [{"itemId": "o1", "x": 0.3, "z": -104.0, "radius": 1.15}]}
    intent = decide(state(), course, "me")
    assert intent.jump and intent.steer < 0
    assert not decide(state(jumpHeight=0.4), course, "me").jump


def test_ignores_obstacles_behind_or_far_to_the_side():
    course = {**EMPTY, "obstacles": [{"itemId": "o1", "x": 0.0, "z": -95.0, "radius": 1.8},
                                     {"itemId": "o2", "x": 9.0, "z": -104.0, "radius": 1.15}]}
    assert decide(state(), course, "me").jump is False


def test_aims_the_net_at_uncollected_trash_only():
    course = {**EMPTY, "trash": [{"itemId": "t1", "x": -6.0, "z": -110.0},
                                 {"itemId": "t2", "x": 6.0, "z": -108.0}]}
    snapshot = state()
    intent = decide(snapshot, course, "me")
    assert intent.net_side == 1 and intent.steer > 0
    snapshot["trash"] = [{"itemId": "t2", "collectedBy": "rival"}, {"itemId": "t1", "collectedBy": None}]
    intent = decide(snapshot, course, "me")
    assert intent.net_side == -1 and intent.steer < 0


def test_boosts_only_with_energy_and_stops_when_terminal():
    assert decide(state(energy=0.8), EMPTY, "me").boost
    assert not decide(state(energy=0.0), EMPTY, "me").boost
    snapshot = state(energy=0.3)
    snapshot["pursuits"][0]["gap"] = 10
    assert decide(snapshot, EMPTY, "me").boost
    neutral = decide(state(participantState="finished", energy=1.0), EMPTY, "me")
    assert (neutral.steer, neutral.boost, neutral.jump) == (0.0, False, False)
