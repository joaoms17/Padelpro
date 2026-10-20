import { describe, it, expect } from "vitest";
import { planAccountLinks, type StoredAccount } from "./accounts";

const casa: StoredAccount = {
  id: "casa",
  role: "casa",
  eb_account_uid: null,
  eb_identification_hash: null,
  iban_last4: null,
};

describe("planAccountLinks", () => {
  it("first link: Conta Casa takes the first account, the rest are added", () => {
    const plan = planAccountLinks([casa], [
      { uid: "u1", identification_hash: "h1", account_id: { iban: "PT50000000001234" } },
      { uid: "u2", identification_hash: "h2", account_id: { iban: "PT50000000005678" } },
    ]);
    expect(plan.update).toEqual([
      { id: "casa", eb_account_uid: "u1", eb_identification_hash: "h1", iban_last4: "1234" },
    ]);
    expect(plan.insert).toEqual([
      { name: "Conta 5678", eb_account_uid: "u2", eb_identification_hash: "h2", iban_last4: "5678" },
    ]);
    expect(plan.unlink).toEqual([]);
  });

  it("renewal: new uids map back to the same accounts by identification_hash", () => {
    const stored: StoredAccount[] = [
      { ...casa, eb_account_uid: "old1", eb_identification_hash: "h1", iban_last4: "1234" },
      { id: "x", role: "outra", eb_account_uid: "old2", eb_identification_hash: "h2", iban_last4: "5678" },
    ];
    const plan = planAccountLinks(stored, [
      { uid: "new2", identification_hash: "h2" },
      { uid: "new1", identification_hash: "h1" },
    ]);
    expect(plan.insert).toEqual([]);
    expect(plan.update.map((u) => [u.id, u.eb_account_uid])).toEqual([["x", "new2"], ["casa", "new1"]]);
    expect(plan.unlink).toEqual([]);
  });

  it("unlinks a previously linked account that is not in the new session", () => {
    const stored: StoredAccount[] = [
      { ...casa, eb_account_uid: "old1", eb_identification_hash: "h1" },
      { id: "x", role: "outra", eb_account_uid: "old2", eb_identification_hash: "h2", iban_last4: null },
    ];
    const plan = planAccountLinks(stored, [{ uid: "new1", identification_hash: "h1" }]);
    expect(plan.unlink).toEqual(["x"]);
  });

  it("skips accounts without a uid (blocked/closed)", () => {
    const plan = planAccountLinks([casa], [{ uid: null, identification_hash: "h1" }]);
    expect(plan).toEqual({ update: [], insert: [], unlink: [] });
  });

  it("falls back to the uid, then to the IBAN tail of a bank-linked account", () => {
    const stored: StoredAccount[] = [
      { ...casa, eb_account_uid: "u1", eb_identification_hash: null, iban_last4: "1234" },
      { id: "y", role: "outra", eb_account_uid: "gone", eb_identification_hash: null, iban_last4: "9999" },
    ];
    const plan = planAccountLinks(stored, [
      { uid: "u1", identification_hash: "h1" },
      { uid: "u9", identification_hash: "h9", account_id: { iban: "PT500000009999" } },
    ]);
    expect(plan.update.map((u) => u.id)).toEqual(["casa", "y"]);
    expect(plan.insert).toEqual([]);
  });
});
