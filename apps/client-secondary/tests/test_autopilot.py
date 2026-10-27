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


def test_keeps_dodging_an_obstacle_it_already_moved_beside():
    # Without hysteresis the obstacle stops counting as blocking once the surfer
    # is beside it, and the trash behind it pulls the surfer back into it.
    course = {**EMPTY, "obstacles": [{"itemId": "o1", "x": 0.0, "z": -108.0, "radius": 1.15}],
              "trash": [{"itemId": "t1", "x": -1.0, "z": -112.0}]}
    assert decide(state(x=2.6), course, "me").steer >= 0


def test_heads_for_a_lifesaver_only_after_losing_a_life():
    course = {**EMPTY, "lifesavers": [{"itemId": "l1", "x": -8.0, "z": -115.0}],
              "trash": [{"itemId": "t1", "x": 8.0, "z": -110.0}]}
    snapshot = state(lives=2)
    snapshot["lifesavers"] = [{"itemId": "l1", "collectedBy": None}]
    assert decide(snapshot, course, "me").steer < 0
    assert decide({**snapshot, "players": [{**snapshot["players"][0], "lives": 3}]}, course, "me").steer > 0
    snapshot["lifesavers"] = [{"itemId": "l1", "collectedBy": "rival"}]
    assert decide(snapshot, course, "me").steer > 0


def test_does_not_boost_into_an_obstacle_unless_the_octopus_is_close():
    course = {**EMPTY, "obstacles": [{"itemId": "o1", "x": 1.0, "z": -120.0, "radius": 1.8}]}
    assert not decide(state(energy=0.9), course, "me").boost
    snapshot = state(energy=0.9)
    snapshot["pursuits"][0]["gap"] = 8
    assert decide(snapshot, course, "me").boost
