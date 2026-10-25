// Generates the E2E test corpus for the Riishe pipeline:
//   rich.pdf    — 36 pages of detailed study text (enough for a 50-question test)
//   small.pdf   — 2 pages, thin content
//   scanned.pdf — 2 pages of pure images (no text layer)
//   broken.pdf  — garbage bytes with a .pdf name
import { writeFileSync, mkdirSync } from 'node:fs'
import sharp from 'sharp'

const OUT = '/tmp/riishe-tests'
mkdirSync(OUT, { recursive: true })

// ─── minimal valid PDF writer ───
function buildPdf(pages) {
  // pages: array of arrays of strings (lines)
  const objects = []
  const pageObjNums = []
  const nPages = pages.length
  const fontNum = 3 + nPages * 2
  for (let i = 0; i < nPages; i++) pageObjNums.push(3 + i * 2)
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`
  objects[2] = `<< /Type /Pages /Kids [${pageObjNums.map(n => `${n} 0 R`).join(' ')}] /Count ${nPages} >>`
  pages.forEach((lines, i) => {
    const pn = pageObjNums[i]
    const cn = pn + 1
    objects[pn] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${cn} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>`
    const esc = s => s.replace(/([()\\])/g, '\\$1')
    let y = 740
    let stream = ''
    for (const line of lines) {
      stream += `BT /F1 11 Tf 64 ${y} Td (${esc(line)}) Tj ET\n`
      y -= 17
      if (y < 60) break
    }
    objects[cn] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  })
  objects[fontNum] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`
  let out = '%PDF-1.4\n'
  const offsets = [0]
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = out.length
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objects.length; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

// ─── scanned PDF with real JPEG pages (via sharp) ───
async function buildScannedPdf() {
  // A photo-like noisy page: gradient + shapes so it is clearly an image
  const w = 612, h = 792
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#e8e4d8"/>
    <rect x="40" y="40" width="${w - 80}" height="${h - 80}" fill="none" stroke="#7a6f52" stroke-width="3"/>
    <circle cx="${w / 2}" cy="${h / 2}" r="140" fill="#b8a86a" opacity="0.7"/>
    <rect x="120" y="120" width="180" height="90" fill="#6a7a8a" opacity="0.6" transform="rotate(12 ${w / 2} ${h / 2})"/>
    <text x="60" y="720" font-family="serif" font-size="26" fill="#4a4432">Scanned page — handwriting</text>
  </svg>`
  const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 72 }).toBuffer()
  const jpeg2 = await sharp(Buffer.from(svg.replace('handwriting', 'continued'))).jpeg({ quality: 72 }).toBuffer()

  const objs = []
  objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`
  objs[2] = `<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>`
  objs[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /XObject << /Im0 7 0 R >> >> >>`
  objs[4] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /XObject << /Im0 8 0 R >> >> >>`
  const c1 = `q 612 0 0 792 0 0 cm /Im0 Do Q`
  objs[5] = `<< /Length ${c1.length} >>\nstream\n${c1}\nendstream`
  objs[6] = objs[5]
  objs[7] = { img: jpeg }
  objs[8] = { img: jpeg2 }

  let out = '%PDF-1.4\n'
  const offsets = [0]
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length
    if (objs[i].img) {
      out += `${i} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${objs[i].img.length} >>\nstream\n`
      out += objs[i].img.toString('latin1')
      out += `\nendstream\nendobj\n`
    } else {
      out += `${i} 0 obj\n${objs[i]}\nendobj\n`
    }
  }
  const xref = out.length
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objs.length; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

// ─── rich 36-page document: Indian Constitution & Polity (exam-grade content) ───
const rich = []
rich.push(['THE CONSTITUTION OF INDIA — A STUDY COMPANION', '', 'PART I: MAKING OF THE CONSTITUTION', ''])
const p2 = [
  'The Constituent Assembly was formed in 1946 under the Cabinet Mission Plan.',
  'Its first meeting was held on 9 December 1946; Dr. Rajendra Prasad was elected',
  'Permanent Chairman on 11 December 1946. The Objectives Resolution, moved by',
  'Jawaharlal Nehru on 13 December 1946, became the foundation of the Preamble.',
  'The Drafting Committee was formed on 29 August 1947 with Dr. B. R. Ambedkar',
  'as its Chairman. It had seven members in total. The Constitution was adopted',
  'on 26 November 1949 and came into force on 26 January 1950. 26 January was',
  'chosen to commemorate Purna Swaraj Day of 26 January 1930. The Constituent',
  'Assembly took 2 years, 11 months and 18 days to complete the task. It held',
  '11 sessions in total. The Draft Constitution had 315 Articles in 1917',
  'clauses when first presented in February 1948; the final text has 395',
  'Articles in 22 Parts and 8 Schedules.',
]
rich.push(['PART II: THE PREAMBLE', ''])
const p3 = [
  'The Preamble declares India a SOVEREIGN, SOCIALIST, SECULAR, DEMOCRATIC',
  'REPUBLIC. The words Socialist, Secular and Integrity were added by the',
  '42nd Amendment Act, 1976. Sovereign means India is internally supreme and',
  'externally free. Secular means the State has no official religion and',
  'treats all religions equally (Articles 25 to 28 support this). Democratic',
  'means the authority flows from the people through universal adult',
  'franchise. The Preamble is non-justiciable: courts cannot enforce it,',
  'but in Kesavananda Bharati (1973) the Supreme Court held that the',
  'Preamble is part of the Constitution and can be amended without',
  'damaging the basic structure. In Berubari Union (1960) it was earlier',
  'held NOT to be part of the Constitution.',
]
const topicPages = [
  ['Fundamental Rights', [
    'Articles 12 to 35 deal with Fundamental Rights in Part III. They are',
    'justiciable and enforceable against the State. Article 12 defines the',
    'State to include the Government and Parliament of India, state',
    'legislatures, and local or other authorities within Indian territory.',
    'Article 13 bars laws inconsistent with Fundamental Rights; the doctrine',
    'of judicial review flows from it.',
  ]],
  ['Right to Equality', [
    'Article 14 guarantees equality before law and equal protection of the',
    'laws. It permits reasonable classification but forbids class legislation.',
    'Article 15 prohibits discrimination on grounds only of religion, race,',
    'caste, sex or place of birth. Clause (4) allows special provisions for',
    'backward classes; clause (6), added by the 103rd Amendment 2019, allows',
    '10 percent reservation for the economically weaker sections.',
    'Article 16 guarantees equality of opportunity in public employment.',
    'Article 17 abolishes untouchability; Article 18 abolishes titles.',
  ]],
  ['Right to Freedom', [
    'Article 19 grants six freedoms: speech and expression; assembly;',
    'association; movement; residence; and profession. The freedom of',
    'speech is subject to eight reasonable restrictions including sovereignty',
    'and integrity of India, security of the State, public order, decency,',
    'morality, contempt of court, defamation and incitement to an offence.',
    'Article 20 gives protection in respect of convictions: no ex-post-facto',
    'criminal law, no double jeopardy, no self-incrimination. Article 21',
    'protects life and personal liberty; after Maneka Gandhi (1978) any',
    'procedure must be fair, just and reasonable. Article 21A, added by the',
    '86th Amendment 2002, makes free and compulsory education for children',
    'aged 6 to 14 a fundamental right. Article 22 gives protection against',
    'arrest and detention, including the right to be informed of grounds,',
    'consult a lawyer, and be produced before a magistrate within 24 hours,',
    'with a preventive-detention exception allowing up to 3 months without',
    'an advisory board.',
  ]],
  ['Rights against Exploitation, Religion, Culture', [
    'Articles 23 and 24 prohibit human trafficking, forced labour and child',
    'labour in factories under 14 years. Articles 25 to 28 cover freedom of',
    'religion: Article 25 covers conscience and free profession, practice',
    'and propagation of religion, subject to public order, morality and',
    'health. Article 26 manages religious affairs; Article 27 bars forced',
    'taxes for religion; Article 28 bars religious instruction in wholly',
    'State-funded institutions. Articles 29 and 30 protect cultural and',
    'educational rights of minorities, including the right to establish',
    'and administer educational institutions.',
  ]],
  ['Constitutional Remedies', [
    'Article 32 — the heart and soul of the Constitution, per Dr. Ambedkar —',
    'gives the right to constitutional remedies. The Supreme Court issues',
    'five writs: habeas corpus (produce the detained person), mandamus',
    '(command a public official to act), prohibition (stop a lower court',
    'exceeding jurisdiction), certiorari (transfer and quash), and quo',
    'warranto (question the legal authority of an office holder).',
    'Article 32 can be suspended only during a national Emergency under',
    'Article 359. High Courts reach the same writs under Article 226,',
    'which is wider: it covers legal as well as fundamental rights.',
  ]],
  ['Directive Principles', [
    'Part IV, Articles 36 to 51, holds the Directive Principles of State',
    'Policy. They are non-justiciable but fundamental in the governance of',
    'the country. Socialist principles include Articles 38, 39, 39A (equal',
    'justice and free legal aid), 41 (right to work, education, assistance),',
    '42 (just and humane conditions of work, maternity relief), 43 (living',
    'wage) and 43A (worker participation in management). Gandhian principles',
    'include 40 (village panchayats), 43, 46, 47 and 48. Liberal-intellectual',
    'principles include 44 (uniform civil code), 45, 48, 50 (separation of',
    'judiciary from executive) and 51 (international peace). The 42nd',
    'Amendment added Articles 39A, 43A and 48A; the 44th Amendment moved',
    'property out of fundamental rights into Article 300A.',
  ]],
  ['The Union Executive', [
    'Article 52 creates the office of the President. Article 53 vests',
    'executive power of the Union in the President, exercised directly or',
    'through subordinates. The President is elected by an electoral college',
    'of elected MPs and elected MLAs of states (including Delhi and',
    'Puducherry) by single transferable vote through a secret ballot.',
    'Article 55 gives the proportional representation formula: each MLA',
    'value = state population / (MLA seats x 1000); each MP value = total',
    'MLA votes / elected MPs. Term is 5 years; impeachment under Article 61',
    'for violation of the Constitution needs a 2/3 majority in both Houses.',
    'Article 72 grants pardon power including court-martial sentences; the',
    'Governor under Article 161 cannot pardon death sentences or',
    'court-martial sentences.',
  ]],
  ['The Vice-President and Council of Ministers', [
    'The Vice-President (Articles 63 to 71) is elected by both Houses of',
    'Parliament (elected members only) and is ex-officio Chairman of the',
    'Rajya Sabha under Article 64. Article 74 requires a Council of',
    'Ministers with the Prime Minister at the head to aid and advise the',
    'President, who must act on such advice; the 42nd and 44th Amendments',
    'let the President return advice once for reconsideration. Article 75',
    'says ministers hold office during the pleasure of the President and',
    'the Council is collectively responsible to the Lok Sabha. The total',
    'number of ministers including the PM cannot exceed 15 percent of Lok',
    'Sabha strength (91st Amendment, 2003). Article 78 lists the duties of',
    'the PM regarding furnishing information to the President.',
  ]],
  ['Parliament: Composition', [
    'Articles 79 to 122 cover Parliament. It consists of the President,',
    'the Lok Sabha and the Rajya Sabha. The Lok Sabha maximum is 552: up',
    'to 530 from states, 20 from union territories, 2 nominated Anglo-',
    'Indians (this nomination lapsed). Term is 5 years, dissolvable only',
    'by the President. The Rajya Sabha maximum is 250: 238 elected and 12',
    'nominated by the President for literature, science, art and social',
    'service. It is a permanent house; one third of members retire every',
    'second year for a 6-year term. Elected members of state assemblies',
    'choose Rajya Sabha members by proportional representation, single',
    'transferable vote.',
  ]],
  ['Parliament: Officers and Procedure', [
    'The Speaker (Articles 93 to 96) is elected by the Lok Sabha from its',
    'members; resigns by writing to the Deputy Speaker. Article 94 covers',
    'removal by a 14-day notice and effective majority. The Speaker votes',
    'only in a tie (casting vote). Whether a bill is a Money Bill is',
    'decided by the Speaker and that decision is final. Quorum under',
    'Article 100 is one tenth of total membership. Article 107 to 108',
    'cover the legislative procedure and the joint sitting, presided over',
    'by the Speaker. A Money Bill (Article 110) can be introduced only in',
    'the Lok Sabha, only on the President\'s recommendation, and the Rajya',
    'Sabha must return it within 14 days with or without recommendations.',
  ]],
  ['The Judiciary', [
    'Articles 124 to 147 cover the Supreme Court. Judges are appointed by',
    'the President; a judge holds office until 65. Removal is by an order',
    'of the President after a special majority in both Houses on grounds',
    'of proved misbehaviour or incapacity (Article 124(4)). The Supreme',
    'Court has original jurisdiction under Article 131 (federal disputes),',
    'writ jurisdiction under 32, appellate jurisdiction under 132 to 136,',
    'and advisory jurisdiction under Article 143. Article 141 makes its',
    'law binding on all courts. The High Courts (Articles 214 to 231)',
    'have a judge retirement age of 62. Article 226 is wider than 32.',
    'The collegium system evolved from the Second and Third Judges cases.',
  ]],
  ['Amendment and Basic Structure', [
    'Article 368 gives Parliament the amending power. A simple majority',
    'outside 368 amends Parts like citizenship or creates new states.',
    'Special majority (majority of total membership and 2/3 of those',
    'present and voting) amends most provisions. Ratification by half the',
    'state legislatures is needed for federal provisions: election of the',
    'President, extent of executive power, judiciary, representation of',
    'states in Parliament and Article 368 itself. Kesavananda Bharati',
    '(1973) established the basic structure doctrine: Parliament cannot',
    'alter the basic structure. Minerva Mills (1980) balanced Articles',
    '14 and 19 with 31C and struck down clauses 4 and 5 of Article 368.',
  ]],
]
let pageNo = 4
for (const [title, lines] of topicPages) {
  rich.push([`SECTION: ${title}`, ''])
  rich.push([...lines])
  // pad each topic to 2 pages with recap lines so the doc is ~30+ pages
  rich.push([
    `Recap of ${title}: remember the article numbers, the amendment years,`,
    'and the leading Supreme Court cases named above. Exam questions often',
    'pair an Article with its amendment or its case law.',
  ])
  pageNo += 3
}
rich.push(['PART III: QUICK REVISION TABLES', ''])
rich.push([
  'Key pairs: Article 14 equality before law; Article 19 six freedoms;',
  'Article 21 life and liberty; Article 32 writs; Article 44 uniform civil',
  'code; Article 50 separation of powers; Article 61 impeachment; Article',
  '72 pardon; Article 110 Money Bill; Article 141 binding precedent.',
  'Key years: 1946 Assembly, 1947 Drafting Committee, 1949 adoption,',
  '1950 commencement, 1973 Kesavananda, 1976 42nd Amendment, 1978 44th',
  'Amendment, 2002 86th Amendment, 2003 91st Amendment, 2019 103rd.',
])

writeFileSync(`${OUT}/rich.pdf`, buildPdf([rich[0].concat(rich[1]), p2, p3, ...rich.slice(2)]))
writeFileSync(`${OUT}/small.pdf`, buildPdf([
  ['Photosynthesis — quick note', 'Plants convert light energy into glucose.'],
  ['Chlorophyll absorbs red and blue light; the Calvin cycle fixes CO2.'],
]))
writeFileSync(`${OUT}/broken.pdf`, Buffer.from('this is definitely not a pdf, just text bytes with a pdf name'))

const scanned = await buildScannedPdf()
writeFileSync(`${OUT}/scanned.pdf`, scanned)

console.log('written:', OUT)
for (const f of ['rich.pdf', 'small.pdf', 'scanned.pdf', 'broken.pdf']) {
  const { statSync } = await import('node:fs')
  console.log(f, statSync(`${OUT}/${f}`).size, 'bytes')
}
