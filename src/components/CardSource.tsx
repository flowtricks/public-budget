import { useEffect, useState } from "react";
import {
  cardAccount,
  cardDisplayKind,
  type CardAccount,
} from "../../shared/card";
import type { Transaction } from "../../shared/model";
import { cardArt } from "../lib/card-art";
import { api } from "../lib/store";

const accountRequests = new Map<string, Promise<CardAccount[]>>();

function accountsForConnection(id: string) {
  let request = accountRequests.get(id);
  if (!request) {
    request = api("/api/banks/accounts", { id })
      .then((result) => {
        const rawAccounts: unknown[] = Array.isArray(result.accounts)
          ? result.accounts
          : [];
        return rawAccounts
          .map(cardAccount)
          .filter((account): account is CardAccount => !!account);
      })
      .catch((error) => {
        accountRequests.delete(id);
        throw error;
      });
    accountRequests.set(id, request);
  }
  return request;
}

function cardTheme(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("southwest")) return "southwest";
  if (lower.includes("sapphire")) return "sapphire";
  if (lower.includes("hyatt")) return "hyatt";
  if (lower.includes("freedom")) return "freedom";
  if (lower.includes("quicksilver")) return "quicksilver";
  return "standard";
}

export default function CardSource({
  transaction,
}: {
  transaction: Transaction;
}) {
  const [fetched, setFetched] = useState<CardAccount>();
  const [failedArt, setFailedArt] = useState<string>();
  const accountId = transaction.bankOriginal?.accountId;
  const connectionId = transaction.sourceId?.split(":", 1)[0];
  const storedAccount = cardAccount(transaction.bankOriginal?.account);
  const hasStoredAccount = !!storedAccount && storedAccount.id === accountId;
  const needsProductName =
    hasStoredAccount &&
    storedAccount.type === "credit" &&
    /ultimate rewards/i.test(
      storedAccount.officialName || storedAccount.name,
    ) &&
    !storedAccount.productName;

  useEffect(() => {
    setFetched(undefined);
    if (
      (hasStoredAccount && !needsProductName) ||
      transaction.source !== "bank" ||
      typeof accountId !== "string" ||
      !connectionId
    )
      return;
    let canceled = false;
    void accountsForConnection(connectionId)
      .then((accounts) => {
        if (!canceled)
          setFetched(accounts.find((account) => account.id === accountId));
      })
      .catch(() => {
        // Existing transactions remain editable if account details are unavailable.
      });
    return () => {
      canceled = true;
    };
  }, [
    accountId,
    connectionId,
    hasStoredAccount,
    needsProductName,
    transaction.source,
  ]);

  const card = fetched || (hasStoredAccount ? storedAccount : undefined);
  const kind = cardDisplayKind(transaction, card);
  if (!card || !kind) return null;

  const name = card.productName || card.officialName || card.name;
  const institution = transaction.sourceAccount?.split("·")[0].trim() || "Card";
  const owner = transaction.sourceAccount?.split("·")[1]?.trim();
  const displayName =
    institution !== "Card" &&
    !name.toLowerCase().startsWith(institution.toLowerCase())
      ? `${institution} ${name}`
      : name;
  const artName = name.toLowerCase().startsWith(`${institution.toLowerCase()} `)
    ? name.slice(institution.length + 1)
    : name;
  const digits = card.mask ? `•••• ${card.mask}` : "Credit card";
  const theme = cardTheme(name);
  const artwork = cardArt(name);
  const label = "Card used";

  return (
    <div
      className="card-source-row"
      aria-label={`${label}: ${displayName}, ${digits}${owner ? `, ${owner}` : ""}`}
    >
      <span className="card-source-label">{label}</span>
      <div className="card-source-detail">
        {artwork && artwork !== failedArt ? (
          <img
            className="card-source-art card-source-image"
            src={artwork}
            alt=""
            aria-hidden="true"
            onError={() => setFailedArt(artwork)}
          />
        ) : (
          <div
            className={`card-source-art card-source-art-${theme}`}
            aria-hidden="true"
          >
            <span className="card-source-art-bank">{institution}</span>
            {theme === "southwest" && (
              <img
                className="card-source-art-logo"
                src="/payee-logos/southwest.com.png"
                alt=""
              />
            )}
            <span className="card-source-art-chip" />
            <span className="card-source-art-name">{artName}</span>
          </div>
        )}
        <div className="card-source-copy">
          <strong>{displayName}</strong>
          <small>
            {digits}
            {owner ? ` · ${owner}` : ""}
          </small>
        </div>
      </div>
    </div>
  );
}
