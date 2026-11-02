// ── OFFLINE DEVANAGARI FOR DATA NAMES, FOR THE HINDI BOOK ──
// lib/ims/hindiNames asks the AI for a name's Devanagari and keeps it in `hindi_names`. When the AI cannot answer (owner report
// 2026-11-02: the Gemini function has no key and the Anthropic account is out of credit, so every name printed in English) the book
// still has to be Hindi, so a name the AI has not done is spelled here: word by word from the decor / flower / venue words the crew
// uses, and a phonetic spelling for a word not in the list. Digits, sizes and symbols stay as they are ("RFT 4ft" → "आरएफ़टी 4फ़ुट").
// A TRANSLITERATION, not a translation - "Iron Wooden Coffee Table" → "आयरन वुडन कॉफ़ी टेबल" - same rule as the AI's.

const WORDS = {
  // things
  iron: "आयरन", wooden: "वुडन", wood: "वुड", console: "कंसोल", consol: "कंसोल", table: "टेबल", pot: "पॉट", flower: "फ़्लावर",
  fibre: "फ़ाइबर", fiber: "फ़ाइबर", small: "स्मॉल", medium: "मीडियम", big: "बिग", large: "लार्ज", mini: "मिनी", candle: "कैंडल",
  pillar: "पिलर", stand: "स्टैंड", stick: "स्टिक", glass: "ग्लास", ceramic: "सिरेमिक", jar: "जार", crate: "क्रेट", ring: "रिंग",
  arrangement: "अरेंजमेंट", pedestal: "पेडस्टल", prop: "प्रॉप", metal: "मेटल", leaf: "लीफ़", leaves: "लीव्स", bunch: "बंच",
  hanging: "हैंगिंग", chair: "चेयर", sofa: "सोफ़ा", couch: "काउच", seater: "सीटर", lamp: "लैंप", chandelier: "शैंडलियर",
  lantern: "लैंटर्न", carpet: "कारपेट", drape: "ड्रेप", fabric: "फ़ैब्रिक", velvet: "वेलवेट", liza: "लिज़ा", masking: "मास्किंग",
  truss: "ट्रस", stage: "स्टेज", entry: "एंट्री", passage: "पैसेज", photo: "फ़ोटो", op: "ऑप", centre: "सेंटर", center: "सेंटर",
  piece: "पीस", pieces: "पीसेज़", lounge: "लाउंज", bar: "बार", counter: "काउंटर", ambience: "एम्बिएंस", lighting: "लाइटिंग",
  light: "लाइट", artificial: "आर्टिफ़िशियल", real: "रियल", element: "एलिमेंट", coffee: "कॉफ़ी", box: "बॉक्स", roman: "रोमन",
  style: "स्टाइल", bucket: "बकेट", size: "साइज़", world: "वर्ल्ड", cup: "कप", texture: "टेक्सचर", easel: "ईज़ल",
  terracotta: "टेराकोटा", entrance: "एंट्रेंस", gate: "गेट", pathway: "पाथवे", walkway: "वॉकवे", aisle: "आइल", backdrop: "बैकड्रॉप",
  selfie: "सेल्फ़ी", booth: "बूथ", corner: "कॉर्नर", buffet: "बुफ़े", food: "फ़ूड", dj: "डीजे", dance: "डांस", floor: "फ़्लोर",
  ceiling: "सीलिंग", wall: "वॉल", column: "कॉलम", arch: "आर्च", frame: "फ़्रेम", panel: "पैनल", screen: "स्क्रीन", mirror: "मिरर",
  vase: "वास", bowl: "बाउल", urn: "अर्न", planter: "प्लांटर", basket: "बास्केट", tray: "ट्रे", holder: "होल्डर", votive: "वोटिव",
  tealight: "टी-लाइट", hurricane: "हरिकेन", fairy: "फ़ेयरी", string: "स्ट्रिंग", led: "एलईडी", neon: "नियॉन", sign: "साइन",
  board: "बोर्ड", welcome: "वेलकम", name: "नेम", cushion: "कुशन", cover: "कवर", overlay: "ओवरले", runner: "रनर", cloth: "क्लॉथ",
  napkin: "नैपकिन", tent: "टेंट", canopy: "कैनोपी", umbrella: "अम्ब्रेला", swing: "स्विंग", jhoola: "झूला", jhula: "झूला",
  chowki: "चौकी", takht: "तख़्त", gaddi: "गद्दी", masnad: "मसनद", diwan: "दीवान", divan: "दीवान", bench: "बेंच", stool: "स्टूल",
  ottoman: "ओटोमन", pouf: "पूफ़", rug: "रग", mat: "मैट", durrie: "दरी", dari: "दरी", garland: "गारलैंड", mala: "माला", ladi: "लड़ी",
  toran: "तोरण", petal: "पेटल", net: "नेट", foam: "फ़ोम", oasis: "ओएसिस", wire: "वायर", tape: "टेप", filler: "फ़िलर", palm: "पाम",
  fern: "फ़र्न", ivy: "आइवी", eucalyptus: "यूकेलिप्टस", monstera: "मॉन्स्टेरा", bamboo: "बैम्बू", tree: "ट्री", plant: "प्लांट",
  bush: "बुश", mix: "मिक्स", mixed: "मिक्स्ड", double: "डबल", single: "सिंगल", set: "सेट", kit: "किट", pair: "पेयर", round: "राउंड",
  square: "स्क्वेयर", rectangle: "रेक्टेंगल", oval: "ओवल", tall: "टॉल", short: "शॉर्ट", high: "हाई", low: "लो", long: "लॉन्ग",
  wide: "वाइड", half: "हाफ़", full: "फ़ुल", top: "टॉप", bottom: "बॉटम", side: "साइड", front: "फ़्रंट", back: "बैक", left: "लेफ़्ट",
  right: "राइट", inner: "इनर", outer: "आउटर", inside: "इनसाइड", outside: "आउटसाइड", indoor: "इनडोर", outdoor: "आउटडोर",
  main: "मेन", new: "न्यू", old: "ओल्ड", vintage: "विंटेज", royal: "रॉयल", classic: "क्लासिक", modern: "मॉडर्न", rustic: "रस्टिक",
  boho: "बोहो", floral: "फ़्लोरल", crystal: "क्रिस्टल", acrylic: "ऐक्रेलिक", steel: "स्टील", aluminium: "एल्युमिनियम",
  plastic: "प्लास्टिक", paper: "पेपर", cane: "केन", jute: "जूट", rattan: "रतन", marble: "मार्बल", stone: "स्टोन", brick: "ब्रिक",
  clay: "क्ले", mud: "मड", matka: "मटका", kalash: "कलश", diya: "दीया", urli: "उरली", lota: "लोटा", thali: "थाली", handi: "हांडी",
  ghungroo: "घुंघरू", bell: "बेल", peacock: "पीकॉक", elephant: "एलिफ़ेंट", horse: "हॉर्स", bird: "बर्ड", birdcage: "बर्डकेज",
  cage: "केज", butterfly: "बटरफ़्लाई", heart: "हार्ट", moon: "मून", sun: "सन", cloud: "क्लाउड", parasol: "पैरासोल", chhatri: "छतरी",
  pankha: "पंखा", fan: "फ़ैन", rajasthani: "राजस्थानी", mughal: "मुग़ल", indian: "इंडियन", banjara: "बंजारा", borosil: "बोरोसिल",
  china: "चाइना", shamadhan: "शमादान", shamadan: "शमादान", havan: "हवन", kund: "कुंड", roli: "रोली", poli: "पोली", dumbroo: "डमरू",
  damru: "डमरू", clover: "क्लोवर", pipni: "पिपनी", muradabad: "मुरादाबाद", moradabad: "मुरादाबाद", muradabadi: "मुरादाबादी",
  moradabadi: "मुरादाबादी", mandap: "मंडप", varmala: "वरमाला", jaimala: "जयमाला", baraat: "बारात", phera: "फेरा", pheras: "फेरे",
  // colours
  white: "व्हाइट", gold: "गोल्ड", golden: "गोल्डन", silver: "सिल्वर", pink: "पिंक", green: "ग्रीन", red: "रेड", yellow: "येलो",
  orange: "ऑरेंज", blue: "ब्लू", purple: "पर्पल", black: "ब्लैक", cream: "क्रीम", ivory: "आइवरी", peach: "पीच", maroon: "मरून",
  lavender: "लैवेंडर", beige: "बेज", brown: "ब्राउन", grey: "ग्रे", gray: "ग्रे", magenta: "मजेंटा", champagne: "शैंपेन",
  copper: "कॉपर", brass: "ब्रास", rust: "रस्ट", wine: "वाइन", teal: "टील", mint: "मिंट", lilac: "लाइलैक", mauve: "मॉव",
  nude: "न्यूड", off: "ऑफ़", dark: "डार्क", baby: "बेबी", sky: "स्काई", rani: "रानी", multi: "मल्टी", colour: "कलर", color: "कलर",
  // flowers
  rose: "रोज़", carnation: "कार्नेशन", daisy: "डेज़ी", gypso: "जिप्सो", gypsophila: "जिप्सोफ़िला", marigold: "मैरीगोल्ड",
  genda: "गेंदा", orchid: "ऑर्किड", lily: "लिली", lilies: "लिलीज़", tulip: "ट्यूलिप", hydrangea: "हाइड्रेंजिया",
  chrysanthemum: "क्रिसेंथेमम", guldavari: "गुलदावरी", star: "स्टार", patti: "पत्ती", morya: "मोरया", dandela: "डंडेला",
  junado: "जुनाडो", grass: "ग्रास", rajnigandha: "रजनीगंधा", mogra: "मोगरा", jasmine: "जैस्मिन", reet: "रीट", gerbera: "जरबेरा",
  anthurium: "एंथूरियम", alstroemeria: "एल्स्ट्रोमेरिया", lisianthus: "लिसिएंथस", peony: "पिओनी", calla: "कैला",
  breath: "ब्रेथ", asparagus: "ऐस्पेरेगस", leatherleaf: "लेदरलीफ़", kamini: "कामिनी", gulab: "गुलाब",
  himachal: "हिमाचल", banglore: "बैंगलोर", bangalore: "बैंगलोर", delhi: "दिल्ली", pune: "पुणे", ooty: "ऊटी", kolkata: "कोलकाता",
  local: "लोकल", imported: "इम्पोर्टेड", dutch: "डच", thai: "थाई",
  // events, shifts, places
  wedding: "वेडिंग", sangeet: "संगीत", mehendi: "मेहंदी", mehndi: "मेहंदी", haldi: "हल्दी", reception: "रिसेप्शन",
  cocktail: "कॉकटेल", engagement: "इंगेजमेंट", roka: "रोका", sagan: "सगन", shagun: "शगुन", tilak: "तिलक", party: "पार्टी",
  birthday: "बर्थडे", anniversary: "एनिवर्सरी", lunch: "लंच", dinner: "डिनर", brunch: "ब्रंच", sundowner: "सनडाउनर",
  morning: "मॉर्निंग", evening: "ईवनिंग", night: "नाइट", day: "डे", lawn: "लॉन", hall: "हॉल", banquet: "बैंक्वेट",
  terrace: "टैरेस", garden: "गार्डन", pool: "पूल", poolside: "पूलसाइड", courtyard: "कोर्टयार्ड", venue: "वेन्यू",
  exotica: "एक्ज़ोटिका", aura: "ऑरा", pushpanjali: "पुष्पांजलि", ambria: "एम्ब्रिया", lux: "लक्स", grand: "ग्रैंड",
  palace: "पैलेस", farm: "फ़ार्म", farms: "फ़ार्म्स", resort: "रिज़ॉर्ट", hotel: "होटल", function: "फ़ंक्शन", zone: "ज़ोन",
  // fabrics
  satin: "साटन", organza: "ऑर्गेंज़ा", chiffon: "शिफ़ॉन", georgette: "जॉर्जेट", lycra: "लाइक्रा", silk: "सिल्क",
  cotton: "कॉटन", brocade: "ब्रोकेड", sequin: "सीक्विन", tissue: "टिशू", chivari: "चिवारी", chiavari: "चिवारी", tiffany: "टिफ़नी",
  // client surnames and first names the phonetic spelling gets wrong (Hindi t / d are त / द, not ट / ड)
  sharma: "शर्मा", gupta: "गुप्ता", malhotra: "मल्होत्रा", kapoor: "कपूर", singh: "सिंह", agarwal: "अग्रवाल", aggarwal: "अग्रवाल",
  jain: "जैन", mehta: "मेहता", verma: "वर्मा", khanna: "खन्ना", arora: "अरोड़ा", sethi: "सेठी", bansal: "बंसल", goel: "गोयल",
  goyal: "गोयल", mittal: "मित्तल", chopra: "चोपड़ा", kumar: "कुमार", sangeeta: "संगीता", sangita: "संगीता", priya: "प्रिया",
  neha: "नेहा", pooja: "पूजा", rahul: "राहुल", rohit: "रोहित", amit: "अमित", ankit: "अंकित", anita: "अनीता", sunita: "सुनीता",
  vinod: "विनोद", deepak: "दीपक", rajesh: "राजेश", suresh: "सुरेश", mahesh: "महेश", ramesh: "रमेश", sanjay: "संजय", vijay: "विजय",
  ritu: "रितु", geeta: "गीता", seema: "सीमा", kavita: "कविता", nidhi: "निधि", aarav: "आरव", aditya: "आदित्य", arjun: "अर्जुन",
  mr: "मि.", mrs: "मिसेज़", ji: "जी",
  // the team
  tarun: "तरुण", krati: "कृति", ajay: "अजय", sudhir: "सुधीर", aman: "अमन", anmol: "अनमोल", ashi: "आशी", jitanshu: "जितांशु",
  himanshu: "हिमांशु", bhaskar: "भास्कर", test: "टेस्ट",
  // units in names
  inch: "इंच", inches: "इंच", ft: "फ़ुट", feet: "फ़ीट", mm: "मिमी", cm: "सेमी", kg: "किलो",
  // small words
  and: "एंड", with: "विद", of: "ऑफ़", the: "द", for: "फ़ॉर", on: "ऑन", in: "इन",
};

