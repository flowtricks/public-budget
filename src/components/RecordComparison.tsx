import {
  moneyText,
  type BudgetRecord,
  type State,
  type Envelope,
} from "../../shared/model";
import { transactionTitle } from "../lib/transaction-display";
export default function RecordComparison({
  record,
  state,
}: {
  record?: BudgetRecord;
  state: State;
}) {
  if (!record) return <p>Not saved in the shared budget yet.</p>;
  const name = (id: string) =>
    (state.records[id] as Envelope)?.name || "Envelope";
  if (record.kind === "transaction")
    return (
      <div className="record-comparison">
        <strong>{transactionTitle(state, record)}</strong>
        <span>
          {record.deleted ? "Deleted · " : ""}
          {record.excluded ? "Excluded · " : ""}
          {record.type} · {moneyText(record.amount)}
        </span>
        <span>{record.date}</span>
        {record.allocations.map((a) => (
          <span key={a.envelopeId}>
            {name(a.envelopeId)}: {moneyText(a.amount)}
          </span>
        ))}
        {record.note && <p>{record.note}</p>}
        {record.tags.length > 0 && <span>Tags: {record.tags.join(", ")}</span>}
      </div>
    );
  if (record.kind === "envelope")
    return (
      <div className="record-comparison">
        <strong>{record.name}</strong>
        <span>{record.archived ? "Archived" : "Active"}</span>
        <span>
          Full amount:{" "}
          {record.target === null ? "No target" : moneyText(record.target)}
        </span>
        <span>Opening balance: {moneyText(record.opening)}</span>
      </div>
    );
  if (record.kind === "rule")
    return (
      <div className="record-comparison">
        <strong>{record.merchant}</strong>
        <span>Future purchases use {name(record.envelopeId)}</span>
      </div>
    );
  return (
    <div className="record-comparison">
      <strong>{record.name}</strong>
      <span>Default envelope: {name(record.fallbackId)}</span>
      <span>{record.timezone}</span>
    </div>
  );
}
