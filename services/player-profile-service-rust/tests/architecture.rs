//! Structural checks for the layering in D29 and the persistence ownership in
//! E41. They scan the crate sources so they run without PostgreSQL.

use std::{
    fs,
    path::{Path, PathBuf},
};

fn src_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

fn sources_under(relative: &str) -> Vec<(PathBuf, String)> {
    let mut files = Vec::new();
    rust_files(&src_root().join(relative), &mut files);
    files
        .into_iter()
        .map(|path| {
            let text = fs::read_to_string(&path).unwrap();
            (path, text)
        })
        .collect()
}

fn all_sources() -> Vec<(PathBuf, String)> {
    sources_under("")
}

/// Production code only: drops `#[cfg(test)] mod tests { ... }` (always the file
/// tail in this crate) and comment lines, so fixtures and documentation that
/// mention a forbidden word do not count.
fn production_part(text: &str) -> String {
    text.split("#[cfg(test)]")
        .next()
        .unwrap_or(text)
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn assert_absent(files: &[(PathBuf, String)], needles: &[&str], why: &str) {
    for (path, text) in files {
        let code = production_part(text);
        for needle in needles {
            assert!(
                !code.contains(needle),
                "{}: found `{needle}` ({why})",
                path.display()
            );
        }
    }
}

#[test]
fn sources_are_discovered() {
    assert!(all_sources().len() >= 10, "scan found too few files");
    assert!(!sources_under("application").is_empty());
    assert!(!sources_under("repository/postgres").is_empty());
}

#[test]
fn application_depends_only_on_repository_ports() {
    assert_absent(
        &sources_under("application"),
        &[
            "sqlx",
            "repository::postgres",
            "tonic",
            "crate::pb",
            "crate::transport",
        ],
        "application must see ports only, not SQL, adapters or transport",
    );
}

#[test]
fn domain_is_free_of_infrastructure() {
    assert_absent(
        &sources_under("domain"),
        &[
            "sqlx",
            "tonic",
            "crate::repository",
            "crate::transport",
            "crate::application",
        ],
        "domain must not depend on storage or transport",
    );
}

#[test]
fn transport_never_touches_storage() {
    assert_absent(
        &sources_under("transport"),
        &["sqlx", "repository::postgres", "crate::repository"],
        "transport talks to the application layer only",
    );
}

#[test]
fn sqlx_and_sql_are_confined_to_the_postgres_adapter() {
    let outside: Vec<_> = all_sources()
        .into_iter()
        .filter(|(path, _)| !path.starts_with(src_root().join("repository/postgres")))
        .collect();
    assert_absent(
        &outside,
        &[
            "sqlx",
            "SELECT ",
            "INSERT INTO",
            "UPDATE player",
            "DELETE FROM",
        ],
        "all SQL belongs to repository::postgres",
    );
}

#[test]
fn rust_never_references_the_match_schema() {
    // `match` is owned by Go. Rust may only reference `player.*` and the
    // administrative `public.schema_migrations`.
    let forbidden = [
        "match.rooms",
        "match.races",
        "match.race_participants",
        "match.settlement_delivery",
        "FROM match.",
        "JOIN match.",
        "INTO match.",
        "UPDATE match.",
        "match.\"",
    ];
    for (path, text) in all_sources() {
        for needle in forbidden {
            assert!(
                !text.contains(needle),
                "{}: references the Go-owned `match` schema via `{needle}`",
                path.display()
            );
        }
    }
}

#[test]
fn sql_only_targets_the_player_schema_or_migration_history() {
    for (path, text) in sources_under("repository/postgres") {
        for line in production_part(&text).lines() {
            let upper = line.to_uppercase();
            if let Some(index) = upper.find("FROM ").or_else(|| upper.find("JOIN ")) {
                let rest = line[index + 5..].trim_start();
                let relation: String = rest
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '.')
                    .collect();
                if relation.contains('.') {
                    assert!(
                        relation.starts_with("player.")
                            || relation.starts_with("pg_catalog.")
                            || relation == "public.schema_migrations",
                        "{}: unexpected relation `{relation}`",
                        path.display()
                    );
                }
            }
        }
    }
}
