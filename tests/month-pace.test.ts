import { describe, expect, it } from "vitest";
import type { Transaction } from "../shared/model";
import {
  budgetMonthPeriod,
  monthRemainingPercent,
  spentThisWeek,
  tracksWeeklyPace,
  weeklySpendingPace,
} from "../src/lib/month-pace";

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

describe("Sunday–Saturday budget months", () => {
  it("hides pace tracking only for opted-out or targetless envelopes", () => {
    expect(tracksWeeklyPace({ target: 100_000 })).toBe(true);
    expect(
      tracksWeeklyPace({ target: 100_000, weeklyPaceEnabled: false }),
    ).toBe(false);
    expect(tracksWeeklyPace({ target: null })).toBe(false);
    expect(tracksWeeklyPace({ target: 0 })).toBe(false);
  });
  it("assigns August 30–September 5, 2026 to September", () => {
    for (const day of [new Date(2026, 7, 30), new Date(2026, 8, 5)]) {
      const { start, end } = budgetMonthPeriod(day);
      expect(localDate(start)).toBe("2026-08-30");
      expect(localDate(end)).toBe("2026-10-04");
    }
    expect(monthRemainingPercent(new Date(2026, 7, 30))).toBe(100);
  });

  it("assigns January 1–2, 2027 to December 2026", () => {
    for (const day of [new Date(2027, 0, 1), new Date(2027, 0, 2)]) {
      const { start, end } = budgetMonthPeriod(day);
      expect(localDate(start)).toBe("2026-11-29");
      expect(localDate(end)).toBe("2027-01-03");
    }
    expect(monthRemainingPercent(new Date(2027, 0, 3))).toBe(100);
  });

  it("supports both four-week and five-week months", () => {
    const october = budgetMonthPeriod(new Date(2026, 9, 7));
    expect(localDate(october.start)).toBe("2026-10-04");
    expect(localDate(october.end)).toBe("2026-11-01");
    expect(monthRemainingPercent(new Date(2026, 9, 18))).toBe(50);

    const september = budgetMonthPeriod(new Date(2026, 8, 16));
    expect(localDate(september.start)).toBe("2026-08-30");
    expect(localDate(september.end)).toBe("2026-10-04");
    expect(monthRemainingPercent(new Date(2026, 8, 16, 12))).toBe(50);
  });

  it("calculates contiguous four- or five-week periods across future years", () => {
    for (let year = 2026; year <= 2100; year++) {
      for (let month = 0; month < 12; month++) {
        const { start, end } = budgetMonthPeriod(new Date(year, month, 15));
        const days =
          (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
            Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
          86_400_000;
        expect([28, 35]).toContain(days);
        expect(start.getDay()).toBe(0);
        expect(end.getDay()).toBe(0);
        expect(budgetMonthPeriod(end).start.getTime()).toBe(end.getTime());
      }
    }
  });

  it("compares planned spending with the balance spread over later weeks", () => {
    const pace = weeklySpendingPace(100_000, 86_203, new Date(2026, 9, 7));
    expect(pace.weeks).toBe(4);
    expect(pace.currentWeek).toBe(1);
    expect(pace.futureWeeks).toBe(3);
    expect(pace.plannedPerWeek).toBe(25_000);
    expect(pace.plannedForFutureWeeks).toBe(75_000);
    expect(pace.futureWeekPercent).toBe(75);
    expect(Math.round(pace.availablePerWeek)).toBe(28_734);
    expect(pace.remainingThisWeek).toBe(11_203);
  });

  it("handles a five-week month and the final week without division by zero", () => {
    const september = weeklySpendingPace(100_000, 86_203, new Date(2026, 7, 30));
    expect(september.weeks).toBe(5);
    expect(september.futureWeeks).toBe(4);
    expect(september.plannedPerWeek).toBe(20_000);

    const december = weeklySpendingPace(100_000, 12_345, new Date(2027, 0, 1));
    expect(december.currentWeek).toBe(5);
    expect(december.futureWeeks).toBe(0);
    expect(december.futureWeekPercent).toBe(0);
    expect(december.availablePerWeek).toBe(12_345);
    expect(december.remainingThisWeek).toBe(12_345);
  });

  it("shows an over-budget amount when later weeks are underfunded", () => {
    const pace = weeklySpendingPace(100_000, 70_000, new Date(2026, 9, 7));
    expect(pace.remainingThisWeek).toBe(-5_000);
  });

  it("counts this envelope's expenses through today, net of refunds", () => {
    const expense: Transaction = {
      id: "expense",
      kind: "transaction",
      version: 0,
      type: "expense",
      payee: "Store",
      amount: 1_000,
      date: "2026-10-04",
      note: "",
      tags: [],
      allocations: [{ envelopeId: "food", amount: -1_000 }],
      pending: false,
      deleted: false,
      excluded: false,
      source: "manual",
      updatedAt: "2026-10-04T12:00:00.000Z",
    };
    const records: Transaction[] = [
      expense,
      {
        ...expense,
        id: "split",
        date: "2026-10-06",
        amount: 500,
        pending: true,
        allocations: [
          { envelopeId: "food", amount: -300 },
          { envelopeId: "other", amount: -200 },
        ],
      },
      {
        ...expense,
        id: "refund",
        date: "2026-10-07",
        type: "refund",
        amount: 200,
        allocations: [{ envelopeId: "food", amount: 200 }],
      },
      { ...expense, id: "previous", date: "2026-10-03" },
      { ...expense, id: "future", date: "2026-10-08" },
      { ...expense, id: "excluded", excluded: true },
      { ...expense, id: "deleted", deleted: true },
      {
        ...expense,
        id: "transfer",
        type: "transfer",
        allocations: [
          { envelopeId: "food", amount: -1_000 },
          { envelopeId: "other", amount: 1_000 },
        ],
      },
    ];
    expect(spentThisWeek(records, "food", new Date(2026, 9, 7))).toBe(1_100);
    expect(spentThisWeek(records, "other", new Date(2026, 9, 7))).toBe(200);
  });
});
