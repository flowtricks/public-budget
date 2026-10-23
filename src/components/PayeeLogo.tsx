import { useEffect, useRef, useState } from "react";
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
  const [retry, setRetry] = useState(0);
  const attempts = useRef(0);

  useEffect(() => {
    attempts.current = 0;
    setFailed(null);
    setRetry(0);
  }, [logo]);

  useEffect(() => {
    if (failed !== logo || logo === fallbackPayeeLogo) return;

    const tryAgain = () => {
      if (document.visibilityState === "hidden" || !navigator.onLine) return;
      setFailed(null);
      setRetry((value) => value + 1);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") tryAgain();
    };
    const onOnline = () => tryAgain();
    const worker = navigator.serviceWorker;
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    worker?.addEventListener("controllerchange", tryAgain);

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (attempts.current < 2) {
      attempts.current += 1;
      timer = setTimeout(tryAgain, attempts.current * 2000);
    }
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      worker?.removeEventListener("controllerchange", tryAgain);
    };
  }, [failed, logo]);

  const showingFallback = failed === logo;
  return (
    <img
      className="payee-logo"
      src={
        showingFallback
          ? fallbackPayeeLogo
          : retry
            ? `${logo}?retry=${retry}`
            : logo
      }
      alt=""
      aria-hidden="true"
      width={36}
      height={36}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => {
        if (!showingFallback && logo !== fallbackPayeeLogo) setFailed(logo);
      }}
    />
  );
}