const LETTERS = { a: "ए", b: "बी", c: "सी", d: "डी", e: "ई", f: "एफ़", g: "जी", h: "एच", i: "आई", j: "जे", k: "के", l: "एल", m: "एम",
  n: "एन", o: "ओ", p: "पी", q: "क्यू", r: "आर", s: "एस", t: "टी", u: "यू", v: "वी", w: "डब्ल्यू", x: "एक्स", y: "वाई", z: "ज़ेड" };

// Phonetic spelling, longest pattern first. Consonants join with a virama; a vowel after a consonant is its matra.
const CONS = [["tch", "च"], ["chh", "छ"], ["ch", "च"], ["sh", "श"], ["th", "थ"], ["ph", "फ"], ["kh", "ख"], ["gh", "घ"], ["bh", "भ"],
  ["dh", "ध"], ["jh", "झ"], ["ck", "क"], ["b", "ब"], ["d", "ड"], ["f", "फ़"], ["g", "ग"], ["h", "ह"], ["j", "ज"], ["k", "क"],
  ["l", "ल"], ["m", "म"], ["n", "न"], ["p", "प"], ["q", "क"], ["r", "र"], ["s", "स"], ["t", "ट"], ["v", "व"], ["w", "व"], ["z", "ज़"]];
const VOW = [["aa", "आ", "ा"], ["ee", "ई", "ी"], ["ea", "ई", "ी"], ["oo", "ऊ", "ू"], ["ai", "ऐ", "ै"], ["ay", "ए", "े"], ["ey", "ए", "े"],
  ["ei", "ए", "े"], ["au", "ऑ", "ॉ"], ["aw", "ऑ", "ॉ"], ["ou", "औ", "ौ"], ["ow", "ओ", "ो"], ["a", "अ", ""], ["e", "ए", "े"],
  ["i", "इ", "ि"], ["o", "ओ", "ो"], ["u", "उ", "ु"]];
