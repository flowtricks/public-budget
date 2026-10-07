import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import { importGoodbudgetHistory } from "../src/lib/goodbudget-history";
import {
  initialSettings,
  transactions,
  envelopes,
  balances,
} from "../shared/model";
const csv = (rows: Record<string, string>[]) =>
  Papa.unparse(
    rows.map((row) => ({
      Date: "10/06/2026",
      Envelope: "",
      Account: "My Account",
      Name: "Purchase",
      Notes: "",
      "Check #": "",
      Amount: "0.00",
      Status: "",
      Details: "",
      ...row,
    })),
  );
describe("Goodbudget signed history", () => {
  it("combines paired transfers and preserves every source row and both envelope effects", () => {
    const result = importGoodbudgetHistory(
      csv([
        { Envelope: "Giving", Account: "", Name: "Transfer", Amount: "139.00" },
        {
          Envelope: "Savings",
          Account: "",
          Name: "Transfer",
          Amount: "-139.00",
        },
        {
          Name: "Paycheck",
          Amount: "500.00",
          Details: "Savings|-100.00||Giving|600.00",
        },
      ]),
      "test",
      initialSettings,
    );
    expect(result.report.sourceRows).toBe(3);
    expect(result.report.transactions).toBe(2);
    expect(result.report.totalCents).toBe(50000);
    const transfer = transactions(result.state).find(
      (t) => t.type === "transfer",
    )!;
    expect(transfer.amount).toBe(13900);
    expect(transfer.allocations.map((a) => a.amount)).toEqual([13900, -13900]);
    expect(transfer.bankOriginal?.rows).toHaveLength(2);
  });
  it("merges deleted-envelope aliases without hiding a residual balance", () => {
    const result = importGoodbudgetHistory(
      csv([
        { Name: "Old fill", Amount: "20.01", Details: "DELETED: Old|20.01" },
        { Envelope: "Old", Amount: "-20.00" },
      ]),
      "test",
      initialSettings,
    );
    expect(envelopes(result.state)).toHaveLength(1);
    expect(envelopes(result.state)[0].archived).toBe(false);
    expect(Object.values(balances(result.state))).toEqual([1]);
  });
  it("preserves net withdrawals with positive split corrections and zero fills", () => {
    const result = importGoodbudgetHistory(
      csv([
        { Amount: "-3.00", Details: "Spending|-3.01||[Available]|0.01" },
        { Account: "[none]", Name: "Fill", Amount: "0.00" },
      ]),
      "test",
      initialSettings,
    );
    expect(result.report.transactions).toBe(2);
    expect(transactions(result.state)[0].type).toBe("adjustment");
    expect(
      transactions(result.state)[0].allocations.map((a) => a.amount),
    ).toEqual([-301, 1]);
    expect(result.report.totalCents).toBe(-300);
  });
  it("rejects an orphaned transfer and mismatched split instead of losing amounts", () => {
    expect(() =>
      importGoodbudgetHistory(
        csv([{ Envelope: "Savings", Account: "", Amount: "-5.00" }]),
        "test",
        initialSettings,
      ),
    ).toThrow("Unpaired");
    expect(() =>
      importGoodbudgetHistory(
        csv([{ Amount: "-5.00", Details: "Spending|-4.00" }]),
        "test",
        initialSettings,
      ),
    ).toThrow("Allocations");
  });
});
