// Currency formatter — Indian Rupee, Indian digit grouping. Faithful to reference `fmt`.
export function fmt(n) {
  return "₹" + (Number(n) || 0).toLocaleString("en-IN");
}
