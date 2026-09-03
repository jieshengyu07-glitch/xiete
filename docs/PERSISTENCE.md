# Persistence modes

Production must set `DATABASE_URL`; the PostgreSQL `users` and `jwxt_bindings`
tables are the authority for WeChat identity and JWXT binding metadata. The
existing JSON files remain a compatibility cache for sessions and product
data in this phase. PostgreSQL failures are surfaced and never silently fall
back to JSON in production.

Development defaults to `PERSISTENCE_MODE=json`. Set
`PERSISTENCE_MODE=postgres` together with `DATABASE_URL` to exercise the
repository layer locally.

The one-time `scripts/migrate-identity-to-postgres.js` command is dry-run by
default. Set `APPLY_MIGRATION=1` only after reviewing its aggregate output;
it never deletes the legacy JSON files.
