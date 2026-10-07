import { describe, expect, it } from "vitest";
import { happenedAfterConnection } from "../shared/bank-filter";

const connectedAt = "2025-04-12T04:10:00.000Z";
const connectedOn = "2025-04-11";

describe("bank import cutoff", () => {
  it("rejects earlier purchases even when they post after connection", () => {
    expect(
      happenedAfterConnection(
        { authorized_date: "2025-04-10", date: "2025-04-13" },
        connectedAt,
        connectedOn,
      ),
    ).toBe(false);
  });
  it("uses the authorization time when the bank supplies one", () => {
    expect(
      happenedAfterConnection(
        { authorized_datetime: "2025-04-12T04:09:59Z", date: "2025-04-12" },
        connectedAt,
        connectedOn,
      ),
    ).toBe(false);
    expect(
      happenedAfterConnection(
        { authorized_datetime: "2025-04-12T04:10:01Z", date: "2025-04-12" },
        connectedAt,
        connectedOn,
      ),
    ).toBe(true);
  });
  it("skips the connection day when only a date is available", () => {
    expect(happenedAfterConnection({ date: "2025-04-11" }, connectedAt, connectedOn)).toBe(false);
    expect(happenedAfterConnection({ date: "2025-04-12" }, connectedAt, connectedOn)).toBe(true);
  });
});
