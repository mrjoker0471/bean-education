// ─── Test PDF factory for Riishe structure/analysis tests ────────────────────
// Produces three document archetypes with ZERO shared code paths with the app:
//   1. textbook-toc.pdf     — cover + contents page (dotted leaders) + 8 numbered
//                             chapters with x.y subsections + printed page numbers
//                             offset by 2 (cover+contents unnumbered)
//   2. lecture-notes.pdf    — no TOC, unnumbered short headings, no printed numbers
//   3. question-paper.pdf   — instructions with marks + numbered MCQ lines
// Raw PDF writer (no external deps): Helvetica text streams only.

import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const OUT_DIR = '/tmp/riishe-test-docs'

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

/** Cursor-based builder: text() appends to the current page, newPage() flushes. */
class PdfBuilder {
  constructor() {
    this.pages = []
    this.cur = []
  }

  /** Draw one text line on the current page. y is the baseline (842-high page). */
  text(str, opts = {}) {
    if (this.cur.length === 0 && opts.top) {
      // new logical page requested via top:true on the first call
    }
    this.cur.push({ text: str, x: opts.x ?? 56, y: opts.y, bold: opts.bold, size: opts.size ?? 11 })
    return this
  }

  newPage() {
    if (this.cur.length > 0) {
      this.flush()
    }
    return this
  }

  flush() {
    if (this.cur.length === 0) return
    const parts = ['BT']
    let lastFont = null
    let lastSize = null
    for (const l of this.cur) {
      const font = l.bold ? 'F2' : 'F1'
      const size = l.size ?? 11
      if (font !== lastFont || size !== lastSize) {
        parts.push(`/${font} ${size} Tf`)
        lastFont = font
        lastSize = size
      }
      parts.push(`1 0 0 1 ${l.x} ${l.y} Tm (${esc(l.text)}) Tj`)
    }
    parts.push('ET')
    this.pages.push(parts.join('\n'))
    this.cur = []
  }

  build() {
    this.flush()
    const objects = []
    const nPages = this.pages.length
    const kids = []
    const pageObjs = []
    for (let i = 0; i < nPages; i++) {
      pageObjs.push({ page: 5 + i * 2, content: 6 + i * 2 })
      kids.push(`${5 + i * 2} 0 R`)
    }
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
    objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${nPages} >>`
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
    for (let i = 0; i < nPages; i++) {
      const { page, content } = pageObjs[i]
      objects[page] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`
      objects[content] = { stream: this.pages[i] }
    }

