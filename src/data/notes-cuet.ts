// ─────────────────────────────────────────────────────────────────────────────
// BEAN Education — Original study notes written specifically for CUET (UG).
// Content follows the official NTA CUET (UG) 2026 subject syllabus PDFs
// (cuet.nta.nic.in/cuetug-2026-syllabus/) — Class-12 NCERT scope for domain
// subjects, the official language-test outline and the official GAT topics.
// Every note is mapped to a CUET topic via its canonical slug; the same
// canonical can be shared by several exams only where the syllabus matches.
// ─────────────────────────────────────────────────────────────────────────────

import type { NoteSeed } from './notes-gs'

const mk = (canonical: string, title: string, markdown: string, sourceRefs?: { label: string; url: string }[]): NoteSeed =>
  ({ canonical, title, markdown, sourceRefs })

const OFFICIAL_SYLLABUS_REF = {
  label: 'NTA CUET (UG) — official syllabus page',
  url: 'https://cuet.nta.nic.in/cuetug-2026-syllabus/',
}

export const NOTES_CUET: NoteSeed[] = [
  // ─── Language test (official outline: RC + verbal ability + literary aptitude) ───
  mk('cuet-lang-verbal-ability', 'CUET Language Test — Verbal Ability', `## 1. Concept
The CUET language paper (all 13 languages, codes 101–113) tests verbal ability through four official task types: **rearranging the parts**, **match the following**, **choosing the correct word**, and **synonyms & antonyms**. Tasks are embedded in passages of up to 300 words.

## 2. Task types & method
- **Rearranging the parts (para-jumble / sentence order):** find the opening sentence first (it introduces a noun/idea with no pronoun or connector pointing backwards). Then chain the links: pronouns (he, this, such), time markers (then, later, finally) and cause–effect pairs. Options share 1–2 fixed anchors — eliminate around the anchor.
- **Match the following:** match words with meanings, authors with works, or sentence halves. Solve the two you are sure of first, then use the options: a unique combination pins the rest.
- **Choosing the correct word:** sentence fill-ins testing collocation and context ("comprise of" is wrong — "comprise" alone). Read the full sentence; the surrounding words decide the register and tense.
- **Synonyms & antonyms:** answer from the passage context when "choose the word closest in meaning to X *as used in the passage*" is asked — not from the dictionary meaning alone.

## 3. Worked example
Rearrange: (P) finally the bill was passed (Q) the minister introduced the bill (R) it was debated for a week.
→ Q-R-P: the introduction (Q) has the only full noun phrase with no back-reference; "it" in R refers to the bill; "finally" in P closes the sequence.

## 4. Common mistakes & exam traps
- Ignoring the "as used in the passage" instruction for vocabulary items.
- In para-jumbles, picking the sentence with a pronoun (it/this/they) as the opener.
- In match-the-following, marking answers before checking that the option letter-set matches ALL your pairs.
- For antonyms, forgetting that the answer may also need to fit the passage's tone (formal/ironic).

## 5. Revision summary
Four tasks: rearrange (openers first, then links), match (solve the sure pairs, lock the option-set), choose-the-word (context + collocation), synonyms/antonyms (passage sense first). Practice within the 60-minute/50-question format — roughly a minute per question including the passage reading.`, [OFFICIAL_SYLLABUS_REF]),

  mk('cuet-lang-literary-aptitude', 'CUET Language Test — Literary Aptitude', `## 1. Concept
"Literary aptitude" is the official name for the CUET language section's literature-flavoured questions: identifying devices, appreciating tone and figurative meaning in narrative/literary passages, and basic awareness of literary kinds (anecdote, satire, elegy, memoir, travelogue).

## 2. Devices you must recognise on sight
- **Simile** (like/as): "her smile was like spring". **Metaphor** (direct): "her smile was spring".
- **Personification**: non-human things act human — "the city exhaled".
- **Hyperbole** (deliberate exaggeration), **irony** (surface says the opposite of intent), **alliteration** (repeated initial sounds), **oxymoron** (deafening silence), **pun** (double meaning).
- **Allusion**: a reference to a known work, myth or event.

## 3. Tone & attitude words
Appreciative, nostalgic, critical, sarcastic, melancholic, humorous, didactic (teaching/lecturing), elegiac (mourning). Ask: what does the author *feel* about the subject? Adjectives and verbs carry tone — "hobbled" vs "strolled" vs "stormed".

## 4. Worked example
"The politician promised the moon, and like the moon, his promises changed shape every night."
- Device: simile + irony — the comparison (like the moon) literally says promises wax and wane; the intent is criticism. A "literal" reading (about astronomy) is the classic trap.

## 5. Common mistakes & exam traps
- Calling every comparison a metaphor — check for like/as (simile).
- Confusing the *speaker's* view with the *author's* view in narrative extracts.
- Treating irony literally — when praise is absurdly overdone, suspect sarcasm.
- Choosing the "theme" option that restates a detail rather than the passage's central idea.

## 6. Revision summary
Devices (simile/metaphor/personification/irony/hyperbole/allusion), tone adjectives, speaker vs author, theme = central idea not a detail. In the exam, literary-aptitude items live inside the narrative/literary passages — read the passage's last paragraph for the author's stance before answering.`, [OFFICIAL_SYLLABUS_REF]),

  // ─── General Aptitude Test ───
  mk('cuet-gat-science-env', 'General Science & Environmental Literacy (GAT)', `## 1. Concept
The official CUET (UG) General Aptitude Test syllabus includes **General Science and Environmental Literacy** — everyday science concepts, energy, ecosystems and sustainability, asked as applied MCQs rather than deep derivations.

## 2. General science essentials
- **Units & measurement:** SI units (m, kg, s, A, K, mol); 1 kWh = 3.6 × 10⁶ J; speed of light ≈ 3 × 10⁸ m/s.
- **Human body:** 206 bones (adult); heart has 4 chambers; blood groups ABO + Rh; insulin (pancreas) lowers blood sugar; vitamin C deficiency → scurvy, D deficiency → rickets.
- **Everyday physics:** friction, pressure (P = F/A), conduction–convection–radiation, refraction (why pools look shallow), current = charge/time (1 A = 1 C/s).
- **Chemistry in daily life:** rusting (iron + oxygen + water), common salt NaCl, pH < 7 acidic; biogas is mainly methane; CNG is cleaner than petrol mainly due to fewer particulates/residue.
- **Biology basics:** photosynthesis (CO₂ + H₂O → glucose + O₂, chlorophyll, sunlight); pollinators; vaccination gives active immunity.

## 3. Environmental literacy essentials
- **Ecosystem:** producers (plants) → consumers → decomposers; energy flow is one-way with ~10% transfer between trophic levels — food chains are short.
- **Biodiversity hotspots in India:** Western Ghats–Sri Lanka, Himalaya, Indo-Burma, Sundaland (Nicobar).
- **Climate:** CO₂, CH₄, N₂O are major greenhouse gases; ozone (O₃) layer shields UV-B — CFCs were the main depleters (Montreal Protocol, 1987).
- **Pollution:** PM2.5 penetrates deep into lungs; eutrophication = nutrient runoff → algal bloom → oxygen depletion.
- **Sustainable development:** Brundtland definition — "meeting present needs without compromising future generations"; SDGs (2015, 17 goals); India's Mission LiFE (Lifestyle for Environment).
- **Renewables:** solar, wind, hydro, biomass; India's pledges — net zero by 2070 (COP26), 500 GW non-fossil capacity by 2030.

## 4. Common mistakes & exam traps
- Confusing weather (short-term) with climate (long-term).
- Ozone DEPLETION (CFCs, UV) vs global WARMING (greenhouse gases) — two different problems.
- Thinking energy "flows in a cycle" — it flows one way; nutrients cycle, energy doesn't.
- Mission LiFE is a lifestyle/behaviour initiative, not an energy-target scheme.

## 5. Revision summary
One-way energy flow, 10% law, hotspot list, ozone vs greenhouse distinction, SDGs/Mission LiFE, everyday unit conversions. GAT science items reward current-awareness + Class-10 level clarity, not formulas.`, [OFFICIAL_SYLLABUS_REF]),

  // ─── Physics (Class-12 NCERT units) ───
  mk('cuet-phy-electrostatics', 'Electrostatics — Charges, Fields, Potential & Capacitors', `## 1. Concept
Electrostatics (official CUET Physics Unit 1) studies charges at rest: force between charges, the electric field and potential they create, and energy storage in capacitors.

## 2. Definitions & laws
- **Coulomb's law:** F = (1/4πε₀)·q₁q₂/r²; force on each is equal and opposite; in a medium of dielectric constant K, F → F/K.
- **Electric field** E = F/q₀ (N/C); field of a point charge E = kq/r², directed away from +, toward −.
- **Electric dipole:** p = q(2a), pointing −q → +q. Field on axis: 2kp/r³; on equator: kp/r³. Torque in uniform field: τ = pE sinθ.
- **Gauss's law:** ∮E·dA = q_enc/ε₀. Applications: infinite line → E = λ/2πε₀r; infinite sheet → E = σ/2ε₀; spherical shell (outside) behaves like a point charge, **inside E = 0**.
- **Potential** V = U/q₀; V = kq/r (scalar). Equipotential surfaces ⊥ field lines; no work done moving a charge along one. E = −dV/dr.
- **Potential energy:** two charges → U = kq₁q₂/r; dipole → U = −pE cosθ.

## 3. Capacitors
- C = Q/V; parallel-plate: C = ε₀A/d, with dielectric: C = Kε₀A/d.
- Series: 1/C = Σ1/Cᵢ (same charge). Parallel: C = ΣCᵢ (same voltage).
- Energy: U = ½CV² = ½QV = Q²/2C. Energy density between plates = ½ε₀E².
- With battery connected V is fixed (Q changes with K); after disconnection Q is fixed (V changes).

## 4. Worked example
A 12 μF capacitor charged to 100 V is connected to an uncharged 6 μF capacitor. Common V = Q_total/(C₁+C₂) = (1200 μC)/(18 μF) ≈ 66.7 V. Energy before = ½(12μ)(100²) = 60 mJ; after = ½(18μ)(66.7²) ≈ 40 mJ — the 20 mJ loss becomes heat/radiation in the wires.

## 5. Common mistakes & exam traps
- E is a vector, V is a scalar — potentials add algebraically, fields vectorially.
- Inside a charged spherical shell E = 0 but V = kQ/R (constant, not zero).
- Force between plates F = σ²A/2ε₀ — the ½ matters.
- Work done around a closed loop in an electrostatic field is always zero.

## 6. Revision summary
Coulomb → field → flux (Gauss) → potential → energy → capacitors. Memorise: shell-inside cases, dipole formulas, series/parallel combination rules, and the battery-connected vs isolated-capacitor distinction.`, [OFFICIAL_SYLLABUS_REF]),

  // ─── Chemistry (Class-12 NCERT units) ───
  mk('cuet-chem-electrochemistry', 'Electrochemistry — EMF, Nernst Equation & Conductance', `## 1. Concept
Electrochemistry (official CUET Chemistry Unit 2) links redox reactions to electrical energy: galvanic cells produce electricity from spontaneous reactions; electrolytic cells consume it.

## 2. Definitions & laws
- **Standard electrode potential (E°):** potential of an electrode vs SHE (by convention 0 V) at 298 K, 1 M, 1 bar. More positive E° = stronger oxidising agent.
- **EMF of cell:** E°cell = E°cathode − E°anode (reduction potentials; never add/subtract electrode potentials with electron coefficients).
- **Nernst equation (298 K):** E(cell) = E°cell − (0.059/n)·log([products]/[reactants] in stoichiometric powers).
- **Gibbs energy:** ΔG° = −nFE°cell; E°cell = (0.059/n)·log K at equilibrium.
- **Kohlrausch's law:** Λ°m = ν₊λ°₊ + ν₋λ°₋ — used to compute Λ°m of weak electrolytes.
- **Conductance:** G = 1/R; κ = G·(l/A); Λm = κ/c. Λm rises with dilution (more dissociation); κ falls (fewer ions per cm³).
- **Faraday's laws:** m = (Z·I·t); 1 F = 96487 C deposits 1 equivalent. Charge on n mol electrons = nF.

## 3. Worked example
For Zn|Zn²⁺(1M)||Cu²⁺(1M)|Cu: E°cell = 0.34 − (−0.76) = 1.10 V, n = 2 → ΔG° = −2 × 96487 × 1.10 ≈ −212 kJ/mol. If [Cu²⁺] falls to 0.01 M: E = 1.10 − (0.059/2)·log(1/0.01) = 1.10 − 0.059 ≈ 1.04 V.

## 4. Common mistakes & exam traps
- Writing E°cell = E°anode − E°cathode (reversed sign convention).
- Using 0.059 with n wrong — n = electrons transferred in the balanced cell reaction.
- κ vs Λm dilution behaviour (κ decreases, Λm increases for weak electrolytes).
- Battery life problems: capacity in Ah — I·t must use consistent units.

## 5. Revision summary
E° chain (SHE → reduction potentials → E°cell), Nernst at 298 K, ΔG° = −nFE°, log K relation, Kohlrausch for weak electrolytes, Faraday stoichiometry. Expected CUET tasks: compute E of non-standard cells, compare oxidising strength via E°, convert between Λm and κ, deposit-mass calculations.`, [OFFICIAL_SYLLABUS_REF]),

  // ─── Mathematics (Class-12 NCERT) ───
  mk('cuet-math-matrices', 'Matrices & Determinants', `## 1. Concept
Official CUET Mathematics Unit "Algebra" covers matrices (order, types, operations, transpose) and determinants (up to 3×3, minors, cofactors, inverse, and solving linear systems).

## 2. Definitions & laws
- A matrix has order m×n; multiplication AB needs cols(A) = rows(B) and is **not commutative** in general. AB = 0 does not imply A = 0 or B = 0.
- Transpose: (AB)ᵀ = BᵀAᵀ; for symmetric A: Aᵀ = A; skew-symmetric: Aᵀ = −A (diagonal of a skew-symmetric matrix is all zeros).
- |AB| = |A||B|; |Aᵀ| = |A|; |kA| = kⁿ|A| for n×n.
- Adjoint(adj A) properties: A·adj(A) = |A|I; |adj A| = |A|ⁿ⁻¹.
- Inverse: A⁻¹ = adj(A)/|A|, exists iff |A| ≠ 0; (A⁻¹)⁻¹ = A; (AB)⁻¹ = B⁻¹A⁻¹.
- System AX = B: unique solution iff |A| ≠ 0 → X = A⁻¹B. |A| = 0 → consistent only if (adj A)B = 0 (infinitely many), else inconsistent.

## 3. Worked example
A = [[2, 3], [1, 4]] → |A| = 8 − 3 = 5; adj(A) = [[4, −3], [−1, 2]]; A⁻¹ = (1/5)[[4, −3], [−1, 2]]. Solving 2x + 3y = 7, x + 4y = 9: X = A⁻¹B = (1/5)[(28 − 27), (−7 + 18)] = (1/5)(1, 11) → x = 1/5? — check: 2(0.2) + 3(2.2) = 7 ✓, 0.2 + 8.8 = 9 ✓.

## 4. Common mistakes & exam traps
- Multiplying in the wrong order or treating AB = BA as a rule.
- Forgetting |kA| = kⁿ|A| (the power n).
- Using A⁻¹ = adj(A) without dividing by |A|.
- In word problems, defining the matrices consistently (variables must line up in the same order in every equation).

## 5. Revision summary
Order rules → transpose laws → |AB| = |A||B| → adj/inverse → matrix method for linear systems with the three-case consistency check. CUET favourite: 2×2/3×3 inverse + solve a small system, and determinant-value MCQs with the kⁿ rule.`, [OFFICIAL_SYLLABUS_REF]),

  // ─── Accountancy (Class-12 NCERT) ───
  mk('cuet-acc-partnership', 'Accounting for Partnership — Deed, Capital & Profit Division', `## 1. Concept
Official CUET Accountancy Unit 1: nature of the partnership firm (deed) and final accounts of partnership — fixed vs fluctuating capital and division of profit through the Profit & Loss Appropriation Account.

## 2. Definitions & rules
- **Partnership deed:** written agreement covering capital, profit-sharing ratio, interest on capital/drawings, salary/commission to partners, interest on partner's loan (6% p.a. by law if silent). In the absence of a deed: **no** interest on capital, **no** salary, profits shared **equally**, interest on partner's loan 6% p.a. (a charge against profit, paid even in loss).
- **Fixed capital:** two accounts per partner — Capital (stays constant except permanent changes) + Current (absorbs appropriations: interest, salary, share of profit, drawings).
- **Fluctuating capital:** one account; capital itself changes every year.
- **P&L Appropriation order:** Net profit → (+) interest on drawings → (−) interest on capital → (−) salary/commission → (−) transfer to reserves → (÷) share of profit by ratio.
- **Interest on drawings:** calculated per timing — annual drawings: full-year; mid-year: half; quarterly equal drawings: average period 4.5–7.5 months depending on pattern.

## 3. Worked example
A and B (1:1), capitals ₹1,00,000 each. Deed: 8% interest on capital; B salary ₹2,000/quarter; profit ₹61,000; drawings A ₹10,000 at year-end (interest ₹500 charged), B ₹2,000/month mid-month (interest ₹780).
Appropriation: 61,000 + 500 + 780 = 62,280; less IoC 16,000; less salary 8,000 → distributable 38,280 → A 19,140, B 19,140.

## 4. Common mistakes & exam traps
- Treating interest on partner's LOAN as an appropriation — it is a **charge** against profit (goes to P&L, before appropriation).
- Salary to a partner counted before interest on capital without checking the deed.
- Ignoring interest on drawings when the deed provides for it but the question gives drawings dates.
- Dividing profit in the capital ratio instead of the deed ratio (default equal).

## 5. Revision summary
Deed defaults, fixed vs fluctuating capital accounts, appropriation-account order, interest-on-drawings average periods. CUET tasks: prepare/format appropriation results, compute IoC/IoD, pick the legally correct default (6% loan interest, equal sharing).`, [OFFICIAL_SYLLABUS_REF]),

  // ─── Business Studies (Class-12 NCERT) ───
  mk('cuet-bst-management', 'Nature and Significance of Management', `## 1. Concept
Official CUET Business Studies Unit 1: management — concept, objectives, importance; management as science, art and profession; levels; functions; coordination.

## 2. Definitions & distinctions
- **Management:** process of getting things done with the aim of achieving goals effectively (ends) and efficiently (cost/benefit). "Effectively ≠ efficiently" is a standard trap: effective = goal achieved; efficient = minimum cost.
- **Science:** systematised knowledge (cause–effect principles) — but an inexact/social science. **Art:** personal skill + creativity applied to results. **Profession:** restricted entry + service motive — management is *towards* profession (no compulsory degree), so "not a full profession".
- **Levels:** top (vision, overall policy), middle (interpret policy, coordinate divisions, recruit for departments), operational/supervisory (oversee workers, quality, safety).
- **Functions:** planning → organising → staffing → directing → controlling (controlling feeds back into planning).
- **Coordination:** the essence of management — it is not a separate function; it binds all functions at all levels; a deliberate, continuous, group effort ensuring unity of action.

## 3. Worked example
A factory meets its output target (effective) but with 20% overtime cost while rivals produce the same at normal cost — effective but NOT efficient. A manager who sets the schedule (top), translates it into department plans (middle) and supervises machine operators (operational) illustrates all three levels in one chain.

## 4. Common mistakes & exam traps
- Calling coordination a separate managerial function — official NCERT position: it is the **essence** of management.
- Swapping efficiency and effectiveness definitions.
- Claiming management is a full profession — entry is not restricted by law.
- Middle-level vs operational duties: "recruiting department staff" is middle; "ensuring worker safety at the machine" is operational.

## 5. Revision summary
Definition pair (effectiveness/efficiency), science-art-profession triple with the official verdict, three levels with one-line duties, five functions in order, coordination-as-essence. CUET MCQs test exact labels and level-to-duty matching.`, [OFFICIAL_SYLLABUS_REF]),

  // ─── Economics (Class-12 NCERT) ───
  mk('cuet-econ-micro', 'Introductory Microeconomics — Central Problems, Demand & Elasticity', `## 1. Concept
Official CUET Economics Units 1–2: the central problems of an economy (what, how, for whom), the production possibility curve, consumer equilibrium (utility approach) and demand with price elasticity.

## 2. Definitions & laws
- **Central problems:** what to produce, how to produce, for whom to produce — they arise because resources are scarce relative to wants (scarcity → choice → opportunity cost).
- **PPC:** locus of maximum output combinations; downward-sloping and concave to the origin (increasing opportunity cost). Points inside = inefficiency; ON the curve = full & efficient employment; beyond = unattainable.
- **Marginal utility:** MUₙ = TUₙ − TUₙ₋₁; law of diminishing MU. **Consumer equilibrium (one good):** MU in money terms = price → MU/P = MUm; equilibrium when MUx/Px = MUm; if MUx/Px > MUm buy more.
- **Demand:** inverse price relation (law of demand); exceptions — Giffen goods, conspicuous consumption, emergencies. Market demand = horizontal sum of individual demands.
- **Movements vs shifts:** price change → movement ALONG the curve; income, tastes, prices of related goods → SHIFT of the curve. Substitute price ↑ → demand shifts right; complement price ↑ → shifts left.
- **Price elasticity:** Ed = %ΔQ/%ΔP = (ΔQ/ΔP)·(P/Q). |Ed| > 1 elastic, < 1 inelastic; straight-line demand curve: elastic above midpoint, unitary at midpoint, inelastic below. **Total-expenditure method:** price ↑ and TE ↑ → inelastic; TE falls → elastic.

## 3. Worked example
Price falls ₹10 → ₹8; quantity rises 100 → 130. %ΔQ = 30%, %ΔP = −20% → Ed = −1.5 (elastic, |Ed| > 1). TE moves 1000 → 1040 — expenditure rises when price falls, confirming elastic demand.

## 4. Common mistakes & exam traps
- Ignoring the minus sign convention — elasticity of demand is negative; compare |Ed|.
- Calling a rightward demand shift an "increase in quantity demanded" — that phrase means a movement along the curve.
- Giffen vs Veblen: Giffen = inferior staple with strong income effect; Veblen = prestige goods bought BECAUSE costly.
- Using midpoint quantities inconsistently in % calculations within one question.

## 5. Revision summary
Scarcity → three problems → PPC shape (concave, why) → equilibrium condition MUx/Px = MUm → demand curve shifts vs movements → elasticity triangle (percentage/geometric/TE methods) with the midpoint rule.`, [OFFICIAL_SYLLABUS_REF]),

  // ─── Biology (Class-12 NCERT) ───
  mk('cuet-bio-reproduction', 'Reproduction in Flowering Plants & Humans', `## 1. Concept
Official CUET Biology Unit "Reproduction": pre- and post-fertilisation events in flowering plants and the human reproductive system with gametogenesis and the menstrual cycle.

## 2. Flowering plants
- **Stamen** = anther + filament; anther (dithecous, 4 microsporangia). Microsporogenesis → pollen (2-cell at release: vegetative + generative). **Carpel** = stigma + style + ovary; embryo sac = 7 cells, 8 nuclei (egg + 2 synergids + 2 polar nuclei + 3 antipodals).
- **Pollination → double fertilisation:** one male gamete + egg = zygote (2n); other + 2 polar nuclei = PEN (3n, primary endosperm nucleus). Endosperm develops first (free-nuclear then cellular).
- **Post-fertilisation:** ovule → seed; ovary → fruit; integuments → seed coats; zygote → embryo (typical dicot: embryonal axis + 2 cotyledons).
- **Apomixis** = seed formation without fertilisation (e.g., some Citrus, grasses); **polyembryony** = many embryos per seed.

## 3. Humans
- **Male:** testes (scrotal, 2–3 °C lower) → seminiferous tubules: spermatogonia → (FSH → Sertoli cells nourish) → sperm; Leydig cells secrete testosterone (LH stimulated).
- Sperm = head (acrosome + enzymes + nucleus), middle piece (mitochondria), tail.
- **Female:** ovary → oogonia → primary oocyte (arrested prophase-I) → at puberty FSH/LH cycle; Graafian follicle releases secondary oocyte (arrested metaphase-II) at ovulation.
- **Menstrual cycle:** days 1–5 menses; 5–14 follicular (oestrogen; LH surge day ~14 → ovulation); 15–28 luteal (progesterone from corpus luteum); no fertilisation → corpus luteum degenerates → menses.
- **Fertilisation** at ampulla of fallopian tube; implantation ~6 days later in the uterus; placenta = foetal + maternal tissue, secretes hCG, hPL, oestrogens, progesterone.

## 4. Common mistakes & exam traps
- Endosperm is 3n (PEN), not 2n; embryo is 2n.
- Sperm released is still 2-cell?? — No: pollen grain is 2-celled at release; the generative cell divides DURING pollen-tube growth to give 2 male gametes.
- Ovulation releases a secondary oocyte (not a mature ovum) — meiosis-II completes after sperm entry.
- Sertoli = nourishment (FSH); Leydig = testosterone (ICSH/LH). Don't swap them.

## 5. Revision summary
Anther→pollen (2-cell) → double fertilisation (2n zygote + 3n endosperm) → seed/fruit mapping; spermatogenesis vs oogenesis blocks, hormonal cycle (FSH/oestrogen → LH surge → progesterone), implantation + placental hormones. CUET asks exact product-of-fertilisation and hormone-cell pairings.`, [OFFICIAL_SYLLABUS_REF]),

  // ─── History (Themes in Indian History) ───
  mk('cuet-hist-harappan', 'Theme I — The Story of the First Cities: Harappan Archaeology', `## 1. Concept
Official CUET History Theme I: the Harappan (Indus Valley) civilisation c. 2600–1900 BCE — its cities, subsistence, craft and trade — and how archaeologists reconstruct it from material remains.

## 2. Key facts
- **Beginnings:** early cultures (Baluchistan, c. 7000–2600 BCE, Mehrgarh) → Early Harappan → **Mature Harappan c. 2600–1900 BCE**; sites spread over Punjab, Sindh, Baluchistan, Rajasthan, Haryana, Gujarat (incl. Rakhigarhi, Dholavira, Lothal).
- **Urban planning:** citadel (raised, special structures — Great Bath at Mohenjodaro, granary) + Lower Town with grid plan; standardised burnt bricks (ratio 1:2:4); covered drains; wells; the "Great Bath" water-proofed with gypsum.
- **Subsistence:** wheat, barley, lentil, chickpea, sesame; first to grow cotton ("sindon"); animal bones — cattle, sheep, goat, buffalo; wild species hunted.
- **Crafts & materials:** carnelian (from Gujarat), lapis lazuli (Afghanistan), copper (Oman/Rajasthan), gold (Karnataka), steatite seals; bead-making (Chanhudaro); bronze figures ("Dancing Girl"), the Priest-King bust.
- **Seals & script:** steatite seals with animal motifs (unicorn most common) + undeciphered script (not Brahmi; signs 375–400); seals found in Mesopotamia → trade with Mesopotamia (Dilmun, Magan references).
- **End:** after 1900 BCE cities decline — theories: climate change, deforestation, shifting/drying rivers (Ghaggar-Hakra), floods, and the end of Mesopotamian trade; NO single proven cause. The "Aryan invasion" theory is NOT supported by the NCERT account of the evidence.

## 3. How archaeologists work (examiner's favourite)
- Recovery systems: artefacts classified by material/shape; stratigraphy; vertical vs horizontal excavations; provenance of every find recorded.
- Subsistence evidence: charred grains/seeds (botanists), animal bones (zooarchaeologists).
- Craft evidence: waste products identify production sites; brick sizes uniform → standardisation implies administration.
- Texts: Harappan script undeciphered, so history comes from objects, not texts — contrast with later epigraphy.

## 4. Common mistakes & exam traps
- Dating errors: Mature phase is 2600–1900 BCE, not 3300 BCE (that's Early Harappan).
- The Great Bath is at **Mohenjodaro**; the dockyard at **Lothal**; the "stadium"/water reservoirs at **Dholavira**.
- Thinking the script = Sanskrit/Brahmi — it is undeciphered.
- Assuming war/Aryan invasion destroyed the cities — NCERT presents environmental/trade-shift explanations.

## 5. Revision summary
Chronology → citadel/lower-town grid + 1:2:4 bricks → crops + cotton → craft materials & their sources → seals/trade with Mesopotamia → undeciphered script → multiple end-hypotheses. CUET MCQs pair artefacts with sites and ask "how do we know" — always answer from material evidence.`, [OFFICIAL_SYLLABUS_REF]),

  // ─── Political Science (Politics in India Since Independence) ───
  mk('cuet-psc-one-party', 'Era of One-Party Dominance', `## 1. Concept
Official CUET Political Science opening topic: the first three general elections (1952, 1957, 1962) and the nature of Congress dominance at the national and state level — plus the major opposition parties of the period.

## 2. Key facts
- **First election (1951–52):** universal adult franchise for the first time; over 17 crore eligible voters; INC won 364 of 489 Lok Sabha seats (~45% vote); Communists became the largest opposition group. 1957: Congress 371 seats; Kerala elected the **first non-Congress government** (EMS Namboodiripad, CPI) — later dismissed in 1959. 1962: Congress 361 seats (slightly reduced, still dominant).
- **Nature of dominance:** consensus-based and coalition-like *inside* the party — Congress accommodated factions (patronage + consensus), historically rooted in the freedom movement; dominance at state level was uneven (stronger in some states, absent in Kerala, and contested in Tamil Nadu's DMK rise).
- **Major opposition:** Socialist Party (Jayaprakash Narayan, Ram Manohar Lohia), CPI, Jana Sangh (Syama Prasad Mookerjee), Swatantra Party (C. Rajagopalachari, 1959 — free-market, anti-licence), Bharatiya Jana Sangh. Opposition's role: kept democratic competition alive despite limited wins — "genuine multiparty competition existed within one-party dominance".
- **Nehru's era context:** Planning Commission (1950), First Five-Year Plan focus on agriculture, the debate over the Second Plan (Mahalanobis, industry) — background to "politics of planned development".

## 3. Worked example (analysis pattern)
Q: "Congress dominance was democratic because…" — the standard answer: elections were free and regularly held; opposition contested and won state power (Kerala 1957); dominance rested on consent + accommodation of interests, not coercion; internal factions made Congress a "rainbow coalition".

## 4. Common mistakes & exam traps
- Confusing the FIRST non-Congress state government (Kerala, 1957) with the first non-Congress central government (1977, Janata).
- Attributing Congress's dominance only to T.T. Krishnamachari/Kamaraj "syndicate" — the syndicate mattered later (Indira era).
- Swatantra Party founded in 1959 (not 1952); Jana Sangh in 1951.
- 1967 elections (non-Congress coalitions in many states) belong to the NEXT topic — do not mix them into 1952–62.

## 5. Revision summary
Three elections with seat numbers, Kerala 1957, uneven state dominance, factional/consensual nature, four named opposition parties with founders. CUET asks year–event pairing and the "democratic dominance" analysis.`, [OFFICIAL_SYLLABUS_REF]),
]
