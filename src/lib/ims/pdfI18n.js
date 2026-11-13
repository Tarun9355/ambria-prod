// ── THE DEPT OPS BOOK IN HINDI ──
// The Planning → Dept Ops PDF (DepartmentOpsTab's buildReportHtml) can be made in English or Hindi
// (owner ask 2026-11-01: "PDF Hindi mein bhi chahiye"). Every word the book itself prints goes through
// t(): the English string is the key, and this dictionary holds its Hindi - simple spoken Hindi a
// crew reads, keeping the loan words a crew actually says (ट्रस, ज़ोन, किट, कारपेट…).
// Data is never translated: item, client, venue, zone, colour and flower names, numbers and ₹ stay
// as they were typed. Only a department's displayed title is (Floral → फ्लोरल).
//
// Templates: "{n} item" style placeholders are filled from the second argument. A key with a "|"
// is a singular|plural pair, picked by vars.n (English "1 item" / "2 items"); the Hindi needs one form.
// English output is exactly the input string (placeholders filled), so the English book is unchanged.

export const PDF_HI = {
  // Departments (their titles; the department itself stays the data key)
  "Furniture": "फ़र्नीचर",
  "Floral": "फ्लोरल",
  "Structure": "स्ट्रक्चर",
  "Tenting": "टेंटिंग",
  "Transport": "ट्रांसपोर्ट",
  "Lighting": "लाइटिंग",
  "Fabric": "फ़ैब्रिक",
  "Paint": "पेंट",
  "All departments": "सभी विभाग",

  // Cover
  "Setup book": "सेटअप बुक",
  "Event": "इवेंट",
  "Venue": "वेन्यू",
  "Prepared by": "तैयार किया",
  "The event": "इवेंट",
  "{n} sessions": "{n} सेशन",
  "Event type": "इवेंट का प्रकार",
  "Date": "तारीख़",
  "Shift": "शिफ़्ट",
  "Guests": "मेहमान",
  "Session {n}": "सेशन {n}",
  "Date to be set": "तारीख़ तय होनी है",
  "To be set": "तय होना है",
  "Save as PDF": "PDF सेव करें",
  "Generated {date} · {name}": "बनाया गया {date} · {name}",

  // Sections and their tables
  "Loading & dispatch": "लोडिंग और डिस्पैच",
  "Loading list": "लोडिंग लिस्ट",
  "Artificial flowers & greens": "आर्टिफ़िशियल फूल और ग्रीन्स",
  "Dismantle routing": "डिस्मेंटल — सामान कहाँ जाएगा",
  "Fabric required vs available": "फ़ैब्रिक — ज़रूरत और स्टॉक",
  "Vehicle": "गाड़ी",
  "Driver": "ड्राइवर",
  "Phone": "फ़ोन",
  "Status": "स्थिति",
  "Item": "आइटम",
  "Qty": "मात्रा",
  "Bunches": "गुच्छे",
  "Bunches per kg": "गुच्छे प्रति kg",
  "Weight": "वज़न",
  "Colour": "रंग",
  "Load": "लोड",
  "Quantity": "मात्रा",
  "Fits per truck": "एक ट्रक में",
  "Trucks": "ट्रक",
  "Goes to": "कहाँ जाएगा",
  "Logged by": "किसने लिखा",
  "Fabric · colour": "फ़ैब्रिक · रंग",
  "Required": "ज़रूरत",
  "Available": "स्टॉक में",
  "Everything going to site — {items}, {pieces} in total.": "साइट पर जाने वाला सारा सामान — {items}, कुल {pieces}।",
  "{n} item|{n} items": "{n} आइटम",
  "{n} piece|{n} pieces": "{n} पीस",
  "Pull these specific bunches": "ये गुच्छे निकालें",
  "Truck {n}": "ट्रक {n}",
  "part of {kit}": "{kit} का हिस्सा",
  "Planning chose instead: {list}": "प्लानिंग ने इसकी जगह चुना: {list}",
  "Paint: {paint}": "पेंट: {paint}",
  "arranged separately": "अलग से इंतज़ाम",
  "another design": "दूसरा डिज़ाइन",
  "on {item}": "{item} पर",
  "Flower bunches": "फूलों के गुच्छे",
  "Green bunches": "ग्रीन्स के गुच्छे",
  "All functions": "सभी फ़ंक्शन",
  "Function {n}": "फ़ंक्शन {n}",
  "Artificial bunch": "आर्टिफ़िशियल गुच्छा",
  "{n} per truck": "एक ट्रक में {n}",
  "{amount} flat": "{amount} फ़िक्स",
  "{dept} fills {trucks} of the {n} truck this event needs|{dept} fills {trucks} of the {n} trucks this event needs":
    "इस इवेंट के {n} ट्रक में से {trucks} ट्रक {dept} का सामान भरता है",
  "A truck is counted by capacity, so a part-truck share is normal — the loads travel together.":
    "ट्रक जगह के हिसाब से गिना जाता है, इसलिए आधा ट्रक भी हो सकता है — सबका सामान साथ जाता है।",
  "Transfer → {to}": "ट्रांसफ़र → {to}",
  "site": "साइट",
  "Damaged": "ख़राब",
  "Back to production house": "वापस प्रोडक्शन हाउस",
  "short {n}": "{n} कम",
  "ok": "ठीक",
  "(unassigned)": "(तय नहीं)",

  // Fabric colours on the zone pages
  "Liza Fabric": "लिज़ा फ़ैब्रिक",
  "Velvet Curtains": "वेलवेट पर्दे",
  "Wall Masking": "वॉल मास्किंग",
  "Colour not picked": "रंग नहीं चुना",
  "Repeat": "रिपीट",
  "Fixed at venue": "वेन्यू पर फिक्स",
  "Already standing here - not to be loaded": "यहाँ पहले से लगा है - लोड नहीं करना",
  "Reused from {fn}": "{fn} से दोबारा इस्तेमाल",
  "the earlier function": "पिछला फंक्शन",
  "Fixed at venue ({n} standing)": "वेन्यू पर फिक्स ({n} खड़े)",
  "Fixed · {n} standing": "फिक्स · {n} खड़े",

  // The zone strip
  "Truss": "ट्रस",
  "Platform": "प्लेटफ़ॉर्म",
  "Carpet": "कारपेट",
  "Masking": "मास्किंग",
  "Back wall": "पीछे की दीवार",
  "Left wall": "बाईं दीवार",
  "Right wall": "दाईं दीवार",
  "Custom panel": "कस्टम पैनल",
  "Floor": "फ़्लोर",
  "Zone": "ज़ोन",
  "Yes": "हाँ",

  // The truss cut-list block (pillars/beams/batta by real stock size)
  "Truss #{n}": "ट्रस #{n}",
  "Pillar": "पिलर",
  "Beam": "बीम",
  "Batta": "बट्टा",
  "Truss cut list": "ट्रस कट लिस्ट",
  "Pillars": "पिलर",
  "Beams": "बीम",
  "Truss breakdown": "ट्रस का हिसाब",
  "Power": "बिजली",
  "not in stock": "स्टॉक में नहीं",
  "Drape": "ड्रेप",
  "Minimum": "कम",
  "Moderate": "मध्यम",
  "Dense": "घना",
  "Note": "नोट",
  "Genset": "जेनसेट",
  "Gensets for this event": "इस इवेंट के जेनसेट",
  "No genset": "कोई जेनसेट नहीं",
  "Total {n} kVA": "कुल {n} kVA",
  "incl. {pct}% buffer": "{pct}% बफ़र सहित",
  "Floral mix": "फूलों का मिक्स",
  "Flower palette": "फूलों के रंग",
  "Real {real}% · Artificial {art}%": "असली {real}% · आर्टिफ़िशियल {art}%",
  "Artificial {art}% · Real {real}%": "आर्टिफ़िशियल {art}% · असली {real}%",
  "+{n} more": "+{n} और",
  "{n} truss|{n} trusses": "{n} ट्रस",
  "Box": "बॉक्स",
  "Single U": "सिंगल U",
  "Raised {n}ft": "{n}ft ऊँचा",

  // Zone pages
  "Zone {n}": "ज़ोन {n}",
  "Part {part} of {parts}": "भाग {part} / {parts}",
  "No zone photo": "ज़ोन की फ़ोटो नहीं है",
  "No items": "कोई आइटम नहीं",
  "No {dept} items": "{dept} का कोई आइटम नहीं",
  "KIT · {n}": "किट · {n}",
  "Size": "साइज़",
  "From": "कहाँ से",
  "Dept": "विभाग",
  "Small": "छोटा",
  "Medium": "मीडियम",
  "Big": "बड़ा",
  "Real": "असली",
  "Artificial": "आर्टिफ़िशियल",
  "Inside {kit}": "{kit} के अंदर",
  "kit": "किट",
  "Source": "कहाँ से",
  "Bought / hired / made outside stock": "बाहर से ख़रीदा / किराए पर / बनवाया",
  "Bought / hired outside stock": "बाहर से ख़रीदा / किराए पर",
  "Design": "डिज़ाइन",
  "Chosen in Planning": "प्लानिंग में चुना",
  "Choice": "पसंद",
  "1st choice (not decided)": "पहली पसंद (तय नहीं)",
  "1st choice": "पहली पसंद",
  "2nd choice": "दूसरी पसंद",
  "3rd choice": "तीसरी पसंद",
  "4th choice": "चौथी पसंद",
  "{n}th choice": "{n}वीं पसंद",
  "Flowers": "फूल",
  "Flower recipe": "फूलों की रेसिपी",
  "Ceiling": "सीलिंग",
  "Custom ceiling": "कस्टम सीलिंग",
  "(truss {n})": "(ट्रस {n})",
  "Print": "प्रिंट",
  "Area": "एरिया",
  "total": "कुल",
  "On": "किस पर",
  "Carpet arranged separately": "कारपेट का अलग से इंतज़ाम",
  "To use": "यही लगाना है",
  "To use (Planning's pick)": "यही लगाना है (प्लानिंग की पसंद)",
  "To lay": "बिछाना है",
  "(floor {n})": "(फ़्लोर {n})",
  "Buying": "ख़रीदारी",
  "Production": "प्रोडक्शन",
  "From production": "प्रोडक्शन से",
  "Made by the production team for this event": "इस इवेंट के लिए प्रोडक्शन टीम बनाएगी",
  "To buy": "ख़रीदना है",
  "Bought in for this event — not from our own stock": "इस इवेंट के लिए बाहर से ख़रीदा — अपने स्टॉक से नहीं",
  "Not in a zone": "किसी ज़ोन में नहीं",
  "Also on site": "साइट पर ये भी",
  "Held for this event, but no zone lists these. The zone plan here was last synced from Deal Check on {date} — re-sync if they belong in a zone.":
    "ये इस इवेंट के लिए रखे हैं, पर किसी ज़ोन में नहीं लिखे। ज़ोन प्लान आख़िरी बार {date} को Deal Check से सिंक हुआ था — अगर ये किसी ज़ोन के हैं तो दोबारा सिंक करें।",
  "Held for this event, but no zone lists these — re-sync Deal Check if they belong in a zone.":
    "ये इस इवेंट के लिए रखे हैं, पर किसी ज़ोन में नहीं लिखे — अगर ये किसी ज़ोन के हैं तो Deal Check दोबारा सिंक करें।",
  "Artificial flowers": "आर्टिफ़िशियल फूल",
  "Artificial greens": "आर्टिफ़िशियल ग्रीन्स",
  "bunches": "गुच्छे",
  "Arrangement": "अरेंजमेंट",
};

