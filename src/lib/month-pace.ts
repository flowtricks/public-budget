import type { Envelope, Transaction } from "../../shared/model";

export function tracksWeeklyPace(
  envelope: Pick<Envelope, "target" | "weeklyPaceEnabled">,
): boolean {
  return envelope.target !== null && envelope.target > 0 && envelope.weeklyPaceEnabled !== false;
}

// A Sunday–Saturday week belongs to the month containing its Wednesday.
// That month has at least four of the week's seven days.
export function budgetMonthStart(year: number, month: number): Date {
  const first = new Date(year, month, 1);
  const firstWednesday = 1 + ((3 - first.getDay() + 7) % 7);
  return new Date(year, month, firstWednesday - 3);
}

export function budgetMonthPeriod(now: Date): { start: Date; end: Date } {
  const weekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - now.getDay(),
  );
  const weekWednesday = new Date(
    weekStart.getFullYear(),
    weekStart.getMonth(),
    weekStart.getDate() + 3,
  );
  const year = weekWednesday.getFullYear();
  const month = weekWednesday.getMonth();
  return {
    start: budgetMonthStart(year, month),
    end: budgetMonthStart(year, month + 1),
  };
}

export function monthRemainingPercent(now: Date): number {
  const { start, end } = budgetMonthPeriod(now);
  return Math.max(
    0,
    Math.min(
      100,
      ((end.getTime() - now.getTime()) / (end.getTime() - start.getTime())) *
        100,
    ),
  );
}

function calendarDaysBetween(start: Date, end: Date): number {
  return (
    (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
      Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
    86_400_000
  );
}

export function weeklySpendingPace(
  target: number,
  balance: number,
  now: Date,
) {
  const { start, end } = budgetMonthPeriod(now);
  const weeks = calendarDaysBetween(start, end) / 7;
  const currentWeekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - now.getDay(),
  );
  const currentWeek = 1 + calendarDaysBetween(start, currentWeekStart) / 7;
  const futureWeeks = weeks - currentWeek;
  const plannedPerWeek = target / weeks;
  const plannedForFutureWeeks = plannedPerWeek * futureWeeks;
  const availablePerWeek = futureWeeks > 0 ? balance / futureWeeks : balance;
  return {
    start,
    end,
    weeks,
    currentWeek,
    futureWeeks,
    plannedPerWeek,
    plannedForFutureWeeks,
    futureWeekPercent: (futureWeeks / weeks) * 100,
    availablePerWeek,
    remainingThisWeek: balance - plannedForFutureWeeks,
  };
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function spentThisWeek(
  transactions: readonly Transaction[],
  envelopeId: string,
  now: Date,
): number {
  const weekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - now.getDay(),
  );
  const from = localDateKey(weekStart);
  const through = localDateKey(now);
  return transactions.reduce((spent, transaction) => {
    if (
      transaction.deleted ||
      transaction.excluded ||
      transaction.date < from ||
      transaction.date > through ||
      (transaction.type !== "expense" && transaction.type !== "refund")
    )
      return spent;
    const allocation = transaction.allocations.find(
      (item) => item.envelopeId === envelopeId,
    );
    return spent - (allocation?.amount || 0);
  }, 0);
}
