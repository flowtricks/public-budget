# Agent instructions for Public Budget forks

This is a single-household application. Start from this repository's fresh history. Never add another household's data, credentials, deployment config, local browser data, backup files, or Git history.

1. Read `README.md` and inspect `wrangler.production.example.jsonc` before changing deployment settings. Use the fork owner's own Cloudflare and Plaid accounts only. Keep `wrangler.production.jsonc` private and Git-ignored.
2. Run `npm ci`, `npm run setup`, `npm run db:local`, `npm run build`, and `npm test` for local work. Local `wrangler.jsonc` is isolated. Never point a preview at an existing production database without explicit owner direction.
3. Create a new D1 database with `npx wrangler d1 create`, replace the placeholder UUID in the owner's private production config, and apply migrations with `--remote` only to that new database. Confirm the database name and Worker name before any deployment or import.
4. Store `PASSWORD_HASH`, `TOKEN_KEY`, `PLAID_CLIENT_ID`, and `PLAID_SECRET` as Worker secrets. Treat `.dev.vars`, Goodbudget CSVs, `artifacts/`, and any generated SQL as private. Do not paste secrets or financial rows into logs, issues, commits, or chat.
5. Goodbudget's full-history import requires a new empty D1 database. Run `npm run import:prepare:goodbudget -- <private-csv> artifacts/imports/<new-name>`, inspect its report, then apply its SQL to the same database. Do not import a source file twice or link banks before reconciling history.
6. Before publishing a fork, inspect `git status`, `git diff --cached`, all committed files, and Git history for private values. A `.gitignore` rule cannot remove a value already committed. Keep the public logo catalog generic; do not add household payees, card endings, or personal artwork.
