import { describe, expect, it } from "vitest";
import { isAutomaticTag, withoutAutomaticTag } from "../shared/automatic-import";

describe("legacy automatic-import tags", () => {
  it("hides old import markers without removing user tags", () => {
    expect(isAutomaticTag(" automatically added ")).toBe(true);
    expect(
      withoutAutomaticTag(["Food", " automatically added ", "Trip"]),
    ).toEqual(["Food", "Trip"]);
  });
});
