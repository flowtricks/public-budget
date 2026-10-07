ALTER TABLE connections ADD COLUMN client_user_id TEXT NOT NULL DEFAULT '';
UPDATE connections SET client_user_id = 'public-budget-bank-' || id WHERE client_user_id = '';
