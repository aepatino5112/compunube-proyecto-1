//! Structural request validation (E43 `INVALID_ARGUMENT`): problems with the
//! shape of a request, not business outcomes. Identifier rules mirror the Go
//! gateway (`validID`): 1..=128 bytes, no control characters.

use std::fmt;

/// Exclusive upper bound for exchange amounts and settlement credits, the
/// `count()` limit of `economy.js`.
pub const MAX_AMOUNT: u64 = 1_000_000_000;

pub const MAX_ID_BYTES: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationError {
    pub field: &'static str,
    pub reason: &'static str,
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}", self.field, self.reason)
    }
}

impl std::error::Error for ValidationError {}

pub fn validate_id(field: &'static str, value: &str) -> Result<(), ValidationError> {
    if value.is_empty() {
        return Err(ValidationError {
            field,
            reason: "is required",
        });
    }
    if value.len() > MAX_ID_BYTES {
        return Err(ValidationError {
            field,
            reason: "is too long",
        });
    }
    if value.chars().any(|c| (c as u32) < 32 || c as u32 == 127) {
        return Err(ValidationError {
            field,
            reason: "contains control characters",
        });
    }
    Ok(())
}

/// Exchange amounts must be in `1..MAX_AMOUNT`.
pub fn validate_exchange_amount(amount: u64) -> Result<(), ValidationError> {
    if amount == 0 || amount >= MAX_AMOUNT {
        return Err(ValidationError {
            field: "amount",
            reason: "is out of range",
        });
    }
    Ok(())
}

/// Settlement credits must be below `MAX_AMOUNT` (zero is valid).
pub fn validate_credit(field: &'static str, amount: u64) -> Result<(), ValidationError> {
    if amount >= MAX_AMOUNT {
        return Err(ValidationError {
            field,
            reason: "is out of range",
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_follow_the_gateway_rules() {
        assert!(validate_id("player_id", "p-1").is_ok());
        assert!(validate_id("player_id", &"x".repeat(128)).is_ok());
        assert_eq!(
            validate_id("player_id", "").unwrap_err().to_string(),
            "player_id is required"
        );
        assert!(validate_id("player_id", &"x".repeat(129)).is_err());
        assert!(validate_id("player_id", "a\nb").is_err());
        assert!(validate_id("player_id", "a\u{7f}").is_err());
        assert!(validate_id("player_id", "ñandú").is_ok());
    }

    #[test]
    fn exchange_amount_bounds() {
        assert!(validate_exchange_amount(0).is_err());
        assert!(validate_exchange_amount(1).is_ok());
        assert!(validate_exchange_amount(MAX_AMOUNT - 1).is_ok());
        assert!(validate_exchange_amount(MAX_AMOUNT).is_err());
        assert!(validate_exchange_amount(u64::MAX).is_err());
    }

    #[test]
    fn credits_accept_zero_but_not_huge_values() {
        assert!(validate_credit("credited_plastic", 0).is_ok());
        assert!(validate_credit("credited_plastic", MAX_AMOUNT - 1).is_ok());
        assert!(validate_credit("credited_metal", MAX_AMOUNT).is_err());
    }
}
