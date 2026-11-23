// ─────────────────────────────────────────────────────────────────────────────
// BEAN Education — CUET (UG) domain-subject syllabus trees (Section II, 23 subjects).
// Every unit below is transcribed from the OFFICIAL NTA subject syllabus PDFs
// hosted on cuet.nta.nic.in (CUET UG 2026 cycle, verified October 2026):
//   https://cuet.nta.nic.in/cuetug-2026-syllabus/
// Domain-subject syllabus = Class-12 NCERT, per the official bulletin.
// Topics WITHOUT a canonical have no note/question material yet — the UI shows
// them honestly as "material in progress". Nothing generic is substituted.
// ─────────────────────────────────────────────────────────────────────────────

import type { SubjectSeed } from './exams'

const t = (slug: string, name: string, canonical?: string, description?: string) =>
  canonical ? { slug, name, canonical, description } : { slug, name, description }

export const CUET_DOMAIN_SUBJECTS: SubjectSeed[] = [
  {
    slug: 'accountancy', name: 'Accountancy / Book Keeping', icon: 'Calculator',
    description: 'Official units: partnership accounts, reconstitution and dissolution, company accounts and analysis of financial statements.',
    units: [
      { slug: 'acc-partnership', name: 'Accounting for Partnership', topics: [t('acc-partnership', 'Partnership Deed, Capital & Profit Division', 'cuet-acc-partnership')] },
      { slug: 'acc-reconstitution', name: 'Reconstitution of Partnership', topics: [t('acc-reconstitution', 'Admission, Retirement/Death & Goodwill', 'cuet-acc-reconstitution')] },
      { slug: 'acc-dissolution', name: 'Dissolution of Partnership Firm', topics: [t('acc-dissolution', 'Realisation Account & Settlement of Accounts')] },
      { slug: 'acc-company', name: 'Company Accounts: Shares & Debentures', topics: [t('acc-company', 'Issue/Allotment of Equity & Preference Shares, Debentures', 'cuet-acc-company')] },
      { slug: 'acc-fsa', name: 'Analysis of Financial Statements', topics: [t('acc-fsa', 'Comparative Statements, Ratios & Cash Flow (Basics)', 'cuet-acc-fsa')] },
    ],
  },
  {
    slug: 'agriculture', name: 'Agriculture',
    description: 'Official units: agrometeorology/genetics/biochemistry, livestock production, crop production and horticulture.',
    units: [
      { slug: 'agr-agrometeorology', name: 'Agrometeorology, Genetics & Plant Breeding, Biochemistry and Microbiology', topics: [t('agr-agrometeorology', 'Weather, Crop Genetics & Microbiology Basics')] },
      { slug: 'agr-livestock', name: 'Livestock Production', topics: [t('agr-livestock', 'Dairy, Poultry & Animal Husbandry')] },
      { slug: 'agr-crop', name: 'Crop Production', topics: [t('agr-crop', 'Field Crops, Irrigation & Weed Management')] },
      { slug: 'agr-horticulture', name: 'Horticulture', topics: [t('agr-horticulture', 'Fruits, Vegetables & Post-harvest Care')] },
    ],
  },
  {
    slug: 'anthropology', name: 'Anthropology',
    description: 'Official units: physical, archaeological, socio-cultural, linguistic/tribal and applied anthropology.',
    units: [
      { slug: 'ant-physical', name: 'Physical / Biological Anthropology', topics: [t('ant-physical', 'Human Evolution, Genetics & Variation')] },
      { slug: 'ant-archaeological', name: 'Archaeological Anthropology', topics: [t('ant-archaeological', 'Prehistory, Dating Methods & Material Culture')] },
      { slug: 'ant-socio-cultural', name: 'Socio-Cultural Anthropology', topics: [t('ant-socio-cultural', 'Kinship, Marriage, Family & Religion')] },
      { slug: 'ant-linguistic-tribal', name: 'Linguistic and Tribal Anthropology', topics: [t('ant-linguistic-tribal', 'Indian Tribes, Languages & Classification')] },
      { slug: 'ant-applied', name: 'Social Change and Applied Anthropology', topics: [t('ant-applied', 'Applied Anthropology & Development')] },
    ],
  },
  {
    slug: 'biology', name: 'Biology / Biological Science / Biotechnology / Biochemistry', icon: 'Leaf',
    description: 'Official units follow NCERT Class-12 Biology: reproduction, genetics & evolution, biology & human welfare, biotechnology, ecology.',
    units: [
      { slug: 'bio-reproduction', name: 'Reproduction', topics: [t('bio-reproduction', 'Sexual Reproduction in Flowering Plants & Humans', 'cuet-bio-reproduction')] },
      { slug: 'bio-genetics', name: 'Genetics and Evolution', topics: [t('bio-genetics', 'Inheritance, Molecular Basis & Evolution', 'cuet-bio-genetics')] },
      { slug: 'bio-welfare', name: 'Biology and Human Welfare', topics: [t('bio-welfare', 'Health & Disease, Microbes in Human Welfare')] },
      { slug: 'bio-biotech', name: 'Biotechnology and its Applications', topics: [t('bio-biotech', 'Principles, Processes & Applications of Biotechnology', 'cuet-bio-biotech')] },
      { slug: 'bio-ecology', name: 'Ecology and Environment', topics: [t('bio-ecology', 'Organisms, Populations, Ecosystem & Biodiversity', 'cuet-bio-ecology')] },
    ],
  },
  {
    slug: 'business-studies', name: 'Business Studies', icon: 'Briefcase',
    description: 'Official units follow NCERT Class-12 Business Studies: management principles and functions, finance, marketing and consumer protection.',
    units: [
      { slug: 'bst-nature', name: 'Nature and Significance of Management', topics: [t('bst-nature', 'Management: Concept, Levels & Functions', 'cuet-bst-management')] },
      { slug: 'bst-principles', name: 'Principles of Management', topics: [t('bst-principles', "Fayol's Principles & Taylor's Scientific Management", 'cuet-bst-principles')] },
      { slug: 'bst-environment', name: 'Business Environment', topics: [t('bst-environment', 'Dimensions of Business Environment')] },
      { slug: 'bst-planning', name: 'Planning', topics: [t('bst-planning', 'Planning Process & Types of Plans', 'cuet-bst-planning')] },
      { slug: 'bst-organising', name: 'Organising', topics: [t('bst-organising', 'Organisational Structures & Delegation')] },
      { slug: 'bst-staffing', name: 'Staffing', topics: [t('bst-staffing', 'Recruitment, Selection & Training', 'cuet-bst-staffing')] },
      { slug: 'bst-directing', name: 'Directing', topics: [t('bst-directing', 'Motivation, Leadership & Communication')] },
      { slug: 'bst-controlling', name: 'Controlling', topics: [t('bst-controlling', 'Controlling Process & Techniques')] },
      { slug: 'bst-finance', name: 'Business Finance', topics: [t('bst-finance', 'Financial Management & Markets')] },
      { slug: 'bst-marketing', name: 'Marketing', topics: [t('bst-marketing', 'Marketing Mix & Branding', 'cuet-bst-marketing')] },
      { slug: 'bst-consumer', name: 'Consumer Protection', topics: [t('bst-consumer', 'Consumer Rights & Redressal')] },
    ],
  },
  {
    slug: 'chemistry', name: 'Chemistry', icon: 'FlaskConical',
    description: 'Official units follow NCERT Class-12 Chemistry: solutions, electrochemistry, kinetics, inorganic coordination and organic chemistry.',
    units: [
      { slug: 'chem-solutions', name: 'Solutions', topics: [t('chem-solutions', 'Concentration, Colligative Properties & Abnormal Mass', 'cuet-chem-solutions')] },
      { slug: 'chem-electrochemistry', name: 'Electrochemistry', topics: [t('chem-electrochemistry', 'EMF, Nernst Equation, Conductance & Electrolysis', 'cuet-chem-electrochemistry')] },
      { slug: 'chem-kinetics', name: 'Chemical Kinetics', topics: [t('chem-kinetics', 'Rate Law, Order, Half-life & Arrhenius Equation', 'cuet-chem-kinetics')] },
      { slug: 'chem-d-f-block', name: 'd- and f-Block Elements', topics: [t('chem-d-f-block', 'Transition Metals, Lanthanoids & Actinoids', 'cuet-chem-d-f-block')] },
      { slug: 'chem-coordination', name: 'Coordination Compounds', topics: [t('chem-coordination', 'Ligands, Nomenclature, VBT & CFT', 'cuet-chem-coordination')] },
      { slug: 'chem-haloalkanes', name: 'Haloalkanes and Haloarenes', topics: [t('chem-haloalkanes', 'C–X Bond, Substitution Reactions & Uses')] },
      { slug: 'chem-alcohols', name: 'Alcohols, Phenols and Ethers', topics: [t('chem-alcohols', 'Preparation, Properties & Acidity of Phenol')] },
      { slug: 'chem-aldehydes', name: 'Aldehydes, Ketones and Carboxylic Acids', topics: [t('chem-aldehydes', 'Carbonyl Chemistry & Named Reactions', 'cuet-chem-aldehydes')] },
      { slug: 'chem-amines', name: 'Amines', topics: [t('chem-amines', 'Diazonium Salts & Amines Reactions')] },
      { slug: 'chem-biomolecules', name: 'Biomolecules', topics: [t('chem-biomolecules', 'Carbohydrates, Proteins, Nucleic Acids & Vitamins')] },
    ],
  },
  {
    slug: 'environmental-science', name: 'Environmental Science', icon: 'Globe',
    description: 'Official units: ecological thought and sustainable development, population & conservation ecology, natural resources, pollution and environmental issues.',
    units: [
      { slug: 'env-nature', name: 'Human Beings and Nature', topics: [t('env-nature', 'Ecological Thought, Deep/Shallow Ecology & Sustainable Development')] },
      { slug: 'env-population', name: 'Population and Conservation Ecology', topics: [t('env-population', 'Population Dynamics, Demographic Transition & Conservation')] },
      { slug: 'env-monitoring', name: 'Natural Resources, Pollution & Environmental Monitoring', topics: [t('env-monitoring', 'Resource Use, Pollution & Monitoring (per official PDF)')] },
    ],
  },
  {
    slug: 'computer-science', name: 'Computer Science / Information Practices', icon: 'Cpu',
    description: 'Official structure: common Section A (database concepts, SQL, networks) plus Computer Science (Python, data handling) and Informatics Practices (Pandas, Matplotlib, societal impacts).',
    units: [
      { slug: 'cs-database', name: 'Section A — Database Concepts & SQL', topics: [t('cs-database', 'Relational Model, Keys, SQL DDL/DML & Functions', 'cuet-cs-database')] },
      { slug: 'cs-networks', name: 'Section A — Computer Networks', topics: [t('cs-networks', 'Network Types, Devices, Topologies & Protocols', 'cuet-cs-networks')] },
      { slug: 'cs-python', name: 'Section B1 — Python Programming & Data', topics: [t('cs-python', 'Python Basics, Exception/File Handling, Stack, Searching & Sorting', 'cuet-cs-python')] },
      { slug: 'cs-pandas', name: 'Section B2 — Pandas & Matplotlib', topics: [t('cs-pandas', 'Series/DataFrames, Plotting & Data Handling')] },
      { slug: 'cs-society', name: 'Section B2 — Societal Impacts', topics: [t('cs-society', 'Digital Footprint, Cyber Crime & e-Waste')] },
    ],
  },
  {
    slug: 'economics', name: 'Economics / Business Economics', icon: 'TrendingUp',
    description: 'Official structure: Introductory Microeconomics (consumer, producer, market forms) and Introductory Macroeconomics (national income, money, budget, foreign exchange).',
    units: [
      { slug: 'econ-micro-intro', name: 'Microeconomics — Introduction', topics: [t('econ-micro-intro', 'Central Problems, PPC & Opportunity Cost', 'cuet-econ-micro')] },
      { slug: 'econ-demand', name: 'Consumer Behaviour and Demand', topics: [t('econ-demand', 'Utility, Demand Curve & Elasticity', 'cuet-econ-demand')] },
      { slug: 'econ-producer', name: 'Producer Behaviour and Supply', topics: [t('econ-producer', 'Production Function, Cost, Revenue & Supply', 'cuet-econ-producer')] },
      { slug: 'econ-market', name: 'Forms of Market and Price Determination', topics: [t('econ-market', 'Perfect Competition & Market Equilibrium')] },
      { slug: 'econ-macro-ni', name: 'Macroeconomics — National Income & Related Aggregates', topics: [t('econ-macro-ni', 'GDP, GNP, Methods of Estimating National Income', 'cuet-econ-macro-ni')] },
      { slug: 'econ-money', name: 'Money and Banking', topics: [t('econ-money', 'Money Supply, RBI & Credit Creation', 'cuet-econ-money')] },
      { slug: 'econ-income-determination', name: 'Determination of Income and Employment', topics: [t('econ-income-determination', 'AD, AS, Investment Multiplier & Equilibrium')] },
      { slug: 'econ-budget-bop', name: 'Government Budget and the Economy / Balance of Payments', topics: [t('econ-budget-bop', 'Budget Components, Deficits & Exchange Rate', 'cuet-econ-budget-bop')] },
    ],
  },
  {
    slug: 'fine-arts', name: 'Fine Arts / Visual Arts / Commercial Arts',
    description: 'The official syllabus PDF for this subject is image-based; the full unit-wise text is being digitised. Until then, the official PDF itself is the reference — we do not guess unit names.',
    units: [
      { slug: 'fa-official', name: 'Full Official Syllabus (see PDF)', topics: [t('fa-official', 'Complete Unit List in the Official Syllabus PDF')] },
    ],
  },
  {
    slug: 'geography', name: 'Geography / Geology', icon: 'Map',
    description: 'Official structure: Fundamentals of Human Geography (Part I) and India: People and Economy (Part II).',
    units: [
      { slug: 'geo-part1', name: 'Part I — Fundamentals of Human Geography', topics: [
        t('geo-nature-scope', 'Human Geography: Nature and Scope'),
        t('geo-people-world', 'People (World): Population, Migration & Human Development'),
        t('geo-activities', 'Human Activities: Agriculture, Industry & Tertiary'),
        t('geo-transport-trade', 'Transport, Communication and Trade'),
      ] },
      { slug: 'geo-part2', name: 'Part II — India: People and Economy', topics: [
        t('geo-people-india', 'People (India): Density, Growth & Migration'),
        t('geo-settlements', 'Human Settlements: Rural & Urban'),
        t('geo-resources', 'Resources and Development'),
        t('geo-trade-india', 'Transport, Communication & International Trade'),
        t('geo-issues', 'Geographical Perspective on Selected Issues'),
      ] },
    ],
  },
  {
    slug: 'history', name: 'History', icon: 'Landmark',
    description: 'Official structure: Themes in Indian History, Parts I–III (NCERT Class-12 Themes in Indian History).',
    units: [
      { slug: 'hist-part1', name: 'Themes in Indian History — Part I', topics: [
        t('hist-theme1', 'Theme I: The Story of the First Cities — Harappan Archaeology', 'cuet-hist-harappan'),
        t('hist-theme2', 'Theme II: Political & Economic History through Inscriptions', 'cuet-hist-theme2'),
        t('hist-theme3', 'Theme III: Social Histories through the Mahabharata'),
        t('hist-theme4', 'Theme IV: A History of Buddhism — the Sanchi Stupa'),
      ] },
      { slug: 'hist-part2', name: 'Themes in Indian History — Part II', topics: [
        t('hist-theme5', 'Theme V: Agrarian Relations — the Ain-i-Akbari', 'cuet-hist-theme5'),
        t('hist-theme6', 'Theme VI: New Architecture — Hampi'),
        t('hist-theme7', 'Theme VII: Religious Histories — the Bhakti–Sufi Tradition'),
        t('hist-theme8', 'Theme VIII: Medieval Society through Travellers\u2019 Accounts'),
      ] },
      { slug: 'hist-part3', name: 'Themes in Indian History — Part III', topics: [
        t('hist-theme9', 'Theme IX: Colonialism and Rural Society'),
        t('hist-theme10', 'Theme X: Representations of 1857'),
        t('hist-theme11', 'Theme XI: Mahatma Gandhi through Contemporary Eyes', 'cuet-hist-theme11'),
        t('hist-theme12', 'Theme XII: The Making of the Constitution', 'cuet-hist-theme12'),
      ] },
    ],
  },
  {
    slug: 'home-science', name: 'Home Science',
    description: 'Official units: work & career, nutrition, human development, fabric & apparel, resource management, communication & extension.',
    units: [
      { slug: 'hs-work', name: 'Work, Livelihood and Career', topics: [t('hs-work', 'Careers in Home Science & Work Economics')] },
      { slug: 'hs-nutrition', name: 'Nutrition, Food Science and Technology', topics: [t('hs-nutrition', 'Nutrients, Meal Planning & Food Safety')] },
      { slug: 'hs-development', name: 'Human Development and Family Studies', topics: [t('hs-development', 'Growth, Development & Family Dynamics')] },
      { slug: 'hs-fabric', name: 'Fabric and Apparel', topics: [t('hs-fabric', 'Fibres, Fabric Construction & Care')] },
      { slug: 'hs-resources', name: 'Resource Management', topics: [t('hs-resources', 'Time/Money Management & Ergonomics')] },
      { slug: 'hs-communication', name: 'Communication and Extension', topics: [t('hs-communication', 'Extension, Communication & Community Outreach')] },
    ],
  },
  {
    slug: 'ktpi', name: 'Knowledge Tradition & Practices of India',
    description: 'Official survey units (from the 2026 syllabus PDF): agriculture, architecture, dance, education systems and other technologies — spanning primary texts and practices.',
    units: [
      { slug: 'ktpi-agriculture', name: 'Agriculture: A Survey', topics: [t('ktpi-agriculture', 'Agriculture in Texts & Practice, from Prehistory Onwards')] },
      { slug: 'ktpi-architecture', name: 'Architecture: A Survey', topics: [t('ktpi-architecture', 'Early & Classical Architecture, Temple & Rock-Cut Structures')] },
      { slug: 'ktpi-dance', name: 'Dance: A Survey', topics: [t('ktpi-dance', 'Classical & Folk Dance Traditions, Primary Texts')] },
      { slug: 'ktpi-education', name: 'Education Systems and Practices: A Survey', topics: [t('ktpi-education', 'Gurukulas, Tols, Universities & Pedagogy')] },
      { slug: 'ktpi-technologies', name: 'Other Technologies: A Survey', topics: [t('ktpi-technologies', 'Metallurgy, Textiles, Water Management & More')] },
    ],
  },
  {
    slug: 'mass-media', name: 'Mass Media / Mass Communication',
    description: 'Official units: communication, journalism, advertising & PR, radio, television, cinema and social media.',
    units: [
      { slug: 'mm-communication', name: 'Communication', topics: [t('mm-communication', 'Models of Communication, Culture & Media Evolution')] },
      { slug: 'mm-journalism', name: 'Journalism', topics: [t('mm-journalism', 'News Values, Reporting, Editing & Media Ethics')] },
      { slug: 'mm-advertising', name: 'Advertising and Public Relations', topics: [t('mm-advertising', 'Ad Process, PR Tools & Campaigns')] },
      { slug: 'mm-radio-tv-cinema', name: 'Radio, Television & Cinema', topics: [t('mm-radio-tv-cinema', 'Broadcast Media: History, Formats & Roles')] },
      { slug: 'mm-social-media', name: 'Social Media', topics: [t('mm-social-media', 'Platforms, Dynamics & Digital Citizenship')] },
    ],
  },
  {
    slug: 'mathematics', name: 'Mathematics / Applied Mathematics', icon: 'Sigma',
    description: 'Official structure: Section B1 Mathematics (relations & functions, algebra, calculus, vectors & 3D geometry, LPP, probability) and Section B2 Applied Mathematics (numerical applications, financial mathematics, statistics).',
    units: [
      { slug: 'math-relations', name: 'B1 — Relations, Functions & Inverse Trigonometry', topics: [t('math-relations', 'Relations, Functions & Inverse Trigonometric Functions', 'cuet-math-relations')] },
      { slug: 'math-algebra', name: 'B1 — Algebra: Matrices & Determinants', topics: [t('math-algebra', 'Matrices, Determinants & Linear Equations', 'cuet-math-matrices')] },
      { slug: 'math-calculus', name: 'B1 — Calculus & Differential Equations', topics: [t('math-calculus', 'Continuity, Differentiability, Integrals & Differential Equations', 'cuet-math-calculus')] },
      { slug: 'math-vectors', name: 'B1 — Vectors and Three-Dimensional Geometry', topics: [t('math-vectors', 'Vectors, Lines & Planes', 'cuet-math-vectors')] },
      { slug: 'math-lpp-prob', name: 'B1 — Linear Programming & Probability', topics: [t('math-lpp-prob', 'LPP Graphical Method & Probability Distributions', 'cuet-math-lpp-prob')] },
      { slug: 'math-applied', name: 'B2 — Applied Mathematics', topics: [t('math-applied', 'Numerical Applications, Financial Mathematics & Statistics')] },
    ],
  },
  {
    slug: 'performing-arts', name: 'Performing Arts (Dance, Drama, Music)',
    description: 'Official structure: Section A (Hindustani/Karnatak music theory — sound, raga, tala, musical forms, musicians, instruments) plus dance and drama electives.',
    units: [
      { slug: 'pa-music-theory', name: 'Section A — Music Theory (Hindustani & Karnatak)', topics: [t('pa-music-theory', 'Sangeet, Nad, Shruti, Swara, Raga, Tala & Musical Forms')] },
      { slug: 'pa-dance', name: 'Dance', topics: [t('pa-dance', 'Classical Dance Traditions & Repertoire')] },
      { slug: 'pa-drama', name: 'Drama / Theatre', topics: [t('pa-drama', 'Theatre Forms, Stagecraft & Plays')] },
    ],
  },
  {
    slug: 'physical-education', name: 'Physical Education (Yoga, Sports)',
    description: 'The official syllabus PDF for this subject is image-based; the full unit-wise text is being digitised. Until then, the official PDF itself is the reference — we do not guess unit names.',
    units: [
      { slug: 'pe-official', name: 'Full Official Syllabus (see PDF)', topics: [t('pe-official', 'Complete Unit List in the Official Syllabus PDF')] },
    ],
  },
  {
    slug: 'physics', name: 'Physics', icon: 'Atom',
    description: 'Official units follow NCERT Class-12 Physics: electrostatics to electronic devices (9 units in the 2026 syllabus).',
    units: [
      { slug: 'phy-electrostatics', name: 'Unit 1: Electrostatics', topics: [t('phy-electrostatics', 'Charges, Coulomb\u2019s Law, Field, Potential & Capacitors', 'cuet-phy-electrostatics')] },
      { slug: 'phy-current', name: 'Unit 2: Current Electricity', topics: [t('phy-current', 'Ohm\u2019s Law, Kirchhoff\u2019s Laws, Cells & Wheatstone Bridge', 'cuet-phy-current')] },
      { slug: 'phy-magnetism', name: 'Unit 3: Magnetic Effects of Current and Magnetism', topics: [t('phy-magnetism', 'Biot–Savart, Ampere\u2019s Law, Moving-Charge Forces & Magnets', 'cuet-phy-magnetism')] },
      { slug: 'phy-emi-ac', name: 'Unit 4: Electromagnetic Induction and Alternating Currents', topics: [t('phy-emi-ac', 'Faraday\u2019s Law, Lenz\u2019s Law, Inductance, LCR & Transformers', 'cuet-phy-emi-ac')] },
      { slug: 'phy-em-waves', name: 'Unit 5: Electromagnetic Waves', topics: [t('phy-em-waves', 'EM Spectrum & Wave Characteristics')] },
      { slug: 'phy-optics', name: 'Unit 6: Optics', topics: [t('phy-optics', 'Ray Optics, Instruments, Wave Optics & Interference', 'cuet-phy-optics')] },
      { slug: 'phy-dual-nature', name: 'Unit 7: Dual Nature of Matter and Radiation', topics: [t('phy-dual-nature', 'Photoelectric Effect & de Broglie Waves')] },
      { slug: 'phy-atoms-nuclei', name: 'Unit 8: Atoms and Nuclei', topics: [t('phy-atoms-nuclei', 'Atomic Models, Radioactivity & Nuclear Energy')] },
      { slug: 'phy-devices', name: 'Unit 9: Electronic Devices', topics: [t('phy-devices', 'Semiconductors, Diodes & Logic Gates')] },
    ],
  },
  {
    slug: 'political-science', name: 'Political Science', icon: 'Scale',
    description: 'Official structure: Politics in India Since Independence (9 topics) and Contemporary World Politics (7 topics).',
    units: [
      { slug: 'psc-india', name: 'Politics in India Since Independence', topics: [
        t('psc-one-party', 'Era of One-Party Dominance', 'cuet-psc-one-party'),
        t('psc-nation-building', 'Nation-Building and Its Problems'),
        t('psc-planned-development', 'Politics of Planned Development'),
        t('psc-external-relations', 'India\u2019s External Relations'),
        t('psc-congress-system', 'Challenge to and Restoration of Congress System'),
        t('psc-crisis', 'Crises of the Constitutional Order', 'cuet-psc-crisis'),
        t('psc-regional', 'Regional Aspirations and Conflicts'),
        t('psc-coalition', 'Democratic Upsurge and Coalition Politics', 'cuet-psc-coalition'),
        t('psc-recent', 'Recent Issues and Challenges'),
      ] },
      { slug: 'psc-world', name: 'Contemporary World Politics', topics: [
        t('cwp-bipolarity', 'End of Bipolarity: Disintegration of the \u2018Second World\u2019', 'cuet-cwp-bipolarity'),
        t('cwp-alternative', 'Alternative Centres of Economic and Political Power'),
        t('cwp-south-asia', 'South Asia in the Post-Cold War Era'),
        t('cwp-un', 'International Organisations in a Unipolar World'),
        t('cwp-security', 'Security in the Contemporary World'),
        t('cwp-environment', 'Environment and Natural Resources in Global Politics'),
        t('cwp-globalisation', 'Globalisation and Its Critics', 'cuet-cwp-globalisation'),
      ] },
    ],
  },
  {
    slug: 'psychology', name: 'Psychology', icon: 'Brain',
    description: 'Official units follow NCERT Class-12 Psychology: attributes, self & personality, life challenges, disorders, therapy, social cognition and group processes.',
    units: [
      { slug: 'psy-attributes', name: 'Variations in Psychological Attributes', topics: [t('psy-attributes', 'Intelligence, Aptitude & Psychological Assessment')] },
      { slug: 'psy-self', name: 'Self and Personality', topics: [t('psy-self', 'Self-Concept, Personality Theories & Assessment')] },
      { slug: 'psy-challenges', name: 'Meeting Life Challenges', topics: [t('psy-challenges', 'Stress, Coping & Well-being')] },
      { slug: 'psy-disorders', name: 'Psychological Disorders', topics: [t('psy-disorders', 'Classification & Major Disorders')] },
      { slug: 'psy-therapy', name: 'Therapeutic Approaches', topics: [t('psy-therapy', 'Psychotherapy, CBT & Rehabilitation')] },
      { slug: 'psy-attitude', name: 'Attitude and Social Cognition', topics: [t('psy-attitude', 'Attitudes, Stereotypes & Attribution')] },
      { slug: 'psy-groups', name: 'Social Influence and Group Processes', topics: [t('psy-groups', 'Conformity, Compliance & Group Dynamics')] },
    ],
  },
  {
    slug: 'sanskrit', name: 'Sanskrit (Domain Subject)',
    description: 'Official units (2026 syllabus): shabda-rupani & vibhakti usage, dhatu-rupani across five lakaras, sandhi, samasa, karaka, and prescribed classical texts.',
    units: [
      { slug: 'sk-shabda', name: 'शब्दरूपाणि — वाक्येषु विभक्तिप्रयोगाः', topics: [t('sk-shabda', 'Noun Declensions (Ajanta/Halanta) & Case Usage in Sentences')] },
      { slug: 'sk-dhatu', name: 'धातुरूपाणि', topics: [t('sk-dhatu', 'Verb Forms — Parasmaipada/Atmanepada, Five Lakaras')] },
      { slug: 'sk-sandhi-samasa', name: 'सन्धि / समास / कारक', topics: [t('sk-sandhi-samasa', 'Sandhi, Samasa & Karaka Constructions')] },
      { slug: 'sk-texts', name: 'Prescribed Texts', topics: [t('sk-texts', 'Passages & Verses from the Official Prescribed Reading')] },
    ],
  },
  {
    slug: 'sociology', name: 'Sociology', icon: 'Users',
    description: 'Official structure: Indian Society (structure, institutions, inequality, unity in diversity) and Social Change and Development in India.',
    units: [
      { slug: 'soc-society', name: 'Part I — Indian Society', topics: [
        t('soc-structure', 'Structure of Indian Society'),
        t('soc-institutions', 'Social Institutions: Continuity and Change'),
        t('soc-inequality', 'Social Inequality and Exclusion'),
        t('soc-unity', 'The Challenges of Unity in Diversity'),
      ] },
      { slug: 'soc-change', name: 'Part II — Social Change and Development in India', topics: [
        t('soc-change-process', 'Process of Social Change in India'),
        t('soc-polity', 'Social Change and the Polity'),
        t('soc-economy', 'Social Change and the Economy'),
        t('soc-arenas', 'New Arenas of Social Change'),
        t('soc-movements', 'Social Movements'),
      ] },
    ],
  },
]
