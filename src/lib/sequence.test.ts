import { describe, it, expect } from "vitest";
import { latestOnly, nextStamp } from "./sequence";

describe("loads and writes in order", () => {
  it("only the latest load started may apply, whatever order they finish in", async () => {
    const requests = latestOnly();
    const applied: string[] = [];
    const load = (name: string, ms: number) => {
      const id = requests.start();
      return new Promise<void>((r) => setTimeout(r, ms)).then(() => {
        if (requests.isLatest(id)) applied.push(name);
      });
    };
    // An older, slower load (started before a save) finishes after the newer one.
    await Promise.all([load("antes de guardar", 30), load("depois de guardar", 5)]);
    expect(applied).toEqual(["depois de guardar"]);
    // On its own, a load applies.
    await load("sozinho", 1);
    expect(applied).toEqual(["depois de guardar", "sozinho"]);
  });

  it("stamps always grow: a load stamped before a write is older than it", () => {
    const load = nextStamp();
    const write = nextStamp();
    const next = nextStamp();
    expect(load).toBeLessThan(write);
    expect(next).toBeGreaterThan(write);
  });
});
