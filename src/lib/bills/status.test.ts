import { describe, it, expect } from "vitest";
import {
  paidAmount,
  remaining,
  billStatus,
  summarizeBills,
  sortByDueDate,
} from "./status";
import type { Bill } from "@/types";

function bill(p: Partial<Bill>): Bill {
  return {
    ownerId: "u",
    kind: "payable",
    description: "",
    amount: 100,
    dueDate: "2025-06-10",
    payments: [],
    createdAt: 0,
    ...p,
  };
}

describe("paidAmount / remaining", () => {
  it("sums payments and computes remaining", () => {
    const b = bill({ amount: 100, payments: [
      { id: "1", date: "2025-06-01", amount: 30 },
      { id: "2", date: "2025-06-05", amount: 20 },
    ] });
    expect(paidAmount(b)).toBe(50);
    expect(remaining(b)).toBe(50);
  });

  it("never returns a negative remaining", () => {
    const b = bill({ amount: 100, payments: [{ id: "1", date: "2025-06-01", amount: 150 }] });
    expect(remaining(b)).toBe(0);
  });
});

describe("billStatus", () => {
  const today = "2025-06-15";
  it("is paid when fully settled", () => {
    expect(billStatus(bill({ amount: 100, payments: [{ id: "1", date: "x", amount: 100 }] }), today)).toBe("paid");
  });
  it("is overdue when past due and not fully paid", () => {
    expect(billStatus(bill({ amount: 100, dueDate: "2025-06-10", payments: [] }), today)).toBe("overdue");
    expect(billStatus(bill({ amount: 100, dueDate: "2025-06-10", payments: [{ id: "1", date: "x", amount: 40 }] }), today)).toBe("overdue");
  });
  it("is partial when some paid and not yet due", () => {
    expect(billStatus(bill({ amount: 100, dueDate: "2025-06-20", payments: [{ id: "1", date: "x", amount: 40 }] }), today)).toBe("partial");
  });
  it("is open when nothing paid and not yet due", () => {
    expect(billStatus(bill({ amount: 100, dueDate: "2025-06-20", payments: [] }), today)).toBe("open");
  });
});

describe("summarizeBills", () => {
  const today = "2025-06-15";
  it("splits outstanding into overdue and upcoming, and counts paid", () => {
    const bills = [
      bill({ amount: 100, dueDate: "2025-06-10", payments: [] }), // overdue 100
      bill({ amount: 200, dueDate: "2025-06-20", payments: [{ id: "1", date: "x", amount: 50 }] }), // upcoming 150
      bill({ amount: 80, dueDate: "2025-06-01", payments: [{ id: "1", date: "x", amount: 80 }] }), // paid
    ];
    const s = summarizeBills(bills, today);
    expect(s.count).toBe(3);
    expect(s.total).toBe(380);
    expect(s.outstanding).toBe(250);
    expect(s.overdue).toBe(100);
    expect(s.upcoming).toBe(150);
    expect(s.paidCount).toBe(1);
  });
});

describe("sortByDueDate", () => {
  it("orders ascending by due date", () => {
    const out = sortByDueDate([
      bill({ dueDate: "2025-06-20" }),
      bill({ dueDate: "2025-06-01" }),
      bill({ dueDate: "2025-06-10" }),
    ]);
    expect(out.map((b) => b.dueDate)).toEqual(["2025-06-01", "2025-06-10", "2025-06-20"]);
  });
});
