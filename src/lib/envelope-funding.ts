import { cents, type Envelope, type Transaction } from "../../shared/model";

export function projectedEnvelopeTotal(
  balance: number,
  envelopeId: string,
  amount: string,
  previous?: Transaction,
  excluded = false,
): number | null {
  const previousAmount =
    previous && !previous.deleted && !previous.excluded
      ? previous.allocations
          .filter((a) => a.envelopeId === envelopeId)
          .reduce((sum, a) => sum + a.amount, 0)
      : 0;
  try {
    return balance - previousAmount + (excluded ? 0 : cents(amount || "0"));
  } catch {
    return null;
  }
}

export function fiveWeekFundingAmount(
  envelope: Pick<Envelope, "target" | "fiveWeekFundingEnabled">,
): number | null {
  if (envelope.fiveWeekFundingEnabled !== true || envelope.target === null)
    return null;
  // Amounts are integer cents. Round once after scaling, not per week.
  return Math.round((envelope.target * 5) / 4);
}
