// ── THE DEPT OPS SCREEN IN HINDI ──
// The EN | हिं toggle used to turn only the PDF Hindi; the owner wants the Planning screen itself in Hindi too (2026-11-02).
// The screen is thousands of lines of labels across Dept Ops and its blocks, so rather than wrap each one, the shown text is
// rewritten in place while Hindi is on (lib/ims/useHindiDom): a label the crew reads is looked up here (a real Hindi phrase,
// the same words the Hindi PDF uses), and anything else - item, flower, zone, client names, a sentence not listed yet - is spelled
// in Devanagari by lib/ims/hindiTranslit, like the book's names. Digits, ₹ amounts and symbols are kept.
import { PDF_HI } from "./pdfI18n";
import { toHindi } from "./hindiTranslit";
import { UI_HI_MORE } from "./uiHindiMore";

export const UI_HI = {
  // headings and tiles
  "Planning": "प्लानिंग", "Execution": "एग्ज़ीक्यूशन", "Actuals": "असल खर्च", "Actual cost": "असल लागत", "Actual held": "असल रखा",
  "Truck planning": "ट्रक प्लानिंग", "Truss plan": "ट्रस प्लान", "Fabric plan": "फ़ैब्रिक प्लान", "Carpet plan": "कारपेट प्लान",
  "Dismantle plan": "डिसमेंटल प्लान", "Dismantle & routing": "डिसमेंटल और रूटिंग", "Dismantle & return routing": "डिसमेंटल और वापसी रूटिंग",
  "Manpower plan": "मैनपावर प्लान", "On-site crew": "साइट पर क्रू", "Inventory blocked": "ब्लॉक किया सामान", "Receiving": "रिसीविंग",
  "Loading & dispatch": "लोडिंग और डिस्पैच", "Loading manifest": "लोडिंग लिस्ट", "Movement log": "मूवमेंट लॉग", "Activity log": "एक्टिविटी लॉग",
  "Essentials": "ज़रूरी सामान", "Dept Income": "विभाग की आमदनी", "Total income": "कुल आमदनी", "Sales discount": "सेल्स डिस्काउंट",
  "Income − discount − cost": "आमदनी − डिस्काउंट − लागत", "Net": "नेट", "Cost": "लागत", "Crew": "क्रू", "People": "लोग",
  "Department": "विभाग", "Deal value": "डील वैल्यू", "Total": "कुल", "Peak": "सबसे ज़्यादा", "Planned": "प्लान किया", "Suggested": "सुझाया गया",
  "Projected (plan)": "अनुमान (प्लान)", "Rate": "रेट", "Note": "नोट", "Other": "अन्य", "New": "नया", "Bought": "खरीदा", "Broken": "टूटा",
  "Repair": "रिपेयर", "Repairs needed": "रिपेयर चाहिए", "Shared": "साझा", "SHARED": "साझा", "Shared across departments.": "सभी विभागों में साझा।",
  "Own fleet": "अपनी गाड़ियाँ", "Pick from fleet": "गाड़ियों में से चुनें", "Add vehicle": "गाड़ी जोड़ें", "Print challan": "चालान प्रिंट करें",
  "No trucks yet": "अभी कोई ट्रक नहीं", "No truck assigned yet.": "अभी कोई ट्रक नहीं लगा।", "Add a truck to start loading.": "लोडिंग शुरू करने के लिए ट्रक जोड़ें।",
  "no truck capacity set": "ट्रक की क्षमता सेट नहीं", "Labours on site, by day": "साइट पर लेबर, दिन के हिसाब से", "On site, by day": "साइट पर, दिन के हिसाब से",
  "On-site expenses (manual)": "साइट के खर्चे (हाथ से)", "All-department labour": "सभी विभागों की लेबर", "Whole event": "पूरा इवेंट",
  "Whole event manpower": "पूरे इवेंट की मैनपावर", "Labour dih.": "लेबर दिहाड़ी", "Dihari": "दिहाड़ी", "dihari": "दिहाड़ी", "+ dihari": "+ दिहाड़ी",
  "₹/day": "₹/दिन", "₹/unit": "₹/यूनिट", "qty × ₹/unit": "मात्रा × ₹/यूनिट", "Rental qty": "किराए की मात्रा", "Exact need": "असल ज़रूरत",
  "From Deal Check": "डील चेक से", "Synced from Ops": "ऑप्स से सिंक", "How the count was worked out": "गिनती कैसे निकली",
  "Real shopping": "असली ख़रीद", "Real shopping =": "असली ख़रीद =", "Total artificial =": "कुल आर्टिफ़िशियल =",
  "Download PDF": "PDF डाउनलोड करें", "Download Actuals as PDF": "असल खर्च PDF में डाउनलोड करें", "One PDF, every department": "एक PDF, सभी विभाग",
  "Pick an event to plan": "प्लान करने के लिए इवेंट चुनें", "Open Calendar →": "कैलेंडर खोलें →", "Today": "आज", "Per date": "तारीख के हिसाब से",
  "Tap a highlighted date to see its events.": "इवेंट देखने के लिए हाइलाइट तारीख पर टैप करें।", "Changes made in Studio": "स्टूडियो में हुए बदलाव",
  "Loading": "लोडिंग", "Dispatched": "डिस्पैच हुआ", "At site": "साइट पर", "Returned": "वापस आया", "Pending": "बाकी", "Ready": "तैयार",
  "Packed": "पैक हुआ", "Delivered": "पहुँच गया", "Sold": "सोल्ड", "Confirmed": "कन्फ़र्म",
  "Site Supervisor": "साइट सुपरवाइज़र", "Added": "जोड़ा", "Removed": "हटाया", "Quantity changed": "मात्रा बदली",
  // fabric, truss, carpet
  "Fabric allocation": "फ़ैब्रिक बँटवारा", "Liza": "लिज़ा", "Liza Fabric": "लिज़ा फ़ैब्रिक", "Velvet Curtains": "वेलवेट पर्दे",
  "Wall Masking": "वॉल मास्किंग", "Truss": "ट्रस", "Pick colour…": "रंग चुनें…", "+ colour": "+ रंग", "+ add": "+ जोड़ें", "Add": "जोड़ें",
  "— unassigned —": "— तय नहीं —", "· standing": "· पहले से लगा", "Repeat": "रिपीट", "Stock not known": "स्टॉक पता नहीं",
  "Every truss on this event — what to build, and the fabric it takes.": "इस इवेंट के सारे ट्रस — क्या बनाना है, और कितना फ़ैब्रिक लगेगा।",
  "Colour: not recorded for this zone yet - sync the event from Deal Check": "रंग: इस ज़ोन का अभी दर्ज नहीं - डील चेक से इवेंट सिंक करें",
  "No colour has been picked for this fabric yet — it is chosen in Deal Check, under Fabric allocation.": "इस फ़ैब्रिक का रंग अभी नहीं चुना — यह डील चेक में फ़ैब्रिक बँटवारे में चुना जाता है।",
  "Which colour goes in which zone shows once this event is synced again from Deal Check.": "कौन सा रंग किस ज़ोन में लगेगा, यह डील चेक से दोबारा सिंक करने पर दिखेगा।",
  "Total available counts Old + New stock. Update live quantities in Planning → Fabric Stock after each washing": "कुल उपलब्ध में पुराना + नया स्टॉक गिना है। हर धुलाई के बाद प्लानिंग → फ़ैब्रिक स्टॉक में मात्रा अपडेट करें",
  "ℹ️ Truss type not picked — defaulted to Half Box": "ℹ️ ट्रस टाइप नहीं चुना — हाफ़ बॉक्स मान लिया",
  "Sales picked up to three carpets for each floor. Check what is free on the day and choose the one that goes down.": "सेल्स ने हर फ़्लोर के लिए तीन तक कारपेट चुने हैं। उस दिन क्या खाली है देखें और जो बिछेगा वो चुनें।",
  "Nothing to choose from yet — ask sales to pick up to three carpets in Build (Platform → Carpet).": "अभी चुनने को कुछ नहीं — सेल्स से बिल्ड में तीन तक कारपेट चुनवाएँ (प्लेटफ़ॉर्म → कारपेट)।",
  "The carpet for this floor is bought or hired outside stock.": "इस फ़्लोर का कारपेट स्टॉक के बाहर से खरीदा या किराए पर लिया गया है।",
  "Arrange separately (not from stock)": "अलग से इंतज़ाम (स्टॉक से नहीं)", "Arranged separately": "अलग से इंतज़ाम",
  "Use this": "यह लगाएँ", "✓ Using this · undo": "✓ यही लग रहा है · वापस", "✓ 1st choice · default": "✓ पहली पसंद · डिफ़ॉल्ट",
  "✓ Chosen": "✓ चुना गया", "↺ back to Deal Check pick": "↺ डील चेक वाली पसंद पर वापस", "↺ back to Deal Check plan": "↺ डील चेक वाले प्लान पर वापस",
  "↺ Reset to system plan": "↺ सिस्टम प्लान पर वापस", "Overlay & cushion cover choices": "ओवरले और कुशन कवर की पसंद",
  "These pieces are bought, hired or made outside stock.": "ये पीस स्टॉक के बाहर से खरीदे, किराए पर लिए या बनवाए गए हैं।",
  // fixed venues
  "📌 Fixed at venues": "📌 वेन्यू पर फिक्स", "This event's venue": "इस इवेंट का वेन्यू",
  "Standing permanently at these venues - already there, not to be loaded. Tap a venue for its list. Set in Settings → Fixed Venues.": "इन वेन्यू पर हमेशा लगा रहता है - पहले से है, लोड नहीं करना। लिस्ट के लिए वेन्यू पर टैप करें। सेटिंग्स → फिक्स्ड वेन्यू में सेट होता है।",
  // flowers
  "Real flowers (mandi)": "असली फूल (मंडी)", "Floral cost to source": "फूलों की ख़रीद लागत", "Flowers:": "फूल:", "Greens:": "ग्रीन्स:",
  "Flower Palette:": "फूलों के रंग:", "Pull these specific bunches": "ये गुच्छे निकालें", "Print the mandi shopping list": "मंडी ख़रीद लिस्ट प्रिंट करें",
  "No match in Mandi Prices.": "मंडी रेट में नहीं मिला।", "No matching flowers in the mandi catalogue.": "मंडी लिस्ट में ऐसा फूल नहीं मिला।",
  "Save swap": "बदलाव सेव करें", "SWAPPED": "बदला गया", "— see shopping list below": "— नीचे ख़रीद लिस्ट देखें",
  "No mandi plan captured. Add flowers below, or run Deal Check before marking Sold to auto-capture it.": "मंडी प्लान नहीं मिला। नीचे फूल जोड़ें, या सोल्ड करने से पहले डील चेक चलाएँ।",
  "No artificial bunches captured — set \"Art Bunches/Unit\" on flowers in the Mandi tab.": "आर्टिफ़िशियल गुच्छे नहीं मिले — मंडी टैब में फूलों पर \"Art Bunches/Unit\" सेट करें।",
  "What was actually bought/spent — fill in after shopping, not while planning": "असल में क्या खरीदा/खर्च हुआ — ख़रीद के बाद भरें, प्लानिंग के समय नहीं",
  // inventory, routing, loading
  "No inventory blocked for this department on this event.": "इस इवेंट पर इस विभाग का कोई सामान ब्लॉक नहीं है।",
  "No inventory blocked for this department.": "इस विभाग का कोई सामान ब्लॉक नहीं है।", "No inventory to route for this department.": "इस विभाग का भेजने को कोई सामान नहीं।",
  "None of this department's inventory is in this function's zones.": "इस फ़ंक्शन के ज़ोन में इस विभाग का कोई सामान नहीं है।",
  "OUT OF STOCK": "स्टॉक ख़त्म", "not allocated in Deal Check": "डील चेक में बाँटा नहीं गया", "split allocation": "बँटा हुआ",
  "Tick only what fits on this truck — untick the rest and confirm them on a second truck.": "सिर्फ़ वो टिक करें जो इस ट्रक में आए — बाकी हटाकर दूसरे ट्रक पर कन्फ़र्म करें।",
  "Trucks are shared by every department on this event. Each prints its own challan.": "इस इवेंट के ट्रक सभी विभाग साझा करते हैं। हर विभाग अपना चालान प्रिंट करता है।",
  "By destination. Add truck details, mark anything broken or for repair, then confirm.": "जगह के हिसाब से। ट्रक की जानकारी डालें, टूटा या रिपेयर वाला मार्क करें, फिर कन्फ़र्म करें।",
  "Confirm the dept head's plan, or send everything left to the warehouse.": "विभाग हेड का प्लान कन्फ़र्म करें, या बचा सब गोदाम भेजें।",
  "Split items across sites; the rest go to production house.": "सामान साइटों में बाँटें; बाकी प्रोडक्शन हाउस जाएगा।",
  "✓ Confirm all as planned": "✓ सब प्लान के हिसाब से कन्फ़र्म", "✓ Everything routed — see the movement log below.": "✓ सब भेज दिया — नीचे मूवमेंट लॉग देखें।",
  "All → warehouse": "सब → गोदाम", "Production house": "प्रोडक्शन हाउस", "Receiving — sources per item": "रिसीविंग — हर आइटम कहाँ से",
  "— who's bringing what, on which truck": "— कौन क्या ला रहा है, किस ट्रक पर", "No other sold events nearby.": "आस-पास कोई और सोल्ड इवेंट नहीं।",
  "Sync to IMS Dept Ops": "IMS डिपार्टमेंट ऑप्स में सिंक करें", "Updating…": "अपडेट हो रहा है…",
  // manpower
  "One event-wide team, split across departments by their usage or income share. Each department's figure below is its share.": "पूरे इवेंट की एक टीम, जो विभागों में उनके इस्तेमाल या आमदनी के हिस्से से बँटती है। नीचे हर विभाग का आंकड़ा उसका हिस्सा है।",
  "Total dihari for the whole event. Split across departments by usage.": "पूरे इवेंट की कुल दिहाड़ी। इस्तेमाल के हिसाब से विभागों में बँटी।",
  "From Studio; edit any field, it saves. Sum matches the income card.": "स्टूडियो से; कोई भी फ़ील्ड बदलें, सेव हो जाता है। जोड़ आमदनी कार्ड से मिलता है।",
  "all departments · with each dept's edits": "सभी विभाग · हर विभाग के बदलाव के साथ",
  "No Deal Check breakdown synced yet for this event. In Studio → Deal Check →": "इस इवेंट का डील चेक ब्रेकडाउन अभी सिंक नहीं हुआ। स्टूडियो → डील चेक →",
  "to push the numbers here.": "दबाकर आंकड़े यहाँ भेजें।", "How": "कैसे", "how": "कैसे", "note:": "नोट:",
  // buttons and small words
  "Save": "सेव", "Cancel": "रद्द करें", "Close": "बंद करें", "Edit": "बदलें", "Delete": "हटाएँ", "Remove": "हटाएँ", "Confirm": "कन्फ़र्म",
  "Done": "हो गया", "Back": "वापस", "Search": "खोजें", "Search…": "खोजें…", "Loading…": "लोड हो रहा है…", "Saving…": "सेव हो रहा है…", "Saved": "सेव हो गया",
  "edited": "बदला गया", "extra": "अतिरिक्त", "need": "ज़रूरत", "short": "कम", "total": "कुल", "in all": "कुल मिलाकर", "of": "में से",
  "arriving": "आ रहा है", "· arriving": "· आ रहा है", "· auto": "· ऑटो", "· set here": "· यहाँ सेट", "→ planned as": "→ प्लान", "→ you set": "→ आपने सेट किया",
  "crew": "क्रू", "qty": "मात्रा", "stock specifically": "ख़ास स्टॉक", "THIS": "यह", "KIT": "किट", "Yes": "हाँ", "No": "नहीं",
  "Set the crew per day & per dihari (shift). Add a dihari to split a day — e.g. 2 in the day shift + 1 in the night shift.": "हर दिन और हर दिहाड़ी (शिफ़्ट) का क्रू सेट करें। दिन बाँटने के लिए दिहाड़ी जोड़ें — जैसे दिन की शिफ़्ट में 2 + रात में 1।",
};

