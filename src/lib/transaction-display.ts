import type { State, Transaction } from "../../shared/model";

export function transactionTitle(state: State, transaction: Transaction) {
  if (
    transaction.type === "transfer" &&
    transaction.source === "manual" &&
    transaction.note === "Settled balance before archiving" &&
    transaction.payee.startsWith("Archive ")
  ) {
    const record = state.records[transaction.allocations[0]?.envelopeId];
    if (record?.kind === "envelope") return `Archive ${record.name}`;
  }
  return transaction.payee;
}

export function transactionDisplay(
  state: State,
  transaction: Transaction,
  envelopeId?: string,
) {
  const allocation = envelopeId
    ? transaction.allocations.find((a) => a.envelopeId === envelopeId)
    : undefined;
  const sum = transaction.allocations.reduce((total, a) => total + a.amount, 0);
  const incoming = allocation
    ? allocation.amount > 0
    : transaction.type === "income" ||
      transaction.type === "refund" ||
      (transaction.type === "adjustment" && sum > 0);
  const name = (id: string) => {
    const record = state.records[id];
    return record?.kind === "envelope" ? record.name : "Envelope";
  };
  const allocationEnvelopeIds = [
    ...new Set(transaction.allocations.map((a) => a.envelopeId)),
  ];
  let subtitle: string;
  if (transaction.excluded) subtitle = "Excluded from budget";
  else if (transaction.type === "transfer") {
    const from = transaction.allocations
      .filter((a) => a.amount < 0)
      .map((a) => name(a.envelopeId))
      .join(", ");
    const to = transaction.allocations
      .filter((a) => a.amount > 0)
      .map((a) => name(a.envelopeId))
      .join(", ");
    subtitle = allocation
      ? incoming
        ? `Transfer from ${from}`
        : `Transfer to ${to}`
      : `${from} → ${to}`;
  } else if (transaction.type === "income" && !transaction.allocations.length)
    subtitle = "Waiting for allocation";
  else if (allocation) subtitle = name(allocation.envelopeId);
  else if (allocationEnvelopeIds.length === 2)
    subtitle = allocationEnvelopeIds.map(name).join(", ");
  else if (allocationEnvelopeIds.length > 2)
    subtitle = `${allocationEnvelopeIds.length} envelopes`;
  else
    subtitle = transaction.allocations[0]
      ? name(transaction.allocations[0].envelopeId)
      : transaction.type;
  return {
    amount: allocation ? Math.abs(allocation.amount) : transaction.amount,
    incoming: incoming && !transaction.excluded,
    sign:
      !envelopeId && transaction.type === "transfer"
        ? ""
        : incoming
          ? "+"
          : "−",
    subtitle,
  };
}
