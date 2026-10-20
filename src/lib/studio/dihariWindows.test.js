import { describe, it, expect } from "vitest";
import { slotHours, firstFnStartHour, withSetupSlot } from "./dihariWindows.js";

// Labours' real IMS windows.
const LABOURS = [
  { id: "m", label: "9 AM – 5 PM" },
  { id: "wqo1ap", label: "5 PM-12PM" },
  { id: "wai2xc", label: "12 AM - 9 AM" },
];

describe("slotHours", () => {
  it("reads both ends", () => {
    expect(slotHours("9 AM – 5 PM")).toEqual({ start: 9, end: 17 });
    expect(slotHours("12 AM - 9 AM")).toEqual({ start: 0, end: 9 });
  });
  it("is null with no time", () => { expect(slotHours("Full day")).toBeNull(); });
});

describe("firstFnStartHour", () => {
  it("takes the earliest known shift", () => {
    expect(firstFnStartHour([{ fnShift: "Night" }, { fnShift: "Morning" }, { fnShift: "" }])).toBe(9);
  });
  it("is null when no shift is known", () => { expect(firstFnStartHour([{ fnShift: "" }])).toBeNull(); });
});

describe("withSetupSlot", () => {
  it("adds the overnight-to-9 shift before a 9 AM function", () => {
    expect(withSetupSlot(["m", "wqo1ap"], LABOURS, [{ fnShift: "Morning" }, { fnShift: "Night" }])).toEqual(["wai2xc", "m", "wqo1ap"]);
  });
  it("leaves a day whose first function starts after a chosen shift", () => {
    expect(withSetupSlot(["m", "wqo1ap"], LABOURS, [{ fnShift: "Lunch" }])).toEqual(["m", "wqo1ap"]);
  });
  it("leaves the day alone when no function time is known", () => {
    expect(withSetupSlot(["m"], LABOURS, [{ fnShift: "" }])).toEqual(["m"]);
  });
  it("leaves it when the setup shift is already chosen", () => {
    expect(withSetupSlot(["wai2xc", "m"], LABOURS, [{ fnShift: "Morning" }])).toEqual(["wai2xc", "m"]);
  });
  it("adds nothing when no shift ends before the function", () => {
    expect(withSetupSlot(["m"], [{ id: "m", label: "9 AM – 5 PM" }], [{ fnShift: "Morning" }])).toEqual(["m"]);
  });
});
