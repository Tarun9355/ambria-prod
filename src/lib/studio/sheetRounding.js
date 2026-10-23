// Cost sheet item line: whole-rupee Rate / Disc. Rate, and Amount = Qty × that rate, so a guest can check every
// line with a calculator. `up` is the engine's full unit rate (can carry paise), `lt` its exact line cost.
// `adj` is how far the printed Amount sits from the exact one — the caller adds it to the zone/function totals
// so the sheet still adds up as printed. A line whose Amount is not Qty × Rate to begin with (short-part split,
// kit shortfall) keeps its true figure.
export function sheetItemLine({ qty, up, lt }) {
  const qtyN = Number(qty) || 0;
  const noDiscTotal = Math.round(up * qtyN);
  const hasDiscount = qtyN > 0 && (noDiscTotal - lt) > 0.5;
  const wholeRate = Math.round(up);
  const discRate = hasDiscount ? Math.round(lt / qtyN) : undefined;
  const clean = qtyN > 0 && Math.abs(qtyN * up - (hasDiscount ? noDiscTotal : lt)) <= 1;
  const rate = clean ? wholeRate : up;
  const total = hasDiscount ? qtyN * discRate : clean ? qtyN * wholeRate : lt;
  return {
    rate, total, hasDiscount, discRate,
    noDiscTotal: hasDiscount ? (clean ? qtyN * wholeRate : noDiscTotal) : undefined,
    adj: total - lt,
  };
}