// Units the books print after a quantity ("1.5 bundle", "2 Pieces"), in the Hindi the crew uses. Matched case-blind on the unit as stored;
// a unit not listed prints as it is (owner report 2026-11-02: the Hindi book's quantities still read "bundle" / "piece").
const UNIT_HI = {
  piece: "पीस", pieces: "पीस", pc: "पीस", pcs: "पीस", nos: "नग", no: "नग", unit: "नग", units: "नग",
  bundle: "बंडल", bundles: "बंडल", bunch: "गुच्छा", bunches: "गुच्छे", gaddi: "गड्डी", set: "सेट", sets: "सेट", pair: "जोड़ी", pairs: "जोड़ी",
  kg: "किलो", kgs: "किलो", g: "ग्राम", gm: "ग्राम", gram: "ग्राम", grams: "ग्राम", litre: "लीटर", liter: "लीटर", l: "लीटर",
  ft: "फुट", feet: "फुट", rft: "रनिंग फुट", sqft: "वर्ग फुट", "sq ft": "वर्ग फुट", m: "मीटर", metre: "मीटर", meter: "मीटर", mtr: "मीटर",
  inch: "इंच", inches: "इंच", roll: "रोल", rolls: "रोल", box: "डिब्बा", boxes: "डिब्बे", packet: "पैकेट", packets: "पैकेट", dozen: "दर्जन",
};
/** A unit for the book's language: the Hindi word for "hi" when known, else the unit as given. */
export function pdfUnit(lang, unit) {
  if (lang !== "hi" || unit == null) return unit;
  const k = String(unit).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(UNIT_HI, k) ? UNIT_HI[k] : unit;
}