    let pdf = '%PDF-1.4\n'
    const offsets = []
    for (let i = 1; i < objects.length; i++) {
      if (objects[i] === undefined) continue
      offsets[i] = pdf.length
      const obj = objects[i]
      if (typeof obj === 'object' && obj.stream !== undefined) {
        pdf += `${i} 0 obj\n<< /Length ${Buffer.byteLength(obj.stream, 'latin1')} >>\nstream\n${obj.stream}\nendstream\nendobj\n`
      } else {
        pdf += `${i} 0 obj\n${obj}\nendobj\n`
      }
    }
    const xrefStart = pdf.length
    const maxObj = objects.length
    pdf += `xref\n0 ${maxObj}\n0000000000 65535 f \n`
    for (let i = 1; i < maxObj; i++) {
      pdf += offsets[i] !== undefined ? `${String(offsets[i]).padStart(10, '0')} 00000 n \n` : '0000000000 65535 f \n'
    }
    pdf += `trailer\n<< /Size ${maxObj} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
    return Buffer.from(pdf, 'latin1')
  }
}

const W = 595
const MARGIN = 56

function wrapLine(text, size = 11) {
  const max = Math.floor((W - 2 * MARGIN) / (size * 0.5))
  const words = text.split(' ')
  const out = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) {
      out.push(cur.trim())
      cur = w
    } else {
      cur = (cur + ' ' + w).trim()
    }
  }
  if (cur) out.push(cur)
  return out
}

/** Flow wrapped paragraphs onto the current page starting at y; returns next y. */
function para(b, text, yStart, opts = {}) {
  let y = yStart
  for (const line of wrapLine(text, opts.size ?? 11)) {
    b.text(line, { x: MARGIN, y, size: opts.size ?? 11, bold: opts.bold })
    y -= 18
  }
  return y
}

// ─── 1. Textbook with contents page + printed-number offset ─────────────────

const CHAPTERS = [
  { title: 'Photosynthesis Overview', subs: ['Light Reactions', 'Dark Reactions'], facts: ['Photosynthesis converts light energy into chemical energy stored in glucose. Chlorophyll in chloroplasts absorbs mainly red and blue light and reflects green light.'],
    body: 'Photosynthesis occurs in the chloroplasts of plant cells. The overall equation combines carbon dioxide and water into glucose using light energy. The light reactions happen in the thylakoid membrane while the Calvin cycle happens in the stroma. Water is split during the light reactions releasing oxygen as a by-product. ATP and NADPH produced in the light reactions power sugar synthesis in the stroma.' },
  { title: 'Cell Respiration', subs: ['Glycolysis', 'Krebs Cycle'], facts: ['Cellular respiration releases energy from glucose producing carbon dioxide and water. Glycolysis happens in the cytoplasm and yields two molecules of ATP per glucose.'],
    body: 'Respiration breaks down glucose step by step to release usable energy. Glycolysis splits glucose into pyruvate in the cytoplasm. The Krebs cycle then oxidises pyruvate in the mitochondrial matrix. The electron transport chain builds a proton gradient that drives ATP synthase. Aerobic respiration yields far more ATP than fermentation.' },
  { title: 'Human Circulatory System', subs: ['The Heart', 'Blood Vessels'], facts: ['The human heart has four chambers and double circulation. Arteries carry blood away from the heart while veins return it.'],
    body: 'The heart is a muscular pump with two atria and two ventricles. Deoxygenated blood enters the right atrium through the vena cava. The left ventricle pumps oxygenated blood into the aorta at high pressure. Valves prevent backflow between chambers. Capillaries exchange gases and nutrients with tissues through their thin walls.' },
  { title: 'Newtonian Mechanics', subs: ['Laws of Motion', 'Momentum'], facts: ["Newton's second law states that force equals mass times acceleration. Momentum is conserved in an isolated system."],
    body: 'Motion is described by displacement velocity and acceleration. The first law says a body stays at rest or in uniform motion unless acted on by a net force. The second law relates net force to the rate of change of momentum. The third law says every action has an equal and opposite reaction. Collisions conserve total momentum when no external force acts.' },
  { title: 'Chemical Bonding', subs: ['Ionic Bonds', 'Covalent Bonds'], facts: ['Ionic bonds form by electron transfer between metals and non-metals. Covalent bonds share electron pairs between atoms.'],
    body: 'Atoms bond to achieve stable electronic configurations. Metals lose electrons to non-metals forming positive and negative ions held by electrostatic attraction. Covalent bonding shares pairs of electrons between non-metal atoms. Giant covalent structures like diamond have very high melting points. Metallic bonding describes a lattice of ions in a sea of delocalised electrons.' },
  { title: 'Indian Constitution Basics', subs: ['The Preamble', 'Fundamental Rights'], facts: ['The Constitution of India came into force on 26 January 1950. Fundamental Rights are justiciable and guaranteed by Part III.'],
    body: 'The Constitution is the supreme law of India. The Preamble declares India a sovereign socialist secular democratic republic. Fundamental Rights guarantee equality freedom and constitutional remedies. Directive Principles guide state policy though they are not enforceable in court. Parliament can amend the Constitution through a prescribed procedure.' },
  { title: 'Algebraic Expressions', subs: ['Identities', 'Factorisation'], facts: ['The identity (a+b) squared equals a squared plus 2ab plus b squared. Factorisation rewrites an expression as a product of simpler factors.'],
    body: 'An algebraic expression combines variables and constants with operations. Standard identities simplify expansion of squared and cubed binomials. Factorisation uses common factors grouping or identities to rewrite expressions as products. Quadratic expressions factor into two linear brackets when roots are rational. Simplification often means collecting like terms before applying identities.' },
  { title: 'Maps and Coordinates', subs: ['Latitude', 'Longitude'], facts: ['Latitude measures angular distance north or south of the equator. Longitude measures angular distance east or west of the prime meridian.'],
    body: 'A grid of latitude and longitude fixes every point on the globe. The equator is zero degrees latitude and the poles are ninety degrees. The prime meridian passes through Greenwich at zero degrees longitude. Time zones roughly follow fifteen degree bands of longitude. Great circles represent the shortest distance between two points on a sphere.' },
]

function makeTextbook() {
  const b = new PdfBuilder()
  // Page 1 — cover (no printed number)
  b.text('Foundation Science: A Study Textbook', { x: 120, y: 700, bold: true, size: 22 })
  b.text('Class Companion Edition', { x: 180, y: 660, size: 14 })
  b.text('Published by the Study Press', { x: 190, y: 100, size: 10 })
  b.newPage()

  // Page 2 — contents with dotted leaders (claims printed pages)
  let y = 740
  b.text('Contents', { x: MARGIN, y, bold: true, size: 16 })
  y -= 30
  let printed = 1
  const chapterStarts = []
  for (let i = 0; i < CHAPTERS.length; i++) {
    chapterStarts.push(printed)
    b.text(`Chapter ${i + 1}  ${CHAPTERS[i].title} ......... ${printed}`, { x: MARGIN, y, size: 11 })
    y -= 20
    printed += 2
  }
  b.newPage()

  // Pages 3+ — two pages per chapter, printed page numbers offset by 2
  for (let i = 0; i < CHAPTERS.length; i++) {
    const ch = CHAPTERS[i]
    // first page: chapter heading + body
    b.text(`Chapter ${i + 1} ${ch.title}`, { x: MARGIN, y: 780, bold: true, size: 15 })
    para(b, ch.body, 740)
    b.text(String(chapterStarts[i]), { x: W / 2 - 10, y: 30, size: 9 })
    b.newPage()
    // second page: x.y subsections with content
    let yy = 780
    ch.subs.forEach((sub, si) => {
      b.text(`${i + 1}.${si + 1} ${sub}`, { x: MARGIN, y: yy, bold: true, size: 12 })
      yy = para(b, ch.facts[si % ch.facts.length], yy - 26) - 8
    })
    b.text(String(chapterStarts[i] + 1), { x: W / 2 - 10, y: 30, size: 9 })
    b.newPage()
  }
  return b.build()
}

// ─── 2. Lecture notes — no TOC, unnumbered headings, no printed numbers ──────

const NOTES = [
  { h: 'Why Markets Fail', body: 'A market failure happens when free markets do not allocate resources efficiently. Externalities spill costs or benefits onto third parties. Public goods are non-excludable and non-rival so markets under-provide them. Information gaps let sellers hide quality from buyers.' },
  { h: 'Demand and Elasticity', body: 'Price elasticity of demand measures how quantity responds to a price change. Elastic goods have many substitutes like branded snacks. Inelastic goods include petrol and medicines. Total revenue rises with price when demand is inelastic.' },
  { h: 'National Income', body: 'Gross domestic product sums the value of all final goods and services produced inside a country in a year. The three approaches are income expenditure and output. Real GDP removes the effect of price changes using a base year.' },
  { h: 'Banking and Money', body: 'Commercial banks create money through credit creation. The central bank controls the money supply with reserve ratios and policy rates. Repo rate is the rate at which the central bank lends to commercial banks overnight.' },
  { h: 'Inflation Types', body: 'Demand pull inflation comes from excess aggregate demand. Cost push inflation comes from rising input costs like oil. Core inflation excludes food and fuel to show the underlying trend.' },
  { h: 'Budget and Fiscal Policy', body: 'A government budget lists expected revenue and expenditure for the financial year. Fiscal deficit is total expenditure minus total receipts excluding borrowing. Expansionary policy raises spending or cuts taxes during a slowdown.' },
]

function makeNotes() {
  const b = new PdfBuilder()
  for (const n of NOTES) {
    let y = 760
    b.text(n.h, { x: MARGIN, y, bold: true, size: 14 })
    y = para(b, n.body, y - 30)
    y = para(b, `${n.body} Students should practise numericals from the exercise at the end of this note.`, y - 10)
    b.newPage()
  }
  return b.build()
}

// ─── 3. Question paper — instructions + numbered MCQs ─────────────────────────

function makeQuestionPaper() {
  const b = new PdfBuilder()
  b.text('SAMPLE QUESTION PAPER — PHYSICS', { x: 140, y: 780, bold: true, size: 14 })
  b.text('Time allowed: 3 hours          Maximum marks: 70', { x: 160, y: 756, size: 11 })
  b.text('General instructions: All questions are compulsory. Marks for each question are indicated.', { x: MARGIN, y: 732, size: 10 })
  const QS = [
    ['A body moves with constant velocity. Which quantity stays zero?', ['Acceleration', 'Speed', 'Momentum', 'Kinetic energy'], 'A'],
    ['The SI unit of power is the', ['joule', 'watt', 'newton', 'pascal'], 'B'],
    ['Which lens corrects myopia?', ['Concave lens', 'Convex lens', 'Cylindrical lens', 'Bifocal lens'], 'A'],
    ['Ohm law relates voltage current and', ['resistance', 'capacitance', 'inductance', 'power'], 'A'],
    ['Work done is zero when force and displacement are', ['parallel', 'antiparallel', 'perpendicular', 'equal'], 'C'],
    ['Escape velocity from earth is about', ['7.9 km/s', '11.2 km/s', '3.0 km/s', '42 km/s'], 'B'],
    ['A concave mirror forms a virtual image when the object is', ['beyond C', 'between P and F', 'at C', 'at infinity'], 'B'],
    ['The unit of magnetic flux is the', ['tesla', 'weber', 'henry', 'gauss'], 'B'],
    ['Kinetic energy of a body depends on', ['velocity squared', 'velocity', 'mass only', 'height'], 'A'],
    ['Sound cannot travel through', ['solids', 'liquids', 'gases', 'vacuum'], 'D'],
    ['Which quantity is a vector?', ['Speed', 'Distance', 'Displacement', 'Energy'], 'C'],
    ['The focal length of a plane mirror is', ['zero', 'infinite', 'one metre', 'negative'], 'B'],
    ['A wire is stretched to double its length. Its resistance becomes', ['half', 'double', 'four times', 'unchanged'], 'C'],
    ['Nuclear fission releases energy due to', ['mass defect', 'electron capture', 'ionisation', 'friction'], 'A'],
    ['The SI unit of charge is the', ['coulomb', 'ampere', 'volt', 'ohm'], 'A'],
    ['Half life of a radioactive element depends on', ['temperature', 'pressure', 'the nucleus itself', 'volume'], 'C'],
    ['A moving charge produces', ['only electric field', 'only magnetic field', 'both fields', 'no field'], 'C'],
    ['Total internal reflection needs light to travel from', ['denser to rarer medium', 'rarer to denser medium', 'vacuum to glass', 'air to water'], 'A'],
    ['The unit of electric field intensity is', ['N/C', 'N m', 'C/N m squared', 'V m'], 'A'],
    ['Bernoulli theorem is based on conservation of', ['mass', 'energy', 'charge', 'momentum'], 'B'],
  ]
  let qn = 1
  let yy = 700
  for (const [stem, opts, ans] of QS) {
    if (yy < 100) {
      b.newPage()
      yy = 780
    }
    b.text(`${qn}. ${stem}`, { x: MARGIN, y: yy, size: 11 })
    b.text(`(i) ${opts[0]}   (ii) ${opts[1]}   (iii) ${opts[2]}   (iv) ${opts[3]}`, { x: MARGIN + 12, y: yy - 20, size: 10 })
    b.text(`(Answer: ${ans})  Marks: 1`, { x: MARGIN + 12, y: yy - 36, size: 9 })
    yy -= 60
    qn++
  }
  b.newPage()
  return b.build()
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(path.join(OUT_DIR, 'textbook-toc.pdf'), makeTextbook())
writeFileSync(path.join(OUT_DIR, 'lecture-notes.pdf'), makeNotes())
writeFileSync(path.join(OUT_DIR, 'question-paper.pdf'), makeQuestionPaper())
console.log('written to', OUT_DIR)
