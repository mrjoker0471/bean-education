// ─── Riishe Phase 3D: localized deterministic disclosures ────────────────────
// Pure string helpers. No provider, no DB, no server-only import — client-safe
// by design, exactly like src/lib/riishe/tutor.ts.
//
// The chat route appends a small amount of DETERMINISTIC text to some replies
// after the AI provider has answered (outside-material provenance, live-web
// origin, unverified-current warnings). Before Phase 3D those lines were
// always English, even when the student had selected another response
// language. This module supplies the SAME disclosures in every explicitly
// supported response language, so the honesty contract stays intact while the
// disclosure becomes readable in the language the student chose.
//
// Contract (Phase 3D Part B — non-negotiable):
//   * Meaning is preserved exactly — no weaker uncertainty, no stronger claim.
//   * Nothing else is translated: document titles, URLs, citations, page
//     numbers, official names and mathematical notation are untouched (these
//     strings are PREPENDED to the reply and never rewrite it).
//   * 'auto' keeps the pre-existing English behaviour — there is no reliable
//     language-detection capability, and none is claimed here.
//   * 'en' intentionally uses the same English strings as 'auto'.

import type { RiisheResponseLanguage } from '@/lib/riishe/tutor'

/** The deterministic disclosure lines the chat route may prepend. */
export type RiisheDisclosureKind =
  | 'outsideMaterial' // general-knowledge provenance notice
  | 'liveWeb' // live-web origin notice
  | 'notVerifiedCurrent' // time-sensitive + live lookup unavailable

type DisclosureTable = Record<RiisheDisclosureKind, string>

/**
 * English base lines — byte-identical to the pre-Phase-3D route strings.
 * Used for 'auto' (existing default) and the explicit 'en' selection.
 */
const EN: DisclosureTable = {
  outsideMaterial:
    'Outside your uploaded material (general knowledge — not verified against your documents): ',
  liveWeb:
    'From live web results (external — not from your uploaded material): ',
  notVerifiedCurrent:
    '(Not verified as current — the live lookup was unavailable just now; confirm time-sensitive facts with an official source.) ',
}