// Small words that read right on their own in the middle of a label ("12 pcs", "3 trucks"), checked before the phonetic spelling.
const UI_WORDS = {
  pcs: "पीस", pc: "पीस", nos: "नग", sqft: "वर्ग फुट", bundle: "बंडल", bundles: "बंडल", dihari: "दिहाड़ी", qty: "मात्रा", total: "कुल",
  truck: "ट्रक", trucks: "ट्रक", item: "आइटम", items: "आइटम", zone: "ज़ोन", zones: "ज़ोन", day: "दिन", days: "दिन", event: "इवेंट",
  events: "इवेंट", crew: "क्रू", worker: "वर्कर", workers: "वर्कर", labour: "लेबर", labours: "लेबर", full: "फ़ुल", stock: "स्टॉक",
  jan: "जनवरी", feb: "फ़रवरी", mar: "मार्च", apr: "अप्रैल", jun: "जून", jul: "जुलाई", aug: "अगस्त", sep: "सितंबर", sept: "सितंबर",
  oct: "अक्टूबर", nov: "नवंबर", dec: "दिसंबर", january: "जनवरी", february: "फ़रवरी", march: "मार्च", april: "अप्रैल", june: "जून",
  july: "जुलाई", august: "अगस्त", september: "सितंबर", october: "अक्टूबर", november: "नवंबर", december: "दिसंबर",
  mon: "सोम", tue: "मंगल", wed: "बुध", thu: "गुरु", fri: "शुक्र", sat: "शनि", monday: "सोमवार", tuesday: "मंगलवार",
  wednesday: "बुधवार", thursday: "गुरुवार", friday: "शुक्रवार", saturday: "शनिवार", sunday: "रविवार",
};

