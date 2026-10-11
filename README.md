# Public Budget

An envelope budget you can run in your own Cloudflare account. The app includes a React interface, a Cloudflare Worker, a D1 database, offline browser storage, optional Plaid bank connections, and a Goodbudget history importer. This repository contains no household transactions, bank credentials, or live deployment settings.

The application code is available under the [MIT License](LICENSE). Third-party names, logos, card artwork, and trademarks belong to their respective owners.

Each fork is a separate **single-household** installation. People sharing one installation use its shared password and database. This is not a hosted multi-tenant service.

## What you need

- Node.js and npm.
- A [Cloudflare account](https://dash.cloudflare.com/sign-up). Start with the Workers Free plan and a free D1 database; [Cloudflare's D1 guide](https://developers.cloudflare.com/d1/get-started/) walks through account and database creation. Check [current Workers](https://developers.cloudflare.com/workers/platform/pricing/) and [D1](https://developers.cloudflare.com/d1/platform/pricing/) limits for your expected usage.
- Optional for real bank syncing: your own [Plaid developer Dashboard account](https://dashboard.plaid.com/signup). If you are a person using this for your own finances, apply for Plaid's **Trial** plan for a personal finance project, rather than selecting a paid business plan. Plaid says the free Trial is for eligible new US/Canadian teams and allows up to 10 Production Items; removing an Item does not restore that allowance. [Trial eligibility and terms](https://plaid.com/docs/account/billing/). Sandbox uses test bank data only.
- Optional for migration: a CSV exported from **your own** Goodbudget account.

## 1. Make your own copy and test locally

Fork this repository on GitHub or download its source. In your copy:

```sh
npm ci
npm run setup
npm run db:local
npm run build
npm run preview
```

Open `http://127.0.0.1:8787`. `npm run setup` writes `.dev.vars` with a salted password verifier and bank-token encryption key. If you did not supply `BUDGET_SETUP_PASSWORD`, it also writes a random password to `.local-access-password`. Save that password in a password manager, then delete the plaintext file. Both files are ignored by Git. Local preview uses an isolated local D1 database; it never connects to another person's production database.

You can use the demo mode without adding your own records. `npm test` runs the automated tests. The app's **Settings → Export all data** produces a private backup CSV; keep backups outside the repository.

## 2. Create your Cloudflare Worker and D1 database

1. Sign into your new Cloudflare account with `npx wrangler login`.
2. Copy `wrangler.production.example.jsonc` to `wrangler.production.jsonc`. This destination file is ignored by Git.
3. Choose a unique Worker name and D1 database name for your own installation. Replace both `CHANGE-ME-budget` values in the copied config.
4. Create the database using **your** database name:

   ```sh
   npx wrangler d1 create YOUR_DATABASE_NAME
   ```

5. Copy the database UUID from Wrangler's output into `database_id` in `wrangler.production.jsonc`. Leave its binding name as `DB`.
6. Initialize your new **remote** database, build, and deploy:

   ```sh
   npx wrangler d1 migrations apply DB --remote --config wrangler.production.jsonc
   npm run deploy
   ```

Wrangler prints your own `https://...workers.dev` address. Put that exact host into the `PLAID_WEBHOOK_URL` value in your private production config, followed by `/api/plaid/webhook`, and redeploy. For example, `https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/api/plaid/webhook`. The example config intentionally contains no Cloudflare account ID, database UUID, or usable webhook address. See [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) for the local/remote distinction.

## 3. Set your private Worker secrets

Use the values created for **this fork** by `npm run setup` in `.dev.vars`. Add them to your own Worker:

```sh
npx wrangler secret put PASSWORD_HASH --config wrangler.production.jsonc
npx wrangler secret put TOKEN_KEY --config wrangler.production.jsonc
```

When prompted, paste the value **inside** the quotes for the corresponding name in `.dev.vars`; do not paste the name or quotes. Never put these values in `wrangler*.jsonc`, a commit, an issue, or a screenshot. Cloudflare documents [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/). Preserve `TOKEN_KEY` after connecting banks, because it decrypts stored bank tokens.

Visit your deployed address and sign in with the password generated during setup. If you change the shared password later, rotate only `PASSWORD_HASH` using a new verifier and keep `TOKEN_KEY` intact.

## 4. Export and import Goodbudget history

On the [Goodbudget website](https://goodbudget.com/), open your Transactions list and click **Export CSV** above it. [Goodbudget's export instructions](https://goodbudget.com/help/customize-your-goodbudget/export-transactions/) show the location. Keep the downloaded CSV private; it contains your financial history. Import **before** linking banks, so you can inspect any overlapping transactions.

For a **fresh, empty** D1 database, the full history adapter preserves splits, envelope transfers, and the original CSV rows. Run these commands from the project directory, replacing the file path with your export:

```sh
npm run import:prepare:goodbudget -- /absolute/path/to/Goodbudget.csv artifacts/imports/goodbudget-first-import
```

The script reads only your remote database's generation and record count, refuses a database that already contains records, validates every CSV row, and writes `import.sql`, `state.json`, and `report.json` under the Git-ignored `artifacts/` directory. Review `report.json`: compare the transaction and envelope counts, dates, and total against Goodbudget. When they look right, apply the prepared SQL to **your** D1 database:

```sh
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --file=artifacts/imports/goodbudget-first-import/import.sql
```

Refresh the app and check balances and several older transactions. The Goodbudget history CSV does not supply envelope targets or every setting; set targets and check account balances in the app after import. Keep the original export and the generated import report somewhere private until reconciliation is complete. Do not run the import twice or against a budget with existing records.

For a small, simple CSV, **Settings → Your data → Choose a CSV file** also offers an in-app column-mapping preview. It rejects ambiguous splits and transfers; use the full history adapter above for a complete Goodbudget export.

## 5. Optional: connect your own banks through Plaid

1. Create and verify a personal Plaid developer Dashboard account. For a personal budget in the US or Canada, request the **Trial** plan from the Dashboard. Plaid says Trial supports real Production data without business registration and includes Transactions and Transactions Refresh; review the [current Trial rules](https://support.plaid.com/hc/en-us/articles/39994173227159-What-is-the-Plaid-Trial-plan) before linking. Do not choose a paid plan unless you intend to pay for it.
2. In Plaid's Dashboard, set the Link use case to personal finance management and configure your deployed HTTPS origin or redirect settings if requested for your institutions. [Plaid Link setup](https://plaid.com/docs/link/) and [use-case configuration](https://plaid.com/docs/link/data-transparency-messaging-migration-guide/) describe these steps.
3. Find **your** Plaid client ID and **Production** secret in the Dashboard. Add them as Worker secrets:

   ```sh
   npx wrangler secret put PLAID_CLIENT_ID --config wrangler.production.jsonc
   npx wrangler secret put PLAID_SECRET --config wrangler.production.jsonc
   ```

4. Check that your private production config says `PLAID_ENV: "production"` and has your exact `PLAID_WEBHOOK_URL`, then run `npm run deploy` again.
5. In the app, open **Settings → Bank connections**, link a bank, and **Choose accounts**. Only selected accounts import. Check the first incoming transactions before relying on automatic classification. Bank availability depends on Plaid and the institution; a refresh request does not guarantee an immediate new transaction.

The example schedules a bank check every 10 minutes and enables Transactions Refresh. Plaid can limit frequent requests, and moving to a paid plan changes billing. If you do not want this behavior, set `PLAID_REFRESH_ENABLED` to `"false"` and change or remove the cron in your private config before deploying.

## Updating an existing installation

Pull the latest `main` branch into your fork, then update **your own** Cloudflare deployment:

```sh
npm ci
npx wrangler d1 migrations apply DB --remote --config wrangler.production.jsonc
npm run deploy
```

Keep your existing private `wrangler.production.jsonc`, Worker secrets, and D1 database. Do not create a replacement database or rerun the Goodbudget import for an update. After deployment, open **Settings → General → Get updates** in the app to load the new client. Bank imports now use the envelope most often used for a merchant. Matching bank and manual purchases both count toward balances by default; older matching purchases that were automatically excluded are included again when the app opens.

## Privacy and publishing checklist

- This repository starts with no real budget, account number, bank token, password, or CSV. Demo entries are fictitious.
- `artifacts/`, `*.csv`, `.dev.vars`, `.env*`, `.local-access-password`, `.wrangler/`, and `wrangler.production.jsonc` are ignored. Check `git status` and the staged diff before every public push. Git ignore does **not** remove data from an earlier commit, so never commit private files in the first place.
- Do not publish D1 exports, browser IndexedDB data, screenshots of real transactions, Cloudflare account IDs, Plaid credentials, or production backups.
- Merchant logos and card artwork are bundled for convenience. Their trademarks remain with their owners; review rights for your own distribution.
- The app is designed for one household, with a shared password and server-side sessions. Its data is not end-to-end encrypted; signed-in browsers also hold an offline copy. Read the code and test your own deployment before relying on it for important records.

## For coding agents

Read [AGENTS.md](AGENTS.md) first. It includes the setup order, privacy boundaries, and validation commands for adapting a fork without pointing it at another household's resources.
