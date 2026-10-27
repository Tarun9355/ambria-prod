// How many of an item are LOADED on each date of a booking that spans several dates (IMS Dept Ops > Inventory blocked).
// Pieces already standing at the venue from the day before are reused, not loaded again: 8 needed on the 19th and 12 on the 20th load 8,
// then 4, so the dates add up to the most ever needed at once. That holds for one venue on consecutive days; after a day with no event
// there the pieces have gone back and the next date loads in full. Functions held at one venue on the same date share the pieces (the
// largest need counts); different venues are separate chains and add up.
//
//   venueChains  [ [ { date: "YYYY-MM-DD", maps: [m, m…] }, … ] , … ]   one chain per venue, its dates in order; maps = one entry per function
//                held there that day (whatever `needOf` reads a need from)
//   date         the date asked about
//   needOf(m)    how many of this item that function needs
const DAY = 86400000;
const ms = (d) => new Date(d + "T00:00:00").getTime();

export function loadOnDate(venueChains, date, needOf) {
  let load = 0;
  (venueChains || []).forEach((days) => {
    let standing = 0, prev = null;
    for (const day of days) {
      if (prev && ms(day.date) - ms(prev) > DAY * 1.5) standing = 0; // a day with no event here in between: the pieces went back
      const need = Math.max(0, ...day.maps.map((m) => Number(needOf(m)) || 0));
      if (day.date === date) load += Math.max(0, need - standing);
      standing = Math.max(standing, need);
      prev = day.date;
      if (day.date >= date) break;
    }
  });
  return load;
}