const isVowelCh = (c) => "aeiou".includes(c);

/** A word not in the list, spelled the way it reads. Rough, but Devanagari the crew can read. */
export function phoneticHindi(word) {
  let s = String(word || "").toLowerCase();
  s = s.replace(/tion$/, "shan").replace(/([^aeiou])le$/, "$1al").replace(/([^aeiou])re$/, "$1ar");
  if (s.length > 3) s = s.replace(/([^aeiou])e$/, "$1");
  let out = "", prevC = false, i = 0;
  const emitC = (d) => { if (prevC) out += "्"; out += d; prevC = true; };
  const emitV = (ind, mat) => { out += prevC ? mat : ind; prevC = false; };
  while (i < s.length) {
    const c = s[i], rest = s.slice(i);
    // n / m before a consonant after a vowel: the nasal dot ("candle" → कंडल).
    if ((c === "n" || c === "m") && i > 0 && !prevC && i + 1 < s.length && !isVowelCh(s[i + 1]) && s[i + 1] !== "y" && s[i + 1] !== "h") { out += "ं"; i++; continue; }
    if (c === "y") {
      if (!prevC) { emitC("य"); i++; continue; }
      emitV("", i === s.length - 1 ? "ी" : "ाइ"); i++; continue;
    }
    if (c === "x") { emitC("क"); emitC("स"); i++; continue; }
    if (rest.startsWith("qu")) { emitC("क"); emitC("व"); i += 2; continue; }
    if (c === "c" && s[i + 1] !== "h") { emitC(/^[eiy]/.test(s[i + 1] || "") ? "स" : "क"); i++; continue; }
    const v = VOW.find(([p]) => rest.startsWith(p));
    if (v) {
      const end = i + v[0].length === s.length;
      if (v[0] === "a" && prevC && end) emitV("आ", "ा");      // banjara → बंजारा
      else if (v[0] === "i" && end) emitV("ई", "ी");          // roli → रोली
      else emitV(v[1], v[2]);
      i += v[0].length; continue;
    }
    const k = CONS.find(([p]) => rest.startsWith(p));
    if (k) { emitC(k[1]); i += k[0].length; continue; }
    out += c; prevC = false; i++;
  }
  return out;
}

