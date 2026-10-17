# CLAUDE.md

Read and follow `AGENTS.md` before making any change.

Treat `AGENTS.md` and `ARCHITECTURE.md` as the source of truth for service boundaries, resilience and repository conventions.

- Do not invent missing product rules.
- Keep changes scoped.
- Prefer existing conventions.
- Do not replace `compose.yml` with `docker-compose.yml`.
- Do not move authoritative match logic out of Go.
- Do not move persistent Player/Profile ownership out of Rust without an ADR.
