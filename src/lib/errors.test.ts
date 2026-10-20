import { describe, it, expect } from "vitest";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  it("reads Errors and Supabase's plain error objects", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage({ message: "permission denied", code: "42501" })).toBe("permission denied");
    expect(errorMessage("texto")).toBe("texto");
    expect(errorMessage(null)).toBe("null");
  });
});