const devanagariEnd = (s) => /[क-हक़-य़़]$/.test(s); // ends on a bare consonant letter (no matra)

/** One Latin word → Devanagari: the list, a plural of a listed word, an acronym letter by letter, else phonetic. */
function word(w) {
  const lw = w.toLowerCase();
  if (WORDS[lw]) return WORDS[lw];
  if (lw.length > 3 && lw.endsWith("s") && WORDS[lw.slice(0, -1)]) { const st = WORDS[lw.slice(0, -1)]; return st + (devanagariEnd(st) ? "्स" : "ज़"); }
  if (lw.length > 3 && lw.endsWith("es") && WORDS[lw.slice(0, -2)]) return WORDS[lw.slice(0, -2)] + "ेज़";
  if (w.length === 1) return w; // a lone letter ("3D", "Size S") stays as it is
  if (!/[aeiouy]/i.test(w) || (w.length <= 4 && w === w.toUpperCase())) return [...lw].map(ch => LETTERS[ch] || ch).join("");
  return phoneticHindi(w);
}

/** A data name in Devanagari, word by word; anything that is not a Latin letter (digits, ×, /, -, spaces) is kept. */
export function toHindi(name) {
  const s = String(name ?? "");
  if (!/[A-Za-z]/.test(s)) return s;
  return s.replace(/[A-Za-z]+(?:'s)?/g, (m) => m.endsWith("'s") ? word(m.slice(0, -2)) + "ज़" : word(m));
}