const norm = (s) => s.replace(/\s+/g, " ").trim();
// Every listed label, keyed lower-case: the Hindi book's words, then the screen's (lib/ims/uiHindiMore, then UI_HI above) over them.
let ALL = null;
const all = () => {
  if (ALL) return ALL;
  ALL = new Map();
  [PDF_HI, UI_HI_MORE, UI_HI].forEach(m => Object.entries(m).forEach(([k, v]) => { if (!String(v).includes("{")) ALL.set(norm(k).toLowerCase(), String(v).split("|")[0]); }));
  return ALL;
};
const lookup = (core) => (core ? all().get(core.toLowerCase()) ?? null : null);
// A listed phrase of two words or more inside a longer text the screen builds around a number or a name ("Short for this date — only 3"),
// longest first, whole words only.
let PHRASE_RE = null;
const phraseRe = () => {
  if (PHRASE_RE) return PHRASE_RE;
  const keys = [...all().keys()].filter(k => /[a-z]/.test(k) && k.includes(" ") && k.length >= 6).sort((x, y) => y.length - x.length);
  PHRASE_RE = new RegExp("(?<![A-Za-z])(" + keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?![A-Za-z])", "gi");
  return PHRASE_RE;
};

const cache = new Map();
/** One piece of screen text in Hindi: a listed label as its Hindi phrase (also with emoji / ":" / "→" around it), else every
 *  English word in Devanagari. Leading and trailing spaces are kept so text joined from pieces still reads right. */
export function uiHindi(text) {
  const s = String(text ?? "");
  if (!/[A-Za-z]/.test(s) || /@|https?:|www\./.test(s)) return s;
  if (cache.has(s)) return cache.get(s);
  const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
  const core = norm(s);
  let out = lookup(core);
  if (out == null) {
    // emoji / arrows / bullets before, ":" "=" "…" "→" "(" after: look the words up without them
    const m = core.match(/^([^A-Za-z]*)(.*)$/);
    const hitRest = lookup(m[2]);
    if (hitRest != null) out = m[1] + hitRest;
    else {
      const k = m[2].match(/^(.*?)([^A-Za-z.]*)$/);
      const hit = k && lookup(k[1].trim());
      if (hit != null) out = m[1] + hit + k[2];
    }
  }
  if (out == null) {
    // A longer text: the listed phrases in it first, then every other English word in Devanagari.
    out = core.replace(phraseRe(), (ph) => lookup(ph) ?? ph);
    out = toHindi(out.replace(/[A-Za-z]+/g, (w) => UI_WORDS[w.toLowerCase()] || w));
  }
  out = lead + out + trail;
  if (cache.size > 5000) cache.clear();
  cache.set(s, out);
  return out;
}
