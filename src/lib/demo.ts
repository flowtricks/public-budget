import {
  emptyState,
  today,
  type State,
  type Envelope,
  type Transaction,
} from "../../shared/model";
export function demoState(): State {
  const s = emptyState("demo");
  const specs = [
    ["groceries", "Groceries", 60000, 42868, "ShoppingBasket", "green"],
    ["dining", "Dining out", 25000, 16450, "Utensils", "orange"],
    ["transport", "Auto fund", 30000, 23625, "Car", "blue"],
    ["home", "Household", 20000, 14321, "House", "purple"],
    ["spending", "Personal spending", 20000, 11800, "ShoppingBag", "pink"],
    ["bills", "Bills & utilities", 180000, 180000, "Zap", "yellow"],
    ["travel", "Travel", 150000, 112000, "Plane", "teal"],
    ["savings", "Savings", null, 825000, "Landmark", "green"],
  ];
  for (let i = 0; i < specs.length; i++) {
    const [id, name, target, opening, icon, color] = specs[i];
    s.records[id as string] = {
      id,
      kind: "envelope",
      version: 1,
      name,
      target,
      opening,
      icon,
      color,
      order: i,
      archived: false,
    } as Envelope;
  }
  const dates = [0, 0, 1, 1, 2, 2, 3, 4];
  const merchants = [
    ["Whole Foods Market", 6732, "groceries"],
    ["Blue Bottle Coffee", 650, "dining"],
    ["Target", 3824, "home"],
    ["Shell", 4375, "transport"],
    ["Trader Joe’s", 4856, "groceries"],
    ["Spotify", 1199, "bills"],
    ["Amazon", 2799, "spending"],
    ["Sweetgreen", 1875, "dining"],
  ] as const;
  for (let i = 0; i < merchants.length; i++) {
    const [payee, amount, envelopeId] = merchants[i];
    const d = new Date();
    d.setDate(d.getDate() - dates[i]);
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    const tx: Transaction = {
      id: "demo-tx-" + i,
      kind: "transaction",
      version: 1,
      type: "expense",
      payee,
      amount,
      date,
      note: i === 2 ? "A few things for the house" : "",
      tags: i === 2 ? ["Home"] : [],
      allocations: [{ envelopeId, amount: -amount }],
      pending: i === 0,
      deleted: false,
      excluded: false,
      source: "manual",
      updatedAt: d.toISOString(),
    };
    s.records[tx.id] = tx;
    (s.records[envelopeId] as Envelope).opening += amount;
  }
  s.records.settings = {
    id: "settings",
    kind: "settings",
    version: 1,
    name: "Demo household",
    fallbackId: "spending",
    currency: "USD",
    timezone: "America/Chicago",
  };
  return s;
}
