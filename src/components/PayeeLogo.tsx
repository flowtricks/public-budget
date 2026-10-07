import { useState } from "react";
import { fallbackPayeeLogo, payeeLogo } from "../lib/payee-logos";

export default function PayeeLogo({
  name,
  eager = false,
}: {
  name: string;
  eager?: boolean;
}) {
  const logo = payeeLogo(name);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <img
      className="payee-logo"
      src={failed === logo ? fallbackPayeeLogo : logo}
      alt=""
      aria-hidden="true"
      width={36}
      height={36}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(logo)}
    />
  );
}
