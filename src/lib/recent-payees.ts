import { merchantKey, transactions, type State } from "../../shared/model";

export function recentTransactionPayees(
  state: State,
  type: "expense" | "income",
) {
  const seen = new Set<string>();
  return transactions(state)
    .filter(
      (transaction) =>
        transaction.type === type &&
        !transaction.deleted &&
        !transaction.excluded,
    )
    .map((transaction) => transaction.payee)
    .filter((payee) => {
      const key = merchantKey(payee);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
