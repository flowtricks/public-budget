import { useEffect, useRef, useState, type ReactNode } from "react";
import { useIsPresent } from "motion/react";
import type { Transaction } from "../../shared/model";

export const TRANSACTION_PAGE_SIZE = 50;

export default function TransactionFeed({
  transactions,
  renderRow,
}: {
  transactions: Transaction[];
  renderRow: (transaction: Transaction) => ReactNode;
}) {
  const [visible, setVisible] = useState(TRANSACTION_PAGE_SIZE);
  const sentinel = useRef<HTMLButtonElement>(null);
  const present = useIsPresent();
  const hasMore = visible < transactions.length;

  useEffect(() => {
    const element = sentinel.current;
    if (!present || !hasMore || !element || !("IntersectionObserver" in window))
      return;
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (cancelled || !entries.some((entry) => entry.isIntersecting)) return;
      // Only advance once per observation, including during screen transitions.
      cancelled = true;
      observer.disconnect();
      setVisible((count) =>
        Math.min(count + TRANSACTION_PAGE_SIZE, transactions.length),
      );
    });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [visible, transactions.length, hasMore, present]);

  const groups = new Map<string, Transaction[]>();
  for (const transaction of transactions.slice(0, visible))
    groups.set(transaction.date, [
      ...(groups.get(transaction.date) || []),
      transaction,
    ]);

  return (
    <>
      {[...groups].map(([date, rows]) => (
        <section className="day-group" key={date}>
          <div className="list-section-heading">
            <h2>
              {new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                weekday: "short",
              })}
            </h2>
            <span>
              {new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
          <div className="transaction-list">{rows.map(renderRow)}</div>
        </section>
      ))}
      {hasMore && (
        <button
          ref={sentinel}
          type="button"
          className="new-envelope-row transaction-load-more"
          onClick={() =>
            setVisible((count) =>
              Math.min(count + TRANSACTION_PAGE_SIZE, transactions.length),
            )
          }
        >
          Load more transactions
        </button>
      )}
    </>
  );
}
