// ─────────────────────────────────────────────────────────────────────────────
// BEAN Education — Original practice question bank (canonical library).
// Every question is an ORIGINAL BEAN Education practice question with an
// author-verified answer and explanation. sourceType stays ORIGINAL — no
// previous-year provenance is claimed anywhere in this build.
// ─────────────────────────────────────────────────────────────────────────────

export interface QuestionSeed {
  canonical: string
  text: string
  options: [string, string, string, string]
  correctIndex: number
  explanation: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
}

const q = (
  canonical: string,
  text: string,
  options: [string, string, string, string],
  correctIndex: number,
  explanation: string,
  difficulty: QuestionSeed['difficulty'] = 'MEDIUM'
): QuestionSeed => ({ canonical, text, options, correctIndex, explanation, difficulty })

export const QUESTIONS: QuestionSeed[] = [
  // ─── POLITY ───
  q('polity-constitution', 'The Constitution of India came into force on:', ['26 November 1949', '26 January 1950', '15 August 1947', '26 January 1949'], 1, 'Adopted on 26 November 1949; brought into force on 26 January 1950 — celebrated as Republic Day.', 'EASY'),
  q('polity-constitution', 'Who chaired the Drafting Committee of the Constituent Assembly?', ['Dr Rajendra Prasad', 'Jawaharlal Nehru', 'Dr B. R. Ambedkar', 'Sardar Vallabhbhai Patel'], 2, 'Dr B. R. Ambedkar was Chairman of the Drafting Committee; Dr Rajendra Prasad presided over the Assembly.', 'EASY'),
  q('polity-constitution', 'The words "Socialist", "Secular" and "Integrity" were added to the Preamble by which amendment?', ['24th Amendment', '42nd Amendment', '44th Amendment', '73rd Amendment'], 1, 'The 42nd Amendment Act, 1976 added these three words to the Preamble.', 'EASY'),
  q('polity-constitution', 'The idea of the Preamble was borrowed from the Constitution of:', ['USA', 'Ireland', 'UK', 'Canada'], 1, 'The Preamble and Directive Principles were influenced by the Constitution of Ireland.', 'MEDIUM'),
  q('polity-constitution', 'The Constituent Assembly took how long to frame the Constitution?', ['1 year 6 months', '2 years 11 months 18 days', '3 years 5 months', '4 years'], 1, 'The Assembly sat for 2 years, 11 months and 18 days.', 'MEDIUM'),
  q('polity-constitution', 'Which objective resolution, moved in 1946, became the basis of the Preamble?', ['Karachi Resolution', 'Nehru\'s Objectives Resolution', 'Lucknow Pact', 'Quit India Resolution'], 1, 'Jawaharlal Nehru moved the Objectives Resolution in the Constituent Assembly in December 1946.', 'MEDIUM'),
  q('polity-constitution', 'The procedure for amendment of the Constitution is given in:', ['Article 360', 'Article 368', 'Article 352', 'Article 370'], 1, 'Article 368 prescribes the amendment procedure.', 'EASY'),
  q('polity-constitution', 'How many schedules did the original Constitution contain?', ['8', '10', '12', '22'], 0, 'The original Constitution had 8 schedules; there are 12 today.', 'MEDIUM'),
  q('polity-constitution', '"Basic structure doctrine" limiting Parliament\'s amendment power was laid down in:', ['Golaknath case', 'Kesavananda Bharati case', 'Minerva Mills case', 'Maneka Gandhi case'], 1, 'Kesavananda Bharati (1973) established the basic structure doctrine.', 'MEDIUM'),
  q('polity-constitution', 'India is described as a "Republic" because:', ['It has a parliamentary system', 'The head of state is elected', 'It is a union of states', 'It has universal adult franchise'], 1, 'Republic means the head of state (President) is elected, not hereditary.', 'EASY'),

  q('polity-fundamental-rights', 'Which Article is called the "heart and soul" of the Constitution by Dr Ambedkar?', ['Article 14', 'Article 19', 'Article 21', 'Article 32'], 3, 'Article 32 — right to constitutional remedies.', 'EASY'),
  q('polity-fundamental-rights', 'Right to Property after the 44th Amendment is a:', ['Fundamental right', 'Legal/constitutional right under Article 300A', 'Directive principle', 'Natural right'], 1, '44th Amendment (1978) moved property from Part III to Article 300A — a legal right.', 'MEDIUM'),
  q('polity-fundamental-rights', 'Which writ is issued to produce a detained person before the court?', ['Mandamus', 'Habeas Corpus', 'Certiorari', 'Quo Warranto'], 1, 'Habeas Corpus literally means "produce the body".', 'EASY'),
  q('polity-fundamental-rights', 'How many Fundamental Duties are listed in Article 51A?', ['10', '11', '9', '12'], 1, 'Originally 10; the 86th Amendment added the 11th (parents\' duty re education).', 'MEDIUM'),
  q('polity-fundamental-rights', 'Education became a Fundamental Right under Article 21A by which amendment?', ['42nd', '73rd', '86th', '97th'], 2, '86th Amendment (2002) inserted Article 21A for free and compulsory education (6–14 years).', 'MEDIUM'),
  q('polity-fundamental-rights', 'Directive Principles of State Policy are contained in:', ['Part III', 'Part IV', 'Part IVA', 'Part V'], 1, 'DPSPs are in Part IV (Articles 36–51).', 'EASY'),
  q('polity-fundamental-rights', 'Which of these is NOT a Fundamental Right?', ['Equality before law', 'Freedom of religion', 'Right to property', 'Right against exploitation'], 2, 'Right to property ceased to be a Fundamental Right after 1978.', 'EASY'),
  q('polity-fundamental-rights', 'Under Article 14, "equality before the law" is a concept borrowed from:', ['Irish Constitution', 'British (common-law) tradition', 'US Constitution', 'French Declaration'], 1, '"Equality before law" is the negative British concept; "equal protection" is the American positive one.', 'HARD'),

  q('polity-parliament', 'A Money Bill can be introduced only in:', ['Rajya Sabha', 'Lok Sabha', 'Either House', 'Joint sitting'], 1, 'Article 110 — Money Bills originate only in the Lok Sabha on the President\'s recommendation.', 'EASY'),
  q('polity-parliament', 'Rajya Sabha must return a Money Bill to the Lok Sabha within:', ['7 days', '14 days', '30 days', '6 months'], 1, '14 days, with or without recommendations.', 'MEDIUM'),
  q('polity-parliament', 'The quorum for a sitting of either House is:', ['1/5th of members', '1/10th of members', '1/3rd of members', '1/2 of members'], 1, 'One-tenth of the total membership, including the presiding officer.', 'MEDIUM'),
  q('polity-parliament', 'Under which Article can Rajya Sabha authorise Parliament to legislate on a State List subject?', ['Article 249', 'Article 250', 'Article 252', 'Article 356'], 0, 'Article 249 — national interest resolution by 2/3rd majority.', 'HARD'),
  q('polity-parliament', 'How many joint sittings of both Houses have taken place (as commonly cited)?', ['1', '3', '5', 'None'], 1, 'Three: Dowry Prohibition Bill (1960), Banking Service Commission Repeal (1977), POTA (2002).', 'HARD'),
  q('polity-parliament', 'A no-confidence motion can be moved only in the:', ['Rajya Sabha', 'Lok Sabha', 'Either House', 'Parliamentary committees'], 1, 'Council of Ministers is collectively responsible to the Lok Sabha.', 'EASY'),

  q('polity-union-executive', 'The President of India is elected by:', ['People directly', 'Parliament only', 'Electoral college of elected MPs and MLAs', 'Supreme Court judges'], 2, 'Elected MPs + elected MLAs of states (incl. Delhi, Puducherry, J&K) via single transferable vote.', 'EASY'),
  q('polity-union-executive', 'An ordinance promulgated by the President must be approved by Parliament within:', ['2 weeks of reassembly', '6 weeks of reassembly', '3 months', '6 months'], 1, 'Six weeks from the reassembly of Parliament.', 'MEDIUM'),
  q('polity-union-executive', 'Ministers in the Union Council of Ministers (excluding PM) cannot exceed:', ['10% of Lok Sabha', '15% of Lok Sabha strength', '20% of Lok Sabha', '81 members'], 1, '91st Amendment (2003): 15% cap including the PM.', 'MEDIUM'),
  q('polity-union-executive', 'The Vice-President of India is elected by:', ['Lok Sabha only', 'Electoral college of elected MPs and MLAs', 'Both Houses of Parliament (elected + nominated members)', 'Presidential nomination'], 2, 'Members of both Houses (elected and nominated) elect the Vice-President — unlike the President\'s college.', 'HARD'),
  q('polity-union-executive', 'Collective responsibility of the Council of Ministers to the Lok Sabha is provided in:', ['Article 74', 'Article 75(3)', 'Article 78', 'Article 85'], 1, 'Article 75(3).', 'MEDIUM'),
  q('polity-union-executive', 'The "pocket veto" refers to:', ['Rejecting a bill after 6 months', 'Keeping a bill pending indefinitely without assent', 'Returning a bill once for reconsideration', 'Refusing to call Parliament'], 1, 'The President is not bound by a time limit to assent — the pocket veto.', 'MEDIUM'),

  q('polity-judiciary', 'The sanctioned strength of judges in the Supreme Court (including CJI) is:', ['30', '31', '34', '25'], 2, '34 — CJI plus 33 judges (after the 2019 increase).', 'MEDIUM'),
  q('polity-judiciary', 'Under which Article does the Supreme Court have original jurisdiction in Centre–state disputes?', ['Article 131', 'Article 132', 'Article 136', 'Article 143'], 0, 'Article 131.', 'MEDIUM'),
  q('polity-judiciary', 'The retirement age of a Supreme Court judge is:', ['60', '62', '65', '70'], 2, '65 for SC; 62 for High Court judges.', 'EASY'),
  q('polity-judiciary', 'Writ jurisdiction of High Courts under Article 226 is:', ['Narrower than Article 32', 'Wider than Article 32', 'Identical to Article 32', 'Non-existent'], 1, 'HC writs extend to legal rights too, not just fundamental rights.', 'HARD'),
  q('polity-judiciary', 'Law declared by the Supreme Court is binding on all courts under:', ['Article 141', 'Article 142', 'Article 144', 'Article 137'], 0, 'Article 141.', 'MEDIUM'),

  q('polity-panchayati-raj', 'The three-tier Panchayati Raj system was recommended by:', ['Ashok Mehta Committee', 'Balwant Rai Mehta Committee', 'G.V.K. Rao Committee', 'L.M. Singhvi Committee'], 1, 'Balwant Rai Mehta (1957) recommended the three-tier system.', 'EASY'),
  q('polity-panchayati-raj', 'Panchayats received constitutional status through:', ['72nd Amendment', '73rd Amendment', '74th Amendment', '71st Amendment'], 1, '73rd Amendment (1992) — Part IX; 74th for municipalities.', 'EASY'),
  q('polity-panchayati-raj', 'The Eleventh Schedule lists how many subjects for Panchayats?', ['18', '29', '47', '66'], 1, '29 subjects (Twelfth Schedule has 18 for municipalities).', 'MEDIUM'),
  q('polity-panchayati-raj', 'Reservation for women in Panchayats is:', ['One-third minimum', 'At least 50% in all states by Constitution', 'One-fourth', 'No reservation'], 0, 'Article 243D mandates not less than one-third; many states raised it to 50% by state law.', 'MEDIUM'),

  q('polity-constitutional-bodies', 'Which of the following is NOT a constitutional body?', ['Election Commission', 'UPSC', 'NITI Aayog', 'Finance Commission'], 2, 'NITI Aayog is an executive body created by a Cabinet resolution in 2015.', 'EASY'),
  q('polity-constitutional-bodies', 'The CAG of India is appointed for a term of:', ['5 years', '6 years or 65 years of age, whichever earlier', '4 years', 'Life'], 1, 'Six years or 65 years, whichever is earlier.', 'MEDIUM'),
  q('polity-constitutional-bodies', 'The Finance Commission is constituted every:', ['3 years', '5 years', '7 years', '10 years'], 1, 'Article 280 — every fifth year (or earlier if needed).', 'EASY'),
  q('polity-constitutional-bodies', 'The National Commission for Backward Classes became a constitutional body by:', ['101st Amendment', '102nd Amendment', '103rd Amendment', '99th Amendment'], 1, '102nd Amendment (2018) inserted Article 338B.', 'HARD'),

  q('polity-tn-administration', 'The Tamil Nadu Legislature is:', ['Bicameral', 'Unicameral', 'Tricameral', 'None'], 1, 'Only a Legislative Assembly — the Council was abolished in 1986.', 'EASY'),
  q('polity-tn-administration', 'The Tamil Nadu Legislative Assembly has how many elected members?', ['234', '260', '200', '224'], 0, '234 elected members (plus the lapsed Anglo-Indian nomination).', 'EASY'),
  q('polity-tn-administration', 'Greater Chennai Corporation, established in 1688, is known as:', ['India\'s first municipal corporation', 'Asia\'s largest port trust', 'TN\'s first panchayat', 'First district board'], 0, 'It is among the oldest municipal corporations in the world outside the UK.', 'MEDIUM'),
  q('polity-tn-administration', 'Tamil Nadu currently has how many districts?', ['32', '36', '38', '40'], 2, '38 districts (after the 2019–2020 reorganisations).', 'MEDIUM'),

  // ─── HISTORY ───
  q('history-ancient', 'The Indus Valley Civilization was discovered in:', ['1857', '1921', '1930', '1905'], 1, 'Harappa excavations began in 1921 under Daya Ram Sahni.', 'EASY'),
  q('history-ancient', 'The "Great Bath" is a notable structure found at:', ['Harappa', 'Mohenjo-daro', 'Lothal', 'Kalibangan'], 1, 'The Great Bath is at Mohenjo-daro.', 'EASY'),
  q('history-ancient', 'Which Harappan site is famous for its dockyard?', ['Lothal', 'Dholavira', 'Ropar', 'Banawali'], 0, 'Lothal (Gujarat) has the dockyard.', 'MEDIUM'),
  q('history-ancient', 'The Kalinga War was fought by Ashoka in approximately:', ['261 BCE', '322 BCE', '185 BCE', '320 CE'], 0, 'c. 261 BCE, the eighth year of his reign.', 'MEDIUM'),
  q('history-ancient', 'Megasthenes, author of Indica, was the ambassador of:', ['Persia', 'Greece (Seleucus) to Chandragupta Maurya', 'Rome to Ashoka', 'China to Kanishka'], 1, 'Sent by Seleucus Nicator to Chandragupta Maurya\'s court.', 'MEDIUM'),
  q('history-ancient', 'Ashoka\'s inscriptions were mostly written in which script?', ['Devanagari', 'Brahmi', 'Kharoshthi throughout', 'Tamil-Brahmi'], 1, 'Prakrit language, mostly Brahmi script.', 'MEDIUM'),
  q('history-ancient', 'Samudragupta\'s military achievements are recorded in the:', ['Allahabad (Prayag) Pillar inscription by Harisena', 'Aihole inscription', 'Junagadh inscription', 'Hathigumpha inscription'], 0, 'The Prayag Prashasti composed by Harisena.', 'HARD'),
  q('history-ancient', 'The Chinese traveller Fa-Hien visited India during the reign of:', ['Chandragupta II', 'Samudragupta', 'Harshavardhana', 'Ashoka'], 0, 'Fa-Hien visited during Chandragupta II (c. 399–414 CE).', 'MEDIUM'),

  q('history-medieval', 'The First Battle of Panipat (1526) was won by Babur against:', ['Rana Sanga', 'Ibrahim Lodi', 'Sher Shah Suri', 'Hemu'], 1, 'Babur defeated Ibrahim Lodi using gunpowder and tulughma tactics.', 'EASY'),
  q('history-medieval', 'Who among the Delhi Sultans introduced the token currency?', ['Alauddin Khalji', 'Muhammad bin Tughlaq', 'Firoz Shah Tughlaq', 'Iltutmish'], 1, 'Muhammad bin Tughlaq\'s token copper currency failed due to counterfeiting.', 'MEDIUM'),
  q('history-medieval', 'The Vijayanagara empire was founded in 1336 by:', ['Krishnadeva Raya', 'Harihara and Bukka', 'Devaraya II', 'Rama Raya'], 1, 'The Sangama brothers Harihara and Bukka.', 'EASY'),
  q('history-medieval', 'Akbar abolished the jizya tax in:', ['1564', '1579', '1595', '1679'], 0, '1564; Aurangzeb re-imposed it in 1679.', 'MEDIUM'),
  q('history-medieval', 'The Mansabdari system was introduced by:', ['Babur', 'Sher Shah', 'Akbar', 'Aurangzeb'], 2, 'Akbar — a combined military-civil ranking system (zat & sawar).', 'MEDIUM'),
  q('history-medieval', 'The Battle of Talikota (1565) led to the decline of:', ['Bahmani kingdom', 'Vijayanagara empire', 'Mughal empire', 'Maratha confederacy'], 1, 'Deccan Sultanates defeated Vijayanagara; Aravidu line survived nominally.', 'MEDIUM'),

  q('history-modern', 'The Battle of Plassey was fought in:', ['1757', '1764', '1761', '1857'], 0, '23 June 1757 — Clive defeated Siraj-ud-Daulah.', 'EASY'),
  q('history-modern', 'The Indian National Congress was founded in 1885 by:', ['W. C. Bonnerjee', 'A. O. Hume', 'Dadabhai Naoroji', 'Surendranath Banerjee'], 1, 'Retired ICS officer A. O. Hume founded it; Bonnerjee was first president.', 'EASY'),
  q('history-modern', 'The Rowlatt Act (1919) was popularly called:', ['Vernacular Press Act', 'Black Act', 'Indian Councils Act', 'Charter Act'], 1, 'It permitted detention without trial — the "Black Act".', 'MEDIUM'),
  q('history-modern', 'The Non-Cooperation Movement was withdrawn after the incident at:', ['Jallianwala Bagh', 'Chauri Chaura', 'Kakori', 'Champaran'], 1, 'Violence at Chauri Chaura (February 1922).', 'EASY'),
  q('history-modern', 'The Dandi March began on:', ['12 March 1930', '6 April 1930', '26 January 1930', '8 August 1942'], 0, '12 March 1930 from Sabarmati; salt law broken 6 April at Dandi.', 'EASY'),
  q('history-modern', 'Jallianwala Bagh massacre took place on:', ['13 April 1919', '13 April 1920', '6 April 1919', '10 May 1919'], 0, '13 April 1919, ordered by General Dyer.', 'EASY'),
  q('history-modern', 'The slogan "Do or Die" is associated with:', ['Civil Disobedience', 'Quit India Movement', 'Non-Cooperation', 'Simon Commission protests'], 1, 'Gandhi\'s call at the launch of Quit India (8 August 1942).', 'EASY'),
  q('history-modern', 'The Government of India Act of 1858 followed:', ['Battle of Buxar', 'Revolt of 1857', 'Plassey', 'Third Anglo-Maratha War'], 1, 'Crown rule replaced Company rule after the 1857 revolt.', 'MEDIUM'),
  q('history-modern', 'Drain of wealth theory was propounded by:', ['R. C. Dutt', 'Dadabhai Naoroji', 'M. G. Ranade', 'Gopal Krishna Gokhale'], 1, 'Dadabhai Naoroji in "Poverty and Un-British Rule in India".', 'MEDIUM'),
  q('history-modern', 'The Partition of Bengal (1905) was annulled in:', ['1906', '1909', '1911', '1915'], 2, 'Annulled in 1911 at the Delhi Durbar.', 'MEDIUM'),

  q('history-tn', 'The Uttaramerur inscriptions describe:', ['Chola village administration (kudavolai system)', 'Pallava war tactics', 'Pandya trade routes', 'Nayak land grants'], 0, 'Parantaka Chola\'s time — pot-ticket elections to village committees.', 'MEDIUM'),
  q('history-tn', 'Brihadeeswara Temple at Thanjavur was built by:', ['Rajaraja I', 'Rajendra I', 'Mahendra Varman', 'Karikala Chola'], 0, 'Rajaraja I, completed around 1010 CE.', 'EASY'),
  q('history-tn', 'Rajendra Chola I assumed the title "Gangaikonda Chola" after:', ['Defeating Srivijaya', 'His Gangetic expedition', 'Building the Brihadeeswara temple', 'Defeating the Pandyas'], 1, 'After marching to the Ganges; a separate naval expedition struck Srivijaya.', 'MEDIUM'),
  q('history-tn', 'The Shore Temple at Mahabalipuram was built by:', ['Narasimhavarman I', 'Narasimhavarman II (Rajasimha)', 'Mahendra Varman I', 'Nandivarman II'], 1, 'Rajasimha (Narasimhavarman II).', 'MEDIUM'),
  q('history-tn', 'The Sangam age assembly of poets was held at:', ['Kanchipuram', 'Madurai', 'Uraiyur', 'Puhar'], 1, 'Madurai, under Pandya patronage.', 'EASY'),
  q('history-tn', 'V. O. Chidambaram Pillai founded the Swadeshi Steam Navigation Company in:', ['1905', '1906', '1911', '1920'], 1, '1906 — against British shipping monopoly on the Tuticorin–Colombo route.', 'MEDIUM'),
  q('history-tn', 'The Vedaranyam Salt March (1930) was led by:', ['C. Rajagopalachari', 'K. Kamaraj', 'S. Satyamurti', 'Periyar'], 0, 'C. Rajagopalachari marched from Trichy to Vedaranyam.', 'MEDIUM'),
  q('history-tn', 'The Self-Respect Movement (1925) was founded by:', ['E. V. Ramasamy (Periyar)', 'C. N. Annadurai', 'M. G. Ramachandran', 'Theagaroya Chetty'], 0, 'Periyar E. V. Ramasamy.', 'EASY'),

  q('history-national-movement', 'The Swaraj Party (1923) was founded by:', ['Motilal Nehru and C. R. Das', 'Tilak and Lajpat Rai', 'Gandhi and Nehru', 'Bose and Savarkar'], 0, 'To enter legislative councils under the GoI Act 1919.', 'MEDIUM'),
  q('history-national-movement', 'Bhagat Singh, Rajguru and Sukhdev were executed on:', ['23 March 1931', '23 March 1930', '14 February 1931', '26 January 1931'], 0, '23 March 1931 (Lahore Conspiracy Case).', 'MEDIUM'),
  q('history-national-movement', '"Give me blood, and I will give you freedom" was said by:', ['Bhagat Singh', 'Subhas Chandra Bose', 'Bal Gangadhar Tilak', 'Aurobindo Ghosh'], 1, 'Subhas Chandra Bose to the INA.', 'EASY'),
  q('history-national-movement', 'The Purna Swaraj resolution was passed at the Congress session in:', ['Calcutta (1928)', 'Lahore (1929)', 'Karachi (1931)', 'Lucknow (1916)'], 1, 'Lahore, December 1929; Nehru presided.', 'EASY'),
  q('history-national-movement', 'The Indian National Army (INA) was reorganised under Subhas Bose at:', ['Tokyo', 'Singapore', 'Rangoon', 'Bangkok'], 1, 'Singapore (Shonan), 1943.', 'MEDIUM'),
  q('history-national-movement', 'Kakori conspiracy (1925) involved:', ['Ram Prasad Bismil and Ashfaqulla Khan', 'Bhagat Singh and Batukeshwar Dutt', 'Surya Sen', 'Chandrashekhar Azad alone'], 0, 'Train robbery near Kakori; Bismil, Ashfaqulla, Roshan Singh, Rajendra Lahiri hanged.', 'HARD'),

  // ─── GEOGRAPHY ───
  q('geography-india', 'The Tropic of Cancer passes through how many Indian states?', ['6', '8', '9', '5'], 1, 'Eight: Gujarat, Rajasthan, MP, Chhattisgarh, Jharkhand, WB, Tripura, Mizoram.', 'MEDIUM'),
  q('geography-india', 'The highest peak located entirely within India is:', ['K2', 'Kangchenjunga', 'Nanda Devi', 'Nanga Parbat'], 1, 'Kangchenjunga (8,586 m) on the Sikkim–Nepal border; K2 lies in PoK region.', 'MEDIUM'),
  q('geography-india', 'The Godavari originates from:', ['Amarkantak', 'Trimbakeshwar (Nashik)', 'Talakaveri', 'Mahabaleshwar'], 1, 'Trimbakeshwar near Nashik, Maharashtra.', 'MEDIUM'),
  q('geography-india', 'Which peninsular rivers flow through rift valleys into the Arabian Sea?', ['Godavari & Krishna', 'Narmada & Tapi', 'Mahanadi & Subarnarekha', 'Kaveri & Vaigai'], 1, 'Narmada and Tapi flow west through rift valleys, forming estuaries.', 'MEDIUM'),
  q('geography-india', 'Mawsynram, the wettest place in India, is in:', ['Assam', 'Meghalaya', 'Arunachal Pradesh', 'West Bengal'], 1, 'Meghalaya (Cherrapunji nearby).', 'EASY'),
  q('geography-india', 'The Bhagirathi and Alaknanda meet at:', ['Devprayag', 'Rudraprayag', 'Karnaprayag', 'Vishnuprayag'], 0, 'Devprayag — where the combined river takes the name Ganga.', 'HARD'),
  q('geography-india', 'Black (regur) soil is most suited for:', ['Tea', 'Cotton', 'Jute', 'Coffee'], 1, 'Moisture-retentive black soil suits cotton in the Deccan.', 'EASY'),
  q('geography-india', 'Majuli, the largest river island in the world, lies in:', ['Ganga', 'Brahmaputra', 'Godavari', 'Mahanadi'], 1, 'Brahmaputra (Assam).', 'MEDIUM'),

  q('geography-tn', 'The highest peak in Tamil Nadu is:', ['Anamudi', 'Doddabetta', 'Kalsubai', 'Gulbarga Hills'], 1, 'Doddabetta (2,637 m) in the Nilgiris.', 'EASY'),
  q('geography-tn', 'The Mettur Dam is built on which river?', ['Vaigai', 'Kaveri', 'Thamirabarani', 'Thenpennai'], 1, 'Kaveri (Stanley Reservoir, 1934).', 'EASY'),
  q('geography-tn', 'Tamil Nadu receives most of its rainfall from:', ['South-West monsoon', 'North-East monsoon', 'Western disturbances', 'Cyclones only'], 1, 'The NE monsoon (October–December) contributes nearly half the annual rainfall.', 'EASY'),
  q('geography-tn', 'Neyveli in Tamil Nadu is known for:', ['Coal', 'Lignite', 'Bauxite', 'Iron ore'], 1, 'Lignite — mined by NLC India Ltd.', 'EASY'),
  q('geography-tn', 'Which river originates and flows entirely within Tamil Nadu?', ['Kaveri', 'Vaigai', 'Thamirabarani', 'Bhavani'], 2, 'Thamirabarani — rises at Pothigai hills (Agasthyamalai).', 'HARD'),
  q('geography-tn', 'The Gulf of Mannar Marine National Park is located off:', ['Chennai', 'Rameswaram–Tuticorin coast', 'Kanyakumari', 'Pondicherry'], 1, 'Between Rameswaram and Tuticorin — a biosphere reserve.', 'MEDIUM'),

  q('geography-world', 'The largest hot desert in the world is:', ['Gobi', 'Sahara', 'Thar', 'Kalahari'], 1, 'Sahara (North Africa). Antarctica is the largest desert overall.', 'EASY'),
  q('geography-world', 'The Prime Meridian passes through:', ['Paris', 'Greenwich', 'New York', 'Rome'], 1, 'Greenwich, London.', 'EASY'),
  q('geography-world', 'The Panama Canal connects:', ['Mediterranean–Red Sea', 'Atlantic–Pacific', 'Pacific–Indian', 'Black Sea–Caspian'], 1, 'Atlantic and Pacific Oceans.', 'EASY'),
  q('geography-world', 'The deepest lake in the world is:', ['Caspian Sea', 'Lake Baikal', 'Lake Superior', 'Dead Sea'], 1, 'Lake Baikal (Russia), ~1,642 m deep.', 'MEDIUM'),

  // ─── ECONOMY ───
  q('economy-basics', 'NITI Aayog replaced the Planning Commission in:', ['2014', '2015', '2016', '2017'], 1, '1 January 2015.', 'EASY'),
  q('economy-basics', 'GST was launched on:', ['1 April 2016', '1 July 2017', '1 January 2017', '15 August 2017'], 1, '1 July 2017, under the 101st Constitutional Amendment Act.', 'EASY'),
  q('economy-basics', 'Fiscal deficit equals:', ['Revenue expenditure − revenue receipts', 'Total expenditure − total receipts excluding borrowings', 'Primary deficit + interest', 'Exports − imports'], 1, 'Total expenditure minus total non-borrowed receipts.', 'MEDIUM'),
  q('economy-basics', 'India\'s flexible inflation targeting aims for CPI inflation of:', ['2% ± 2%', '4% ± 2%', '5% ± 1%', '6% ± 2%'], 1, '4% with a ±2% band.', 'MEDIUM'),
  q('economy-basics', 'The Union Budget is presented on:', ['28 February', '1 February', '31 March', '1 April'], 1, '1 February since 2017.', 'EASY'),
  q('economy-basics', 'Which body recommends tax devolution between the Centre and states?', ['NITI Aayog', 'Finance Commission', 'GST Council', 'RBI'], 1, 'The Finance Commission (Article 280).', 'EASY'),
  q('economy-basics', 'The 1991 reforms are known for:', ['Nationalisation of banks', 'LPG — Liberalisation, Privatisation, Globalisation', 'Five-Year Plans start', 'Demonetisation'], 1, 'The New Economic Policy of 1991.', 'EASY'),
  q('economy-basics', 'MGNREGA guarantees how many days of wage employment?', ['90', '100', '120', '150'], 1, '100 days per rural household per year.', 'EASY'),

  q('economy-banking', 'The Reserve Bank of India was established in:', ['1934', '1935', '1949', '1950'], 1, '1 April 1935; nationalised in 1949.', 'EASY'),
  q('economy-banking', 'The monetary policy rate at which RBI lends short-term funds to banks is:', ['Reverse repo', 'Repo rate', 'Bank rate', 'SLR'], 1, 'Repo rate — the policy rate set by the MPC.', 'EASY'),
  q('economy-banking', 'How many banks were nationalised in 1969?', ['6', '14', '20', '8'], 1, '14 major banks (6 more in 1980).', 'MEDIUM'),
  q('economy-banking', 'DICGC deposit insurance covers up to:', ['₹1 lakh', '₹2 lakh', '₹5 lakh', '₹10 lakh'], 2, '₹5 lakh per depositor per bank since Feb 2020.', 'MEDIUM'),
  q('economy-banking', 'The note that RBI does NOT issue is:', ['₹100', '₹500', '₹1', '₹2000'], 2, '₹1 note is issued by the Government of India.', 'MEDIUM'),
  q('economy-banking', 'Priority sector lending target for commercial banks is:', ['30% of ANBC', '40% of ANBC', '50% of ANBC', '25% of deposits'], 1, '40% of adjusted net bank credit.', 'HARD'),
  q('economy-banking', 'The Monetary Policy Committee has how many members?', ['4', '5', '6', '7'], 2, 'Six — three RBI (incl. Governor as chair) + three external.', 'MEDIUM'),
  q('economy-banking', 'CRR refers to:', ['Cash banks keep in their vaults', 'Cash banks keep with RBI against NDTL', 'Government securities held by banks', 'Gold reserves'], 1, 'Cash Reserve Ratio — with RBI, interest-free.', 'MEDIUM'),

  q('economy-tn', 'The "Detroit of India" refers to:', ['Coimbatore', 'Chennai', 'Tiruppur', 'Salem'], 1, 'Chennai — major automobile manufacturing hub.', 'EASY'),
  q('economy-tn', 'Muppandal in Kanyakumari district is famous for:', ['Nuclear power', 'Wind energy', 'Solar thermal', 'Hydropower'], 1, 'One of Asia\'s largest wind farms.', 'EASY'),
  q('economy-tn', 'The Kudankulam Nuclear Power Plant is located in:', ['Tirunelveli district', 'Nagapattinam', 'Ramanathapuram', 'Cuddalore'], 0, 'Tirunelveli district (built with Russian collaboration).', 'MEDIUM'),
  q('economy-tn', 'Tiruppur is associated with:', ['Knitwear exports', 'Steel', 'Paper', 'Sugar'], 0, 'Knitwear and cotton garments.', 'EASY'),

  // ─── SCIENCE ───
  q('science-physics', 'The SI unit of power is:', ['Joule', 'Newton', 'Watt', 'Pascal'], 2, 'Watt = joule per second.', 'EASY'),
  q('science-physics', 'Sound cannot travel through:', ['Solids', 'Liquids', 'Gases', 'Vacuum'], 3, 'Sound needs a material medium.', 'EASY'),
  q('science-physics', 'A person suffering from myopia should use:', ['Convex lens', 'Concave lens', 'Bifocal lens', 'Cylindrical lens'], 1, 'Short-sightedness is corrected by a diverging (concave) lens.', 'MEDIUM'),
  q('science-physics', 'Hydraulic brakes work on:', ['Bernoulli\'s principle', 'Pascal\'s law', 'Archimedes\' principle', 'Newton\'s third law'], 1, 'Pressure applied to an enclosed fluid transmits equally — Pascal\'s law.', 'MEDIUM'),
  q('science-physics', 'The speed of sound in air at room temperature is approximately:', ['300 m/s', '343 m/s', '500 m/s', '1500 m/s'], 1, '~343 m/s at 20 °C.', 'EASY'),
  q('science-physics', '1 kilowatt-hour equals:', ['3.6 × 10³ J', '3.6 × 10⁶ J', '3.6 × 10⁵ J', '36 × 10⁶ J'], 1, '1000 W × 3600 s = 3.6 MJ.', 'MEDIUM'),
  q('science-physics', 'Heat transfer without any medium is called:', ['Conduction', 'Convection', 'Radiation', 'Advection'], 2, 'Radiation (e.g., sunlight through space).', 'EASY'),
  q('science-physics', 'The image formed by a plane mirror is:', ['Real, inverted', 'Virtual, same size, laterally inverted', 'Real, magnified', 'Virtual, diminished'], 1, 'Plane mirrors always form virtual, same-size, laterally inverted images.', 'EASY'),

  q('science-chemistry', 'The pH of a neutral solution at 25 °C is:', ['0', '7', '10', '14'], 1, 'pH 7 is neutral at 25 °C.', 'EASY'),
  q('science-chemistry', 'Baking soda is chemically:', ['Na₂CO₃', 'NaHCO₃', 'NaOH', 'NaCl'], 1, 'Sodium bicarbonate, NaHCO₃.', 'EASY'),
  q('science-chemistry', 'Brass is an alloy of:', ['Copper and tin', 'Copper and zinc', 'Iron and carbon', 'Aluminium and copper'], 1, 'Brass = Cu + Zn; bronze = Cu + Sn.', 'EASY'),
  q('science-chemistry', 'Plaster of Paris is:', ['CaSO₄·2H₂O', 'CaSO₄·½H₂O', 'CaO', 'CaCO₃'], 1, 'Calcium sulphate hemihydrate.', 'MEDIUM'),
  q('science-chemistry', 'Dry ice is:', ['Frozen water', 'Solid CO₂', 'Solid NH₃', 'Solid SO₂'], 1, 'Solid carbon dioxide sublimates at −78.5 °C.', 'EASY'),
  q('science-chemistry', 'LPG mainly contains:', ['Methane', 'Butane and propane', 'Ethane', 'Acetylene'], 1, 'Liquefied Petroleum Gas = butane/propane mix.', 'EASY'),
  q('science-chemistry', 'Vulcanisation of rubber involves adding:', ['Carbon', 'Sulphur', 'Silicon', 'Zinc'], 1, 'Sulphur cross-links improve elasticity (Goodyear).', 'MEDIUM'),
  q('science-chemistry', 'Tooth decay begins when mouth pH falls below:', ['7.0', '6.5', '5.5', '4.0'], 2, 'Enamel demineralises below pH 5.5.', 'MEDIUM'),

  q('science-biology', 'The powerhouse of the cell is:', ['Ribosome', 'Mitochondria', 'Golgi body', 'Lysosome'], 1, 'Mitochondria produce ATP.', 'EASY'),
  q('science-biology', 'Vitamin C deficiency causes:', ['Rickets', 'Scurvy', 'Beriberi', 'Night blindness'], 1, 'Scurvy; rickets = vitamin D, beriberi = B1.', 'EASY'),
  q('science-biology', 'Malaria is transmitted by:', ['Aedes mosquito', 'Female Anopheles mosquito', 'Culex mosquito', 'Housefly'], 1, 'Female Anopheles transmits Plasmodium.', 'EASY'),
  q('science-biology', 'The universal blood donor group is:', ['A+', 'AB+', 'O−', 'B−'], 2, 'O negative — no A/B antigens, no Rh antigen.', 'MEDIUM'),
  q('science-biology', 'Insulin is secreted by the:', ['Liver', 'Pancreas', 'Kidney', 'Thyroid'], 1, 'Beta cells of the pancreatic islets of Langerhans.', 'EASY'),
  q('science-biology', 'The largest gland in the human body is:', ['Pancreas', 'Liver', 'Thyroid', 'Pituitary'], 1, 'Liver — also the largest internal organ.', 'EASY'),
  q('science-biology', 'RBCs in adult human males live about:', ['20 days', '60 days', '120 days', '365 days'], 2, 'About 120 days; removed by the spleen.', 'MEDIUM'),
  q('science-biology', 'Photosynthesis releases:', ['CO₂', 'Oxygen', 'Nitrogen', 'Hydrogen'], 1, 'O₂ from photolysis of water.', 'EASY'),

  q('science-space', 'The hottest planet in the solar system is:', ['Mercury', 'Venus', 'Mars', 'Jupiter'], 1, 'Venus — runaway greenhouse effect (~465 °C surface).', 'EASY'),
  q('science-space', 'ISRO was established in:', ['1962', '1969', '1972', '1975'], 1, '15 August 1969; INCOSPAR was 1962.', 'MEDIUM'),
  q('science-space', 'Chandrayaan-3\'s lander that soft-landed near the lunar south pole (2023) is named:', ['Pragyan', 'Vikram', 'Bhim', 'Dhruva'], 1, 'Vikram lander; Pragyan is the rover.', 'MEDIUM'),
  q('science-space', 'India\'s first satellite, launched in 1975, was:', ['Rohini', 'Aryabhata', 'Bhaskara', 'INSAT-1A'], 1, 'Aryabhata (19 April 1975).', 'EASY'),

  q('environment', 'India\'s biodiversity hotspots include all EXCEPT:', ['Western Ghats', 'Himalaya', 'Indo-Burma', 'Deccan Plateau'], 3, 'The four hotspots: Western Ghats–Sri Lanka, Himalaya, Indo-Burma, Sundaland.', 'MEDIUM'),
  q('environment', 'The Montreal Protocol deals with:', ['Climate change', 'Ozone-depleting substances', 'Wetlands', 'Desertification'], 1, 'CFC phase-out to protect the ozone layer.', 'EASY'),
  q('environment', 'Project Tiger was launched in:', ['1972', '1973', '1980', '1992'], 1, '1973; Project Elephant came in 1992.', 'MEDIUM'),
  q('environment', 'Ramsar Convention concerns conservation of:', ['Forests', 'Wetlands', 'Deserts', 'Coral reefs'], 1, 'Wetlands of international importance.', 'EASY'),
  q('environment', 'The 10% law of energy transfer in food chains was given by:', ['Odum', 'Lindeman', 'Darwin', 'Tansley'], 1, 'Raymond Lindeman — energy flow between trophic levels.', 'HARD'),
  q('environment', 'India\'s net-zero emissions target year is:', ['2050', '2060', '2070', '2100'], 2, '2070, announced at COP26 (2021).', 'MEDIUM'),

  q('current-affairs', 'The Press Information Bureau (PIB) functions under:', ['Ministry of Home Affairs', 'Ministry of Information & Broadcasting', 'Cabinet Secretariat', 'PMO'], 1, 'PIB is the nodal agency of the Ministry of Information & Broadcasting.', 'MEDIUM'),
  q('current-affairs', 'The National Portal of India (india.gov.in) is managed under the:', ['Ministry of Electronics & IT', 'NIC / Ministry of Communications & IT framework', 'Ministry of External Affairs', 'NITI Aayog'], 1, 'Developed and managed by NIC under MeitY — a single-window portal.', 'HARD'),
  q('current-affairs', 'Which document should be treated as the authoritative source for exam-scheme details?', ['Social media summaries', 'Official PIB releases and ministry portals', 'Coaching notes', 'News headlines'], 1, 'Primary official sources — PIB releases and ministry websites.', 'EASY'),
  q('current-affairs', 'Awards and honours announced on Republic Day/eve include civilian honours like:', ['Padma awards', 'Jnanpith', 'Arjuna only', 'Nobel'], 0, 'Padma Vibhushan, Padma Bhushan and Padma Shri are announced around 26 January.', 'MEDIUM'),

  // ─── APTITUDE ───
  q('aptitude-percentages', 'A number increased by 20% and then decreased by 20% results in:', ['No change', '4% increase', '4% decrease', '2% decrease'], 2, '1.2 × 0.8 = 0.96 → 4% decrease.', 'EASY'),
  q('aptitude-percentages', 'If A is 25% more than B, then B is less than A by:', ['25%', '20%', '22.5%', '30%'], 1, '25/125 = 20%.', 'EASY'),
  q('aptitude-percentages', '45% of 360 + 25% of 240 = ?', ['220', '222', '224', '226'], 1, '162 + 60 = 222.', 'EASY'),
  q('aptitude-percentages', 'A price is increased by 25%; consumption must be reduced by what % to keep expenditure constant?', ['25%', '20%', '22%', '18%'], 1, 'r/(100+r) × 100 = 25/125 = 20%.', 'MEDIUM'),
  q('aptitude-percentages', 'Successive discounts of 10% and 20% equal a single discount of:', ['30%', '28%', '29%', '27%'], 1, '0.9 × 0.8 = 0.72 → 28%.', 'EASY'),
  q('aptitude-percentages', 'The population of a town grows 10% in year 1 and falls 5% in year 2. Net change is:', ['+5%', '+4.5%', '−4.5%', '+10%'], 1, '1.1 × 0.95 = 1.045 → +4.5%.', 'MEDIUM'),

  q('aptitude-ratio', 'Divide ₹630 between A and B in the ratio 4:5. A gets:', ['₹280', '₹350', '₹315', '₹300'], 0, '9 parts = 630 → A = 4 × 70 = ₹280.', 'EASY'),
  q('aptitude-ratio', 'If a:b = 2:3 and b:c = 6:5, then a:b:c = ?', ['2:3:5', '4:6:5', '4:6:10', '2:6:5'], 1, 'Equalise b: 2:3 → 4:6; with 6:5 → 4:6:5.', 'MEDIUM'),
  q('aptitude-ratio', 'The mean proportional between 4 and 25 is:', ['10', '14.5', '20', '12'], 0, '√(4×25) = 10.', 'EASY'),
  q('aptitude-ratio', 'Incomes of A and B are in the ratio 3:4 and their expenditures in the ratio 2:3. If each saves ₹600, B\'s income is:', ['₹1800', '₹2400', '₹2000', '₹2800'], 1, 'Let incomes 3x,4x and expenditures 2y,3y: 3x−2y=600, 4x−3y=600 → x=y=600 → B = 4×600 = ₹2400.', 'HARD'),
  q('aptitude-ratio', 'A mixture has milk and water 5:1. Adding 5 litres of water makes it 5:2. Milk quantity is:', ['20 L', '25 L', '30 L', '15 L'], 1, '1 part change = 5 L → milk 5 parts = 25 L.', 'MEDIUM'),

  q('aptitude-average', 'The average of first 50 natural numbers is:', ['25', '25.5', '26', '24.5'], 1, '(n+1)/2 = 25.5.', 'EASY'),
  q('aptitude-average', 'The average of 10 numbers is 15. If one number 20 is replaced by 40, the new average is:', ['16', '17', '18', '15'], 1, 'A + 20/10 = 15 + 2 = 17.', 'EASY'),
  q('aptitude-average', 'The average age of 24 students is 12 years. Including the teacher, it becomes 12.25. The teacher\'s age is:', ['18', '18.25', '19', '20'], 1, '12.25×25 − 12×24 = 306.25 − 288 = 18.25.', 'MEDIUM'),
  q('aptitude-average', 'The average of 11 results is 50. The average of the first six is 49 and the last six is 52. The 6th result is:', ['54', '56', '50', '52'], 1, '6×49 + 6×52 − 11×50 = 294+312−550 = 56.', 'HARD'),
  q('aptitude-average', 'A batsman scores 87 in the 17th innings, raising his average by 3. His average after 17 innings is:', ['39', '42', '36', '45'], 0, 'Let avg = x: 16x + 87 = 17(x+3) → x = 36 → new = 39.', 'HARD'),

  q('aptitude-number-system', 'The unit digit of 7¹⁰⁰ is:', ['1', '3', '7', '9'], 0, 'Cycle 7,9,3,1 with period 4; 100 mod 4 = 0 → 4th position → 1.', 'MEDIUM'),
  q('aptitude-number-system', 'The HCF of 36 and 84 is:', ['6', '12', '18', '9'], 1, '36 = 2²×3², 84 = 2²×3×7 → HCF = 12.', 'EASY'),
  q('aptitude-number-system', 'If HCF of two numbers is 12 and their product is 1728, their LCM is:', ['144', '132', '156', '168'], 0, 'LCM = 1728/12 = 144.', 'MEDIUM'),
  q('aptitude-number-system', 'Which of the following numbers is divisible by 11?', ['2728', '2738', '2748', '2758'], 0, 'Alternating digit sum of 2728: (2+2)−(7+8) = −11 → divisible by 11 (2728 = 11 × 248).', 'HARD'),
  q('aptitude-number-system', 'The smallest number that must be added to 1056 to make it divisible by 23 is:', ['2', '3', '1', '4'], 0, '1056 = 23×45 + 21 → add 2.', 'MEDIUM'),

  q('aptitude-time-work', 'A can do a work in 10 days, B in 15 days. Together they finish in:', ['6 days', '7 days', '5 days', '8 days'], 0, '10×15/25 = 6 days.', 'EASY'),
  q('aptitude-time-work', 'A pipe fills a tank in 6 hours; another empties it in 12 hours. Both open — the tank fills in:', ['9 hours', '12 hours', '8 hours', '6 hours'], 1, '1/6 − 1/12 = 1/12 → 12 hours.', 'EASY'),
  q('aptitude-time-work', 'A and B together complete work in 8 days; A alone in 12 days. B alone takes:', ['20 days', '24 days', '16 days', '18 days'], 1, 'B = 1/8 − 1/12 = 1/24 → 24 days.', 'MEDIUM'),
  q('aptitude-time-work', 'If 6 men can do a piece of work in 20 days, 15 men will do it in:', ['8 days', '10 days', '12 days', '9 days'], 0, '6×20 = 120 man-days → 120/15 = 8 days.', 'EASY'),
  q('aptitude-time-work', 'A is twice as efficient as B and finishes a job 12 days earlier than B. A alone takes:', ['12 days', '14 days', '10 days', '9 days'], 0, 'Rates 2:1 → times 1:2 → diff = 1 unit = 12 days → A = 12 days? Check: B = 24, diff = 12 ✓.', 'HARD'),

  q('aptitude-time-speed-distance', 'A 150 m train at 54 km/h crosses a pole in:', ['10 s', '12 s', '9 s', '15 s'], 0, '54 km/h = 15 m/s → 150/15 = 10 s.', 'EASY'),
  q('aptitude-time-speed-distance', 'A boat rows 12 km/h in still water; stream 4 km/h. Time to go 32 km downstream:', ['2 h', '2.5 h', '3 h', '4 h'], 0, '16 km/h → 2 hours.', 'EASY'),
  q('aptitude-time-speed-distance', 'Walking at 4 km/h, a man is 10 minutes late; at 5 km/h, 5 minutes early. Distance is:', ['4 km', '5 km', '6 km', '3 km'], 1, 'd/4 − d/5 = 15/60 → d/20 = 0.25 → 5 km.', 'MEDIUM'),
  q('aptitude-time-speed-distance', 'Two trains of 125 m each run at 54 and 36 km/h in opposite directions. Time to cross each other:', ['10 s', '12 s', '14 s', '16 s'], 0, 'Relative speed = 90 km/h = 25 m/s; combined length 250 m → 10 s.', 'HARD'),
  q('aptitude-time-speed-distance', 'A car covers the first half of a distance at 40 km/h and the second half at 60 km/h. Average speed:', ['50 km/h', '48 km/h', '45 km/h', '52 km/h'], 1, 'Harmonic mean: 2×40×60/100 = 48 km/h.', 'MEDIUM'),

  q('aptitude-profit-loss', 'An article bought for ₹450 is sold for ₹495. Profit % is:', ['10%', '11%', '12%', '9%'], 0, '45/450 = 10%.', 'EASY'),
  q('aptitude-profit-loss', 'Marked price ₹800; sold at 15% discount. Selling price:', ['₹680', '₹700', '₹660', '₹720'], 0, '800 × 0.85 = ₹680.', 'EASY'),
  q('aptitude-profit-loss', 'Selling at ₹540 yields 20% loss. Cost price is:', ['₹650', '₹675', '₹660', '₹700'], 1, 'CP = 540/0.8 = ₹675.', 'MEDIUM'),
  q('aptitude-profit-loss', 'A dishonest dealer sells at cost price using a 900 g weight per kg. His gain % is:', ['10%', '11.11%', '9%', '12.5%'], 1, '100/900 = 11.11%.', 'MEDIUM'),
  q('aptitude-profit-loss', 'By selling an item for ₹72 a trader loses 10%. To gain 20%, he should sell at:', ['₹96', '₹88', '₹92', '₹90'], 0, 'CP = 80; +20% → ₹96.', 'MEDIUM'),

  q('aptitude-si-ci', 'SI on ₹6000 at 8% for 3 years is:', ['₹1440', '₹1400', '₹1480', '₹1520'], 0, '6000×8×3/100 = 1440.', 'EASY'),
  q('aptitude-si-ci', 'CI on ₹5000 at 10% for 2 years (annual) is:', ['₹1000', '₹1050', '₹1100', '₹1025'], 1, '5000(1.21) = 6050 → CI 1050.', 'EASY'),
  q('aptitude-si-ci', 'CI − SI on a sum for 2 years at 5% is ₹25. The principal is:', ['₹10000', '₹8000', '₹12000', '₹5000'], 0, 'P(r/100)² = P×0.0025 = 25 → P = 10000.', 'MEDIUM'),
  q('aptitude-si-ci', 'A sum doubles itself in 8 years at simple interest. The rate is:', ['10%', '12.5%', '15%', '8%'], 1, '100/8 = 12.5%.', 'EASY'),
  q('aptitude-si-ci', '₹8000 at 10% CI half-yearly for 1 year amounts to:', ['₹8820', '₹8800', '₹8840', '₹8780'], 0, '8000(1.05)² = 8820.', 'MEDIUM'),

  q('aptitude-simplification', 'The value of 25 × 4.04 is:', ['100', '101', '102', '99'], 1, '25×4 + 25×0.04 = 101.', 'EASY'),
  q('aptitude-simplification', '999² = ?', ['998001', '999001', '99801', '989001'], 0, '(1000−1)² = 998001.', 'EASY'),
  q('aptitude-simplification', '√1089 = ?', ['31', '33', '37', '39'], 1, '33² = 1089.', 'EASY'),
  q('aptitude-simplification', 'If a + b = 10 and ab = 21, then a² + b² = ?', ['58', '79', '100', '42'], 0, '100 − 2×21 = 58.', 'MEDIUM'),

  q('aptitude-data-interpretation', 'In a pie chart of 360°, a sector of 54° represents what share?', ['12.5%', '15%', '18%', '20%'], 1, '54/360 = 15%.', 'EASY'),
  q('aptitude-data-interpretation', 'Sales: A 120, B 80, C 60. B\'s share of total is approximately:', ['30.8%', '33.3%', '25%', '28%'], 0, '80/260 ≈ 30.8%.', 'MEDIUM'),
  q('aptitude-data-interpretation', 'If production rises from 400 to 460 units, the growth rate is:', ['15%', '16%', '12%', '18%'], 0, '60/400 = 15%.', 'EASY'),
  q('aptitude-data-interpretation', 'Average of sales 120, 80, 60, 140 is:', ['100', '105', '95', '110'], 0, '400/4 = 100.', 'EASY'),

  q('aptitude-measurement', '1 hectare equals:', ['1000 m²', '10000 m²', '100 m²', '4047 m²'], 1, '10⁴ m² (an acre ≈ 4047 m²).', 'EASY'),
  q('aptitude-measurement', '1 knot equals approximately:', ['1.852 km/h', '1.609 km/h', '2.4 km/h', '1 km/h'], 0, 'Nautical mile per hour = 1.852 km/h.', 'MEDIUM'),
  q('aptitude-measurement', 'In a class-II lever, the load lies:', ['Between fulcrum and effort', 'Between effort and fulcrum — same', 'At the fulcrum', 'At the effort'], 0, 'Class II: load between fulcrum and effort (wheelbarrow).', 'HARD'),
  q('aptitude-measurement', '1 horsepower is approximately:', ['546 W', '646 W', '746 W', '1000 W'], 2, '≈746 watts.', 'MEDIUM'),

  // ─── REASONING ───
  q('reasoning-series', 'Find the next term: 2, 6, 12, 20, 30, ?', ['40', '42', '44', '46'], 1, 'Differences 4, 6, 8, 10, 12 → 30+12 = 42.', 'EASY'),
  q('reasoning-series', 'Find the next term: 3, 6, 12, 24, ?', ['30', '36', '48', '42'], 2, 'Geometric ×2 → 48.', 'EASY'),
  q('reasoning-series', 'Find the missing term: 1, 4, 9, 16, ?, 36', ['20', '24', '25', '27'], 2, 'Perfect squares → 25.', 'EASY'),
  q('reasoning-series', 'Find the next term: A, D, G, J, ?', ['L', 'M', 'N', 'K'], 1, '+3 each → M.', 'EASY'),

  q('reasoning-coding', 'If CAT is coded as ECV, then DOG is coded as:', ['FQI', 'EQI', 'FQJ', 'GQI'], 0, '+2 shift → F, Q, I.', 'EASY'),
  q('reasoning-coding', 'If RAIL is coded as 181912 (letter positions), then ROAD is:', ['181514', '181541', '181415', '151814'], 0, 'R18 O15 A1 D4 → 181514.', 'MEDIUM'),
  q('reasoning-coding', 'If MIRROR of a word means its reversal, then the reversal of LEVEL is:', ['LEVEL', 'LEVE', 'LVEEL', 'EVEL'], 0, 'LEVEL is a palindrome — reversal is LEVEL.', 'MEDIUM'),

  q('reasoning-blood-relations', 'Pointing to a photo, Ram said, "She is the daughter of my grandfather\'s only son." The girl is Ram\'s:', ['Sister', 'Cousin', 'Aunt', 'Niece'], 0, 'Grandfather\'s only son = Ram\'s father → his daughter = Ram\'s sister.', 'MEDIUM'),
  q('reasoning-blood-relations', 'A is B\'s brother, C is A\'s mother, D is C\'s father. How is A related to D?', ['Son', 'Grandson', 'Grandfather', 'Nephew'], 1, 'D is A\'s maternal grandfather → A is his grandson.', 'EASY'),
  q('reasoning-blood-relations', 'If P + Q means P is the father of Q, and P − Q means P is the sister of Q, then A + B − C means:', ['A is father of B; B is sister of C', 'A is father of C', 'C is sister of A', 'B is father of C'], 0, 'Parse left to right: A + B, then B − C.', 'MEDIUM'),

  q('reasoning-directions', 'A man walks 3 km north, turns right and walks 4 km. How far is he from the start?', ['5 km NE', '7 km', '5 km NW', '6 km NE'], 0, '√(9+16) = 5 km, north-east.', 'EASY'),
  q('reasoning-directions', 'Facing north, you turn 90° clockwise, then 180° anticlockwise. You now face:', ['East', 'West', 'North', 'South'], 1, 'N → E → (180° back) W.', 'MEDIUM'),
  q('reasoning-directions', 'In the evening, a person\'s shadow falls to his left. He is facing:', ['North', 'South', 'East', 'West'], 1, 'Evening shadow → east; shadow on left means facing south.', 'HARD'),

  q('reasoning-syllogism', 'Statements: All pens are books. Some books are copies. Conclusion: Some pens are copies is:', ['Definitely true', 'Definitely false', 'Not definite', 'Both I and II follow'], 2, 'The overlap need not include pens — not definite.', 'MEDIUM'),
  q('reasoning-syllogism', 'Statements: No dog is a cat. All cats are animals. Conclusions: I. No dog is an animal. II. Some animals are cats. Which follows?', ['Only I', 'Only II', 'Both', 'Neither'], 1, 'Dogs can still be other animals (I fails); "all cats are animals" implies some animals are cats (II follows).', 'MEDIUM'),
  q('reasoning-syllogism', 'Converse of "All A are B" is:', ['All B are A', 'Some B are A', 'No B is A', 'Some A are not B'], 1, 'Only "some B are A" necessarily follows.', 'MEDIUM'),

  q('reasoning-puzzles', 'Five friends P, Q, R, S, T sit in a row facing north. T is at the extreme left. S sits between P and Q, and R is to the right of Q. Who is at the extreme right?', ['R', 'Q', 'S', 'P'], 0, 'Order: T, P, S, Q, R → R is extreme right.', 'MEDIUM'),
  q('reasoning-puzzles', 'Six people sit around a circular table facing centre. A is opposite D, B is adjacent to A. Who sits opposite B?', ['D or E — cannot be fixed', 'C or E depending on side', 'Always C', 'Always E'], 0, 'Two arrangements possible → cannot be uniquely fixed.', 'HARD'),
  q('reasoning-puzzles', 'In a floor puzzle, F lives on an odd floor below floor 5 of a 6-floor building. Possible floors:', ['1, 3, 5', '1, 3', '3, 5', '1, 5'], 1, 'Odd below 5 → 1 and 3.', 'EASY'),

  // ─── ENGLISH ───
  q('english-grammar', 'Choose the correct sentence:', ['He has been working since two hours', 'He has been working for two hours', 'He is working since two hours', 'He works since two hours'], 1, '"For" + period of time.', 'EASY'),
  q('english-grammar', 'Fill in: "She is good ___ mathematics."', ['in', 'at', 'on', 'with'], 1, '"Good at" a subject/skill.', 'EASY'),
  q('english-grammar', 'Choose the correct article: "He is ___ university student."', ['a', 'an', 'the', 'no article'], 0, '"University" begins with a /juː/ consonant sound.', 'MEDIUM'),
  q('english-grammar', '"Each of the boys ___ present." Choose the correct verb:', ['were', 'was', 'are', 'have been'], 1, '"Each" takes a singular verb.', 'MEDIUM'),
  q('english-grammar', 'Identify the correctly formed sentence:', ['One of my friend is a doctor', 'One of my friends is a doctor', 'One of my friends are a doctor', 'One of my friend are a doctor'], 1, '"One of + plural noun + singular verb".', 'MEDIUM'),

  q('english-vocabulary', 'Choose the synonym of "abundant":', ['Scarce', 'Plentiful', 'Rare', 'Meagre'], 1, 'Abundant = plentiful.', 'EASY'),
  q('english-vocabulary', 'Choose the antonym of "benevolent":', ['Kind', 'Generous', 'Malevolent', 'Gracious'], 2, 'Malevolent = wishing harm.', 'MEDIUM'),
  q('english-vocabulary', '"To burn the midnight oil" means:', ['To waste resources', 'To work late into the night', 'To light lamps', 'To celebrate'], 1, 'Idiomatic: work/study late at night.', 'EASY'),
  q('english-vocabulary', 'One word for "a person who loves mankind" is:', ['Misogynist', 'Philanthropist', 'Egoist', 'Optimist'], 1, 'Philanthropist.', 'EASY'),
  q('english-vocabulary', '"Disinterested" means:', ['Bored', 'Impartial', 'Unwilling', 'Careless'], 1, 'Disinterested = unbiased; uninterested = bored — classic pair.', 'HARD'),

  q('english-comprehension', 'The main idea of a passage is usually found in:', ['Random sentences', 'The topic sentence/first or last paragraph', 'Footnotes', 'Titles of examples'], 1, 'Topic sentences and conclusion carry the central claim.', 'EASY'),
  q('english-comprehension', 'An "inference" question requires an answer that is:', ['Merely possible', 'Necessarily true from the passage', 'Your personal opinion', 'Always the longest option'], 1, 'Inferences must follow necessarily from the text.', 'MEDIUM'),
  q('english-comprehension', 'In EXCEPT/NOT questions, you should:', ['Pick the first option', 'Find the three options supported by the passage; the odd one is the answer', 'Choose the shortest', 'Skip it'], 1, 'Negative stems ask for the unsupported option.', 'MEDIUM'),

  q('english-error-spotting', 'Spot the error: "He is senior than me by two years."', ['senior', 'than', 'me', 'by'], 1, 'Latin comparatives take "to": senior to me.', 'MEDIUM'),
  q('english-error-spotting', 'Spot the error: "The scissors is lying on the table."', ['The', 'scissors', 'is', 'lying'], 2, '"Scissors" is a plural-only noun → are.', 'MEDIUM'),
  q('english-error-spotting', 'Spot the error: "He returned back home yesterday."', ['returned', 'back', 'home', 'yesterday'], 1, '"Returned back" is redundant — return alone suffices.', 'EASY'),
  q('english-error-spotting', 'Spot the error: "There are less students today."', ['There', 'are', 'less', 'today'], 2, 'Countable nouns take "fewer".', 'MEDIUM'),

  // ─── COMPUTER & BANKING ───
  q('computer-basics', 'RAM is:', ['Permanent memory', 'Volatile memory', 'Read-only', 'External storage'], 1, 'RAM loses data when power is off.', 'EASY'),
  q('computer-basics', 'SMTP is used for:', ['Receiving email', 'Sending email', 'Browsing', 'File transfer'], 1, 'Simple Mail Transfer Protocol sends mail; POP3/IMAP receive.', 'MEDIUM'),
  q('computer-basics', '1 GB equals:', ['1024 KB', '1024 MB', '1000 MB only', '1024 TB'], 1, 'Binary convention: 1024 MB.', 'EASY'),
  q('computer-basics', 'Ctrl + Z is the shortcut for:', ['Cut', 'Undo', 'Redo', 'Paste'], 1, 'Undo (Ctrl+Y = redo).', 'EASY'),
  q('computer-basics', 'Ransomware is a type of:', ['Hardware', 'Malicious software', 'Browser', 'Network protocol'], 1, 'It encrypts data and demands payment.', 'EASY'),

  q('banking-awareness', 'UPI is developed and operated by:', ['RBI', 'NPCI', 'SEBI', 'SBI'], 1, 'National Payments Corporation of India.', 'EASY'),
  q('banking-awareness', 'The minimum amount for RTGS transfer is:', ['₹1 lakh', '₹2 lakh', '₹50,000', 'No minimum'], 1, 'RTGS is for large-value transfers (≥ ₹2 lakh).', 'MEDIUM'),
  q('banking-awareness', 'NRE accounts are:', ['Taxable in India', 'Tax-free in India and fully repatriable', 'Only for residents', 'Fixed only'], 1, 'Non-Resident External accounts enjoy Indian tax exemption on interest.', 'HARD'),
  q('banking-awareness', 'Insurance sector in India is regulated by:', ['RBI', 'IRDAI', 'SEBI', 'PFRDA'], 1, 'Insurance Regulatory and Development Authority of India.', 'EASY'),

  // ─── NEET/JEE FOUNDATIONS ───
  q('neet-bio-cell', 'The fluid mosaic model of the plasma membrane was proposed by:', ['Singer and Nicolson', 'Robertson', 'Schleiden and Schwann', 'Watson and Crick'], 0, 'S. J. Singer and G. L. Nicolson (1972).', 'MEDIUM'),
  q('neet-bio-cell', 'Ribosomes in prokaryotes are of which type?', ['80S', '70S', '60S', '40S'], 1, '70S (50S + 30S subunits).', 'EASY'),
  q('neet-bio-cell', 'Which organelle is called the "suicide bag" of the cell?', ['Ribosome', 'Lysosome', 'Vacuole', 'Peroxisome'], 1, 'Lysosomes contain hydrolytic enzymes.', 'EASY'),
  q('neet-bio-cell', 'Cell theory was complemented by Virchow\'s statement:', ['Cells arise spontaneously', 'Omnis cellula-e cellula', 'All cells have nuclei', 'Cells are immortal'], 1, 'All cells arise from pre-existing cells.', 'MEDIUM'),

  q('neet-bio-human-physiology', 'Tidal volume in a healthy adult is approximately:', ['250 mL', '500 mL', '1000 mL', '1500 mL'], 1, '~500 mL per breath at rest.', 'EASY'),
  q('neet-bio-human-physiology', 'Most CO₂ is transported in blood as:', ['Carbaminohaemoglobin', 'Bicarbonate ions', 'Dissolved gas', 'Carbonic acid only'], 1, '~70% as HCO₃⁻ via carbonic anhydrase.', 'MEDIUM'),
  q('neet-bio-human-physiology', 'The respiratory rhythm centre is located in the:', ['Pons', 'Medulla oblongata', 'Cerebellum', 'Spinal cord'], 1, 'Medulla; pneumotaxic centre in pons moderates it.', 'MEDIUM'),

  q('neet-chem-mole-concept', 'The number of molecules in 9.8 g of H₂SO₄ (M = 98 g/mol) is:', ['6.022×10²³', '6.022×10²²', '3.011×10²³', '1.204×10²³'], 1, '0.1 mol × N_A = 6.022×10²².', 'MEDIUM'),
  q('neet-chem-mole-concept', 'Which concentration term is temperature-independent?', ['Molarity', 'Molality', 'Normality', 'Volume percent'], 1, 'Molality uses mass, not volume.', 'MEDIUM'),
  q('neet-chem-mole-concept', 'Molar volume of an ideal gas at STP (0 °C, 1 atm) is:', ['22.4 L', '22.7 L', '24.4 L', '20 L'], 0, '22.4 L under 1 atm convention (22.7 L at 1 bar).', 'EASY'),

  q('neet-physics-kinematics', 'A ball is thrown up at 20 m/s (g = 10 m/s²). Time to reach the highest point:', ['1 s', '2 s', '4 s', '0.5 s'], 1, 'u/g = 2 s.', 'EASY'),
  q('neet-physics-kinematics', 'The range of a projectile is maximum at:', ['30°', '45°', '60°', '90°'], 1, 'sin2θ = 1 at 45°.', 'EASY'),
  q('neet-physics-kinematics', 'The area under a velocity–time graph gives:', ['Acceleration', 'Displacement', 'Speed', 'Force'], 1, 'Displacement (can be signed).', 'EASY'),

  q('physics-units-dimensions', 'The dimensional formula of force is:', ['MLT⁻²', 'ML²T⁻²', 'ML⁻¹T⁻²', 'MLT⁻¹'], 0, 'F = ma → MLT⁻².', 'EASY'),
  q('physics-units-dimensions', 'How many base units does SI have?', ['5', '6', '7', '9'], 2, 'Seven: m, kg, s, A, K, mol, cd.', 'EASY'),
  q('physics-units-dimensions', 'Light-year is a unit of:', ['Time', 'Distance', 'Speed', 'Brightness'], 1, 'Distance light travels in a year.', 'EASY'),

  q('math-quadratic', 'The roots of x² − 5x + 6 = 0 are:', ['2 and 3', '−2 and −3', '1 and 6', '−1 and 6'], 0, 'Factorises to (x−2)(x−3).', 'EASY'),
  q('math-quadratic', 'The discriminant of ax² + bx + c = 0 is:', ['b² − 4ac', 'b² + 4ac', '4ac − b²', '2b − 4ac'], 0, 'D = b² − 4ac determines nature of roots.', 'EASY'),
  q('math-quadratic', 'If the sum of the roots of x² + px + q = 0 equals their product, then:', ['p = q', 'p = −q', 'p = 1', 'q = −1'], 1, 'Sum = −p, product = q → −p = q → p = −q.', 'MEDIUM'),
]
