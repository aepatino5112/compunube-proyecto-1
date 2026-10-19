//! Settlement rules (E12). Go owns the race result; Rust only decides whether
//! the credit it is told to apply is acceptable and applies it once.

use super::{fingerprint::Canonical, profile::ProfileState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RaceOutcome {
    Finished,
    Disqualified,
    Left,
    Dnf,
}

impl RaceOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            RaceOutcome::Finished => "finished",
            RaceOutcome::Disqualified => "disqualified",
            RaceOutcome::Left => "left",
            RaceOutcome::Dnf => "dnf",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettlementRejection {
    InvalidSettlement,
    Conflict,
}

impl SettlementRejection {
    pub fn message(self) -> &'static str {
        match self {
            SettlementRejection::InvalidSettlement => "only a finished race may credit materials",
            SettlementRejection::Conflict => {
                "this race was already settled for the player with different data"
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SettlementRequest {
    pub race_id: String,
    pub player_id: String,
    pub outcome: RaceOutcome,
    pub credited_plastic: u64,
    pub credited_metal: u64,
}

/// Materials to add to the balance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Credit {
    pub plastic: u64,
    pub metal: u64,
}

impl Credit {
    pub fn is_zero(self) -> bool {
        self.plastic == 0 && self.metal == 0
    }

    /// Whether adding the credit keeps both balances representable in the
    /// `BIGINT` columns.
    pub fn fits(self, state: &ProfileState) -> bool {
        let limit = i64::MAX as u64;
        state
            .plastic
            .checked_add(self.plastic)
            .is_some_and(|v| v <= limit)
            && state
                .metal
                .checked_add(self.metal)
                .is_some_and(|v| v <= limit)
    }

    /// Mirrors the repository balance update for the response; saturating so
    /// it can never panic (`fits` is checked beforehand). The revision comes
    /// from the repository.
    pub fn apply_to_balances(self, state: &mut ProfileState) {
        state.plastic = state.plastic.saturating_add(self.plastic);
        state.metal = state.metal.saturating_add(self.metal);
    }
}

impl SettlementRequest {
    /// E9: the outcome has no column, so it lives in the fingerprint together
    /// with the credited amounts.
    pub fn fingerprint(&self) -> String {
        let mut canonical = Canonical::new("settlement");
        canonical
            .field("race_id", &self.race_id)
            .field("player_id", &self.player_id)
            .field("outcome", self.outcome.as_str())
            .number("credited_plastic", self.credited_plastic)
            .number("credited_metal", self.credited_metal);
        canonical.finish()
    }

    /// A finished race credits exactly what Go sent. Any other outcome with a
    /// positive credit is a contract violation by the caller.
    pub fn credit(&self) -> Result<Credit, SettlementRejection> {
        let credit = Credit {
            plastic: self.credited_plastic,
            metal: self.credited_metal,
        };
        if self.outcome != RaceOutcome::Finished && !credit.is_zero() {
            return Err(SettlementRejection::InvalidSettlement);
        }
        Ok(credit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::provisioning::initial_state;

    fn request(outcome: RaceOutcome, plastic: u64, metal: u64) -> SettlementRequest {
        SettlementRequest {
            race_id: "race-1".into(),
            player_id: "p1".into(),
            outcome,
            credited_plastic: plastic,
            credited_metal: metal,
        }
    }

    #[test]
    fn finished_credits_exactly_the_request_amounts() {
        let credit = request(RaceOutcome::Finished, 7, 3).credit().unwrap();
        assert_eq!((credit.plastic, credit.metal), (7, 3));
        let mut state = initial_state("p1");
        credit.apply_to_balances(&mut state);
        assert_eq!((state.plastic, state.metal, state.revision), (7, 3, 1));
    }

    #[test]
    fn finished_with_zero_credit_is_valid() {
        assert!(request(RaceOutcome::Finished, 0, 0)
            .credit()
            .unwrap()
            .is_zero());
    }

    #[test]
    fn dnf_disqualified_and_left_credit_nothing() {
        for outcome in [
            RaceOutcome::Dnf,
            RaceOutcome::Disqualified,
            RaceOutcome::Left,
        ] {
            assert!(
                request(outcome, 0, 0).credit().unwrap().is_zero(),
                "{outcome:?}"
            );
            for (plastic, metal) in [(1, 0), (0, 1), (5, 5)] {
                assert_eq!(
                    request(outcome, plastic, metal).credit(),
                    Err(SettlementRejection::InvalidSettlement),
                    "{outcome:?} {plastic}/{metal}"
                );
            }
        }
    }

    #[test]
    fn fingerprint_covers_every_field_including_the_outcome() {
        let base = request(RaceOutcome::Finished, 1, 2);
        let variants = [
            SettlementRequest {
                race_id: "race-2".into(),
                ..base.clone()
            },
            SettlementRequest {
                player_id: "p2".into(),
                ..base.clone()
            },
            SettlementRequest {
                outcome: RaceOutcome::Dnf,
                ..base.clone()
            },
            SettlementRequest {
                credited_plastic: 2,
                ..base.clone()
            },
            SettlementRequest {
                credited_metal: 3,
                ..base.clone()
            },
        ];
        assert_eq!(base.fingerprint(), base.clone().fingerprint());
        for variant in variants {
            assert_ne!(base.fingerprint(), variant.fingerprint(), "{variant:?}");
        }
    }

    #[test]
    fn credit_that_would_overflow_the_column_does_not_fit() {
        let mut state = initial_state("p1");
        state.plastic = i64::MAX as u64;
        assert!(!Credit {
            plastic: 1,
            metal: 0
        }
        .fits(&state));
        assert!(Credit {
            plastic: 0,
            metal: 1
        }
        .fits(&state));
    }
}
