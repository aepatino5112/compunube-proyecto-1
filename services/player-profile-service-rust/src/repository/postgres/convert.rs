//! Conversions between the unsigned domain numbers and `BIGINT` columns.

use crate::repository::RepositoryError;

pub fn to_i64(value: u64, what: &str) -> Result<i64, RepositoryError> {
    i64::try_from(value).map_err(|_| RepositoryError::Unexpected(format!("{what} exceeds BIGINT")))
}

pub fn to_u64(value: i64, what: &str) -> Result<u64, RepositoryError> {
    u64::try_from(value).map_err(|_| RepositoryError::Unexpected(format!("{what} is negative")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversions_reject_out_of_range_values() {
        assert_eq!(to_i64(5, "x"), Ok(5));
        assert!(to_i64(u64::MAX, "x").is_err());
        assert_eq!(to_u64(5, "x"), Ok(5));
        assert!(to_u64(-1, "x").is_err());
    }
}
