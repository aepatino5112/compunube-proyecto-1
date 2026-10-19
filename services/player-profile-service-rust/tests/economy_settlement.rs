//! SettleRace against PostgreSQL through the application layer (F52-T5).
//! Needs a migrated database, see `tests/common/mod.rs`.

mod common;

use std::sync::Arc;

use common::{unique, Env};
use player_profile_service::{
    application::{ApplicationError, PlayerProfileApp, SettleRaceCommand, SettlementOutcome},
    domain::{ProfileState, RaceOutcome, SettlementRejection as S},
    repository::postgres,
};

macro_rules! env {
    ($name:expr) => {
        match common::env($name).await {
            Some(env) => env,
            None => return,
        }
    };
}

fn command(
    race: &str,
    player: &str,
    outcome: RaceOutcome,
    plastic: u64,
    metal: u64,
) -> SettleRaceCommand {
    SettleRaceCommand {
        race_id: race.into(),
        player_id: player.into(),
        outcome,
        credited_plastic: plastic,
        credited_metal: metal,
    }
}

async fn settle(app: &PlayerProfileApp, c: SettleRaceCommand) -> SettlementOutcome {
    app.settle_race(c).await.unwrap().outcome
}

fn ok(outcome: SettlementOutcome) -> (bool, ProfileState) {
    match outcome {
        SettlementOutcome::Applied { replayed, profile } => (replayed, profile),
        other => panic!("expected an applied settlement, got {other:?}"),
    }
}

fn refused(outcome: SettlementOutcome) -> (S, bool) {
    match outcome {
        SettlementOutcome::Rejected {
            rejection,
            replayed,
        } => (rejection, replayed),
        other => panic!("expected a rejection, got {other:?}"),
    }
}

async fn settlement_rows(env: &Env, player: &str) -> i64 {
    env.count(
        "SELECT count(*) FROM player.settlements WHERE player_id = $1",
        player,
    )
    .await
}

#[tokio::test]
async fn a_finished_race_credits_exactly_the_request_amounts_once() {
    let env = env!("a_finished_race_credits_exactly_the_request_amounts_once");
    let player = unique("settle");
    let race = unique("race");
    let (replayed, profile) = ok(settle(
        &env.app,
        command(&race, &player, RaceOutcome::Finished, 7, 3),
    )
    .await);
    assert!(!replayed, "first application is not a replay");
    assert_eq!((profile.plastic, profile.metal, profile.coins), (7, 3, 0));
    assert_eq!(profile.revision, 2, "provisioned at 1, credit bumps to 2");
    let stored: (i64, i64, i64) = sqlx::query_as(
        "SELECT credited_plastic, credited_metal, profile_revision_after FROM player.settlements \
         WHERE race_id = $1 AND player_id = $2",
    )
    .bind(&race)
    .bind(&player)
    .fetch_one(&env.pool)
    .await
    .unwrap();
    assert_eq!(stored, (7, 3, 2));

    // replay: same result, zero extra effect
    let (replayed, again) = ok(settle(
        &env.app,
        command(&race, &player, RaceOutcome::Finished, 7, 3),
    )
    .await);
    assert!(replayed);
    assert_eq!(again, profile);
    assert_eq!(settlement_rows(&env, &player).await, 1);

    // the credited materials are usable right away
    let (_, crafted) = common::applied(env.craft(&player, "craft-1", "red-reuso").await);
    assert_eq!((crafted.plastic, crafted.metal), (1, 0));
}

#[tokio::test]
async fn the_same_race_and_player_with_different_data_is_a_conflict() {
    let env = env!("the_same_race_and_player_with_different_data_is_a_conflict");
    let player = unique("sconf");
    let race = unique("race");
    let (_, profile) = ok(settle(
        &env.app,
        command(&race, &player, RaceOutcome::Finished, 5, 5),
    )
    .await);

    for changed in [
        command(&race, &player, RaceOutcome::Finished, 6, 5),
        command(&race, &player, RaceOutcome::Finished, 5, 6),
        command(&race, &player, RaceOutcome::Finished, 0, 0),
        command(&race, &player, RaceOutcome::Dnf, 0, 0),
        command(&race, &player, RaceOutcome::Left, 0, 0),
        command(&race, &player, RaceOutcome::Disqualified, 0, 0),
    ] {
        assert_eq!(
            refused(settle(&env.app, changed.clone()).await),
            (S::Conflict, false),
            "{changed:?}"
        );
    }
    assert_eq!(
        env.profile(&player).await,
        profile,
        "a conflict credits nothing"
    );
    assert_eq!(settlement_rows(&env, &player).await, 1);
    // the original still replays
    let (replayed, _) = ok(settle(
        &env.app,
        command(&race, &player, RaceOutcome::Finished, 5, 5),
    )
    .await);
    assert!(replayed);
}

