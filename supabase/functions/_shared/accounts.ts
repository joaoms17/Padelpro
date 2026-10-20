// Maps the accounts of a new Enable Banking session onto the household's
// accounts. Pure (no Deno or Supabase APIs) so it is unit-tested with vitest.
//
// A new consent (every ~180 days) brings NEW account uids; identification_hash
// is the id that stays stable across sessions, so it is matched first —
// otherwise each renewal would create duplicate accounts and re-import the
// whole history.

export interface SessionAccount {
  uid?: string | null;
  identification_hash?: string | null;
  account_id?: { iban?: string | null } | null;
}

export interface StoredAccount {
  id: string;
  role: string;
  eb_account_uid: string | null;
  eb_identification_hash: string | null;
  iban_last4: string | null;
}

export interface LinkFields {
  eb_account_uid: string;
  eb_identification_hash: string | null;
  iban_last4: string | null;
}

export interface LinkPlan {
  update: ({ id: string } & LinkFields)[];
  insert: ({ name: string } & LinkFields)[];
  /** Linked accounts missing from the new session: their uid is dead. */
  unlink: string[];
}

export function planAccountLinks(stored: StoredAccount[], session: SessionAccount[]): LinkPlan {
  const plan: LinkPlan = { update: [], insert: [], unlink: [] };
  const claimed = new Set<string>();
  const free = (pred: (a: StoredAccount) => boolean) =>
    stored.find((a) => !claimed.has(a.id) && pred(a));

  const usable = session.filter((s) => s.uid); // uid is absent for blocked/closed accounts
  const pending: { s: SessionAccount; fields: LinkFields }[] = [];

  for (const s of usable) {
    const iban = s.account_id?.iban ?? null;
    const fields: LinkFields = {
      eb_account_uid: s.uid!,
      eb_identification_hash: s.identification_hash ?? null,
      iban_last4: iban ? iban.slice(-4) : null,
    };
    const match =
      (fields.eb_identification_hash &&
        free((a) => a.eb_identification_hash === fields.eb_identification_hash)) ||
      free((a) => a.eb_account_uid === fields.eb_account_uid) ||
      (fields.iban_last4 &&
        free((a) =>
          a.iban_last4 === fields.iban_last4 && !!(a.eb_account_uid || a.eb_identification_hash)
        )) ||
      null;
    if (match) {
      claimed.add(match.id);
      plan.update.push({ id: match.id, ...fields });
    } else {
      pending.push({ s, fields });
    }
  }

  // First new bank account becomes the (not yet linked) Conta Casa; the rest
  // are added as secondary accounts.
  pending.forEach(({ fields }, i) => {
    const casa = free((a) => a.role === "casa" && !a.eb_account_uid && !a.eb_identification_hash);
    if (casa) {
      claimed.add(casa.id);
      plan.update.push({ id: casa.id, ...fields });
    } else {
      plan.insert.push({ name: `Conta ${fields.iban_last4 ?? i + 1}`, ...fields });
    }
  });

  plan.unlink = stored.filter((a) => a.eb_account_uid && !claimed.has(a.id)).map((a) => a.id);
  return plan;
}