/** t(str, vars) for a language: the Hindi for "hi" when there is one, else the English as given. */
export function pdfT(lang) {
  const hi = lang === "hi";
  return function t(str, vars) {
    if (str == null) return str; // nothing to say: handed back as it came, so esc() still prints it as before
    const key = String(str);
    let out = (hi && Object.prototype.hasOwnProperty.call(PDF_HI, key)) ? PDF_HI[key] : key;
    if (out.includes("|") && vars && vars.n !== undefined) {
      const [one, many] = out.split("|");
      out = Number(vars.n) === 1 ? one : (many ?? one);
    }
    if (!vars) return out;
    // One pass over the template only: a value that itself holds "{x}" is not filled again.
    return out.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
  };
}

const HI_MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
const HI_DAYS = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];
const HI_DAYS_SHORT = ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"];

/** A date in Hindi with Western digits: "शनिवार, 29 अगस्त 2026". opts.weekday "long" | "short" | omitted; opts.year false drops it. */
export function formatDateHi(date, opts = {}) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return String(date ?? "");
  const day = opts.weekday === "long" ? HI_DAYS[d.getDay()] : opts.weekday === "short" ? HI_DAYS_SHORT[d.getDay()] : "";
  const body = `${d.getDate()} ${HI_MONTHS[d.getMonth()]}${opts.year === false ? "" : ` ${d.getFullYear()}`}`;
  return day ? `${day}, ${body}` : body;
}

