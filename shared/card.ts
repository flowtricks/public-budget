import type { Transaction } from "./model";

export type CardAccount = {
  id: string;
  name: string;
  officialName?: string | null;
  mask?: string | null;
  type: string;
  subtype?: string | null;
  productName?: string;
};

export function cardAccount(value: unknown): CardAccount | undefined {
  if (!value || typeof value !== "object") return;
  const account = value as Record<string, unknown>;
  if (
    typeof account.id !== "string" ||
    typeof account.name !== "string" ||
    typeof account.type !== "string"
  )
    return;
  return {
    id: account.id,
    name: account.name,
    officialName:
      typeof account.officialName === "string" ? account.officialName : null,
    mask: typeof account.mask === "string" ? account.mask : null,
    type: account.type,
    subtype: typeof account.subtype === "string" ? account.subtype : null,
    productName:
      typeof account.productName === "string" ? account.productName : undefined,
  };
}

export function cardFromTransaction(transaction?: Transaction) {
  if (transaction?.source !== "bank") return;
  const account = cardAccount(transaction.bankOriginal?.account);
  if (
    account?.type !== "credit" ||
    account.id !== transaction.bankOriginal?.accountId
  )
    return;
  return account;
}

export function cardDisplayKind(
  transaction: Transaction | undefined,
  account: CardAccount | undefined,
): "credit" | undefined {
  if (
    transaction?.source !== "bank" ||
    !account ||
    account.id !== transaction.bankOriginal?.accountId
  ) return;
  if (account.type === "credit") return "credit";
}
