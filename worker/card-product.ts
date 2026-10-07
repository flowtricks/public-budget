import { cardAccount, type CardAccount } from "../shared/card";

export function bankCardAccount(
  raw: Record<string, unknown>,
  _connectionName: string,
): CardAccount | undefined {
  return cardAccount({
    id: raw.account_id,
    name: raw.name,
    officialName: raw.official_name,
    mask: raw.mask,
    type: raw.type,
    subtype: raw.subtype,
  });
}
