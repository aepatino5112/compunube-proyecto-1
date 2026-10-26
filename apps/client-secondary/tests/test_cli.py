from compunube_client.cli import member_name


def test_member_name_never_shows_the_opaque_player_id():
    unprepared = {"playerId": "p_abcdef123", "displayName": "", "equipment": {"characterId": ""}}
    prepared = {"playerId": "p_abcdef123", "displayName": "p_abcdef123", "equipment": {"characterId": "luna"}}
    named = {"playerId": "p_x", "displayName": "Ana", "equipment": {"characterId": "nico"}}
    assert member_name(unprepared) == "Surfista (p_abcd)"
    assert member_name(prepared) == "Luna (p_abcd)"
    assert member_name(named) == "Ana"
