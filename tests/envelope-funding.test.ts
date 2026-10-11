import { describe, expect, it } from "vitest";
import {
  fiveWeekFundingAmount,
  projectedEnvelopeTotal,
} from "../src/lib/envelope-funding";
import {
  applyOperation,
  emptyState,
  EnvelopeSchema,
  makeOperation,
  settings,
  type Envelope,
  type Transaction,
} from "../shared/model";

const envelope: Envelope = {
  id: "groceries",
  kind: "envelope",
  version: 0,
  name: "Groceries",
  target: 100_000,
  opening: 0,
  icon: "basket",
  color: "green",
  order: 0,
  archived: false,
};

describe("five-week envelope funding", () => {
  it("leaves existing and opted-out envelopes off by default", () => {
    const old = EnvelopeSchema.parse(envelope);
    expect(old.fiveWeekFundingEnabled).toBeUndefined();
    expect(fiveWeekFundingAmount(old)).toBeNull();
    expect(
      fiveWeekFundingAmount({ ...old, fiveWeekFundingEnabled: false }),
    ).toBeNull();
  });

  it.each([
    [100_000, 125_000],
    [60_000, 75_000],
    [10_001, 12_501],
    [10_002, 12_503],
    [0, 0],
  ])(
    "scales %i cents to %i cents, rounding only the final amount",
    (target, expected) => {
      expect(
        fiveWeekFundingAmount({ target, fiveWeekFundingEnabled: true }),
      ).toBe(expected);
    },
  );

  it("does not offer five-week funding without a full amount", () => {
    expect(
      fiveWeekFundingAmount({ target: null, fiveWeekFundingEnabled: true }),
    ).toBeNull();
  });

  it("preserves the opt-in and opt-out through validated sync operations", () => {
    let state = emptyState("five-weeks-test");
    state = applyOperation(
      state,
      makeOperation(
        state,
        [envelope, { ...settings(state), fallbackId: envelope.id }],
        "test",
        "Create envelope",
      ),
    );
    for (const enabled of [true, false]) {
      const saved = {
        ...(state.records.groceries as Envelope),
        fiveWeekFundingEnabled: enabled,
      };
      state = applyOperation(
        state,
        makeOperation(state, [saved], "test", "Update funding preference"),
      );
      expect((state.records.groceries as Envelope).fiveWeekFundingEnabled).toBe(
        enabled,
      );
      expect((state.records.groceries as Envelope).target).toBe(100_000);
    }
  });
});

describe("projected envelope totals", () => {
  it("adds custom funding to the existing balance in cents", () => {
    expect(projectedEnvelopeTotal(86203, "groceries", "1250.00")).toBe(211203);
    expect(projectedEnvelopeTotal(86203, "groceries", "")).toBe(86203);
    expect(projectedEnvelopeTotal(-1000, "groceries", "25.50")).toBe(1550);
    expect(projectedEnvelopeTotal(86203, "groceries", "not money")).toBeNull();
  });

  it("replaces a saved contribution when editing instead of counting it twice", () => {
    const previous = {
      allocations: [{ envelopeId: "groceries", amount: 10000 }],
      deleted: false,
      excluded: false,
    } as Transaction;
    expect(projectedEnvelopeTotal(96203, "groceries", "1250", previous)).toBe(
      211203,
    );
    expect(projectedEnvelopeTotal(96203, "groceries", "100", previous)).toBe(
      96203,
    );
    expect(
      projectedEnvelopeTotal(96203, "groceries", "100", previous, true),
    ).toBe(86203);
    expect(
      projectedEnvelopeTotal(86203, "groceries", "100", {
        ...previous,
        excluded: true,
      }),
    ).toBe(96203);
    expect(projectedEnvelopeTotal(86203, "groceries", "-20")).toBe(84203);
  });
});
