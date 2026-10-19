//! Canonical request fingerprints (E9). A fingerprint is the SHA-256 (lower
//! hex) of `name=<byte length>:<value>` lines, so no choice of values can
//! shift a boundary between two fields and collide with another request.

use sha2::{Digest, Sha256};

#[derive(Debug, Default)]
pub struct Canonical {
    text: String,
}

impl Canonical {
    pub fn new(kind: &str) -> Self {
        let mut canonical = Self::default();
        canonical.field("kind", kind);
        canonical
    }

    pub fn field(&mut self, name: &str, value: &str) -> &mut Self {
        self.text
            .push_str(&format!("{name}={}:{value}\n", value.len()));
        self
    }

    pub fn number(&mut self, name: &str, value: u64) -> &mut Self {
        self.field(name, &value.to_string())
    }

    pub fn finish(&self) -> String {
        let digest = Sha256::digest(self.text.as_bytes());
        digest.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digest_is_stable_lower_hex_sha256() {
        let mut canonical = Canonical::new("t");
        canonical.field("a", "b");
        let first = canonical.finish();
        assert_eq!(first.len(), 64);
        assert!(first
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_eq!(first, canonical.finish());
    }

    #[test]
    fn field_boundaries_cannot_be_shifted() {
        let mut a = Canonical::new("t");
        a.field("x", "1\ny=1:2");
        let mut b = Canonical::new("t");
        b.field("x", "1").field("y", "2");
        assert_ne!(a.finish(), b.finish());
    }

    #[test]
    fn kind_participates_in_the_digest() {
        let mut a = Canonical::new("buy");
        a.field("item_id", "sol");
        let mut b = Canonical::new("craft");
        b.field("item_id", "sol");
        assert_ne!(a.finish(), b.finish());
    }
}