#[tokio::test]
async fn a_non_finished_outcome_with_a_credit_is_invalid_and_leaves_no_trace() {
    let env = env!("a_non_finished_outcome_with_a_credit_is_invalid");
    let player = unique("sinvalid");
    let race = unique("race");
    for outcome in [
        RaceOutcome::Dnf,
        RaceOutcome::Disqualified,
        RaceOutcome::Left,
    ] {
        for (plastic, metal) in [(1, 0), (0, 1), (9, 9)] {
            assert_eq!(
                refused(settle(&env.app, command(&race, &player, outcome, plastic, metal)).await),
                (S::InvalidSettlement, false),
                "{outcome:?} {plastic}/{metal}"
            );
        }
    }
    let profile = env.profile(&player).await;
    assert_eq!(
        (profile.plastic, profile.metal, profile.revision),
        (0, 0, 1)
    );
    assert_eq!(
        settlement_rows(&env, &player).await,
        0,
        "invalid settlements are not stored"
    );
    // so the same key may still be settled correctly afterwards
    let (replayed, _) = ok(settle(&env.app, command(&race, &player, RaceOutcome::Dnf, 0, 0)).await);
    assert!(!replayed);
}

#[tokio::test]
async fn dnf_disqualified_and_left_settle_with_zero_credit_and_keep_the_revision() {
    let env = env!("dnf_disqualified_and_left_settle_with_zero_credit");
    let player = unique("szero");
    env.fund(&player, 3, 4, 5).await;
    for outcome in [
        RaceOutcome::Dnf,
        RaceOutcome::Disqualified,
        RaceOutcome::Left,
    ] {
        let race = unique("race");
        let (replayed, profile) =
            ok(settle(&env.app, command(&race, &player, outcome, 0, 0)).await);
        assert!(!replayed);
        assert_eq!(
            (
                profile.coins,
                profile.plastic,
                profile.metal,
                profile.revision
            ),
            (3, 4, 5, 1)
        );
        // the zero-credit settlement is still the single record for the key
        let (replayed, _) = ok(settle(&env.app, command(&race, &player, outcome, 0, 0)).await);
        assert!(replayed);
        assert_eq!(
            refused(
                settle(
                    &env.app,
                    command(&race, &player, RaceOutcome::Finished, 1, 1)
                )
                .await
            ),
            (S::Conflict, false)
        );
    }
    assert_eq!(settlement_rows(&env, &player).await, 3);
    // a finished race with nothing collected is valid and also keeps the revision
    let (_, profile) = ok(settle(
        &env.app,
        command(&unique("race"), &player, RaceOutcome::Finished, 0, 0),
    )
    .await);
    assert_eq!(profile.revision, 1);
}

#[tokio::test]
async fn settlement_provisions_an_unknown_player() {
    let env = env!("settlement_provisions_an_unknown_player");
    let player = unique("snew");
    let (_, profile) = ok(settle(
        &env.app,
        command(&unique("race"), &player, RaceOutcome::Finished, 2, 0),
    )
    .await);
    assert_eq!(profile.owned_item_ids.len(), 12);
    assert_eq!(profile.plastic, 2);
}

#[tokio::test]
async fn malformed_settlements_are_invalid_arguments_and_store_nothing() {
    let env = env!("malformed_settlements_are_invalid_arguments");
    let player = unique("sbad");
    for bad in [
        command("", &player, RaceOutcome::Finished, 0, 0),
        command("race", "", RaceOutcome::Finished, 0, 0),
        command("race", &player, RaceOutcome::Finished, 1_000_000_000, 0),
        command("race", &player, RaceOutcome::Finished, 0, u64::MAX),
    ] {
        assert!(
            matches!(
                env.app.settle_race(bad.clone()).await,
                Err(ApplicationError::InvalidArgument(_))
            ),
            "{bad:?}"
        );
    }
    assert_eq!(
        env.count(
            "SELECT count(*) FROM player.profiles WHERE player_id = $1",
            &player
        )
        .await,
        0
    );
}

