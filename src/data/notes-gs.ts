// ─────────────────────────────────────────────────────────────────────────────
// BEAN EXAMS — Original study notes (canonical library, General Studies).
// All notes are original BEAN EXAMS content, structured for exam learning:
// concept → definitions → key facts → examples → formulas/tables → common
// mistakes → revision summary → references. Attached to matching topics.
// ─────────────────────────────────────────────────────────────────────────────

export interface NoteSeed {
  canonical: string
  title: string
  markdown: string
  sourceRefs?: { label: string; url: string }[]
}

const mk = (canonical: string, title: string, markdown: string, sourceRefs?: { label: string; url: string }[]): NoteSeed =>
  ({ canonical, title, markdown, sourceRefs })

const WIKI = (slug: string) => ({ label: 'Wikipedia — ' + slug.replace(/_/g, ' '), url: `https://en.wikipedia.org/wiki/${slug}` })

export const NOTES_GS: NoteSeed[] = [
  mk('polity-constitution', 'Making of the Constitution & the Preamble', `## 1. Concept
The Constitution of India is the supreme law of the land. It was framed by the Constituent Assembly (formed 1946) over 2 years, 11 months and 18 days, adopted on **26 November 1949**, and came into force on **26 January 1950**. Dr B. R. Ambedkar chaired the Drafting Committee; Dr Rajendra Prasad was Assembly President.

## 2. Definitions
- **Constitution**: the fundamental law defining the structure, powers and duties of government organs and the rights of citizens.
- **Preamble**: the introductory statement declaring the source of authority ("We, the People of India") and the ideals: Sovereign, Socialist, Secular, Democratic, Republic; Justice, Liberty, Equality, Fraternity.
- **Socialist / Secular / Integrity** were added by the **42nd Amendment (1976)**.

## 3. Key facts
- Borrowed features: Parliamentary government (Britain), Fundamental Rights (USA), Directive Principles (Ireland), Federalism with strong Centre (Canada), Concurrent List (Australia), Emergency provisions (Germany), Amendment procedure (South Africa).
- Article 368 deals with amendment. Amendments need special majority; some also need ratification by half the states.
- The Constitution originally had 395 articles, 22 parts and 8 schedules; today it has 12 schedules.

## 4. Examples & applications
- "Republic" means the head of state is elected (Article 52: the President of India).
- Objective Resolution (1946) by Jawaharlal Nehru became the basis of the Preamble.

## 5. Quick table
| Item | Detail |
|---|---|
| Adopted | 26 Nov 1949 |
| In force | 26 Jan 1950 |
| Drafting Committee chair | Dr B. R. Ambedkar |
| Assembly President | Dr Rajendra Prasad |
| Longest written constitution | Yes (as originally framed) |

## 6. Common mistakes & exam traps
- Confusing "adopted" (26 Nov 1949) with "came into force" (26 Jan 1950).
- Thinking the Preamble is justiciable — courts treat it as non-justiciable but part of the Constitution (Kesavananda Bharati, 1973).
- Believing "Socialist" implies state ownership only — Indian socialism is a democratic mixed-economy model.

## 7. Revision summary
Constituent Assembly → adopted 26 Nov 1949 → in force 26 Jan 1950. Preamble expresses ideals; 42nd Amendment added three words; Kesavananda made it part of the basic structure.

## 8. References
- Original text via the National Portal of India (india.gov.in) — Constituent Assembly Debates summaries.
- Wikipedia: Constitution of India.`, [WIKI('Constitution_of_India')]),

  mk('polity-fundamental-rights', 'Fundamental Rights, Duties & Directive Principles', `## 1. Concept
Part III of the Constitution (Articles 12–35) guarantees **Fundamental Rights (FRs)** — justiciable rights enforceable against the State. Part IV contains **Directive Principles of State Policy (DPSP)** — non-justiciable guidelines for governance. Part IV-A (Article 51A) lists **Fundamental Duties** (originally 10, now 11 after the 86th Amendment, 2002).

## 2. Definitions
- **Article 12**: defines "the State" (Government, Parliament, legislatures, local and other authorities).
- **Article 13**: laws inconsistent with FRs are void — basis of judicial review.
- **Writs**: Habeas Corpus, Mandamus, Prohibition, Certiorari, Quo Warranto.

## 3. The six Fundamental Rights
1. **Article 14** — Equality before law and equal protection of laws.
2. **Article 19** — Six freedoms (speech, assembly, association, movement, residence, profession).
3. **Article 21** — Protection of life and personal liberty; expanded by courts to include privacy, education, clean environment.
4. **Article 25–28** — Freedom of religion.
5. **Article 29–30** — Cultural and educational rights.
6. **Article 32** — Right to constitutional remedies (Ambedkar: "the heart and soul of the Constitution").

## 4. Key facts
- **Right to Property** was removed from FRs by the 44th Amendment (1978); it is now a legal right under Article 300A.
- DPSP highlights: Article 39 (equal pay), 40 (village panchayats), 44 (uniform civil code), 45/21A (education — 86th Amendment made elementary education a fundamental right under Article 21A).
- FRs available mostly to citizens only; some (Articles 14, 20, 21, 32) also protect foreigners.

## 5. Common mistakes & exam traps
- Article 21 is enforceable against the State **and** (after later rulings) has expanded reach — but classic answer: FRs protect against State action, not private individuals, except Articles 17 and 23.
- DPSPs are non-justiciable — no court can enforce them, but they are fundamental in governance (Article 37).
- 11 Fundamental Duties (not 10) — Article 51A(k) on parents providing education opportunities was added in 2002.

## 6. Revision summary
FRs = justiciable, Part III, six rights, Article 32 remedies. DPSPs = non-justiciable ideals, Part IV. Duties = Part IV-A, Article 51A, 11 duties. Property right moved to Article 300A by 44th Amendment.

## 7. References
- National Portal of India — Know India: Constitution. Wikipedia: Fundamental Rights in India.`, [WIKI('Fundamental_Rights_in_India')]),

  mk('polity-union-executive', 'Union Executive: President, Vice-President, PM & Council of Ministers', `## 1. Concept
The Union Executive comprises the President, Vice-President, Prime Minister, Council of Ministers and the Attorney-General. India has a **parliamentary** executive: the real executive is the Council of Ministers headed by the Prime Minister, while the President is the constitutional head who acts on aid and advice (Article 74).

## 2. Definitions
- **President**: constitutional head; elected by an Electoral College (elected MPs + elected MLAs of states incl. Delhi, Puducherry & J&K), via proportional representation by single transferable vote.
- **Impeachment** (Article 61): for "violation of the Constitution" — initiated in either House with 1/4th members' notice, 14-day notice, 2/3rd majority of the House.
- **Ordinance** (Article 123): President may promulgate when Parliament is not in session; must be approved within 6 weeks of reassembly.

## 3. Key facts
- Qualification: citizen of India, 35 years, qualified as an MP. Term 5 years; salary charged on Consolidated Fund.
- Vice-President: elected by both Houses (elected members only); ex-officio Chairman of Rajya Sabha.
- PM: appointed by President; leader of majority in Lok Sabha. Council of Ministers collectively responsible to the **Lok Sabha** (Article 75(3)).
- Total number of ministers including PM shall not exceed **15% of Lok Sabha strength** (91st Amendment, 2003).
- Veto power: absolute, suspensive (returns bill once), and pocket veto (no time limit for assent).

## 4. Examples & applications
- Article 356 President's Rule: imposed in a state on Governor's report — needs parliamentary approval within 2 months, valid 6 months (max 3 years with conditions).
- A money bill needs President's recommendation in Lok Sabha; President cannot return a money bill (no suspensive veto).

## 5. Common mistakes & exam traps
- President is elected indirectly — NOT by popular vote.
- Impeachment applies only for "violation of the Constitution" — not incompetence.
- Ministers can be appointed without being legislators for only **6 months**.

## 6. Revision summary
President = constitutional head, elected indirectly, ordinances under Art 123, veto types. PM & CoM = real executive, collective responsibility to Lok Sabha, 15% cap.

## 7. References
- Wikipedia: President of India; National Portal of India.`, [WIKI('President_of_India')]),

  mk('polity-parliament', 'Parliament: Lok Sabha & Rajya Sabha', `## 1. Concept
Parliament (Articles 79–122) consists of the **President, Lok Sabha and Rajya Sabha**. Lok Sabha is the popular house (max 550 members as per original provision; current 543 elected); Rajya Sabha is the Council of States (max 250; 238 elected + 12 nominated).

## 2. Definitions
- **Quorum**: 1/10th of total members.
- **Money Bill** (Article 110): contains only matters of taxation, borrowing, Consolidated/Contingency Fund; certified by the Speaker.
- **Joint sitting** (Article 108): called by President to resolve deadlocks on ordinary bills — never for Money Bills or Constitutional Amendment Bills.

## 3. Key facts
- Lok Sabha term: 5 years (dissolvable). Rajya Sabha: permanent house; 1/3rd retire every 2 years; members serve 6 years.
- Speaker: elected by Lok Sabha; resigns to Deputy Speaker; casting vote in ties.
- Rajya Sabha special powers: Article 249 (state-list legislation in national interest), Article 312 (All-India Services).
- Sessions: at least two sessions per year (practically three: Budget, Monsoon, Winter); gap between sessions cannot exceed 6 months.
- Bills: Ordinary → both houses; Money → Lok Sabha only, Rajya Sabha must return in 14 days with recommendations.

## 4. Examples & applications
- No-confidence motion: only in Lok Sabha, needs 50 members' support.
- Question Hour (first hour), Zero Hour (immediately after, Indian innovation).

## 5. Common mistakes & exam traps
- Rajya Sabha CANNOT amend or reject a Money Bill — only recommend (14 days).
- Joint sittings: only 3 so far (Dowry Prohibition 1960, Banking Service Commission Repeal 1977, POTA 2002).
- The President is part of Parliament but not a member of either House.

## 6. Revision summary
Lok Sabha = 543, 5 years, money bills originate, no-confidence. Rajya Sabha = permanent, federal house, Art 249/312 powers. Quorum 1/10; joint sitting Art 108.

## 7. References
- National Portal of India — Parliament; Wikipedia: Parliament of India.`, [WIKI('Parliament_of_India')]),

  mk('polity-judiciary', 'Judiciary: Supreme Court & High Courts', `## 1. Concept
An integrated judiciary with the **Supreme Court (Articles 124–147)** at the apex and High Courts (Articles 214–231) below, plus subordinate courts. The SC is the guardian of the Constitution and the highest court of appeal.

## 2. Definitions
- **Judicial review**: power to examine laws/executive acts for constitutional validity (Articles 13, 32, 226).
- **Basic Structure Doctrine**: Kesavananda Bharati (1973) — Parliament cannot amend the basic structure (supremacy of Constitution, secularism, judicial review etc.).
- **PIL (Public Interest Litigation)**: widened locus standi so any public-spirited person may approach the court.

## 3. Key facts
- SC: 1 Chief Justice + 33 other judges (34 total). Appointed by President; collegium system recommends.
- Qualifications: citizen + judge of HC for 5 years, or HC advocate for 10 years, or distinguished jurist.
- Judge tenure: SC — until 65; HC — until 62. Removal: proved misbehaviour/incapacity by Parliament (Judges Inquiry Act 1968).
- Original jurisdiction (Article 131): Centre–state/state–state disputes. Appellate: constitutional, civil, criminal. Advisory (Article 143): President may refer questions.
- Article 141: SC law binding on all courts. Article 142: complete justice decrees.

## 4. Examples & applications
- Landmark cases: Kesavananda (1973 basic structure), Maneka Gandhi (1977 due process in Art 21), Minerva Mills (1980 balance FR–DPSP).

## 5. Common mistakes & exam traps
- SC sits in Delhi only; can hold office elsewhere with CJI approval.
- High Court judges appointed by President after consultation (collegium); writ jurisdiction of HC (Art 226) is **wider** than SC's (Art 32).

## 6. Revision summary
SC = Art 124, 34 judges, original/appellate/advisory jurisdiction, Art 141 binding. Basic structure = Kesavananda. HC = Art 214, writs under 226.

## 7. References
- Wikipedia: Supreme Court of India; National Portal of India.`, [WIKI('Supreme_Court_of_India')]),

  mk('polity-panchayati-raj', 'Panchayati Raj & Local Governance', `## 1. Concept
The **73rd Constitutional Amendment (1992)** gave constitutional status to Panchayati Raj Institutions (PRIs); the **74th** did the same for Urban Local Bodies (municipalities). Balwant Rai Mehta Committee (1957) recommended the three-tier system; Ashok Mehta Committee (1977) recommended two-tier.

## 2. Definitions
- **Three-tier system**: Gram Panchayat (village) → Panchayat Samiti (block) → Zila Parishad (district).
- **State Election Commission**: conducts PRI elections (Article 243K).
- **Gram Sabha**: all registered voters of a village — the foundation of PRIs (Article 243A).

## 3. Key facts
- Direct elections at all three levels; indirect chairpersons allowed at intermediate/district levels.
- 5-year term; elections within 6 months of dissolution.
- Reservation: SC/ST in proportion to population; **not less than one-third for women** (many states give 50%).
- 29 subjects in the Eleventh Schedule (73rd Amendment); 18 subjects in Twelfth Schedule (74th).
- Tamil Nadu: implemented from 1994; three-tier rural local bodies + village panchayats as units of self-government.

## 4. Examples & applications
- Article 243G: Panchayats as "institutions of self-government" for economic development and social justice planning.
- Finance Commission (Article 280) recommends state–local fiscal devolution.

## 5. Common mistakes & exam traps
- Panchayats were non-justiciable DPSP (Art 40) before 1992 — the amendment inserted Part IX with Articles 243–243O.
- Gram Sabha exists only at village level; not an elected body.

## 6. Revision summary
73rd/74th Amendments 1992, Part IX/XI schedules (11th/12th), three tiers, SEC conducts polls, 1/3rd+ women reservation, 29/18 subjects.

## 7. References
- Wikipedia: Panchayati raj in India; National Portal of India.`, [WIKI('Panchayati_raj_in_India')]),

  mk('polity-constitutional-bodies', 'Constitutional & Statutory Bodies', `## 1. Concept
Constitutional bodies derive their existence from the Constitution; statutory bodies from Acts of Parliament; executive bodies from government resolutions. Exams test the distinction plus compositions and functions.

## 2. Key bodies (constitutional)
- **Election Commission of India (Article 324)**: superintendence, direction and control of elections; CEC + other ECs (CEC and other ECs have equal powers; CEC removal like a SC judge, other ECs on CEC's recommendation).
- **UPSC (Articles 315–323)**: recruitment to central services; members appointed for 6 years or 65 years.
- **Finance Commission (Article 280)**: every 5 years; recommends tax devolution; chairman + 4 members.
- **CAG (Articles 148–151)**: audits accounts of Union and states; 6 years or 65; reports to President/Governor laid before legislature via PAC.
- **Attorney-General (Article 76)**: legal advisor to Government of India; right to speak in Parliament, no vote.
- **NITI Aayog**: NOT constitutional or statutory — executive resolution (2015), replaced the Planning Commission.

## 3. Key facts
- Official Languages under the Eighth Schedule: 22 languages.
- NCSC (Art 338), NCST (338A), NCBC (338B — statutory body given constitutional status by 102nd Amendment, 2018).
- Special Officer for Linguistic Minorities (350B).

## 4. Common mistakes & exam traps
- NITI Aayog and National Human Rights Commission (statutory, PHRA 1993) are NOT constitutional bodies.
- CAG is an officer of Parliament, not of the executive; audits but does not prepare budgets.

## 5. Revision summary
Constitutional: ECI, UPSC, Finance Commission, CAG, AG. Statutory: NHRC, NCBC (pre-2018), CBI (executive resolution). NITI Aayog = executive.

## 6. References
- National Portal of India; Wikipedia: Comptroller and Auditor General of India.`, [WIKI('Comptroller_and_Auditor_General_of_India')]),

  mk('polity-tn-administration', 'Administration of Tamil Nadu — Structure & Governance', `## 1. Concept
Tamil Nadu follows the standard state constitutional structure (Governor, CM & Council of Ministers, Legislative Assembly, High Court) with a **unicameral** legislature (Legislative Assembly only — the Legislative Council was abolished in 1986 and has not been revived).

## 2. Key facts
- **Legislature**: Tamil Nadu Legislative Assembly — 234 elected members + 1 nominated Anglo-Indian (nomination lapsed after 2020 amendment to Constitution). Term: 5 years.
- **Governor**: appointed by President; chancellor of state universities; appoints CM.
- **Administrative divisions**: 38 districts, each led by a District Collector (revenue and development head); Revenue Divisional Officers and Tahsildars below.
- **Local government**: corporations (Greater Chennai Corporation is India's oldest, est. 1688), municipalities, town panchayats and village panchayats.
- **Secretariat**: Fort St. George, Chennai; departments headed by Additional Chief Secretaries/Secretaries under the CM.
- **State subjects of note**: land revenue, police, public health, agriculture, irrigation (state list).

## 3. TN-specific features frequently asked
- TNPSC conducts recruitment to state services (Group 1, 2/2A, 4 etc.).
- TN has pioneered midday meals (introduced nationally from TN's pilot),universal nutrition schemes and extensive e-governance (e-Sevai centres).
- Chief Minister's Breakfast Scheme (2022) and Pudhumai Penn (2022) are frequently asked current-affairs items.

## 4. Common mistakes & exam traps
- TN is unicameral — do not mark "Legislative Council exists" unless a revival is formally notified.
- District Collector vs District Judge: different offices (revenue vs judiciary).

## 5. Revision summary
Unicameral 234-member Assembly; 38 districts; Fort St George secretariat; TNPSC for recruitment; strong local-body network; welfare-scheme pioneer.

## 6. References
- National Portal of India — Tamil Nadu state page (india.gov.in).`, [WIKI('Tamil_Nadu')]),

  mk('history-ancient', 'Ancient India: Indus Valley to the Guptas', `## 1. Concept
Ancient Indian history spans prehistoric cultures, the **Indus Valley Civilization (c. 2600–1900 BCE)**, the Vedic age, the rise of **Mahajanapadas**, the Mauryan Empire, the post-Mauryan period and the **Gupta "golden age"** (c. 320–550 CE).

## 2. Key facts by period
- **Indus Valley**: discovered 1921 (Harappa, by Daya Ram Sahni). Cities: Harappa, Mohenjo-daro, Dholavira, Lothal (dockyard), Kalibangan (ploughed field). Features: grid town planning, drainage, seals, no large temples. Great Bath — Mohenjo-daro.
- **Vedic age**: Rig Veda (oldest); later Vedas, Brahmanas, Upanishads. Society: varna system crystallised. Iron ("Krishna Ayas") in later Vedic period.
- **Mahajanapadas**: 16 states; Magadha rose under Bimbisara, Ajatashatru (Haryanka dynasty).
- **Mauryas (322–185 BCE)**: Chandragupta (with Chanakya's guidance), **Ashoka the Great** — Kalinga war (261 BCE) → Dhamma. **Megasthenes' Indica** describes the court. Edicts in Prakrit (Brahmi script mostly; deciphered by James Prinsep 1837).
- **Guptas (c. 320–550 CE)**: Chandragupta I, Samudragupta (Prayag Prashasti by Harisena), Chandragupta II (Vikramaditya; Fa-Hien visited). Culture: Aryabhata, Kalidasa, Nalanda. Land grants signal feudal trends.

## 3. Quick table
| Ruler | Famous for |
|---|---|
| Ashoka | Kalinga war, edicts, Buddhism spread |
| Kanishka | Kushan dynasty, 4th Buddhist council |
| Samudragupta | "Napoleon of India" (V. A. Smith) |
| Harshavardhana | Hiuen Tsang (Xuanzang) visited, Kannauj |

## 4. Common mistakes & exam traps
- Indus people did NOT know the horse extensively or the iron age — no iron tools found.
- Ashoka's inscriptions are in **Prakrit**, not Sanskrit (some in Kharoshthi/Greek/Aramaic at northwest edges).
- "Golden age" label for Guptas is a generalisation — exams may test its critique (position of women, slavery).

## 5. Revision summary
IVC 2600–1900 BCE → Vedic → Mahajanapadas → Mauryas (Ashoka/Kalinga) → Kushanas → Guptas (science & literature) → Harsha. Remember sites, travellers, and scripts.

## 6. References
- Wikipedia: Indus Valley Civilisation; Maurya Empire.`, [WIKI('Indus_Valley_Civilisation')]),

  mk('history-medieval', 'Medieval India: Delhi Sultanate to the Mughals', `## 1. Concept
Medieval India (c. 1206–1707+ and beyond) covers the **Delhi Sultanate (1206–1526)**, Vijayanagara and Bahmani kingdoms, and the **Mughal Empire (1526–1857 nominally)**.

## 2. Key facts
- **Delhi Sultanate dynasties**: Slave/Mamluk (1206–1290: Qutb-ud-din Aibak, Iltutmish — first to issue Tanka silver coin; Razia — first woman ruler of Delhi), Khalji (Alauddin — market control, Dagh & Chehra), Tughlaq (Muhammad bin Tughlaq — capital transfer to Daulatabad, token currency; Firoz Shah — canals, hospitals), Sayyid, Lodi (first Afghan dynasty).
- **Vijayanagara (1336–1646)**: founded by Harihara & Bukka (Sangama brothers); Krishnadeva Raya (Tuluva) — Amuktamalyada; Hampi (UNESCO site); foreign travellers: Nicolo Conti, Abdur Razzaq, Domingo Paes.
- **Mughals**: Babur (First Battle of Panipat 1526, gunpowder), Akbar (Din-i-Ilahi, Mansabdari, land revenue by Todar Mal, abolished jizya 1564), Jahangir (Sir Thomas Roe 1615), Shah Jahan (Taj Mahal, Peacock Throne), Aurangzeb (expansion peak; jizya re-imposed 1679).
- **Sikhism**: Guru Nanak (1469–1539); Adi Granth compiled by Guru Arjan; Khanda by Guru Gobind Singh (1699).

## 3. Quick table
| Event | Year |
|---|---|
| First Battle of Panipat | 1526 |
| Battle of Talikota (Vijayanagara decline) | 1565 |
| Second Battle of Panipat | 1556 |
| Battle of Plassey | 1757 |

## 4. Common mistakes & exam traps
- Akbar abolished jizya in 1564; Aurangzeb re-imposed it in 1679 — do not swap.
- Iltutmish, not Qutb-ud-din Aibak, was the real consolidator of the Sultanate.
- Qutb Minar begun by Aibak, completed by Iltutmish.

## 5. Revision summary
Sultanate dynasties in order → Alauddin's market reforms → Tughlaq experiments → Vijayanagara & Hampi → Mughals from Panipat 1526 → Akbar's administration → decline after Aurangzeb.

## 6. References
- Wikipedia: Delhi Sultanate; Mughal Empire.`, [WIKI('Delhi_Sultanate')]),

  mk('history-modern', 'Modern India: Company Rule to Independence', `## 1. Concept
Modern Indian history covers Company expansion (1757–1858), Crown rule (1858–1947), socio-religious reform, the national movement and independence with Partition.

## 2. Key timeline
- 1757 **Battle of Plassey** — Robert Clive; foundation of Company power in Bengal.
- 1764 Buxar → Diwani rights 1765 (revenue of Bengal, Bihar, Orissa).
- 1857 **Revolt of 1857**: began at Meerut (10 May); Mangal Pandey at Barrackpore; Bahadur Shah II proclaimed; Governor-General **Canning**. Result: Government of India Act 1858 — Crown rule, Secretary of State, Viceroy.
- Socio-religious reform: **Brahmo Samaj (Raja Rammohan Roy, 1828)**, Arya Samaj (Dayananda Saraswati, 1875), Prarthana Samaj (Atmaram Pandurang, 1867), Ramakrishna Mission (Vivekananda, 1897), Aligarh Movement (Sir Syed Ahmed Khan), Theosophical Society (Adyar 1882, Annie Besant).
- 1885 **Indian National Congress** founded by A. O. Hume; first president W. C. Bonnerjee, Bombay session.
- 1905 Partition of Bengal → Swadeshi movement; 1906 Muslim League; 1909 Morley–Minto (separate electorates); 1919 Rowlatt Act, Jallianwala Bagh (13 April, General Dyer); Khilafat & Non-Cooperation 1920–22 (withdrawn after Chauri Chaura); Simon Commission 1928; **Purna Swaraj resolution 1929 (Lahore)**; Civil Disobedience & Dandi March (12 March–6 April 1930); Gandhi–Irwin Pact 1931; GoI Act 1935; Quit India **8 August 1942**; Cabinet Mission 1946; Mountbatten Plan 3 June 1947; **Independence 15 August 1947**.

## 3. Quick table
| Movement | Leader | Year |
|---|---|---|
| Non-Cooperation | Gandhi | 1920 |
| Civil Disobedience (Dandi) | Gandhi | 1930 |
| Quit India | Gandhi | 1942 |
| Salt Satyagraha (TN, Vedaranyam) | C. Rajagopalachari | 1930 |

## 4. Common mistakes & exam traps
- Jallianwala Bagh: 13 April 1919, Amritsar, ordered by Dyer — not Curzon-Wythe.
- Chauri Chaura (1922) ended Non-Cooperation; Bhagat Singh executed 23 March 1931 (Lahore conspiracy).
- The INC's first session was in Bombay (Gokuldas Tejpal Sanskrit College), 1885.

## 5. Revision summary
Plassey → 1857 → reform societies → INC 1885 → Surat split 1907 → Gandhi era (NCM, CDM, QIM) → 1947 independence with Partition.

## 6. References
- Wikipedia: Indian independence movement; National Portal of India.`, [WIKI('Indian_independence_movement')]),

  mk('history-tn', 'Tamil Nadu History & Culture', `## 1. Concept
Tamil Nadu's history spans the **Sangam age** (c. 300 BCE–300 CE), the Pallavas, Imperial Cholas, Pandyas, Nayaks and the colonial era — with distinctive language, temple culture and social movements.

## 2. Key facts by period
- **Sangam age**: three assemblies at Madurai under Pandya patronage; literature: Tolkappiyam (grammar), Ettuthogai, Pattupattu; "Muvendar" = Chera, Chola, Pandya. Ports: Puhar (Kaveripoompattinam), Muziris (Chera). Roman trade with Yavana merchants.
- **Pallavas of Kanchi (c. 275–897 CE)**: Mahendra Varman, Narasimhavarman I (Mamalla; defeated Pulakesin II — Vatapi conquest), shore temple & rathas at **Mahabalipuram (UNESCO)**; Kailasanatha temple, Kanchipuram.
- **Imperial Cholas (848–1279)**: Vijayalaya Chola founded Thanjavur line; **Rajaraja I** — Brihadeeswara temple (1010, UNESCO); **Rajendra I** — Gangetic expedition (title Gangaikonda Chola), naval expedition to Srivijaya; local self-government: **Uttaramerur inscriptions** (kudavolai system); bronze iconography (Nataraja).
- **Pandyas revival**: Maravarman Sundara Pandya; Marco Polo visited (c. 1292).
- **Nayaks & Marathas**: Madurai Nayaks (Thirumalai Nayak palace), Thanjavur Marathas (Serfoji II — Sarasvati Mahal library).
- **Colonial & modern**: Carnatic wars, Company rule; Justice Party (1916, social justice), Periyar E. V. Ramasamy's Self-Respect Movement (1925), anti-Hindi agitations, Dravidian political legacy.

## 3. Quick table
| Landmark | Builder/Period |
|---|---|
| Brihadeeswara Temple, Thanjavur | Rajaraja I (1010 CE) |
| Gangaikonda Cholapuram | Rajendra I |
| Meenakshi Temple gopurams | Nayak period |
| Shore Temple, Mahabalipuram | Narasimhavarman II (Rajasimha) |

## 4. Common mistakes & exam traps
- Kudavolai (pot-ticket) elections are attested at **Uttaramerur** — often misattributed to Thanjavur.
- Rajendra I's naval expedition targeted **Srivijaya (Southeast Asia)**, not the Gangetic plains — that was the land expedition.
- Sangam corpus is classical Tamil, not later devotional literature.

## 5. Revision summary
Sangam (Muvendar) → Pallavas (Mamallapuram) → Cholas (temple + navy + local govt) → Pandyas → Nayaks → colonial era → social-justice movements.

## 6. References
- Wikipedia: Chola dynasty; Great Living Chola Temples.`, [WIKI('Chola_dynasty')]),

  mk('history-national-movement', 'Indian National Movement — Phases & Personalities', `## 1. Concept
The national movement evolved through phases: Moderate (1885–1905), Extremist/Swadeshi (1905–1919), Gandhian mass movements (1919–1942), and revolutionary & socialist currents throughout.

## 2. Phase-wise facts
- **Moderates**: Dadabhai Naoroji ("Grand Old Man"; drain theory — *Poverty and Un-British Rule in India*), Gopal Krishna Gokhale (Servants of India Society 1905), Pherozeshah Mehta. Methods: petitions, prayers, constitutionalism.
- **Extremists**: Lal–Bal–Pal (Lajpat Rai, Tilak — "Swaraj is my birthright", Bipin Pal), Aurobindo Ghosh; Surat Split 1907; Swadeshi boycott after Bengal Partition (20 July 1905 announced; effective 16 Oct 1905).
- **Revolutionaries**: Anushilan Samiti, HSRA (Bhagat Singh, Rajguru, Sukhdev — Saunders killing 1928, Assembly bomb 1929), Chittagong armoury raid (Surya Sen, 1930), Kakori (Ram Prasad Bismil, 1925). Abhinav Bharat (Savarkar). Madam Cama unfurled flag at Stuttgart (1907).
- **Gandhian movements**: Champaran (1917, indigo), Ahmedabad mill (1918), Kheda (1918); Non-Cooperation (1920–22), Civil Disobedience (1930–34), Quit India (1942) — "Do or Die".
- **Left & others**: CPI 1925; Congress Socialist Party 1934 (JP, Lohia); INA (Subhas Chandra Bose — "Give me blood…", Azad Hind, Rani Jhansi regiment — Capt. Lakshmi Sahgal).
- **TN personalities**: C. Rajagopalachari (Vedaranyam March 1930; last Governor-General of India), K. Kamaraj, V. O. Chidambaram Pillai (Swadeshi Steam Navigation Company 1906), Subramania Bharati.

## 3. Common mistakes & exam traps
- Swaraj Party (1923) was formed by Motilal Nehru & C. R. Das to enter councils — not to boycott.
- Gandhi called off NCM after **Chauri Chaura** (Feb 1922); Bhagat Singh was hanged in **1931**.
- First Indian to demand complete independence in a Congress session context: Jawaharlal Nehru's Lahore session (1929) — Purna Swaraj resolution.

## 4. Revision summary
Moderates → Extremists → Gandhi's mass movements → revolutionary stream → INA & 1942 → transfer of power 1947. Know year, place, leader triplets.

## 5. References
- Wikipedia: Indian National Congress; Quit India Movement.`, [WIKI('Indian_independence_movement')]),

  mk('geography-india', 'India: Physical Geography, Rivers & Climate', `## 1. Concept
India (32.87 lakh km²) lies between **8°4'–37°6' N** and 68°7'–97°25' E, divided into the Himalayas, Northern Plains, Peninsular Plateau, Thar Desert, Coastal Plains and Islands. The **Tropic of Cancer** divides the country almost in half.

## 2. Relief & drainage
- **Himalayas**: three ranges (Greater/Himadri, Lesser/Himachal, Shiwaliks); passes: Nathu La (Sikkim), Bomdi La, Shipki La. Highest: K2 in POK region (MT Godwin Austen), highest fully in India: Kangchenjunga (Sikkim).
- **Northern Plains**: formed by Indus, Ganga, Brahmaputra alluvium.
- **Peninsular rivers** (non-perennial): Godavari ("Dakshina Ganga", 1465 km), Krishna, Kaveri (origin Talakaveri), Narmada & Tapi (west-flowing into rift valleys, estuaries), Mahanadi. **Himalayan rivers** perennial: Ganga (Bhagirathi + Alaknanda meet at Devprayag), Yamuna, Brahmaputra (Tsangpo in Tibet; Dihang in Arunachal).
- Waterfalls: Jog (Sharavathi), Dhuandhar (Narmada), Hogenakkal (Kaveri).

## 3. Climate
- **Monsoon**: SW monsoon (Arabian Sea branch + Bay of Bengal branch) — onset Kerala ~1 June; retreat in October; NE monsoon (Oct–Dec) is the key rainy season for Tamil Nadu & Coromandel coast.
- Mawsynram (Meghalaya) — wettest place in India; western disturbance gives winter rain to NW India.
- **Soils**: alluvial (largest, ~43%), black/regur (cotton, Deccan), red, laterite (tea/coffee), arid, forest/mountain.

## 4. Quick table
| River | Origin | Key fact |
|---|---|---|
| Godavari | Trimbakeshwar (Nashik) | Longest peninsular river |
| Narmada | Amarkantak | Flows through rift valley |
| Kaveri | Talakaveri (Karnataka) | Kallanai (Grand Anicut) built by Karikala Chola |
| Brahmaputra | Kailash region (Tsangpo) | Majuli — largest river island |

## 5. Common mistakes & exam traps
- Narmada and Tapi flow **west** and form estuaries, not deltas.
- The NE monsoon, not SW, gives Tamil Nadu its main rainfall.
- Kanchenjunga is India's highest peak **within India**; K2 lies in Pakistan-occupied Gilgit-Baltistan.

## 6. Revision summary
Six physiographic divisions; Tropic of Cancer; perennial Himalayan vs seasonal peninsular rivers; monsoon mechanism; soil types with crops.

## 7. References
- Wikipedia: Geography of India; National Portal of India — Know India.`, [WIKI('Geography_of_India')]),

  mk('geography-tn', 'Geography of Tamil Nadu', `## 1. Concept
Tamil Nadu (130,058 km²) lies in the extreme south of the peninsula, bounded by Kerala, Karnataka, Andhra Pradesh and the Bay of Bengal, with the Eastern and Western Ghats and the Nilgiris meeting at the tri-junction.

## 2. Key facts
- **Mountains**: Nilgiris (Doddabetta 2637 m — highest in TN), Anamalai & Palani hills; Palghat and Shencottah gaps.
- **Rivers**: Kaveri (enters TN at Hogenakkal; delta — Thanjavur "rice bowl"), Vaigai (Madurai), Thamirabarani (the only TN river originating in TN — Pothigai hills), Thenpennai (South Pennar). Mettur dam (1934) on Kaveri — largest in TN.
- **Climate**: tropical; **NE monsoon (Oct–Dec) contributes ~48% of annual rain**; summer (SW monsoon) limited by rain-shadow of Western Ghats.
- **Agriculture**: paddy (delta), sugarcane, cotton (Coimbatore belt), tea/coffee (Nilgiris), coconut; Horticulture: mango (Salem/Dharmapuri).
- **Minerals**: lignite (Neyveli), limestone, magnesite (Salem), garnet (Tuticorin), beach sands (Kanyakumari), graphite.
- **Coasts**: Coromandel coast; Gulf of Mannar Marine National Park; Point Calimere wildlife sanctuary.
- **Census/demographics**: ~7.26 crore population (2011); Chennai, Coimbatore, Madurai are major cities.

## 3. Quick table
| Item | Detail |
|---|---|
| Highest peak | Doddabetta (Nilgiris) |
| Largest dam | Mettur (Stanley Reservoir) |
| Main monsoon | North-East (Oct–Dec) |
| River born fully inside TN | Thamirabarani |

## 4. Common mistakes & exam traps
- TN's rice rainfall season is **NE monsoon** — SW monsoon largely misses the interior due to the Western Ghats rain shadow.
- Neyveli = **lignite** (not coal) — NLCIL runs it.
- Kallanai/Grand Anicut is on the Kaveri (built by Karikala Chola, renovated by the British).

## 5. Revision summary
Doddabetta; Kaveri–Mettur–delta; NE monsoon dominance; lignite at Neyveli; Coromandel coast; Gulf of Mannar biodiversity.

## 6. References
- National Portal of India — Tamil Nadu; Wikipedia: Geography of Tamil Nadu.`, [WIKI('Tamil_Nadu')]),

  mk('geography-world', 'World Geography Essentials', `## 1. Concept
World geography for competitive exams focuses on continents, oceans, latitudes, climate zones, deserts, rivers and notable countries/landmarks.

## 2. Key facts
- Continents by area: Asia > Africa > North America > South America > Antarctica > Europe > Australia. Oceans: Pacific > Atlantic > Indian > Southern > Arctic.
- **Important lines**: Equator, Tropic of Cancer/Capricorn (23.5°), Arctic/Antarctic Circles (66.5°). Prime Meridian (0°) passes through Greenwich; International Date Line ~180°.
- Longest river: Nile (with Amazon disputed in some measures); largest by discharge: Amazon. Longest in Asia: Yangtze.
- Deserts: Sahara (largest hot), Atacama (driest), Gobi (cold). Highest peak: Everest (8,849 m); largest island: Greenland; largest lake: Caspian Sea; deepest: Lake Baikal; largest freshwater lake by area: Lake Superior.
- Climates (Köppen): tropical, dry, warm temperate, cold, polar — monsoon climate in South Asia.

## 3. Quick table
| Feature | Location |
|---|---|
| Great Barrier Reef | Australia (Coral Sea) |
| Victoria Falls | Zambia–Zimbabwe (Zambezi) |
| Panama Canal | Connects Atlantic–Pacific |
| Suez Canal | Connects Mediterranean–Red Sea |

## 4. Common mistakes & exam traps
- Sahara is the largest **hot** desert; Antarctica is the largest desert overall (cold desert).
- The International Date Line is not exactly 180° — it zig-zags around territories.

## 5. Revision summary
Continents/oceans order, latitude lines, superlatives (Nile/Amazon/Everest/Greenland/Caspian/Baikal), canals and reefs.

## 6. References
- Wikipedia: Geography portal.`, [WIKI('Geography')]),

  mk('economy-basics', 'Indian Economy: Basics, Planning & Budgeting', `## 1. Concept
India is a **mixed economy** (private + public sectors) with a federal fiscal structure. Key macro concepts: GDP/GNP, fiscal deficit, inflation, planning history and the annual Budget.

## 2. Definitions
- **GDP**: value of final goods/services produced **within** India. **GNP**: GDP + net factor income from abroad.
- **Fiscal deficit**: Total expenditure − total receipts (excluding borrowings). **Revenue deficit**: revenue expenditure > revenue receipts.
- **Inflation**: sustained price rise; India targets **CPI inflation of 4% ± 2%** (RBI's flexible inflation targeting, amended mandate 2016).

## 3. Key facts
- Planning: Planning Commission (1950) → **NITI Aayog (1 Jan 2015)**, an executive think-tank; Five-Year Plans ended with the 12th Plan (2012–17).
- Historic landmarks: 1991 New Economic Policy — Liberalisation, Privatisation, Globalisation (LPG); GST launched **1 July 2017** (101st Constitutional Amendment); demonetisation Nov 2016.
- Budget: presented 1 February (since 2017); railway budget merged with Union budget. Fiscal year: 1 April–31 March.
- Tax structure: direct (income tax, corporate tax) and indirect (GST slabs 0/5/12/18/28%); GST Council under Article 279A.
- Poverty & programmes: MGNREGA (2005, 100 days guaranteed wage employment); PM-KISAN; Ayushman Bharat (PM-JAY).

## 4. Quick table
| Term | Meaning |
|---|---|
| Repo rate | RBI lending rate to banks |
| CRR | Cash banks keep with RBI (% of NDTL) |
| SLR | Statutory liquid assets (% of NDTL) |
| Base year CPI | 2012 (CPI-Combined) |

## 5. Common mistakes & exam traps
- NITI Aayog is NOT a constitutional or statutory body.
- Fiscal deficit includes capital receipts excluding borrowings — don't confuse with revenue deficit.
- GST replaced excise, service tax, VAT etc., but **petroleum products, alcohol, electricity** remain outside GST.

## 6. Revision summary
Mixed economy → Planning Commission to NITI Aayog → 1991 LPG reforms → GST 2017 → Budget on 1 Feb → deficits, inflation targeting, key schemes.

## 7. References
- Press Information Bureau (pib.gov.in); Wikipedia: Economy of India.`, [WIKI('Economy_of_India')]),

  mk('economy-banking', 'Banking System & the Reserve Bank of India', `## 1. Concept
India follows a regulated multi-bank structure with the **Reserve Bank of India (est. 1 April 1935, nationalised 1949)** as the central bank and monetary authority.

## 2. Key facts
- RBI established on the recommendation of the **Hilton Young Commission**; originally privately owned, nationalised in 1949. Head office: Mumbai.
- Banks: commercial (public sector — SBI & associates, nationalised banks; private; foreign; RRBs; cooperative) + NBFCs + payments banks/small finance banks.
- Nationalisation milestones: 14 banks in **1969**, 6 in 1980. SBI created 1955 (Imperial Bank), associates merged with SBI in 2017–2020.
- **Monetary policy instruments**: Repo & reverse repo (now SDF/MSF corridor), CRR, SLR, OMOs, Bank Rate, MSF. Monetary Policy Committee (6 members) sets repo target for 4% CPI ± 2%.
- Priority sector lending: agriculture, MSMEs, education, housing, weaker sections, renewable energy — 40% of ANBC for commercial banks.
- Deposit insurance: DICGC up to ₹5 lakh per depositor per bank (2019 amendment).

## 3. Quick table
| Term | Current meaning |
|---|---|
| SDF | Standing Deposit Facility — RBI absorbs liquidity (floor) |
| MSF | Marginal Standing Facility — emergency borrowing (ceiling) |
| M1 | Currency + demand deposits + other deposits with RBI |
| NEFT/RTGS | Retail / large-value (RTGS min ₹2 lakh) transfer systems |

## 4. Common mistakes & exam traps
- RBI is the government's banker and debt manager, but **issues currency except ₹1 note** (₹1 note issued by Government of India, signed by Finance Secretary).
- Repo is the policy rate; Bank Rate is different (aligned with MSF) — don't interchange.
- SLR assets are held by the bank itself (not with RBI); CRR is with RBI and earns no interest.

## 5. Revision summary
RBI 1935 → nationalisation 1949 → bank nationalisation waves → MPC inflation targeting → repo/CRR/SLR/OMO toolkit → priority sector & DICGC norms.

## 6. References
- RBI (opportunities.rbi.org.in public info); Wikipedia: Reserve Bank of India.`, [WIKI('Reserve_Bank_of_India')]),

  mk('economy-tn', 'Economy of Tamil Nadu', `## 1. Concept
Tamil Nadu is one of India's most industrialised states with a diversified economy: manufacturing (automobiles, textiles), services (IT, finance) and strong agriculture (paddy, sugarcane, cotton) plus a leading position in renewable energy.

## 2. Key facts
- **Industry**: Chennai–Oragadam belt ("Detroit of India") — Hyundai, Ford (left in 2024), Ashok Leyland, TVS, Royal Enfield; Tiruppur knitwear; Coimbatore pumps & textiles ("Manchester of South India"); Sivakasi fireworks/printing; Salem steel; Neyveli lignite.
- **IT/ITES**: Tidel Park (1998, among India's first IT parks), Taramani–Siruseri–Sholinganallur corridors; TCS, Infosys, Cognizant, Zoho (Chennai).
- **Energy**: largest installed wind capacity among Indian states (Muppandal — one of Asia's largest wind farms); Kalpakkam (Madras Atomic Power Station, MAPS) and Kudankulam NPP (Tirunelveli).
- **Ports & logistics**: Chennai Port, Kamarajar (Ennore) Port, V. O. C. Port (Tuticorin), Cuddalore/Nagapattinam minor ports.
- **Agriculture**: paddy, sugarcane, cotton, groundnut, coconut; TN is a top banana and tapioca producer; micro-irrigation and tank-fed irrigation heritage (eris).
- **Social indicators**: high urbanisation (~48%), strong gross enrolment in higher education, extensive PDS (universal scheme).

## 3. Common mistakes & exam traps
- Muppandal is **wind** energy; Kudankulam is **nuclear** (Russian-built VVER).
- "Detroit of India" refers to **Chennai's** automobile cluster.
- Neyveli = lignite (NLCIL), not thermal coal mining.

## 4. Revision summary
Auto + textile + IT pillars; wind leader; Kudankulam/MAPS nuclear; four sea ports; universal PDS; tank irrigation legacy.

## 5. References
- Press Information Bureau; Wikipedia: Economy of Tamil Nadu.`, [WIKI('Economy_of_Tamil_Nadu')]),

  mk('science-physics', 'Everyday Physics for Exams', `## 1. Concept
General-science physics questions test basic mechanics, light, sound, heat, electricity and units — usually at the applied "why does this happen" level.

## 2. Key facts & formulas
- **Newton's laws**: 1st (inertia), 2nd (F = ma), 3rd (action–reaction). Momentum p = mv (conserved in collisions).
- **Work W = F·s·cosθ** (joule); Power = W/t (watt); Energy: KE = ½mv², PE = mgh.
- **Light**: laws of reflection (i = r); refraction — Snell's law n = sin i/sin r; convex lens converges, concave diverges. Rainbow: dispersion + internal reflection; primary rainbow 42°, secondary 51°.
- **Sound**: needs a medium; speed in air ~343 m/s (20°C); ultrasonic > 20 kHz; SONAR uses echoes.
- **Electricity**: V = IR (Ohm); series R = R1+R2; parallel 1/R = 1/R1+1/R2; Power P = VI; unit kWh = "unit" of electricity.
- **Heat**: conduction (solids), convection (fluids), radiation (no medium); latent heat at phase change; absolute zero −273.15°C.

## 3. Everyday applications
- Short-sightedness → concave lens; long-sightedness → convex lens.
- Hydraulic brakes/lifts — Pascal's law. Aircraft lift — Bernoulli's principle.
- Lightning conductors — earthing; kerosene floats on water (density < 1 g/cc).

## 4. Common mistakes & exam traps
- Inertia depends on **mass** (not size or speed).
- Sound travels faster in solids than in air (~5000 m/s in steel).
- Total internal reflection (mirage, optical fibre) needs light going from denser → rarer medium.

## 5. Revision summary
F=ma; energy forms & conservation; reflection/refraction basics; sound medium & speed; Ohm's law & circuits; heat transfer modes; famous instruments (barometer, hygrometer, seismograph).

## 6. References
- Wikipedia: Physics.`, [WIKI('Physics')]),

  mk('science-chemistry', 'Everyday Chemistry for Exams', `## 1. Concept
Everyday chemistry questions cover matter, atoms & molecules, acids-bases-salts, metals/non-metals, alloys, fertilisers, gases and common compounds.

## 2. Key facts
- **Atom**: proton (+), neutron (0), electron (−). Atomic number Z = protons; mass number A = protons + neutrons. Isotopes = same Z different A; isobars = same A.
- **pH scale** 0–14: <7 acid, 7 neutral, >7 base. Blood pH ≈ 7.4. Tooth decay occurs below pH 5.5.
- **Common compounds**: baking soda NaHCO₃; washing soda Na₂CO₃·10H₂O; common salt NaCl; bleaching powder Ca(OCl)Cl; plaster of Paris CaSO₄·½H₂O; quicklime CaO.
- **Alloys**: brass (Cu+Zn), bronze (Cu+Sn), stainless steel (Fe+Cr+Ni), duralumin (Al+Cu), solder (Pb+Sn), amalgam (with Hg).
- **Gases**: photosynthesis consumes CO₂; ammonia NH₃ (Haber process, N₂+3H₂); laughing gas N₂O; CNG = methane (mainly).
- **Fuels & polymers**: LPG = butane/propane; biogas ~ methane; PVC/polythene = polymers; vulcanisation = rubber + sulphur (Charles Goodyear).

## 3. Quick table
| Substance | Chemical name / formula |
|---|---|
| Baking soda | Sodium bicarbonate, NaHCO₃ |
| Caustic soda | NaOH |
| Gypsum | CaSO₄·2H₂O |
| Dry ice | Solid CO₂ |

## 4. Common mistakes & exam traps
- Baking powder = baking soda + tartaric acid (mild acid) — not plain baking soda.
- Brass contains zinc; bronze contains tin — commonly swapped.
- pH of pure water is 7 at 25°C — it changes slightly with temperature.

## 5. Revision summary
Atom structure → pH scale → household compounds with formulas → alloys with composition → important gases → polymers and vulcanisation.

## 6. References
- Wikipedia: Chemistry.`, [WIKI('Chemistry')]),

  mk('science-biology', 'Biology: Human Body & Life Processes', `## 1. Concept
General biology covers cell biology, human organ systems, nutrition, diseases and plant basics — with heavy overlap between SSC/state exams.

## 2. Key facts
- **Cell**: Robert Hooke coined "cell" (1665). Cell theory: Schleiden & Schwann. Mitochondria = powerhouse; ribosomes = protein synthesis; lysosome = suicide bags.
- **Blood**: RBC (erythrocytes — no nucleus in mammals, haemoglobin, ~120-day lifespan), WBC (defence), platelets (clotting). Blood groups: ABO + Rh (Karl Landsteiner — ABO). Universal donor O−; universal recipient AB+.
- **Vitamins**: A (night blindness), B1 (beriberi), C (scurvy), D (rickets; fat-soluble: A, D, E, K).
- **Systems**: heart 4 chambers; SA node = pacemaker; largest gland = liver; largest organ = skin; insulin from pancreas (beta cells).
- **Diseases**: viral — dengue, rabies, AIDS (HIV); bacterial — TB, cholera, typhoid; protozoan — malaria (Plasmodium, female Anopheles), amoebiasis. Vaccines: BCG (TB), polio (OPV/IPV).
- **Plants**: photosynthesis — chlorophyll, 6CO₂+6H₂O→C₆H₁₂O₆+6O₂; transpiration via stomata; xylem (water up), phloem (food both ways).

## 3. Common mistakes & exam traps
- Malaria is spread by the **female Anopheles** mosquito; dengue by **Aedes aegypti** (day-biting).
- RBCs lack a nucleus; WBCs have one — often reversed.
- Insulin lowers blood sugar; glucagon raises it.

## 4. Revision summary
Cell organelles → blood composition & groups → vitamin deficiency table → organ systems & "largest" facts → disease agents & vaccines → photosynthesis equation.

## 5. References
- Wikipedia: Human body.`, [WIKI('Human_body')]),

  mk('science-space', 'Space & Solar System', `## 1. Concept
Space questions cover the solar system, Earth–Moon system, eclipses, satellites and India's space programme.

## 2. Key facts
- Solar system: 8 planets (Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune — MVEMJSUN). Pluto is a dwarf planet (IAU 2006). Largest planet: Jupiter; hottest: Venus (greenhouse); red planet: Mars; ringed: Saturn.
- **Moon**: 27.3-day orbit; synchronous rotation → same face; causes tides (spring tides at new/full moon).
- **Eclipses**: solar — Moon between Sun & Earth; lunar — Earth's shadow on Moon (safer to watch).
- **India**: ISRO (1969, HQ Bengaluru); Aryabhata (first satellite, 1975); Chandrayaan-1 (2008, water molecules), Chandrayaan-3 (2023 — Vikram soft-landed near lunar south pole; Pragyan rover); Mangalyaan/MOM (2013–14, first nation to reach Mars orbit on maiden attempt); Aditya-L1 (2023, solar observatory); Gaganyaan — human spaceflight programme.
- Launch vehicles: PSLV ("workhorse"), GSLV Mk III / LVM3 (heaviest, used for Chandrayaan-3); SDSC SHAR, Sriharikota.

## 3. Common mistakes & exam traps
- Venus is the hottest planet (not Mercury) despite Mercury being closer to the Sun.
- ISRO founded 1969 (Vikram Sarabhai); INCOSPAR was 1962.
- Lunar eclipses last longer than solar eclipses and are visible from the whole night side of Earth.

## 4. Revision summary
Planet order & superlatives; Moon & tides; eclipse geometry; ISRO milestones timeline; launch vehicles & ports.

## 5. References
- ISRO public information; Wikipedia: Solar System.`, [WIKI('Solar_System')]),

  mk('environment', 'Ecology, Biodiversity & Conservation', `## 1. Concept
Environment questions cover ecosystems, biodiversity hotspots, pollution, climate frameworks and Indian conservation law.

## 2. Key facts
- **Ecosystem**: biotic + abiotic; energy flow unidirectional; 10% law (Lindeman); food chain → food web; trophic levels; producers → consumers → decomposers.
- **Biodiversity**: term popularised by E. O. Wilson; India is a megadiverse country with 4 hotspots: **Western Ghats–Sri Lanka, Himalaya, Indo-Burma, Sundaland (Nicobar)**.
- **Conservation**: Wildlife Protection Act 1972; Forest Conservation Act 1980; Environment Protection Act 1986 (post-Bhopal); Project Tiger 1973; Project Elephant 1992; Ramsar sites (wetlands — India has 85+ sites, among the most in Asia).
- **Climate frameworks**: UNFCCC (1992), Kyoto Protocol (1997), **Paris Agreement (2015 — well below 2°C, pursue 1.5°C)**; India's NDC: 45% emission-intensity cut by 2030 (vs 2005), 50% non-fossil capacity; net-zero by 2070 (announced at COP26).
- **Pollution**: PM2.5 more harmful than PM10; e-waste rules; Montreal Protocol (ozone — CFC phase-out, most successful environmental treaty).

## 3. Quick table
| Term | Meaning |
|---|---|
| Ozone layer | Stratospheric O₃ shields UV-B |
| Biomagnification | Toxin concentration rises up the food chain |
| Carbon sink | Forests/oceans absorb CO₂ |
| Ex-situ | Conservation outside habitat (zoos, gene banks) |

## 4. Common mistakes & exam traps
- Ozone depletion (Montreal Protocol) is a different problem from climate change (UNFCCC) — exams mix them.
- Western Ghats is a biodiversity hotspot; Deccan plateau is not.
- Global Warming Potential: CH₄ > CO₂; N₂O even higher per unit mass.

## 5. Revision summary
Energy flow & 10% law → hotspots → Indian acts & projects → Paris/Kyoto → pollution basics → ozone vs climate.

## 6. References
- Wikipedia: Biodiversity; Press Information Bureau.`, [WIKI('Biodiversity')]),

  mk('current-affairs', 'Current Affairs — How to Prepare (Standing Note)', `## 1. Concept
Current-affairs questions reward consistent, source-anchored preparation rather than last-minute memorisation. This standing note explains a sustainable system you can apply every week.

## 2. A weekly system
1. **Daily (15 min)**: scan one national newspaper's front page + editorial headlines; note schemes, appointments, awards, summits.
2. **Weekly (45 min)**: consolidate the week's notes into five buckets — Polity & Governance, Economy & Banking, Science & Tech, Environment, Sports & Awards.
3. **Monthly (1 hr)**: revise from PIB (pib.gov.in) releases of your exam's ministries; link each item to its static concept (e.g., a GST collection news item → GST Council article).
4. **Pre-exam**: revise only your consolidated notes — not new material.

## 3. What exams typically ask
- Government schemes (launch year, ministry, beneficiaries), constitutional/statutory bodies in news, reports & indices (publisher + India's rank), sports winners, space/defence milestones, economic indicators (GDP growth, repo rate direction), international summits and their host cities.

## 4. BEAN EXAMS note on honesty
Static notes in this app cover the permanent framework (institutions, processes). For day-to-day items, always verify with official sources (PIB, ministry portals, exam-conducting bodies) — content here does not replace them.

## 5. Common mistakes & exam traps
- Mixing the year a scheme was **announced** with the year it was **launched/rolled out**.
- Trusting unverified social-media summaries over official releases.

## 6. Revision summary
Daily scan → weekly buckets → monthly PIB consolidation → link news to static concepts. Use official sources for verification.`, [{ label: 'Press Information Bureau', url: 'https://pib.gov.in' }]),
]