/** Date and time in Hindi: "1 नवंबर 2026, 15:05". */
export function formatDateTimeHi(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return String(date ?? "");
  return `${formatDateHi(d)}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The book's date for a language: English goes through toLocaleDateString("en-IN", opts) exactly as before. */
export function pdfDate(lang, date, opts) {
  return lang === "hi" ? formatDateHi(date, { weekday: opts?.weekday, year: opts?.year ? true : false }) : date.toLocaleDateString("en-IN", opts);
}
export function pdfDateTime(lang, date) {
  return lang === "hi" ? formatDateTimeHi(date) : date.toLocaleString("en-IN");
}

// ── THE HINDI BOOK'S TYPE ──
// The house fonts (Inter, Playfair Display) carry no Devanagari, so the Noto Devanagari faces follow each of them in every stack:
// Latin data (item and client names) still sets in the house fonts, Hindi falls through to Noto. Letter-spacing is dropped
// (html2canvas draws text letter by letter when it is set, which splits Devanagari conjuncts) and uppercase is meaningless for
// Devanagari. The smallest uppercase labels go up a step, since Devanagari at 9px is hard to read, and the big serif titles get
// room above for the matras.
export const HI_FONT_FAMILIES = "&family=Noto+Sans+Devanagari:wght@400;600;700&family=Noto+Serif+Devanagari:wght@600;700";
const HI_CSS = `
  /* Hindi book */
  *{letter-spacing:0!important;text-transform:none!important}
  .cv-title{line-height:1.4}
  .zh h2{line-height:1.45}
  .zc-r span,.zl,.kb-zk,.kb-tg{font-size:10.5px!important}
  th,.cv-facts .k,.cv-ses .sk,.cv-ses .sf .k,.cv-kind,.cv-sec,.card .k{font-size:11.5px!important}
`;

/** Turns the English report's markup into the Hindi one's (fonts, lang, the CSS above). English is never passed through this. */
export function hindiReportHtml(html) {
  return String(html)
    .replace("<html>", '<html lang="hi">')
    .replace("&display=swap", HI_FONT_FAMILIES + "&display=swap")
    .replace(/"Inter",/g, '"Inter","Noto Sans Devanagari",')
    .replace(/"Playfair Display",/g, '"Playfair Display","Noto Serif Devanagari",')
    .replace("</style></head>", HI_CSS + "</style></head>");
}
