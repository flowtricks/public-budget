export type BankTransactionDate = {
  authorized_datetime?: string | null;
  authorized_date?: string | null;
  date: string;
};

// Plaid does not always supply the purchase time. In that case, skip the
// connection day as well as earlier dates so old activity cannot be mistaken
// for a new purchase on that day.
export function happenedAfterConnection(
  transaction: BankTransactionDate,
  connectedAt: string,
  connectedOn: string,
) {
  const authorizedAt = transaction.authorized_datetime;
  if (authorizedAt) {
    const time = Date.parse(authorizedAt);
    if (Number.isFinite(time)) return time > Date.parse(connectedAt);
  }
  const day = transaction.authorized_date || transaction.date;
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day > connectedOn;
}
