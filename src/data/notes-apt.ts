// ─────────────────────────────────────────────────────────────────────────────
// BEAN EXAMS — Original study notes (canonical library): Aptitude, Reasoning,
// English, Computer, Banking awareness and NEET/JEE foundational topics.
// ─────────────────────────────────────────────────────────────────────────────

import type { NoteSeed } from './notes-gs'

const mk = (canonical: string, title: string, markdown: string): NoteSeed => ({ canonical, title, markdown })

export const NOTES_APT: NoteSeed[] = [
  mk('aptitude-percentages', 'Percentages — Concepts, Shortcuts & Traps', `## 1. Concept
A percentage expresses a number as a fraction of 100. "x% of N" = (x/100) × N. It underlies profit-loss, interest, discounts and data interpretation.

## 2. Definitions
- Percentage change = (New − Old)/Old × 100.
- Multiplier method: +20% ⇒ ×1.2; −20% ⇒ ×0.8. Consecutive changes multiply.

## 3. Key equivalences
| Fraction | % | Fraction | % |
|---|---|---|---|
| 1/2 | 50% | 1/6 | 16.67% |
| 1/3 | 33.33% | 1/8 | 12.5% |
| 1/4 | 25% | 1/9 | 11.11% |
| 1/5 | 20% | 1/12 | 8.33% |

## 4. Worked examples
1. A price rises from ₹250 to ₹300: change = 50/250 = **20%**.
2. A number is increased by 20% then decreased by 20% → net = 1.2 × 0.8 = 0.96 → **4% decrease** (not zero!).
3. If A is 25% more than B, then B is 20% less than A (100/125 = 0.8).

## 5. Formulas
- Successive change: a + b + ab/100.
- If price rises r% and consumption must keep expenditure constant, reduce consumption by r/(100+r) × 100%.

## 6. Common mistakes & exam traps
- +x% then −x% is **not** net zero — use the multiplier.
- Comparing percentages of different bases — always check the base.
- "Decreased by 25% then increased by 20%" ⇒ net 10% decrease (0.75 × 1.2 = 0.9).

## 7. Revision summary
Memorise the fraction–% table; use multipliers; successive changes multiply; convert "more/less than" carefully both ways.

## 8. Related questions
Practice the Percentages topic test after revising this note.`),

  mk('aptitude-ratio', 'Ratio & Proportion', `## 1. Concept
A ratio a : b compares two quantities; a proportion states equality of two ratios (a:b = c:d ⇔ ad = bc).

## 2. Definitions
- **Direct proportion**: x/y constant. **Inverse proportion**: xy constant.
- **Mean proportional** between a and b = √(ab). **Third proportional** to a, b = b²/a.

## 3. Worked examples
1. Divide ₹720 in ratio 2:3:4 → total parts 9 → ₹160, ₹240, ₹320.
2. Incomes 3:4, expenditures 2:3, each saves ₹600 → income 3x − 2y = 600, 4x − 3y = 600 → x = 600, y = 600 → incomes ₹1800, ₹2400.
3. Mixture 3:5 milk-water; add 8 L water → ratio 3:7 → 2 parts = 8 L → milk = 12 L.

## 4. Key techniques
- Scaling: ratios must refer to the **same base** before combining (e.g., a:b, b:c → a:b:c via LCM of b's).
- Partners' profit share = investment × time (compound partnership).

## 5. Common mistakes & exam traps
- Combining a:b and b:c without equalising b.
- Ratio of speeds with equal distances: ratio of times is inverse.
- Adding the same quantity to both terms changes the ratio (unless equal).

## 6. Revision summary
Proportion cross-multiplies; divide-by-parts; inverse proportion for work/speed; equalise common terms before merging ratios.`),

  mk('aptitude-average', 'Averages', `## 1. Concept
Average = Sum of observations / Number of observations. Most problems are about adding or removing members and recomputing sums.

## 2. Formulas
- New average after replacing one value v with v': A' = A + (v' − v)/n.
- Average of first n natural numbers = (n+1)/2.
- Weighted average = Σ(wx)/Σw.

## 3. Worked examples
1. Average of 11 numbers is 50. One number 60 is replaced by 86 → new average = 50 + 26/11 = **52.36** (576/11).
2. Average age of 30 students is 12; teacher included → average becomes 13 → teacher's age = 13×31 − 12×30 = **43**.
3. Average of odd numbers between 1 and 99 = average of 1..99 odds = 50.

## 4. Common mistakes & exam traps
- Forgetting the **count** changes when a member is added/removed.
- Average speed is NOT the average of speeds unless times are equal — use total distance/total time (harmonic mean for equal distances).

## 5. Revision summary
Average ↔ total conversion (sum = A × n); replacement formula; weighted averages; harmonic mean for equal-distance speed problems.`),

  mk('aptitude-number-system', 'Number System & Divisibility', `## 1. Concept
The number system covers integers, factors, multiples, remainders, LCM/HCF and divisibility rules.

## 2. Definitions
- HCF × LCM = product of two numbers (for two numbers only).
- **Divisibility rules**: 2 (even), 3 (digit sum), 4 (last two digits), 5 (0/5), 8 (last three), 9 (digit sum), 11 (alternating sum).
- **Unit digit cycles**: powers of 2 cycle 2,4,8,6; 3 cycle 3,9,7,1; 7 cycle 7,9,3,1; 8 cycle 8,4,2,6; 4 cycle 4,6; 9 cycle 9,1.

## 3. Worked examples
1. Remainder of 7¹⁰⁰ ÷ 6: 7 ≡ 1 (mod 6) → remainder **1**.
2. Unit digit of 3^47: 47 mod 4 = 3 → cycle position 3 → **7**.
3. LCM of 12, 18, 24 = 72; HCF = 6.

## 4. Common mistakes & exam traps
- HCF×LCM = a×b holds only for TWO numbers.
- 0 is neither positive nor negative; 1 is neither prime nor composite.
- Divisibility by 6 requires both 2 and 3.

## 5. Revision summary
Divisibility table; unit-digit cycles (period 4); modular remainders via substitution; LCM/HCM relations; prime factorisation tools.`),

  mk('aptitude-time-work', 'Time & Work', `## 1. Concept
If a person finishes a job in n days, their one-day work = 1/n. Combined rates add; wages divide in proportion to work done.

## 2. Formulas
- A in a days, B in b days → together = ab/(a+b) days.
- Pipes filling/draining: rates add/subtract; net rate = fill − empty.
- Work equivalence: M₁D₁H₁/W₁ = M₂D₂H₂/W₂.

## 3. Worked examples
1. A: 12 days, B: 18 days → together 12×18/30 = **7.2 days**.
2. Pipe fills in 6 h, drain empties in 9 h → net 1/6 − 1/9 = 1/18 → **18 h**.
3. A & B in 8 days, B & C in 12, A & C in 10 → (1/8+1/12+1/10)/2 = A+B+C rate = 7/60 → all three ≈ **8.57 days**.

## 4. Common mistakes & exam traps
- Rates add, not times.
- Alternate-day work: track per 2-day cycle, then handle the remainder day.
- Efficiency ratio A:B = 3:4 ⇒ time ratio A:B = 4:3 (inverse).

## 5. Revision summary
One-day work 1/n; combined = product/sum; LCM method for many workers; pipes with negative rates; MDH equivalence.`),

  mk('aptitude-time-speed-distance', 'Time, Speed & Distance', `## 1. Concept
Speed = Distance/Time. Units: km/h ↔ m/s conversion ×5/18 and ×18/5.

## 2. Formulas
- Relative speed: opposite directions add; same direction subtract.
- Trains crossing poles/platforms: distance = train length / (train length + platform length).
- Boats: downstream = b + s; upstream = b − s (b boat, s stream).
- Equal distances: average speed = 2xy/(x+y).

## 3. Worked examples
1. 90 km/h = 25 m/s. A 150 m train at 90 km/h crosses a 250 m platform in (150+250)/25 = **16 s**.
2. Boat 10 km/h, stream 2 km/h, 24 km downstream → 24/12 = **2 h**.
3. Two trains 120 m & 80 m, opposite directions, 54 & 36 km/h → relative 25 m/s → time 200/25 = **8 s**.

## 4. Common mistakes & exam traps
- Forgetting to convert units (km/h vs m/s).
- Average speed with unequal times ≠ arithmetic mean.
- Clock problems: hands coincide every 65 5/11 minutes.

## 5. Revision summary
S = D/T triangle; unit conversion; relative speeds for trains; boats with stream; equal-distance harmonic mean; races (head starts) as distance offsets.`),

  mk('aptitude-profit-loss', 'Profit & Loss', `## 1. Concept
Profit = SP − CP; Profit% = Profit/CP × 100. Discounts act on Marked Price (MP): SP = MP × (1 − d/100).

## 2. Key relations
- SP = CP × (1 + p/100). CP from SP: CP = SP/(1+p/100).
- Mark-up m% then discount d% ⇒ net = (1+m)(1−d) − 1.
- Successive discounts multiply: 20% and 10% ⇒ 0.8 × 0.9 = 0.72 ⇒ 28% total.

## 3. Worked examples
1. CP ₹800, SP ₹920 → profit 15%.
2. MP ₹1000, discounts 20% then 10% → SP ₹720.
3. Sold at 8% loss; if sold for ₹112 more, 8% profit → CP = 112/0.16 = **₹700**.

## 4. Common mistakes & exam traps
- Profit% is on CP (for merchants); discount% is on MP — never mix bases.
- Two discounts do not add.
- False-weight problems: gain% = (error/(true − error)) × 100.

## 5. Revision summary
CP/SP/MP chain; multiplier method; successive discounts; loss-to-profit price-gap problems; dishonest dealer formula.`),

  mk('aptitude-si-ci', 'Simple & Compound Interest', `## 1. Concept
SI is linear; CI compounds each period. SI = Pnr/100 (n years, r%). CI amount = P(1 + r/100)ⁿ.

## 2. Formulas
- CI − SI for 2 years = P(r/100)².
- Half-yearly compounding: rate/2, periods ×2. Quarterly: rate/4, periods ×4.
- Effective annual rate for r% half-yearly = (1 + r/200)² − 1.

## 3. Worked examples
1. P=₹5000, r=10%, 2 yrs: SI = 1000; CI = 5000(1.21) − 5000 = **₹1050**; difference = 50 = 5000(0.1)².
2. ₹8000 doubles in 4 years SI → rate = 100/4 = 25%.
3. CI 3 years at 10% on ₹1000 → 1331 → CI = **₹331**.

## 4. Common mistakes & exam traps
- Doubling time via SI: n = 100/r (not via 72 rule — that's for CI approximation).
- Forgetting period conversion for half-yearly/quarterly.
- CI on fractions of years needs mixed calculation (full periods compounded + SI on remainder).

## 5. Revision summary
SI linear; CI geometric; CI−SI = P(r/100)² for 2 years; period adjustments; doubling approximations (72/r for CI).`),

  mk('aptitude-simplification', 'Simplification, Approximation & BODMAS', `## 1. Concept
Simplification questions test fast arithmetic under BODMAS: Brackets → Orders → Division/Multiplication → Addition/Subtraction (left to right within a tier).

## 2. Techniques
- Digit-sum checks, last-digit checks for products.
- Algebraic identities: (a+b)² = a²+2ab+b²; a²−b² = (a−b)(a+b); (a+b)³ = a³+b³+3ab(a+b); a³+b³ = (a+b)(a²−ab+b²).
- Vedic-style: (100+x)(100+y) = 10000 + 100(x+y) + xy.

## 3. Worked examples
1. 25 × 4.04 = 25 × 4 + 25 × 0.04 = 100 + 1 = **101**.
2. 999² = (1000−1)² = 998001.
3. √(1089) = 33 (33² = 1089).

## 4. Common mistakes & exam traps
- Ignoring BODMAS order in mixed expressions.
- Squaring binomials: forgetting the 2ab term.
- Square roots of non-perfect squares need approximation to the given tolerance.

## 5. Revision summary
BODMAS discipline; identities toolkit; last-digit/digit-sum sanity checks; approximation with tolerance; squares/cubes up to 30 memorised.`),

  mk('aptitude-data-interpretation', 'Data Interpretation — Tables, Charts & Percentage Analysis', `## 1. Concept
DI presents data in tables, bar/line/pie charts and asks for shares, growth, ratios and averages. Speed comes from reading **percentages of totals** and approximating.

## 2. Method
1. Read the title, axes, units and footnotes FIRST.
2. Compute the grand total once; store sub-totals.
3. Prefer percentage-share arithmetic over raw division: share = part/total × 100.
4. For pie charts: degrees → share = angle/360.

## 3. Worked example
Sales: A 120, B 80, C 60 (total 260). B's share = 80/260 ≈ **30.8%**. Growth of total if A grows 10%: new total = 132+80+60 = 272 → +4.6%.

## 4. Common mistakes & exam traps
- Mixing units (thousands vs lakhs) — always note the scale.
- Answering from a different year/series than asked.
- Growth% needs the **base year** as denominator.

## 5. Revision summary
Title-axes-units first; totals & shares; angle/360 for pies; growth vs share; approximation saves time — keep 2 significant digits.`),

  mk('aptitude-measurement', 'Units, Conversion & Simple Machines', `## 1. Concept
SI units and conversions appear in TNPSC and other state exams' aptitude sections along with basic machine mechanics.

## 2. Key units & conversions
- Length: 1 km = 1000 m; 1 m = 100 cm; 1 inch = 2.54 cm; 1 mile = 1.609 km.
- Area: 1 hectare = 10⁴ m²; 1 acre ≈ 4047 m²; 1 km² = 100 ha.
- Volume: 1 L = 1000 cm³; 1 m³ = 1000 L.
- Mass: 1 tonne = 1000 kg; 1 quintal = 100 kg; 1 lb ≈ 0.4536 kg.
- Time/other: 1 knot = 1.852 km/h; 1 horsepower ≈ 746 W.

## 3. Simple machines
- Lever classes: I (fulcrum between load & effort — seesaw), II (load between — wheelbarrow), III (effort between — tongs).
- Mechanical advantage = Load/Effort; pulleys change direction or multiply force.
- Inclined plane reduces effort at the cost of distance.

## 4. Common mistakes & exam traps
- Confusing mass (kg) and weight (newton) — weight = mg.
- 1 hectare vs 1 acre size (ha is ~2.47 acres).
- Units in answers — always carry the unit through calculation.

## 5. Revision summary
SI prefixes (kilo/milli); length-area-volume-mass conversions; three lever classes; MA = load/effort; unit discipline.`),

  mk('reasoning-series', 'Number & Letter Series', `## 1. Concept
Series questions ask for the next term or the odd one out. Patterns combine arithmetic operations, primes, squares, alternation and letter positions (A=1 … Z=26).

## 2. Common patterns
- Arithmetic (+d), geometric (×r), alternating (+a, −b), difference-of-differences, squares/cubes ± k, primes.
- Letter series: positional arithmetic (A, D, G → +3), reverse alphabet, vowel-consonant patterns.
- Alphanumeric: mix letter shift + digit pattern.

## 3. Worked examples
1. 2, 6, 12, 20, 30 → differences 4,6,8,10 → next 42.
2. 3, 6, 12, 24 → ×2 → next 48.
3. AZ, CX, EV → letters +2 forward, −2 backward → next GT.

## 4. Method
1. Check differences; if not constant, check ratios; then second differences.
2. Test squares/cubes/primes offsets.
3. For letters, write positions; look for ±k or mirror (A+Z=27).

## 5. Common mistakes & exam traps
- Stopping at the first pattern that fits two terms — verify with all terms.
- Off-by-one on letter positions (A=1).
- Alternating series need two interleaved subsequences.

## 6. Revision summary
Differences → ratios → second differences → special offsets; letter positions with mirror arithmetic; check the whole series.`),

  mk('reasoning-coding', 'Coding & Decoding', `## 1. Concept
A word is encoded by shifts, reversals, positional sums or substitutions; you must infer the rule from examples and apply it.

## 2. Common rules
- Shift cipher: each letter ±k (e.g., CAT → ECV is +2).
- Reverse the word; reverse each letter's position (AZ↔ZA mirror: A→Z).
- Positional arithmetic: sum of letter values; word ↔ number mapping.
- Substitution by other words (A is called B).

## 3. Worked example
If RAIL = 181912, then code = letter positions (R=18, A=1, I=9, L=12). So ROAD = 18,15,1,4 → 181514.

## 4. Method
1. Compare letter-by-letter; compute shifts; check consistency.
2. Try reversal and mirror next.
3. For number codes, test position values, then sums/products.

## 4b. Common mistakes & exam traps
- Assuming one global shift when only some letters shift.
- Ignoring the mirror operation (A↔Z, B↔Y…).
- Case sensitivity in mixed codes.

## 5. Revision summary
Shift → reverse → mirror → positional arithmetic; verify rule on every given pair before applying.`),

  mk('reasoning-blood-relations', 'Blood Relations', `## 1. Concept
You must map family statements into a tree. Draw generations, mark gender, and answer from the diagram — never from the sentence alone.

## 2. Standard notations
- + male, − female; = couple; vertical = generation. Use "+" only where stated or implied.
- Key phrases: "maternal grandfather" = mother's father; "paternal uncle" = father's brother; "only daughter/son" matters.

## 3. Worked example
"A is B's sister. C is B's mother. D is C's father. E is D's mother." → A female; C mother of A&B; D = C's father; E = D's mother = C's grandmother. Question: how is A related to D? → **granddaughter**.

## 4. Method
1. Identify the two people in the question; find the connecting chain.
2. Build the tree top-down; fix genders explicitly.
3. Re-read for "only", "in-law", "maternal/paternal".

## 5. Common mistakes & exam traps
- Assuming gender from names.
- Mixing up in-law relations (spouse's side vs blood side).
- Coded relations (A+B means A is father of B) need a translation table first.

## 6. Revision summary
Tree-first approach; explicit gender marks; keyword dictionary; coded-relation translation tables.`),

  mk('reasoning-directions', 'Direction Sense', `## 1. Concept
Track a walker's turns and distances on a rough compass diagram (N top, E right). Net displacement gives the final direction/distance.

## 2. Method
1. Draw step by step; mark each turn (left/right relative to current facing).
2. Compute net north-south and east-west offsets; use Pythagoras for distance.
3. Shadow-based questions: morning shadow points west; evening — east.

## 3. Worked example
Walk 3 km N, turn right, 4 km E → displacement = √(3²+4²) = **5 km north-east**.

## 4. Common mistakes & exam traps
- Rotating the compass incorrectly after turns.
- Confusing "towards left" (absolute) with "turns left" (relative).
- Forgetting to add distances for opposite-direction legs (net offset).

## 5. Revision summary
Compass sketch per move; relative turns; net offsets + Pythagoras; shadow directions; final-facing questions need the last turn only.`),

  mk('reasoning-syllogism', 'Syllogism & Logical Deduction', `## 1. Concept
Syllogisms give premises; you test which conclusions MUST follow. Use Venn diagrams with minimal-overlap and maximum-overlap checks.

## 2. Statement types
- All A are B; No A is B; Some A are B; Some A are not B.
- Conclusions must hold in EVERY valid diagram to be "definitely true".

## 3. Worked example
Statements: All pens are books. Some books are copies.
Conclusions: (I) Some pens are copies — NOT definite (draw minimal overlap). (II) Some copies are books — follows (converse of "some").

## 4. Key rules
- "All A are B" ⇒ Some B are A (converse holds).
- "No A is B" ⇒ No B is A.
- "Some A are B" ⇒ Some B are A; nothing about "not".
- Possibility cases: check the maximal diagram.

## 5. Common mistakes & exam traps
- Converting "All" to "All" illegally.
- Treating "Some A are not B" as implying "Some B are not A" — it does not.
- Forgetting "either–or" conclusions (complementary pairs).

## 6. Revision summary
Venn minimal/maximal; converse rules; possibility questions; complementary either-or pairs.`),

  mk('reasoning-puzzles', 'Puzzles & Seating Arrangements', `## 1. Concept
Linear/circular seating and scheduling puzzles give a set of constraints; build a fixed grid and eliminate.

## 2. Method
1. Fix the frame: positions 1..n (linear) or clock positions (circular).
2. Place definite information first (e.g., "A sits at an end").
3. Branch only when forced; strike off contradictions.
4. Left/right in circular puzzles: assume viewer's perspective unless stated.

## 3. Worked example
5 people in a row; C is middle; A is left of C; B is right of C; D adjacent to A; E must take the remaining seat → row: D A C B? Check adjacency: D adjacent to A works if D1 A2 C3 B4 E5 — but E5 is fine. Verify all clues before finalising.

## 4. Common mistakes & exam traps
- Assuming more than the clues state (never infer directions facing the centre unless given).
- Ignoring "not necessarily in order" clauses.
- Losing track of relative vs absolute positions ("3rd to the left of X").

## 5. Revision summary
Frame → definite clues → elimination → branch minimally; circular left/right conventions; count-based (floor/puzzle-day) grids follow the same method.`),

  mk('english-grammar', 'English Grammar Essentials: Tenses, Articles & Prepositions', `## 1. Concept
Grammar questions test tense consistency, article choice (a/an/the), preposition collocations and subject-verb agreement.

## 2. Key rules
- **Tenses**: present perfect (have + V3) links past to present; past perfect (had + V3) for the earlier of two past events; since + point of time, for + period.
- **Articles**: "a" before consonant sounds, "an" before vowel sounds (an hour, a university); "the" for unique/specific/superlative.
- **Subject-verb agreement**: each/every → singular; "either…or" verb agrees with the nearer subject; collective nouns usually singular.
- **Prepositions**: good at, fond of, married to, capable of, deal in (trade)/deal with (conduct), die of (disease)/die from (cause).

## 3. Common mistakes & exam traps
- "One of the + plural noun + singular verb".
- Double negatives; redundant pairs ("return back").
- Tense shifts within a paragraph — check the time frame.

## 4. Revision summary
Tense timeline; article sound-rule; agreement with each/every/either-or; high-frequency preposition pairs; error-spotting scan order: verb → article → preposition → agreement.`),

  mk('english-vocabulary', 'Vocabulary: Synonyms, Antonyms, Idioms & One-word Substitutions', `## 1. Concept
Vocabulary sections test synonyms, antonyms, idioms, phrasal verbs, spelling and one-word substitutions. Build from roots and high-frequency exam lists.

## 2. High-frequency items
- Idioms: "a blessing in disguise" (hidden benefit), "burn the midnight oil" (work late), "beat around the bush" (avoid the point), "a red-letter day" (important day).
- One-word: "misogynist" (hater of women), "philanthropist" (lover of mankind), "omnivorous" (eats everything), "epitaph" (inscription on a tomb).
- Phrasal verbs: call off (cancel), put off (postpone), look into (investigate), bring up (raise a topic/children).
- Roots: bene- (good), mal- (bad), scrib/script (write), port (carry), vid/vis (see).

## 3. Method
- Synonym questions: check the word's register and part of speech; eliminate the antonym and unrelated choices first.
- Antonym: watch for two-step words (disinterested ≠ uninterested).

## 4. Common mistakes & exam traps
- "Disinterested" = impartial; "uninterested" = bored — classic trap.
- Idiom meaning vs literal reading.
- Spelling traps: accommodate, embarrass, occurrence, necessary.

## 5. Revision summary
Root-based learning; idiom list review; phrasal-verb pairs; one-word substitutions; the disinterested/uninterested distinction.`),

  mk('english-comprehension', 'Reading Comprehension Strategy', `## 1. Concept
RC passages test main idea, inference, vocabulary-in-context and tone. Accuracy comes from reading the questions with the passage, not memory.

## 2. Method (3 passes)
1. Skim the passage (30–45 s) — topic, structure, author's stance.
2. Read the question stem; locate the line/paragraph anchor (keywords, names, dates).
3. Answer from the anchor; for inference, pick the option that follows necessarily, not merely possibly.

## 3. Question types
- Main idea: usually in the first/last paragraph; avoid over-specific or over-broad options.
- Inference: "must be true" standard.
- Vocabulary-in-context: replace with each option; the sentence must keep meaning.
- Tone: sarcastic, neutral, critical, appreciative — watch adjectives.

## 4. Common mistakes & exam traps
- Choosing an option that is true in the world but not stated/derivable in the passage.
- Extreme words (always, never, only) are usually wrong for inference questions.
- Ignoring negative stems ("EXCEPT", "NOT").

## 5. Revision summary
Skim → anchor → answer; main idea from structure; necessary-inference standard; extreme-word elimination; EXCEPT handling.`),

  mk('english-error-spotting', 'Error Spotting & Sentence Improvement', `## 1. Concept
Error-spotting questions hide one grammatical error per sentence: agreement, tense, article, preposition, pronoun case, or redundancy.

## 2. Scan order (fastest to slowest)
1. **Verb**: tense/number consistency.
2. **Agreement**: subject–verb, pronoun–antecedent.
3. **Article/preposition** collocations.
4. **Comparison**: than/as…as structure; comparatives.
5. **Word form**: noun/adjective/verb suffixes; redundancy.

## 3. Worked examples
- "Each of the boys were present" → **was** (each…singular).
- "He is senior than me" → **senior to me** (Latin comparatives take 'to').
- "The scissors is on the table" → **are** (plural-only noun).

## 4. Common mistakes & exam traps
- Collective nouns ("team is/are") — singular when acting as one unit.
- "Less" for uncountable, "fewer" for countable.
- Pronoun after than/as: "taller than I (am)" in formal usage.

## 5. Revision summary
Verb-first scan; agreement chain; collocation dictionary; comparison structures; redundancy detection.`),

  mk('computer-basics', 'Computer Fundamentals & MS Office', `## 1. Concept
Computer-awareness questions cover hardware, software, memory hierarchy, networks, internet basics and MS Office shortcuts.

## 2. Key facts
- Generations: vacuum tube → transistor → IC → microprocessor → AI (5th).
- **Memory**: RAM volatile; ROM non-volatile; cache fastest; 1 KB = 1024 B (binary) though marketing uses 1000; 1 GB = 1024 MB.
- **Hardware terms**: CPU (ALU + CU + registers); motherboard; ports — USB, HDMI; printer types (inkjet, laser).
- **Software**: system (OS — Windows, Linux, Android) vs application (MS Word); open source vs proprietary.
- **Networks**: LAN/WAN; IP address; DNS; HTTP/HTTPS; email protocols (SMTP send, POP3/IMAP receive); WWW ≠ Internet.
- **Office shortcuts**: Ctrl+C/V/X/Z, Ctrl+B/I/U, Ctrl+S save, F7 spell-check, Ctrl+F find, Alt+Tab switch.
- **Security**: malware types (virus, worm, trojan, ransomware, phishing), firewall, antivirus; strong passwords.

## 3. Common mistakes & exam traps
- WWW is a service on the Internet, not the Internet itself.
- SMTP sends mail; POP3/IMAP receive it.
- RAM vs ROM volatility; cache vs virtual memory.

## 4. Revision summary
Generations; memory hierarchy; hardware/software classification; network & internet vocabulary; Office shortcuts; security terminology.`),

  mk('banking-awareness', 'Banking Terminology & Products', `## 1. Concept
Banking exams' awareness section tests products, rates and regulatory bodies beyond core RBI concepts.

## 2. Key terms
- **NEFT/RTGS/IMPS/UPI**: retail and instant payment rails (UPI by NPCI, 2016).
- **KYC**: Know Your Customer — Aadhaar/PAN based verification.
- **Types of accounts**: savings, current, fixed, recurring, NRI (NRE/NRO/FCNR).
- **Loans**: secured/unsecured, EMI, moratorium, top-up; MCLR/EBLR-linked lending rates.
- **NBFC vs Bank**: NBFCs cannot accept demand deposits or issue cheques.
- **Regulators**: RBI (banks), SEBI (securities), IRDAI (insurance), PFRDA (pensions).
- **PSL**: priority sector lending 40% ANBC; agriculture & MSME sub-targets.

## 3. Common mistakes & exam traps
- RTGS minimum ₹2 lakh; NEFT has no minimum.
- Repo vs reverse repo direction of funds.
- NRE (tax-free, repatriable) vs NRO (taxable) accounts — frequently swapped.

## 4. Revision summary
Payment rails; KYC; account and loan types; NBFC limits; regulator map; PSL basics.`),

  mk('neet-bio-cell', 'Cell: The Unit of Life (NEET Foundation)', `## 1. Concept
The cell theory (Schleiden & Schwann; Virchow: omnis cellula-e cellula) states all organisms are made of cells arising from pre-existing cells. Prokaryotes lack a true nucleus and membrane organelles; eukaryotes have both.

## 2. Organelles & functions
- **Mitochondria**: double membrane, cristae, 70S ribosomes, own DNA — ATP via oxidative phosphorylation.
- **Chloroplast**: grana (thylakoids) + stroma; photosynthesis; 70S ribosomes + DNA (semiautonomous).
- **Endoplasmic reticulum**: rough (ribosomes, protein synthesis), smooth (lipids, detoxification).
- **Golgi**: packaging/glycosylation; lysosome: hydrolytic enzymes (acid hydrolases); ribosome: 70S (prokaryote) / 80S (eukaryote).
- **Cytoskeleton**: microtubules (tubulin), microfilaments (actin), intermediate filaments.
- **Cell wall**: cellulose (plants), chitin (fungi), peptidoglycan (bacteria); absent in animals.

## 3. Membrane
Fluid mosaic model (Singer & Nicolson, 1972): phospholipid bilayer with intrinsic/extrinsic proteins; selective permeability; diffusion, osmosis, facilitated transport, Na⁺/K⁺ pump (active).

## 4. Common mistakes & exam traps
- 70S vs 80S ribosomes (S = Svedberg, not size sum).
- Mitochondria/chloroplast DNA is circular like prokaryotes.
- Amoeba/paramecium: contractile vacuole for osmoregulation.

## 5. Revision summary
Cell theory; prokaryote vs eukaryote; organelle function map; fluid mosaic model; semiautonomous organelles.

## 6. References
- NCERT Biology Class 11 chapter summary (via public educational sources).`),

  mk('neet-bio-human-physiology', 'Breathing & Exchange of Gases (NEET Foundation)', `## 1. Concept
Human respiration: pulmonary ventilation → alveolar gas exchange → transport → tissue exchange. Breathing is driven by the diaphragm and intercostal muscles under medullary control.

## 2. Key facts
- **Volumes**: tidal ~500 mL; IRV ~2500–3000; ERV ~1000–1100; RV ~1100–1200; vital capacity = TV+IRV+ERV; total lung capacity ~5800–6000 mL.
- **Exchange**: alveoli (~300 million; ~70 m² surface); PO₂ alveoli 104 mm Hg vs blood 40 → O₂ diffuses in; CO₂ diffuses out (pCO₂ 45 vs 40).
- **Transport**: O₂ — 97% as oxyhaemoglobin (HbO₂); CO₂ — 70% as bicarbonate (carbonic anhydrase), 20–25% as carbaminohaemoglobin, 7% dissolved.
- **Regulation**: respiratory rhythm centre (medulla); pneumotaxic centre (pons) moderates; chemosensors for CO₂/H⁺ (central — medulla; peripheral — aortic/carotid bodies).
- **Disorders**: asthma (bronchoconstriction), emphysema (alveolar damage), COPD, occupational lung disorders (silicosis, asbestosis).

## 3. Common mistakes & exam traps
- Oxygen dissociation curve is sigmoid; Bohr effect = right shift with high CO₂/H⁺/temperature.
- CO₂ mainly travels as bicarbonate, not carbaminohaemoglobin.
- Respiratory centre is in the medulla, not the cerebellum.

## 4. Revision summary
Volume definitions; partial-pressure gradients; Hb transport percentages; bicarbonate reaction; centres of regulation; disorders list.

## 5. References
- NCERT Biology summary via public educational sources.`),

  mk('neet-chem-mole-concept', 'Some Basic Concepts & the Mole (NEET Foundation)', `## 1. Concept
A mole contains 6.022×10²³ (Avogadro's number, N_A) particles. Molar mass in grams equals the molecular mass in amu. Stoichiometry uses balanced equations and limiting reagents.

## 2. Key formulas
- n = m/M = N/N_A = V(STP)/22.4 L (for gases at STP, molar volume 22.4 L per older convention; 22.7 L at 1 bar).
- Molarity M = n/V(L); Molality m = n/kg solvent — molality is temperature-independent.
- Mass percent = mass solute/mass solution × 100; mole fraction x_i = n_i/Σn.

## 3. Worked example
Moles in 9.8 g H₂SO₄ (M = 98) = 0.1 mol → molecules = 6.022×10²² → H atoms = 2×0.1 = 0.2 mol = 1.204×10²³.

## 4. Limiting reagent
Convert all reactants to moles; divide by stoichiometric coefficients; the smallest ratio limits the reaction; calculate product from it.

## 5. Common mistakes & exam traps
- STP definitions differ (0 °C & 1 atm → 22.4 L; 0 °C & 1 bar → 22.7 L) — check the paper's convention.
- Molality uses solvent mass, molarity uses solution volume.
- Empirical vs molecular formula (molecular = n × empirical).

## 6. Revision summary
Mole triangle (mass↔moles↔particles↔volume); concentration modes; limiting reagent algorithm; STP conventions.`),

  mk('neet-physics-kinematics', 'Kinematics: Motion in a Straight Line & Plane (Foundation)', `## 1. Concept
Kinematics describes motion without forces: position, velocity, acceleration. For uniform acceleration: v = u + at, s = ut + ½at², v² = u² + 2as.

## 2. Key ideas
- Slope of x–t graph = velocity; slope of v–t graph = acceleration; area under v–t = displacement.
- Projectile (θ above horizontal): R = u² sin2θ/g (max at 45°); H = u² sin²θ/2g; T = 2u sinθ/g. At the top: v_y = 0, speed = u cosθ.
- Relative velocity: v_AB = v_A − v_B; river-boat problems combine vectors head-to-tail.
- Free fall: g ≈ 9.8 m/s² downward; mass-independent.

## 3. Worked example
Ball thrown up at 20 m/s: time to top = u/g = 2 s; max height = u²/2g = 20.4 m; returns to hand after 4 s with speed 20 m/s.

## 4. Common mistakes & exam traps
- Displacement vs distance — displacement can be zero over a closed path.
- Using v² = u² + 2as when acceleration isn't constant.
- Dropping the sign convention (take one direction positive throughout).

## 5. Revision summary
Three equations of motion; graph slopes/areas; projectile trio; relative velocity vectors; free-fall symmetry (up = down times).`),

  mk('physics-units-dimensions', 'Units, Dimensions & Measurement', `## 1. Concept
The SI system has seven base units. Dimensional analysis checks equations, converts units and finds relations — but cannot find dimensionless constants.

## 2. Base SI units
| Quantity | Unit | Symbol |
|---|---|---|
| Length | metre | m |
| Mass | kilogram | kg |
| Time | second | s |
| Current | ampere | A |
| Temperature | kelvin | K |
| Amount | mole | mol |
| Luminous intensity | candela | cd |

## 3. Derived dimensions
- Force: MLT⁻² (newton); Work/Energy: ML²T⁻² (joule); Power: ML²T⁻³ (watt); Pressure: ML⁻¹T⁻² (pascal); Charge: IT (coulomb); Planck's constant: ML²T⁻¹.

## 4. Applications
- Check homogeneity: each term must share dimensions.
- Unit conversion: multiply by (old/new) factor raised to each dimension.
- Count significant figures: non-zero digits significant; zeros between significant.

## 5. Common mistakes & exam traps
- Dimensional analysis can't validate dimensionless factors (½, 2π).
- Angles are dimensionless (radian).
- Light-year is a **distance** unit; candela is luminous intensity, not brightness of a lamp's surface.

## 6. Revision summary
Seven base units; derived dimension table; homogeneity check; conversion via dimension powers; significant-figure rules.`,
  ),
]