#[tokio::test]
async fn concurrent_duplicates_of_one_settlement_credit_once() {
    let env = Arc::new(env!("concurrent_duplicates_of_one_settlement"));
    let player = unique("sdup");
    let race = unique("race");
    let mut tasks = Vec::new();
    for _ in 0..12 {
        let env = env.clone();
        let (race, player) = (race.clone(), player.clone());
        tasks.push(tokio::spawn(async move {
            settle(
                &env.app,
                command(&race, &player, RaceOutcome::Finished, 4, 2),
            )
            .await
        }));
    }
    let (mut fresh, mut replays) = (0, 0);
    for task in tasks {
        let (replayed, profile) = ok(task.await.unwrap());
        assert_eq!((profile.plastic, profile.metal), (4, 2));
        if replayed {
            replays += 1
        } else {
            fresh += 1
        }
    }
    assert_eq!((fresh, replays), (1, 11));
    assert_eq!(settlement_rows(&env, &player).await, 1);
    assert_eq!(env.profile(&player).await.revision, 2);
}

#[tokio::test]
async fn concurrent_settlements_of_different_races_all_apply_and_add_up() {
    let env = Arc::new(env!("concurrent_settlements_of_different_races"));
    let player = unique("smany");
    env.fund(&player, 0, 0, 0).await;
    let mut tasks = Vec::new();
    for n in 0..10 {
        let env = env.clone();
        let player = player.clone();
        tasks.push(tokio::spawn(async move {
            settle(
                &env.app,
                command(
                    &format!("race-{n}-{player}"),
                    &player,
                    RaceOutcome::Finished,
                    3,
                    1,
                ),
            )
            .await
        }));
    }
    for task in tasks {
        assert!(!ok(task.await.unwrap()).0);
    }
    let profile = env.profile(&player).await;
    assert_eq!(
        (profile.plastic, profile.metal, profile.revision),
        (30, 10, 11)
    );
    assert_eq!(settlement_rows(&env, &player).await, 10);
}

#[tokio::test]
async fn a_settlement_survives_a_service_restart() {
    let env = env!("a_settlement_survives_a_service_restart");
    let player = unique("srestart");
    let race = unique("race");
    let (_, before) = ok(settle(
        &env.app,
        command(&race, &player, RaceOutcome::Finished, 6, 6),
    )
    .await);

    // "restart": everything in memory is gone, only PostgreSQL remains.
    env.pool.close().await;
    let url = std::env::var(common::URL_VAR).unwrap();
    let pool = common::test_pool(&url, 5).await;
    let restarted = PlayerProfileApp::new(postgres::repositories(pool));
    let (replayed, after) = ok(settle(
        &restarted,
        command(&race, &player, RaceOutcome::Finished, 6, 6),
    )
    .await);
    assert!(replayed);
    assert_eq!(after, before);
    assert_eq!(
        refused(
            settle(
                &restarted,
                command(&race, &player, RaceOutcome::Finished, 7, 6)
            )
            .await
        ),
        (S::Conflict, false)
    );
}

#[tokio::test]
async fn a_credit_that_would_overflow_a_balance_column_is_invalid_and_leaves_no_trace() {
    let env = env!("a_credit_that_would_overflow_a_balance_column");
    let player = unique("sfull");
    let limit = i64::MAX;
    env.fund(&player, 0, limit - 2, limit - 2).await;
    for (plastic, metal) in [(3, 0), (0, 3), (3, 3)] {
        assert_eq!(
            refused(
                settle(
                    &env.app,
                    command(
                        &unique("race"),
                        &player,
                        RaceOutcome::Finished,
                        plastic,
                        metal
                    )
                )
                .await
            ),
            (S::InvalidSettlement, false),
            "{plastic}/{metal}"
        );
    }
    let profile = env.profile(&player).await;
    assert_eq!(
        (profile.plastic, profile.metal, profile.revision),
        (limit as u64 - 2, limit as u64 - 2, 1)
    );
    assert_eq!(settlement_rows(&env, &player).await, 0);

    // the largest credit that still fits is accepted, and fills the column
    let race = unique("race");
    let (replayed, profile) = ok(settle(
        &env.app,
        command(&race, &player, RaceOutcome::Finished, 2, 1),
    )
    .await);
    assert!(!replayed);
    assert_eq!(
        (profile.plastic, profile.metal, profile.revision),
        (limit as u64, limit as u64 - 1, 2)
    );
    assert_eq!(settlement_rows(&env, &player).await, 1);
}