// Explicit translations. Each entry preserves the exact meaning of the English
// line, including the uncertainty and the recommendation it carries. Trailing
// separators (": " / ") ") match the English layout so the reply body follows
// in the same position. Never reword these to sound more (or less) cautious.
const TRANSLATIONS: Record<Exclude<RiisheResponseLanguage, 'auto' | 'en'>, DisclosureTable> = {
  ta: {
    outsideMaterial:
      'உங்கள் பதிவேற்றிய பொருளுக்கு வெளியே (பொது அறிவு — உங்கள் ஆவணங்களுடன் சரிபார்க்கப்படவில்லை): ',
    liveWeb:
      'நேரடி இணைய முடிவுகளிலிருந்து (வெளிப்புறம் — உங்கள் பதிவேற்றிய பொருளிலிருந்து அல்ல): ',
    notVerifiedCurrent:
      '(தற்போதையதாக உறுதிப்படுத்தப்படவில்லை — நேரடி தேடல் இப்போது கிடைக்கவில்லை; நேரத்தைப் பொறுத்த தகவல்களை ஒரு அதிகாரப்பூர்வ ஆதாரத்துடன் சரிபார்த்துக் கொள்ளுங்கள்.) ',
  },
  hi: {
    outsideMaterial:
      'आपकी अपलोड की गई सामग्री के बाहर (सामान्य ज्ञान — आपके दस्तावेज़ों के विरुद्ध सत्यापित नहीं किया गया): ',
    liveWeb:
      'लाइव वेब परिणामों से (बाहरी — आपकी अपलोड की गई सामग्री से नहीं): ',
    notVerifiedCurrent:
      '(वर्तमान के रूप में सत्यापित नहीं — लाइव खोज अभी उपलब्ध नहीं थी; समय-संवेदनशील तथ्यों की पुष्टि किसी आधिकारिक स्रोत से करें.) ',
  },
  te: {
    outsideMaterial:
      'మీ అప్‌లోడ్ చేసిన మెటీరియల్ వెలుపల (సాధారణ జ్ఞానం — మీ పత్రాలతో ధృవీకరించబడలేదు): ',
    liveWeb:
      'ప్రత్యక్ష వెబ్ ఫలితాల నుండి (బాహ్యం — మీ అప్‌లోడ్ చేసిన మెటీరియల్ నుండి కాదు): ',
    notVerifiedCurrent:
      '(ప్రస్తుతమైనదిగా ధృవీకరించబడలేదు — ప్రత్యక్ష శోధన ఇప్పుడు అందుబాటులో లేదు; సమయంతో ముడిపడిన విషయాలను ఒక అధికారిక మూలంతో ఖరారు చేసుకోండి.) ',
  },
  ml: {
    outsideMaterial:
      'നിങ്ങൾ അപ്‌ലോഡ് ചെയ്ത വസ്തുവിന് പുറത്ത് (പൊതുവിജ്ഞാനം — നിങ്ങളുടെ രേഖകളുമായി താരതമ്യം ചെയ്ത് സ്ഥിരീകരിച്ചിട്ടില്ല): ',
    liveWeb:
      'തത്സമയ വെബ് ഫലങ്ങളിൽ നിന്ന് (ബാഹ്യം — നിങ്ങൾ അപ്‌ലോഡ് ചെയ്ത വസ്തുവിൽ നിന്നല്ല): ',
    notVerifiedCurrent:
      '(ഇപ്പോഴത്തേതാണെന്ന് സ്ഥിരീകരിച്ചിട്ടില്ല — തത്സമയ തിരച്ചിൽ ഇപ്പോൾ ലഭ്യമായില്ല; സമയാധാരിത വിവരങ്ങൾ ഒരു ഔദ്യോഗിക സ്രോതസ്സുമായി താരതമ്യം ചെയ്ത് ഉറപ്പാക്കുക.) ',
  },
  kn: {
    outsideMaterial:
      'ನೀವು ಅಪ್‌ಲೋಡ್ ಮಾಡಿದ ವಸ್ತುವಿನ ಹೊರಗೆ (ಸಾಮಾನ್ಯ ಜ್ಞಾನ — ನಿಮ್ಮ ದಸ್ತಾವೇಜುಗಳ ವಿರುದ್ಧ ಪರಿಶೀಲಿಸಲಾಗಿಲ್ಲ): ',
    liveWeb:
      'ನೇರ ವೆಬ್ ಫಲಿತಾಂಶಗಳಿಂದ (ಬಾಹ್ಯ — ನೀವು ಅಪ್‌ಲೋಡ್ ಮಾಡಿದ ವಸ್ತುವಿನಿಂದ ಅಲ್ಲ): ',
    notVerifiedCurrent:
      '(ಪ್ರಸ್ತುತವಾಗಿದೆ ಎಂದು ದೃಢೀಕರಿಸಲಾಗಿಲ್ಲ — ನೇರ ಹುಡುಕಾಟ ಈಗ ಲಭ್ಯವಿರಲಿಲ್ಲ; ಸಮಯದೊಂದಿಗೆ ಬದಲಾಗುವ ಮಾಹಿತಿಯನ್ನು ಒಂದು ಅಧಿಕೃತ ಮೂಲದೊಂದಿಗೆ ದೃಢೀಕರಿಸಿ.) ',
  },
  bn: {
    outsideMaterial:
      'আপনার আপলোড করা উপকরণের বাইরে (সাধারণ জ্ঞান — আপনার নথির বিপরীতে যাচাই করা হয়নি): ',
    liveWeb:
      'সরাসরি ওয়েব ফলাফল থেকে (বাহ্যিক — আপনার আপলোড করা উপকরণ থেকে নয়): ',
    notVerifiedCurrent:
      '(বর্তমান হিসেবে যাচাই করা হয়নি — লাইভ অনুসন্ধান এই মুহূর্তে পাওয়া যায়নি; সময়ের সাথে পরিবর্তনশীল তথ্য একটি অফিসিয়াল সূত্রের সাথে মিলিয়ে নিশ্চিত করুন.) ',
  },
  mr: {
    outsideMaterial:
      'तुम्ही अपलोड केलेल्या साहित्याबाहेरील (सामान्य ज्ञान — तुमच्या दस्तऐवजांशी तपासलेले नाही): ',
    liveWeb:
      'थेट वेब निकालांमधून (बाह्य — तुम्ही अपलोड केलेल्या साहित्यातून नाही): ',
    notVerifiedCurrent:
      '(सध्याचे असल्याचे तपासलेले नाही — थेट शोध नुकताच उपलब्ध नव्हता; काळानुसार बदलणारी वस्तुस्थिती अधिकृत स्रोताशी तुलना करून खात्री करून घ्या.) ',
  },
  gu: {
    outsideMaterial:
      'તમે અપલોડ કરેલી સામગ્રીની બહાર (સામાન્ય જ્ઞાન — તમારા દસ્તાવેજો સાથે ચકાસેલ નથી): ',
    liveWeb:
      'લાઇવ વેબ પરિણામોમાંથી (બાહ્ય — તમે અપલોડ કરેલી સામગ્રીમાંથી નથી): ',
    notVerifiedCurrent:
      '(વર્તમાન તરીકે ચકાસેલ નથી — લાઇવ શોધ હમણાં ઉપલબ્ધ નહોતી; સમય સાથે બદલાતી હકીકતો કોઈ સત્તાવાર સ્ત્રોત સાથે મળીને ખાતરી કરો.) ',
  },
  pa: {
    outsideMaterial:
      'ਤੁਹਾਡੇ ਅੱਪਲੋਡ ਕੀਤੇ ਸਮੱਗਰੀ ਤੋਂ ਬਾਹਰ (ਆਮ ਗਿਆਨ — ਤੁਹਾਡੇ ਦਸਤਾਵੇਜ਼ਾਂ ਨਾਲ ਤਸਦੀਕ ਨਹੀਂ ਕੀਤਾ ਗਿਆ): ',
    liveWeb:
      'ਸਿੱਧੇ ਵੈੱਬ ਨਤੀਜਿਆਂ ਤੋਂ (ਬਾਹਰੀ — ਤੁਹਾਡੇ ਅੱਪਲੋਡ ਕੀਤੇ ਸਮੱਗਰੀ ਤੋਂ ਨਹੀਂ): ',
    notVerifiedCurrent:
      '(ਮੌਜੂਦਾ ਵਜੋਂ ਤਸਦੀਕ ਨਹੀਂ ਕੀਤਾ ਗਿਆ — ਸਿੱਧੀ ਖੋਜ ਹੁਣੇ ਉਪਲਬਧ ਨਹੀਂ ਸੀ; ਸਮੇਂ ਨਾਲ ਬਦਲਣ ਵਾਲੇ ਤੱਥਾਂ ਦੀ ਪੁਸ਼ਟੀ ਕਿਸੇ ਅਧਿਕਾਰਤ ਸਰੋਤ ਨਾਲ ਕਰੋ.) ',
  },
  ur: {
    outsideMaterial:
      'آپ کے اپ لوڈ کیے گئے مواد سے باہر (عام معلومات — آپ کے دستاویزات کے مطابق تصدیق شدہ نہیں): ',
    liveWeb:
      'براہ راست ویب نتائج سے (خارجی — آپ کے اپ لوڈ کیے گئے مواد سے نہیں): ',
    notVerifiedCurrent:
      '(موجودہ ہونے کے طور پر تصدیق شدہ نہیں — براہ راست تلاش ابھی دستیاب نہیں تھی؛ وقت کے ساتھ بدلنے والے حقائق کی تصدیق کسی سرکاری ذریعے سے کریں.) ',
  },
}

/**
 * The deterministic disclosure line for `kind`, written in the selected
 * response language. `undefined`, 'auto' and 'en' all return the English base
 * line — the pre-Phase-3D behaviour for automatic language.
 */
export function disclosureLine(kind: RiisheDisclosureKind, lang?: RiisheResponseLanguage): string {
  if (!lang || lang === 'auto' || lang === 'en') return EN[kind]
  return TRANSLATIONS[lang][kind]
}

/**
 * True when the response language has its own localized disclosure strings
 * (i.e. an explicit non-English selection).
 */
export function hasLocalizedDisclosure(lang?: RiisheResponseLanguage): boolean {
  return !!lang && lang !== 'auto' && lang !== 'en'
}
