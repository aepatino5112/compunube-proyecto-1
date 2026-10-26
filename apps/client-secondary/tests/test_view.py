from compunube_client import view

COURSE = {"lengthUnits": 900, "obstacles": [{"itemId": "o1", "x": 0, "z": -20, "radius": 2}],
          "trash": [{"itemId": "t1", "x": 3, "z": -10, "material": "plastic"},
                    {"itemId": "t2", "x": -3, "z": -12, "material": "metal"},
                    {"itemId": "t3", "x": 0, "z": -300, "material": "plastic"}],
          "lifesavers": [{"itemId": "l1", "x": 5, "z": -30}]}
START = {"course": COURSE, "roster": [{"playerId": "p_me"}, {"playerId": "p_other"}]}


def player(player_id, z, **extra):
    return {"playerId": player_id, "participantState": "racing", "x": 0, "z": z, "lives": 3, "energy": 0.5,
            "collectedPlastic": 1, "collectedMetal": 0, **extra}


def snapshot(*players, trash=(), lifesavers=()):
    return {"raceId": "r", "tick": 1, "elapsedMs": 12300, "players": list(players),
            "trash": [{"itemId": i, "collectedBy": "p_me"} for i in trash],
            "lifesavers": [{"itemId": i, "collectedBy": "p_me"} for i in lifesavers]}


def test_member_name_never_shows_the_opaque_player_id():
    assert view.member_name({"playerId": "p_abcdef", "displayName": "p_abcdef",
                             "equipment": {"characterId": "amara"}}) == "Amara (p_abcd)"
    assert view.member_name({"playerId": "p_abcdef", "displayName": ""}) == "Surfista (p_abcd)"


def test_room_lines_mark_self_disconnection_and_reduce_choice():
    room = {"roomId": "room-1", "mapId": "orinoco", "state": "LOBBY", "capacity": 4, "members": [
        {"playerId": "p_me", "displayName": "", "connected": True, "ready": True, "participantState": "ready",
         "reduceChoice": "reusable", "equipment": {"characterId": "nico"}},
        {"playerId": "p_other", "displayName": "", "connected": False, "ready": False,
         "participantState": "not_ready", "reduceChoice": None, "equipment": {"characterId": "luna"}}]}
    lines = view.room_lines(room, "p_me")
    assert lines[0] == "Sala room-1 · orinoco · En el lobby · 2/4"
    assert "Nico (p_me)" in lines[1] and "listo" in lines[1] and "tú" in lines[1] and "reutilizable" in lines[1]
    assert "not_ready" in lines[2] and "desconectado" in lines[2]
    assert view.room_lines(None, "p_me") == []


def test_catalog_rows_show_catalog_prices_and_ownership():
    catalog = {"items": [
        {"itemId": "nico", "itemType": "character", "name": "Nico", "purchasable": False, "craftable": False},
        {"itemId": "sol", "itemType": "board", "name": "Sol", "purchasable": True, "priceCoins": 40,
         "craftable": False},
        {"itemId": "faro", "itemType": "net", "name": "Faro", "purchasable": False, "priceCoins": 0,
         "craftable": True, "recipePlastic": 6, "recipeMetal": 2},
        {"itemId": "luna", "itemType": "character", "name": "Luna", "purchasable": False, "craftable": False}]}
    profile = {"ownedItemIds": ["nico", "luna"], "equipment": {"characterId": "nico"}}
    rows = dict(view.catalog_rows(catalog, profile))
    assert rows["nico"].endswith("equipado")
    assert rows["luna"].endswith("en tu equipo")
    assert rows["sol"].endswith("40 monedas")
    assert rows["faro"].endswith("6 plástico + 2 chatarra")
    assert view.catalog_rows(None, profile) == []


def test_result_lines_rank_finishers_first_and_show_settlement():
    result = {"participants": [
        {"playerId": "p_other", "outcome": "disqualified", "rank": None, "finishTimeMs": None,
         "credited": {"plastic": 0, "metal": 0}, "settlementState": "confirmed", "reduceChoice": "reusable"},
        {"playerId": "p_me", "outcome": "finished", "rank": 1, "finishTimeMs": 61234,
         "credited": {"plastic": 4, "metal": 2}, "settlementState": "pending", "reduceChoice": "disposable"}]}
    lines = view.result_lines(result, "p_me")
    assert lines[0] == " #1 Tú: llegó · 61.2 s · 4 plástico + 2 chatarra (acreditación pendiente)"
    assert lines[1].startswith("  — p_other: sin vidas · sin tiempo")
    assert "desechable" in lines[2]


def test_projection_keeps_only_the_window_around_the_own_surfer():
    assert view.project(0, -10, 0, 300, 750) == (150, 750 - 25 / 75 * 750)
    assert view.project(-15, 0, 0, 300, 750)[0] == 0
    assert view.project(0, -61, 0, 300, 750) is None
    assert view.project(0, 16, 0, 300, 750) is None


def test_race_shapes_hide_collected_pickups_and_left_players():
    snap = snapshot(player("p_me", 0), player("p_other", -5, participantState="left"), trash=["t1"])
    kinds = [shape.kind for shape in view.race_shapes(START, snap, "p_me", 300, 750)]
    assert kinds.count("metal") == 1 and "plastic" not in kinds
    assert kinds.count("obstacle") == 1 and kinds.count("lifesaver") == 1
    assert kinds.count("player") == 1 and "finish" not in kinds
    near_end = view.race_shapes(START, snapshot(player("p_me", -880)), "p_me", 300, 750)
    assert [shape.label for shape in near_end if shape.kind == "finish"] == ["META"]


def test_hud_reports_progress_position_and_lives():
    snap = snapshot(player("p_me", -450), player("p_other", -500))
    text = view.hud_text(snap, "p_me", 900)
    assert "12.3 s" in text and "450/900 m" in text and "puesto 2" in text and "vidas 3" in text
    assert view.hud_text(None, "p_me").startswith("Esperando")
