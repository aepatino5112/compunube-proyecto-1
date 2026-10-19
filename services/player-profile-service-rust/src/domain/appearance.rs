//! Skin tones and hair colours of the online catalog (E4). They have no
//! table, so they are constants copied verbatim from
//! `apps/web/dist/appearance.js` and bound to catalog `online-v1`.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AppearanceOption {
    pub id: &'static str,
    pub name: &'static str,
    pub color: &'static str,
}

const fn option(id: &'static str, name: &'static str, color: &'static str) -> AppearanceOption {
    AppearanceOption { id, name, color }
}

pub const SKIN_TONES: [AppearanceOption; 5] = [
    option("light", "Claro", "#edbfa0"),
    option("warm", "Claro cálido", "#d99c6e"),
    option("medium", "Medio", "#ad6b45"),
    option("dark", "Oscuro", "#754630"),
    option("deep", "Profundo", "#49312b"),
];

pub const HAIR_COLORS: [AppearanceOption; 6] = [
    option("black", "Negro", "#29201d"),
    option("brown", "Castaño", "#71442c"),
    option("blonde", "Rubio", "#e3af3d"),
    option("copper", "Cobrizo", "#ba6339"),
    option("silver", "Plateado", "#b8c2c7"),
    option("blue", "Azul", "#5884b7"),
];

pub const DEFAULT_SKIN: &str = "medium";
pub const DEFAULT_HAIR_COLOR: &str = "brown";

pub fn is_skin_tone(id: &str) -> bool {
    SKIN_TONES.iter().any(|option| option.id == id)
}

pub fn is_hair_color(id: &str) -> bool {
    HAIR_COLORS.iter().any(|option| option.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_match_the_prototype() {
        let skins: Vec<_> = SKIN_TONES.iter().map(|o| o.id).collect();
        assert_eq!(skins, ["light", "warm", "medium", "dark", "deep"]);
        let hair: Vec<_> = HAIR_COLORS.iter().map(|o| o.id).collect();
        assert_eq!(
            hair,
            ["black", "brown", "blonde", "copper", "silver", "blue"]
        );
        assert_eq!(SKIN_TONES[1].name, "Claro cálido");
        assert_eq!(HAIR_COLORS[5].color, "#5884b7");
    }

    #[test]
    fn membership_is_exact() {
        assert!(is_skin_tone("deep"));
        assert!(!is_skin_tone("Deep"));
        assert!(!is_skin_tone(""));
        assert!(!is_skin_tone("blue"));
        assert!(is_hair_color("blue"));
        assert!(!is_hair_color("deep"));
        assert!(is_skin_tone(DEFAULT_SKIN) && is_hair_color(DEFAULT_HAIR_COLOR));
    }
}
