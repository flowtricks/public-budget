import { moneyText, type Transaction } from "../../shared/model";
import { spentThisWeek, weeklySpendingPace } from "../lib/month-pace";

const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

export default function EnvelopeWeeklyPace({
  target,
  balance,
  now,
  envelopeId,
  transactions,
}: {
  target: number;
  balance: number;
  now: Date;
  envelopeId: string;
  transactions: readonly Transaction[];
}) {
  const pace = weeklySpendingPace(target, balance, now);
  const weeklySpent = spentThisWeek(transactions, envelopeId, now);
  const lastDay = new Date(
    pace.end.getFullYear(),
    pace.end.getMonth(),
    pace.end.getDate() - 1,
  );
  const remainingThisWeek = Math.round(pace.remainingThisWeek);
  const futureWeeks = pace.futureWeeks;
  const weekWord = futureWeeks === 1 ? "week" : "weeks";

  return (
    <section className="envelope-weekly-pace" aria-label="Weekly spending pace">
      <div className="weekly-pace-card">
        <header className="weekly-pace-header">
          <div className="weekly-pace-title">
            <h2>Weekly pace</h2>
            <span>
              Week {pace.currentWeek} of {pace.weeks}
            </span>
          </div>
          <div className="weekly-pace-period">
            <p>
              {shortDate.format(pace.start)} – {shortDate.format(lastDay)}
              {pace.start.getFullYear() !== lastDay.getFullYear()
                ? `, ${lastDay.getFullYear()}`
                : ""}
            </p>
            <div className="weekly-pace-weeks" aria-hidden="true">
              {Array.from({ length: pace.weeks }, (_, index) => (
                <span
                  key={index}
                  className={
                    index + 1 < pace.currentWeek
                      ? "completed"
                      : index + 1 === pace.currentWeek
                        ? "current"
                        : ""
                  }
                />
              ))}
            </div>
          </div>
        </header>

        <div className="weekly-pace-metrics">
          <div>
            <span>Planned per week</span>
            <strong>{moneyText(Math.round(pace.plannedPerWeek))}</strong>
            <small>
              {moneyText(target)} ÷ {pace.weeks} weeks
            </small>
          </div>
          <div>
            <span>{futureWeeks ? "Available per week" : "Left this week"}</span>
            <strong className={balance < 0 ? "negative" : ""}>
              {moneyText(Math.round(pace.availablePerWeek))}
            </strong>
            <small>
              {futureWeeks
                ? `${moneyText(balance)} ÷ ${futureWeeks} ${weekWord}`
                : "Final week of this budget month"}
            </small>
          </div>
        </div>

        <div className="weekly-pace-week-summary">
          <div className="weekly-pace-spent">
            <span>Spent this week</span>
            <strong>
              {weeklySpent === 0
                ? moneyText(0)
                : moneyText(-weeklySpent).replace(/^-/, "−")}
            </strong>
          </div>
          {futureWeeks > 0 && (
            <div
              className={
                "weekly-pace-spent weekly-pace-comparison " +
                (remainingThisWeek >= 0 ? "ahead" : "behind")
              }
            >
              <span>
                {remainingThisWeek >= 0
                  ? "Left to spend"
                  : "Over this week's budget"}
              </span>
              <strong>{moneyText(Math.abs(remainingThisWeek))}</strong>
            </div>
          )}
        </div>
        {futureWeeks === 0 && (
          <p className="weekly-pace-note">
            No full weeks remain after this one.
          </p>
        )}
      </div>
    </section>
  );
}
