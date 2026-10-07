import type { State, Transaction } from "./model";

export const AUTOMATICALLY_ADDED_TAG = "Automatically added";

export function isAutomaticTag(tag: string) {
  return (
    tag.trim().toLocaleLowerCase() ===
    AUTOMATICALLY_ADDED_TAG.toLocaleLowerCase()
  );
}

export function withoutAutomaticTag(tags: readonly string[]) {
  return tags.filter((tag) => !isAutomaticTag(tag));
}

export function isUnapprovedAutomatic(transaction: Transaction) {
  return (
    transaction.source === "bank" &&
    !transaction.deleted &&
    transaction.bankOriginal?.edited !== true &&
    transaction.tags.some(isAutomaticTag)
  );
}

export function unapprovedDeletionPatches(state: State, updatedAt: string) {
  return Object.values(state.records)
    .filter(
      (record): record is Transaction =>
        record.kind === "transaction" && isUnapprovedAutomatic(record),
    )
    .map((transaction) => ({
      ...transaction,
      deleted: true,
      bankOriginal: { ...transaction.bankOriginal, removedByBank: false },
      updatedAt,
    }));
}
