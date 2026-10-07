import { existsSync, writeFileSync } from "node:fs";
import { randomBytes, createHash, pbkdf2Sync } from "node:crypto";
if (existsSync(".dev.vars")) {
  console.log("Local secrets already exist. Nothing changed.");
  process.exit(0);
}
const password =
  process.env.BUDGET_SETUP_PASSWORD || randomBytes(32).toString("base64url");
if (password.length < 16 || password.length > 1000)
  throw new Error("Use a shared password between 16 and 1000 characters.");
const salt = randomBytes(32).toString("hex");
const proof = pbkdf2Sync(password, salt, 600000, 32, "sha256").toString("hex");
const verifier = createHash("sha256").update(proof).digest("hex");
writeFileSync(
  ".dev.vars",
  `PASSWORD_HASH="pbkdf2-client:600000:${salt}:${verifier}"\nTOKEN_KEY="${randomBytes(32).toString("hex")}"\n`,
  { mode: 0o600 },
);
if (!process.env.BUDGET_SETUP_PASSWORD)
  writeFileSync(".local-access-password", password + "\n", { mode: 0o600 });
console.log(
  "Created .dev.vars with a salted adaptive verifier and token encryption key. " +
    (process.env.BUDGET_SETUP_PASSWORD
      ? "No plaintext password was saved."
      : "Your generated password is in .local-access-password. Save it in your password manager, then delete that file."),
);
