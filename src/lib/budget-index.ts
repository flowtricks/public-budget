import {
  balances,
  envelopes,
  transactions,
  moneyText,
  type State,
  type Transaction,
  type Envelope,
} from "../../shared/model";
import { transactionTitle } from "./transaction-display";

// Build once per budget revision, rather than scanning history on every UI update.
export const normalizeTag = (tag: string) => tag.trim().toLocaleLowerCase();
export function createBudgetIndex(state: State) {
  const es = envelopes(state);
  const active = es.filter((envelope) => !envelope.archived);
  const everyTransaction = transactions(state);
  const all = everyTransaction.filter((transaction) => !transaction.deleted);
  const visible = all.filter((transaction) => !transaction.excluded);
  const unallocated = visible.filter(
    (transaction) =>
      transaction.type === "income" && !transaction.allocations.length,
  );
  const pending = visible.filter((transaction) => transaction.pending);
  const byEnvelope = new Map<string, Transaction[]>();
  for (const transaction of everyTransaction) {
    for (const allocation of transaction.allocations) {
      let rows = byEnvelope.get(allocation.envelopeId);
      if (!rows) byEnvelope.set(allocation.envelopeId, (rows = []));
      rows.push(transaction);
    }
  }
  const envelopeGroups = new Map<string, Envelope[]>();
  for (const envelope of active) {
    const name = envelope.group?.trim() || "Envelopes";
    let group = envelopeGroups.get(name);
    if (!group) envelopeGroups.set(name, (group = []));
    group.push(envelope);
  }
  const bs = balances(state);
  return {
    state,
    es,
    active,
    everyTransaction,
    all,
    visible,
    unallocated,
    pending,
    byEnvelope,
    envelopeGroups,
    bs,
    total: Object.values(bs).reduce((sum, amount) => sum + amount, 0),
    searchText: new Map<string, string>(),
  };
}

export function filterTransactions(
  index: ReturnType<typeof createBudgetIndex>,
  envelopeId: string | null,
  filter: string,
  query: string,
  selectedTags: readonly string[] = [],
) {
  const search = query.toLowerCase();
  const tagKeys = new Set(selectedTags.map(normalizeTag));
  if (!envelopeId && filter === "all" && !search && !tagKeys.size)
    return index.visible;
  const candidates = envelopeId
    ? index.byEnvelope.get(envelopeId) || []
    : index.everyTransaction;
  return candidates.filter((transaction) => {
    if (filter === "deleted" ? !transaction.deleted : transaction.deleted)
      return false;
    if (envelopeId && transaction.excluded) return false;
    if (filter === "all" && transaction.excluded) return false;
    if (filter === "pending" && !transaction.pending) return false;
    if (filter === "expense" && transaction.type !== "expense") return false;
    if (filter === "income" && transaction.type !== "income") return false;
    if (
      tagKeys.size &&
      !transaction.tags.some((tag) => tagKeys.has(normalizeTag(tag)))
    )
      return false;
    if (
      filter === "unallocated" &&
      !(
        transaction.type === "income" &&
        !transaction.excluded &&
        !transaction.allocations.length
      )
    )
      return false;
    if (!search) return true;
    let text = index.searchText.get(transaction.id);
    if (text === undefined) {
      text = [
        transactionTitle(index.state, transaction),
        transaction.note,
        ...transaction.tags,
        ...transaction.allocations.map(
          (allocation) =>
            (index.state.records[allocation.envelopeId] as Envelope)?.name ||
            "",
        ),
        moneyText(transaction.amount),
      ]
        .join(" ")
        .toLowerCase();
      index.searchText.set(transaction.id, text);
    }
    return text.includes(search);
  });
}

export function indexedRunningBalances(
  index: ReturnType<typeof createBudgetIndex>,
  envelopeId: string,
) {
  const result = new Map<string, number>();
  const envelope = index.state.records[envelopeId];
  if (envelope?.kind !== "envelope") return result;
  let balance = envelope.opening;
  const rows = index.byEnvelope.get(envelopeId) || [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const transaction = rows[i];
    if (transaction.deleted || transaction.excluded) continue;
    balance += transaction.allocations.find(
      (allocation) => allocation.envelopeId === envelopeId,
    )!.amount;
    result.set(transaction.id, balance);
  }
  return result;
}
