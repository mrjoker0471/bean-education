# BEAN Classroom Intelligence — Multi-Agent Fleet, Domain Expertise & Multilingual Operating Charter

**Product:** BEAN Education / BEAN Teach  
**System:** BEAN Classroom Intelligence  
**Document type:** Product, agent-behaviour, architecture, knowledge and safety specification  
**Status:** Proposed implementation charter; not a claim that all capabilities are already implemented  
**Suggested milestone:** CI-3 — Agent Fleet & World Knowledge Architecture  
**Suggested feature branch:** `feat/bean-classroom-intelligence-agent-fleet`

---

## 1. Mission

Expand BEAN Classroom Intelligence from its current learner-perspective agent, teacher-judge agent and deterministic evaluation orchestrator into a **scalable fleet of specialised educational agents**.

The fleet should be able to support many concurrent BEAN Teach classes, select the right subject and profession specialists for each lesson, understand multilingual educational material where supported, produce useful student and teacher outcomes, and preserve the evidence, consent, privacy and human-review protections established in CI-1 and CI-2.

The target is not a fixed set of three prompts. It is a versioned, observable, testable **agent workforce** with:

- a small number of stable core roles;
- dynamically selected subject and profession specialists;
- a reusable profession, skill and subject knowledge catalogue;
- multilingual text and, only with consent, speech-processing adapters;
- bounded parallelism for many classes;
- one consistent evidence and safety contract;
- human review for consequential decisions.

### 1.1 What “expert in every profession and subject” means operationally

BEAN should aim for an **expandable global coverage system**, not make an impossible promise that any model literally knows every profession, every subject, every local regulation or every language perfectly.

Coverage must be demonstrated by:

1. a maintained taxonomy of subjects, occupations, skills and competencies;
2. versioned domain packs with credible source material;
3. specialists selected for the current class and task;
4. measured subject- and language-specific evaluations;
5. explicit uncertainty and unsupported-domain handling;
6. a repeatable process for adding new domains and languages.

Never label a specialist “expert” merely because its system prompt says so. A capability is only **verified** after suitable reference tests, source coverage and review.

---

## 2. Current BEAN baseline and dependency gate

CI-1 and CI-2 have already established BEAN-native evaluation, durable evaluation jobs, authorised evidence, teacher disputes, student class summaries, reliability tests and privacy controls. Extend that implementation; do not replace it.

At the latest repository check performed while preparing this charter:

- `main` was observed at `4f4cbe73e70178ad608d041266b18a490dd75864` (PR #33 merge).
- `feat/bean-classroom-intelligence-ci2` was observed at `7abd15ff1dad751170efff3d75f52e7369520c8d`.
- That branch compared as six commits ahead and one commit behind `main`.
- The six additional CI-2 commits had not yet been merged through a follow-up PR at the time checked.
- The CI run associated with `7abd15f` was reported as successful by GitHub Actions run `45331311419`.

These are planning checkpoints, **not permanent refs**. Re-fetch GitHub before implementation. Do not assume the above state is still current.

### 2.1 Required order

1. Inspect the current `main`, CI-2 branch, all PRs, actions and worktrees.
2. Preserve and complete the outstanding CI-2 follow-up changes through the repository's normal PR process.
3. Start CI-3 from the latest verified `origin/main` after the dependency state is clear.
4. Do not cherry-pick old CI-2 work onto CI-3 if it is already present in main.
5. Do not fast-forward, delete or rewrite any branch containing unique work.

---

## 3. Open-source foundation research and recommended adaptation

The “FilmCraft trick” for this project means: **start from a proven open-source foundation, inspect its architecture and licence, reuse the smallest useful subsystems, adapt them to BEAN's workflow, and preserve a clear path to upstream updates. Do not rebuild mature infrastructure just to put a BEAN label on it.**

### 3.1 Primary real-time runtime candidate — LiveKit Agents for Node.js

Repository: https://github.com/livekit/agents-js  
Licence: Apache-2.0 for the framework; check every plugin and model licence separately.  
Why it is the first candidate:

- BEAN already uses LiveKit for classrooms.
- It is the Node.js distribution of LiveKit Agents and fits the existing TypeScript/Node ecosystem better than introducing a Python sidecar by default.
- It is designed for server-side programmatic participants and real-time multimodal agents.
- It exposes integrations for streaming LLM, STT, TTS and real-time capabilities.
- LiveKit supports explicit agent dispatch and agent-worker concurrency.

Use it for a **visible, consent-gated classroom observer adapter** if the architecture and tests confirm the integration is worthwhile.

Do not fork the whole repository blindly. First inspect:
- the current BEAN LiveKit SDK usage;
- `livekit/agents-js` source, API compatibility, packages and peer dependencies;
- room dispatch and participant metadata;
- lifecycle, reconnect and shutdown behaviour;
- plugin licence notices;
- supported Node version and deployment resource footprint.

Upstream reference:
- https://github.com/livekit/agents-js
- https://github.com/livekit/agents-js/blob/main/LICENSE
- https://docs.livekit.io/agents/server/agent-dispatch/
- https://docs.livekit.io/agents/server/

LiveKit's own dispatch documentation recommends explicit dispatch for most production use cases. Do not automatically attach the observer to every new room irrespective of class state, consent or policy.

### 3.2 Python alternative — LiveKit Agents

Repository: https://github.com/livekit/agents  
Licence: Apache-2.0 for the framework; the turn-detection model has a separate LiveKit Model Licence.

Evaluate only if a required speech/model integration is materially better supported in Python. Keep it as a bounded worker service behind a BEAN adapter. Do not migrate the main Next.js/Bun application or duplicate the existing queue.

### 3.3 Multi-agent orchestration alternatives — research, not automatic adoption

**Agno** — https://github.com/agno-agi/agno — Apache-2.0. It supports agents, teams, workflows, knowledge, durable services, scheduling and human approvals. It is worth studying for specialist-team patterns, but it may duplicate BEAN's durable queue, report lifecycle, auth and approval infrastructure. Do not add it unless a measured gap cannot be solved cleanly in BEAN.

**LangGraph** — https://github.com/langchain-ai/langgraph — MIT. It offers stateful graph orchestration, durable execution, streaming and human-in-the-loop control. CI-1 already documented why a second workflow engine could duplicate BEAN's queue semantics. Keep it as a comparison candidate, not a default dependency.

**CrewAI** — https://github.com/crewAIInc/crewAI — MIT. Study its role/task concepts if useful, but do not introduce a second persona framework merely to create more named agents.

### 3.4 Multilingual speech-recognition candidate — Omnilingual ASR

Repository: https://github.com/facebookresearch/omnilingual-asr  
Licence: the repository states code and released models are Apache-2.0. Verify the exact checkpoint, tokenizer, dependencies and dataset terms before distribution or production use.

The project reports speech recognition support for 1,600+ languages. This is a valuable candidate for extending speech coverage, but does **not** mean equal accuracy for all languages. Its README reports CER below 10 for 78% of languages for the 7B LLM-ASR system; results differ by language and model size.

Published resource examples in its README include approximately:

- 300M CTC: around 1.3 GiB download and ~2 GiB inference VRAM;
- 1B CTC: around 3.7 GiB download and ~3 GiB inference VRAM;
- 7B CTC: around 25 GiB download and ~15 GiB inference VRAM.

Treat these as upstream reference figures, not BEAN benchmarks. Benchmark on BEAN's actual worker hardware and datasets. Start with the smallest practical model and allow a provider fallback. Do not require users to download a large speech model.

Reference:
- https://github.com/facebookresearch/omnilingual-asr
- https://github.com/facebookresearch/omnilingual-asr/blob/main/LICENSE

### 3.5 Profession and skill taxonomy candidates

**ESCO — European Skills, Competences, Qualifications and Occupations**  
Official source: https://esco.ec.europa.eu/en  
ESCO describes 3,039 occupations and 13,939 skills linked to those occupations in 28 languages, according to the European Commission's current ESCO description. It is a strong seed taxonomy, not a complete representation of every country's jobs. Its downloads are free, but free access must not be confused with an assumed licence: verify the exact current dataset reuse terms and attribution obligations before importing it.

**O*NET Database**  
Official source: https://www.onetcenter.org/database.html  
The O*NET 31.0 database is published under CC BY 4.0 for most database content, with attribution and exceptions. Include attribution and preserve any source-specific exceptions; do not assume every third-party element is covered by the same licence.

**UNESCO ISCED-F 2013**  
Official reference: https://uis.unesco.org/en/methods-and-tools/isced  
Use as a structured seed for academic and vocational fields of education. It defines broad, narrow and detailed education/training fields. It is not an occupation or competency database.

The implementation must maintain a source/licence registry per imported dataset and per document. No source enters the knowledge base until its licence, terms, version and attribution are recorded.

### 3.6 General-purpose multilingual LLM candidate

Qwen3 is an open-weight model family whose repository states Apache-2.0 for its open-weight models: https://github.com/QwenLM/Qwen3 . It may be benchmarked as one candidate in BEAN's model adapter. Do not switch the default model until domain accuracy, language performance, latency, memory and licence checks pass. Model licence does not automatically license training data, external tools or other model components.

### 3.7 Architecture decision to begin with

**Recommended shape:**

- LiveKit Agents JS as an optional room-observer runtime adapter, only after consent and compatibility validation.
- Existing BEAN durable jobs, evidence service, specialist output contracts, deterministic evaluator, dispute history and access-control services remain the system of record.
- Domain specialists are BEAN-defined roles, dynamically selected and executed through bounded worker pools.
- A multilingual model adapter selects a tested speech/text model per language and task.
- Agno/LangGraph are not added in the first implementation unless a documented gap justifies them.

Do not combine several frameworks for fashion. Every extra runtime adds deployment, security, dependency and operational cost.

---

## 4. Agent fleet model — one observer per opted-in class, many specialist workers

### 4.1 Important distinction

“More agents” must mean more **concurrent capacity and specialist coverage**, not dozens of bots talking over the teacher or silently entering every room.

For an eligible class:

1. One clearly disclosed `BEAN Classroom Observer` joins the LiveKit room as a programmatic participant, only when the class-level and participant-level consent policy permits it.
2. The observer processes only permitted live signals.
3. After the session, BEAN's durable queue fans out relevant tasks to the correct specialist agents.
4. Specialist workers process jobs in parallel within capacity and privacy limits. They do not all join the live room.
5. The deterministic orchestrator validates evidence, merges findings and abstains when support is insufficient.
6. Human administrators remain responsible for consequential Trust & Safety decisions.

### 4.2 Why not put every specialist in every class?

- It wastes compute and model calls.
- It increases latency and provider failures.
- It causes duplicated and conflicting analysis.
- It may expose more student data to agents than necessary.
- It may disrupt the classroom.
- A fixed number of live bots is not the same thing as scalable concurrency.

The scheduler must dispatch only the roles required by the class subject, level, language, teaching format, evidence and consent profile.

### 4.3 Fleet capacity

Implement bounded worker pools, not unbounded agent spawning:

- `observerPool`: visible live observers for currently permitted rooms;
- `transcriptionPool`: optional speech jobs where explicit audio/transcript consent exists;
- `subjectPool`: dynamically selected subject/profession specialists;
- `pedagogyPool`: pedagogical and learning-design review;
- `languagePool`: language detection, transcription quality and language support;
- `evidencePool`: source/evidence validation;
- `reportPool`: deterministic report construction and persistence.

Use the existing CI queue, or extend its proven lease/heartbeat semantics. Respect job uniqueness and class/session identity. Add capacity limits, queue backpressure, per-tenant fairness, rate limits, provider concurrency controls and graceful degradation.

A class must never be marked failed merely because an AI worker is busy or offline. Attendance, booking and class-completion truth remain independent.

---

## 5. Agent catalogue and operating instructions

The current three BEAN roles are retained and improved. The following are the proposed stable roles. Some are runtime workers; others are task-specific specialist profiles selected dynamically. They are not all permanently running services.

### Agent 00 — BEAN Fleet Dispatcher / Classroom Coordinator

**ID:** `BEAN_CLASSROOM_DISPATCHER`  
**Type:** deterministic coordinator with model-assisted planning only where needed  
**Purpose:** decide which agents should work on a class and sequence their tasks.

**Inputs:** class metadata, subject, target level, curriculum/board, language preferences, permitted evidence types, consent state, session state, worker capacity.

**Responsibilities:**
- validate the class/session identity;
- verify eligibility and consent before dispatch;
- select the smallest suitable agent set;
- assign each task a narrow scope, deadline, evidence allowlist and output schema;
- use explicit LiveKit dispatch for the observer only when eligible;
- fan out asynchronous post-class tasks;
- avoid duplicate jobs;
- cancel tasks on consent withdrawal or class deletion where required;
- record missing capacity and failures honestly.

**Must never:** invent attendance, change teacher/student roles, bypass consent, dispatch all agents by default, or make Trust decisions.

### Agent 01 — BEAN Classroom Observer

**ID:** `BEAN_CLASSROOM_OBSERVER`  
**Type:** visible LiveKit programmatic participant  
**Purpose:** collect only permitted classroom signals and maintain session context.

**Inputs:** authorised room events, class/session metadata, permitted whiteboard structure, attendance aggregates and optional consented audio/transcript stream.

**Responsibilities:**
- join with a visible identity and disclosed purpose;
- identify the correct class and session;
- track lifecycle events, permitted timestamps and aggregate activity;
- distinguish teacher, learner and system events only where the backend already establishes those identities and access is lawful;
- emit structured event summaries, not speculative judgements;
- leave cleanly when the class ends, is cancelled or consent becomes invalid;
- recover safely from reconnects without duplicate evidence.

**Must never:** secretly record, silently capture video, identify emotions from faces/voices, infer attention from silence/camera status, publish feedback during class, or store raw media by default.

### Agent 02 — BEAN Learner Agent (existing, upgraded)

**ID:** `BEAN_LEARNER_AGENT`  
**Type:** specialist reviewer  
**Purpose:** examine the lesson from a learner-experience perspective without impersonating a student.

**Responsibilities:**
- summarise learning objectives actually supported by evidence;
- identify concepts covered and concepts that need clearer explanation;
- evaluate whether examples/resources support the stated lesson goal;
- separate class-level observations from individual student information;
- prepare revision suggestions linked to real BEAN syllabus and learning resources;
- state evidence gaps.

**Must never:** submit a public student review, impersonate a student, claim an individual learner understood or failed to understand without individual learning evidence, infer intelligence or potential, or fabricate student sentiment.

### Agent 03 — BEAN Teacher Judge Agent (existing, upgraded)

**ID:** `BEAN_TEACHER_JUDGE`  
**Type:** teaching-quality evaluator  
**Purpose:** evaluate the lesson using published and transparent teaching-quality criteria.

**Categories:** subject accuracy, explanation clarity, lesson structure, syllabus coverage, teaching pace, examples/demonstrations, student interaction, question handling, time management and learning-resource quality.

**Responsibilities:**
- write evidence-backed observations;
- cite exact evidence reference IDs and time ranges when available;
- distinguish evaluated, not evaluated and conflicting categories;
- suggest practical improvements;
- calibrate confidence and abstain.

**Must never:** score a teacher on accent, appearance, gender, disability, religion, ethnicity, personality, camera use or other protected characteristics; treat a student's silence or poor network as teacher fault; change public ratings, teacher status or payouts.

### Agent 04 — Dynamic Subject-Matter Specialist

**ID:** `BEAN_SUBJECT_EXPERT::<domain-id>`  
**Type:** dynamically selected subject expert worker; multiple domain instances can run concurrently  
**Purpose:** check subject-specific claims, explanations, examples and technical terminology.

**Example profiles:** mathematics, statistics, physics, chemistry, biology, environmental science, computer science, AI/data, cybersecurity, engineering, architecture, agriculture, veterinary sciences, health education, economics, accounting, law education, history, geography, languages, arts, design, music, media, hospitality, transport and skilled trades.

**Responsibilities:**
- receive only the lesson segments and source references needed for its domain task;
- resolve the relevant subject taxonomy and level;
- retrieve authoritative, licensed and versioned references;
- check calculations, concepts, definitions, procedures and terminology;
- identify jurisdiction and date sensitivity;
- mark disputed or unsupported claims;
- hand off to another specialist when a topic crosses domains.

**Must never:** pretend to be a licensed professional, provide an unsupported diagnosis or legal/financial instruction, or present retrieval text as verified truth without checking provenance.

### Agent 05 — BEAN Curriculum & Standards Specialist

**ID:** `BEAN_CURRICULUM_SPECIALIST`  
**Purpose:** map a lesson to the actual curriculum, exam syllabus, qualification or vocational standard.

**Responsibilities:**
- identify the applicable jurisdiction, board, institution and curriculum version;
- map objectives to exact syllabus references;
- identify missing or out-of-scope content;
- distinguish official curriculum from teacher-provided notes;
- record version and effective date of the standard;
- recommend existing BEAN catalogue resources.

**Must never:** invent syllabus units, claim official approval, or apply one jurisdiction's standard as universal.

### Agent 06 — BEAN Pedagogy & Instructional Design Specialist

**ID:** `BEAN_PEDAGOGY_SPECIALIST`  
**Purpose:** review how learning content is sequenced and taught.

**Responsibilities:**
- examine lesson structure, scaffolding, examples and practice opportunities;
- consider age/level-appropriate explanation and cognitive load;
- identify opportunities for retrieval practice, worked examples, discussion and formative checks;
- propose accessible alternative explanations;
- distinguish evidence from generic pedagogical advice.

**Must never:** evaluate a teacher's personality or claim that one teaching style is best for every learner.

### Agent 07 — BEAN Assessment & Question-Quality Specialist

**ID:** `BEAN_ASSESSMENT_SPECIALIST`  
**Purpose:** examine class tests, examples, worksheets and practice questions.

**Responsibilities:**
- check alignment to the taught objective and target difficulty;
- validate answer keys and calculations;
- inspect ambiguity, distractor quality and cultural/language bias;
- flag unsupported “previous-year question” claims;
- recommend accessible alternatives and explanations.

**Must never:** mark generated questions as official exam questions unless provenance proves it.

### Agent 08 — BEAN Language & Multilingual Specialist

**ID:** `BEAN_LANGUAGE_SPECIALIST`  
**Purpose:** coordinate language handling for lesson material and approved transcripts.

**Responsibilities:**
- identify requested language and script;
- preserve code-switching and mixed-language technical explanations;
- verify translations of subject-specific terminology;
- keep names, formulae, code and official references intact where appropriate;
- detect uncertain transcription spans;
- request user correction when confidence is low;
- generate response-language guidance for other agents.

**Must never:** claim support for a language merely because a model returned text; conceal low confidence; erase regional/dialect differences; translate an unverified technical term as certain.

### Agent 09 — BEAN Accessibility & Inclusion Specialist

**ID:** `BEAN_ACCESSIBILITY_SPECIALIST`  
**Purpose:** identify avoidable barriers in the teaching artefacts and learner resources.

**Responsibilities:**
- inspect permitted captions, text structure, reading level and accessible formatting;
- recommend plain-language explanations, alt text, keyboard-friendly resources and alternative formats;
- recognise when a resource requires human accessibility review;
- avoid inferring disability or personal characteristics.

**Must never:** diagnose a learner, infer disability from behaviour or expose personal accommodations to other users.

### Agent 10 — BEAN Research & Source Verification Specialist

**ID:** `BEAN_RESEARCH_VERIFIER`  
**Purpose:** verify factual claims against reliable sources.

**Source priority:** official government/standards body, official curriculum publisher, peer-reviewed research, recognised professional body, vetted textbook/reference, then other sources with an explicit quality label.

**Responsibilities:**
- verify author, publisher, date, jurisdiction and licence;
- retain stable URLs, citations and retrieval dates;
- detect outdated, conflicting or superseded claims;
- separate primary-source facts from commentary;
- return “not verified” when sources do not settle the question.

**Must never:** invent citations, links, page numbers, quotes or source authority.

### Agent 11 — BEAN Evidence & Hallucination Auditor

**ID:** `BEAN_EVIDENCE_AUDITOR`  
**Purpose:** independently challenge agent findings before report generation.

**Responsibilities:**
- confirm every finding points to an existing permitted evidence reference;
- check that the source supports the wording of the finding;
- inspect unsupported assumptions, invented timestamps and source mismatches;
- flag overconfident language and missing context;
- enforce “insufficient evidence” rules;
- report agent disagreement without hiding it.

**Must never:** rewrite evidence to make an agent look correct or resolve a dispute.

### Agent 12 — BEAN Safety, Privacy & Fairness Guardian

**ID:** `BEAN_SAFETY_GUARDIAN`  
**Type:** deterministic policy checks plus model-assisted risk detection; human escalation  
**Purpose:** apply safeguarding, privacy, fairness and high-stakes boundaries.

**Responsibilities:**
- enforce consent state and data-minimisation policy;
- detect requests to reveal personal student/teacher information;
- flag safety-sensitive or high-stakes content;
- prevent protected-characteristic evaluation;
- route safeguarding concerns to authorised human administrators;
- preserve confidential reporting routes.

**Must never:** autonomously investigate or decide safeguarding outcomes, punish a teacher/student, disclose a reporter's identity or act as an emergency service.

### Agent 13 — BEAN Teacher Development Coach

**ID:** `BEAN_TEACHER_COACH`  
**Purpose:** convert verified, comparable evaluation observations into practical teacher development recommendations.

**Responsibilities:**
- identify repeated strengths and improvement areas across eligible reports;
- require minimum sample thresholds;
- compare only comparable subjects, levels and evidence types;
- link recommendations to legitimate professional-development material;
- explain the evidence behind each recommendation;
- track progress without changing official reviews.

**Must never:** publish rankings, produce unsupported trend claims, use AI scores to penalise earnings or modify a teacher profile automatically.

### Agent 14 — BEAN Student Revision Coach

**ID:** `BEAN_STUDENT_REVISION_COACH`  
**Purpose:** turn class-level summaries and separately verified individual learning evidence into helpful revision activities.

**Responsibilities:**
- suggest related syllabus topics and existing BEAN exercises;
- generate practice with answer explanations and difficulty labels;
- mark unassessed concepts as unassessed;
- tailor only when an authorised individual learning record supports it;
- keep learning history private to the learner.

**Must never:** infer mastery from attendance, claim a learner is weak or strong without evidence, create fake progress or public rankings.

### Agent 15 — BEAN Domain Knowledge Curator

**ID:** `BEAN_DOMAIN_CURATOR`  
**Type:** background curation workflow; human-reviewed publication  
**Purpose:** maintain profession, subject, skills and terminology packs.

**Responsibilities:**
- import taxonomy updates through a controlled ingestion process;
- validate source licence, attribution, version, date and integrity;
- identify duplicates, stale information and conflicting definitions;
- create draft domain packs;
- submit packs for human/domain review;
- publish signed, versioned packs only after all gates pass.

**Must never:** automatically publish unreviewed or unlicensed data as authoritative knowledge.

### Agent 16 — BEAN Final Report Orchestrator

**ID:** `BEAN_REPORT_ORCHESTRATOR`  
**Type:** deterministic BEAN service; may use a language model only for bounded wording assistance after evidence validation  
**Purpose:** build the final teacher and student outputs from specialist results.

**Responsibilities:**
- validate all agent outputs against typed schemas;
- resolve only deterministic duplication and formatting;
- preserve disagreements and uncertainty;
- include evidence IDs and source provenance;
- keep class-level and individual-level outputs separate;
- enforce report versioning and ownership;
- mark missing or failed specialist tasks clearly.

**Must never:** invent a consensus, hide conflicting opinions, turn a recommendation into a disciplinary decision or modify booking/attendance/payment state.

### Agent 17 — BEAN Independent Critic

**ID:** `BEAN_INDEPENDENT_CRITIC`  
**Purpose:** make one bounded second-pass review of a draft report for omissions, contradictions, ambiguity and overclaiming.

**Responsibilities:**
- test whether the report answers the specified task;
- look for unsupported claims and missing caveats;
- compare evidence references against findings;
- propose precise corrections to the report orchestrator.

**Must never:** create new facts or run unlimited self-debate loops. One review pass by default; a second is allowed only with an explicit reason and a strict budget.

### Agent 18 — BEAN Profession Mentor (on demand)

**ID:** `BEAN_PROFESSION_MENTOR`  
**Purpose:** help students explore professions, competencies, pathways and skills.

**Responsibilities:**
- map a student's stated interests to evidence-backed profession profiles;
- explain typical responsibilities, skills, qualifications and entry routes;
- distinguish country-specific requirements;
- identify uncertainty and changing requirements;
- link to official institutions, qualification bodies and training sources.

**Must never:** guarantee employment, invent salary data, provide discriminatory career filtering or present a local licence requirement without a jurisdiction-specific source.

---

## 6. Domain and profession coverage system

### 6.1 Domain families

Create expandable top-level domain packs for at least these families. This is a seed taxonomy, not a claim of exhaustive global coverage.

1. Education, pedagogy and learning sciences.
2. Mathematics, statistics and actuarial concepts.
3. Physics, astronomy and space sciences.
4. Chemistry and materials science.
5. Biology, biotechnology and life sciences.
6. Environment, climate and earth sciences.
7. Computing, software engineering and information technology.
8. Artificial intelligence, data science and analytics.
9. Cybersecurity, networking and telecommunications.
10. Engineering: civil, mechanical, electrical, electronics, chemical, industrial and related fields.
11. Architecture, planning, construction and built environment.
12. Manufacturing, automation, maintenance and quality.
13. Health sciences and medicine education.
14. Nursing, allied health, public health and health administration.
15. Veterinary science, animal care and food systems.
16. Agriculture, horticulture, forestry, fisheries and agritech.
17. Business, management, entrepreneurship and operations.
18. Accounting, taxation, banking, insurance and finance education.
19. Law, governance, public policy and civic education.
20. Economics, political science and international relations.
21. Psychology, sociology, anthropology and social work.
22. History, geography, philosophy and archaeology.
23. Languages, linguistics, literature and translation.
24. Journalism, communication, publishing and information science.
25. Fine arts, visual design, industrial design and crafts.
26. Music, theatre, dance, film and performing arts.
27. Media production, animation, photography and game development.
28. Hospitality, tourism, culinary arts and personal services.
29. Transport, aviation, maritime, logistics and supply chains.
30. Public safety, emergency services and security education.
31. Sports science, physical education and coaching.
32. Sustainability, renewable energy and circular economy.
33. Skilled trades: electrical, plumbing, welding, automotive, HVAC and repair.
34. Retail, sales, customer service and commerce.
35. Public administration, community services and non-profit work.
36. Interdisciplinary and emerging professions.

Each family must support nested subdomains, local job titles, synonyms, alternative labels and region-specific qualifications.

### 6.2 Subject classification

Use UNESCO ISCED-F 2013 as one standard reference taxonomy for educational fields. Map it to BEAN's actual subject and syllabus catalogue instead of replacing the existing catalogue.

Subject hierarchy:

`Field → Domain → Subject → Subsubject → Topic → Concept → Skill → Learning objective → Assessment objective`

Support cross-disciplinary links. For example, environmental engineering may connect chemistry, biology, mathematics, policy and engineering.

### 6.3 Profession hierarchy

`Occupation family → Occupation → Specialisation → Role → Competency → Skill → Knowledge concept → Training/qualification pathway`

Use ESCO and O*NET as reference datasets after licence validation. Keep each source's original identifier, version and attribution. Add a jurisdiction-aware mapping layer for India and other countries as validated datasets become available.

### 6.4 Domain pack schema

Every published domain pack must contain:

- `domainId` and stable URI/identifier;
- title, aliases, translations and scripts;
- taxonomy source and version;
- parent/child domains;
- related subjects and professions;
- competency levels and prerequisites;
- terminology/glossary;
- standards and jurisdictions;
- trusted sources with URLs, authors, publishers and dates;
- source licence and attribution text;
- effective date / review date;
- high-stakes risk class;
- allowed and prohibited tasks;
- recommended agent profiles;
- supported input/output languages with test status;
- benchmark suite and latest benchmark result;
- human reviewer and approval state;
- pack checksum/version and change history.

No pack may be marked `VERIFIED` without provenance and a passing domain evaluation suite.

---

## 7. Knowledge design — make agents knowledgeable, not merely confident

### 7.1 Retrieval-first expertise

Use retrieval-augmented domain knowledge with citations and provenance. Do not attempt to put all professions, all books and all standards into every prompt or train one model on everything.

A specialist task should retrieve only the material relevant to:
- the selected domain;
- subject and target level;
- lesson objectives;
- jurisdiction and applicable date;
- the task being reviewed.

### 7.2 Source hierarchy

1. Official laws, regulators, public agencies and standards bodies for their own jurisdictions.
2. Official education boards, curriculum publishers and qualification bodies.
3. Peer-reviewed literature and established scientific/academic bodies.
4. Profession-specific associations and recognised textbooks.
5. Carefully assessed secondary sources.
6. Community sources only as context, never as sole authority for high-stakes claims.

### 7.3 Source controls

Store:
- canonical URL or source identifier;
- publisher / author;
- publication and access dates;
- jurisdiction;
- licence and usage restrictions;
- version and supersession state;
- exact section/page/anchor where available;
- retrieval checksum;
- confidence and source quality class.

Do not scrape or import copyrighted books, paywalled material or proprietary course content without permission. Do not confuse access to a public webpage with permission to reproduce its contents.

### 7.4 Continuous updates

- Check official feeds/APIs and release dates on a scheduled basis.
- Do not silently overwrite a source version.
- Mark outdated packs and standards.
- Keep old report provenance immutable.
- Require human review for material updates in regulated or high-stakes domains.
- Keep a change log and rollback path.

### 7.5 Memory boundaries

- **Task memory:** temporary context for one agent job; expire after the job unless needed for a report.
- **Session memory:** permitted class/session facts only; never become a free-form cross-class transcript store.
- **Teacher development memory:** derived only from authorised teacher reports, with comparable-sample thresholds.
- **Student learning memory:** existing BEAN personal learning data, subject to current ownership/consent rules.
- **Domain memory:** public/licensed, versioned knowledge packs, separated from private user data.

Never use private student or teacher material to train or fine-tune models without a separately reviewed lawful basis and clear consent.

---

## 8. Multilingual capability architecture

### 8.1 Text, speech and translation are separate capabilities

Do not claim “supports 1,600 languages” just because an ASR model lists 1,600 speech-recognition languages. Text understanding, speech recognition, translation, speech generation, OCR, handwriting recognition and subject terminology each need separate tests.

Create a `LanguageCapabilityRegistry` with per-task status:

- `VERIFIED` — passed the defined test set for the task and domain;
- `LIMITED` — useful but known failure areas exist;
- `EXPERIMENTAL` — initial tests only;
- `UNSUPPORTED` — do not claim this capability;
- `NEEDS_HUMAN_REVIEW` — output requires human validation.

Track language tag, script, dialect/variant, model, model version, domain, WER/CER or translation quality measures, terminology accuracy, code-switch tests, test dataset provenance and last-tested date.

### 8.2 Language pipeline

1. Respect the user's selected language when supplied.
2. Otherwise detect likely language/script and return uncertainty where detection is ambiguous.
3. Preserve mixed-language speech and code-switching instead of forcing a single-language transcript.
4. Use a domain glossary for technical terms and names.
5. Keep original-language evidence references.
6. Translate only for the task that needs translation; preserve the source alongside the translation.
7. Let users correct language and transcription errors.
8. Route low-confidence or safety-critical translations to human review.

### 8.3 Language rollout

Start with BEAN's actual audience and test priority, including English, Tamil, Hindi, Telugu, Malayalam, Kannada, Bengali, Marathi, Gujarati, Urdu and Punjabi. Add further languages based on demand and verified test performance. Script and dialect variants must be tested separately.

Do not claim perfect fluency. Do not erase local terminology or dialects. Do not translate formulas, code, official document names, citations or legal terms carelessly.

### 8.4 Speech recognition

Omnilingual ASR is a candidate, not a mandatory dependency. Benchmark smaller models first. Provide an adapter interface so another permitted model may be selected for a language where it performs better.

Speech-to-text is disabled unless the audio-processing consent gate is satisfied. Model availability is not permission to process classroom audio.

### 8.5 Speech generation

TTS is not needed for every specialist. Add spoken responses only where the user explicitly asks for voice output and a suitable language/voice capability is verified. Do not imitate a real teacher/student voice or create deceptive speaker identity.

---

## 9. Classroom consent and observation modes

CI-1 was intentionally designed around live-only/no-recording classroom behaviour. Preserve that boundary unless a separately reviewed consent and privacy milestone explicitly authorises a change.

### 9.1 Mode A — structured-only observation (default)

Allowed evidence may include existing authorised sources:
- lesson plan;
- verified attendance counts;
- aggregate connection intervals without student identities;
- whiteboard stroke-count structure;
- opt-in teacher notes;
- permitted class/session lifecycle events.

No audio or video recording/transcription is implied by this mode.

### 9.2 Mode B — consented audio/transcript analysis (future opt-in)

This mode requires a separate implementation and legal/privacy review before activation.

Requirements:
- clear pre-class disclosure that a BEAN AI observer is present;
- explicit teacher consent;
- appropriate consent from every participant whose speech is processed;
- verifiable parent/guardian consent where legally required for minors;
- a clear decline path that does not unfairly penalise the student;
- a rule for mixed classes where some participants decline;
- retention and deletion rules stated before collection;
- secure processing and strict role-based access;
- withdrawal immediately stops future processing;
- no raw recording stored by default;
- transcript retention must be justified, minimised and separately disclosed;
- no use for model training by default.

If the consent state is incomplete, use structured-only mode or disable the audio feature. Never silently downgrade consent requirements.

### 9.3 Mode C — teacher-only supplied notes

Teacher-supplied notes may be used only if the teacher explicitly submits them and understands their use. Label them as teacher-provided, not independently verified observations.

---

## 10. How agents should act and react

### 10.1 Global interaction policy

- Quiet by default: the observer must not interrupt the teacher or learners.
- The observer must identify itself clearly as an AI participant.
- Live interaction is enabled only when the teacher has enabled the relevant feature and the class policy permits it.
- A student can address a permitted question agent directly through the approved interface.
- The agent should yield to the teacher, avoid talking over speakers and respect turn-taking.
- Specialist agents normally work after class in the background.
- No agent makes a disciplinary, safeguarding, moderation, admission or payment decision.

### 10.2 Reaction matrix

| Event / condition | Required agent response | Prohibited response |
|---|---|---|
| Teacher is explaining | Remain quiet; collect permitted evidence only | Interrupt or compete for the floor |
| Student asks a direct content question and live Q&A is enabled | Give a concise, level-appropriate answer with uncertainty; return the floor to teacher | Take over the class or claim to be the teacher |
| Teacher asks the observer to summarise | Give a short evidence-backed summary of available signals | Invent unobserved lesson details |
| Question is outside the selected subject | Route to the relevant specialist or say it is outside current capability | Guess confidently |
| Two specialists disagree | Preserve both views and ask the evidence auditor to inspect | Hide the disagreement or average opinions blindly |
| Transcript is low confidence | Mark the segment uncertain; request correction or abstain | Treat guessed words as facts |
| Code-switching occurs | Preserve the languages and route to language-aware processing | Force the entire utterance into one language |
| Student is silent or camera is off | Treat as no evidence of learning or disengagement | Infer inattention, low ability or misconduct |
| Network failure occurs | Mark the evidence gap; continue where safe | Penalise the student or teacher automatically |
| Lesson material conflicts with an official source | Cite both, identify date/jurisdiction and flag for review | Silently rewrite teacher material as fact |
| High-stakes medical/legal/financial question arises | Give bounded educational information and recommend an appropriately qualified professional | Diagnose, prescribe, act as legal counsel or provide personalised regulated advice |
| Safeguarding risk is disclosed | Follow BEAN safeguarding escalation to authorised humans | Investigate autonomously or expose identities |
| Consent is withdrawn | Stop the relevant processing and cancel future work | Continue processing queued audio/transcripts |
| Provider or worker fails | Retry within limits; mark partial/failed status honestly | Fabricate a completed report |
| Evidence is insufficient | Return `INSUFFICIENT_EVIDENCE` | Fill the gap with general knowledge as if observed |

### 10.3 Student question response format

When live Q&A is enabled, use:

1. direct answer in the requested language;
2. short explanation at the class level;
3. one example or worked step if helpful;
4. a check-for-understanding question only if appropriate;
5. optional hand-back prompt to the teacher.

For a complex question, the agent should say it needs a subject specialist or teacher rather than improvising.

### 10.4 Teacher request response format

For a teacher asking for assistance:

1. identify the exact request;
2. retrieve relevant syllabus/domain material;
3. offer a concise classroom-ready suggestion;
4. show evidence and caveats;
5. allow the teacher to accept, reject or edit it.

Never change a lesson plan, assessment, booking or public course listing without an explicit authorised user action.

### 10.5 Evaluation report tone

- respectful, specific and non-punitive;
- distinguish observation, interpretation and recommendation;
- cite evidence references;
- acknowledge missing evidence;
- avoid absolute judgements about a teacher's ability;
- do not make public rankings.

---

## 11. Per-class orchestration workflow

### Phase 0 — eligibility

- class exists and is in an eligible status;
- session belongs to the class;
- teacher profile is authorised;
- required consent is current;
- observer capacity exists;
- allowed evidence scope is established.

### Phase 1 — room observation

- explicitly dispatch one visible observer when permitted;
- collect permitted room lifecycle and structured evidence;
- optional audio processing only in a separate consented mode;
- heartbeat and reconnect safely;
- leave the room when the session ends.

### Phase 2 — evidence normalisation

- map inputs to evidence references;
- record source, timestamp, scope and availability;
- remove unnecessary identifiers;
- label teacher notes as teacher-provided;
- label transcript segments by confidence and consent mode;
- reject malformed or out-of-scope evidence.

### Phase 3 — specialist selection

Select the minimum necessary set:
- Learner Agent;
- Teacher Judge;
- Subject Specialist (one or more only for interdisciplinary material);
- Curriculum Specialist when a curriculum/syllabus is known;
- Pedagogy Specialist for lesson design;
- Assessment Specialist if tests/questions are present;
- Language Specialist if multilingual evidence exists;
- Evidence Auditor and Safety Guardian for all reports.

### Phase 4 — parallel analysis

- Run independent specialist tasks under a bounded concurrency limit.
- Each task receives only the evidence and tools it needs.
- Store task status and agent version.
- Use timeout, retry, cancellation and lease recovery.

### Phase 5 — critic and deterministic validation

- run one bounded critic pass;
- validate all schema and evidence references;
- remove unsupported findings or mark them for review;
- preserve agent disagreements;
- compute report state deterministically.

### Phase 6 — report generation

Generate separate outputs:
- teacher-facing quality feedback;
- class-level student learning summary;
- individual student learning suggestions only when separately supported by existing individual learning evidence and authorised access;
- administrator-only evidence/audit view.

### Phase 7 — follow-up

- teacher can dispute their own report through current BEAN Trust workflows;
- students can access only their own permitted summaries;
- teacher coach creates longitudinal trends only from comparable, eligible reports;
- revision coach links only to real BEAN learning resources;
- administrators handle consequential Trust decisions.

---

## 12. Structured agent contract

Every agent response must use a typed, validated contract. Exact code types must be aligned with the repository's existing CI DTO/Zod schema rather than introducing competing versions.

Recommended logical envelope:

```json
{
  "taskId": "string",
  "classSessionId": "string",
  "agentId": "BEAN_SUBJECT_EXPERT",
  "agentVersion": "semver-or-build-id",
  "domainPackId": "string-or-null",
  "domainPackVersion": "string-or-null",
  "language": {
    "requested": "BCP-47-or-null",
    "detected": "BCP-47-or-null",
    "confidence": "LOW|MEDIUM|HIGH"
  },
  "status": "COMPLETED|PARTIAL|INSUFFICIENT_EVIDENCE|FAILED|CANCELLED",
  "findings": [
    {
      "findingId": "string",
      "category": "string",
      "observation": "string",
      "evidenceRefIds": ["string"],
      "sourceRefs": ["string"],
      "confidence": "LOW|MEDIUM|HIGH",
      "limitations": ["string"],
      "suggestion": "string-or-null"
    }
  ],
  "unknowns": ["string"],
  "conflicts": ["string"],
  "riskFlags": ["string"],
  "requiresHumanReview": false
}
```

This is a conceptual shape, not a demand to copy JSON literally if the repository already has an equivalent validated DTO.

### 12.1 Contract rules

- All evidence IDs must resolve server-side to evidence available to that job.
- Model outputs are untrusted input.
- Reject unknown fields where appropriate and enforce string/array/length bounds.
- Do not accept user-supplied role, ownership, attendance or reviewer identity as authority.
- Record model, prompt, agent and domain-pack versions.
- Avoid including full transcripts or personal data in routine logs.
- Distinguish model failure from low confidence and from insufficient evidence.

---

## 13. Model routing and intelligence improvements

### 13.1 Improve reasoning using tools and knowledge, not prompt inflation

Each specialist receives:
- a clearly bounded role;
- the class/task scope;
- the target learner level;
- retrieved authoritative materials;
- available evidence and its limitations;
- permitted tool list;
- response schema;
- domain-specific safety constraints;
- relevant evaluation rubric.

Use short, specific role instructions and retrieval. Do not paste the entire world knowledge catalogue into every agent prompt.

### 13.2 Model tiers

Create a model adapter with task-based profiles:

- `small-fast`: language identification, classification, simple extraction and routine formatting;
- `balanced`: subject explanations, lesson analysis and retrieval synthesis;
- `high-reasoning`: difficult cross-domain verification and bounded critic review;
- `local-optional`: local inference only where the device/worker has enough measured memory and quality is sufficient.

Model selection must be driven by capability evaluation, not just model size or popularity.

### 13.3 Fallback

- if a provider is unavailable, use a tested alternative when compatible;
- preserve the provider failure in the task record;
- do not silently downgrade to a weaker model without recording the change;
- if no valid model exists, mark the task unavailable/partial;
- never make class attendance or booking correctness depend on a model provider.

### 13.4 Fine-tuning and learning loop

Do not automatically train models from live classroom data.

First improve using:
- better domain packs;
- source-grounded retrieval;
- expert-reviewed test fixtures;
- rubric calibration;
- prompt/version testing;
- error analysis;
- teacher corrections as reviewed feedback, not automatic truth.

Fine-tune only when there is a separate, properly licensed, consented and expert-reviewed dataset, a documented privacy/legal basis, reproducible training and a held-out evaluation set.

---

## 14. Safety boundaries by profession

The system is educational support, not a substitute for licensed professionals.

### Health and medicine

- explain educational concepts and official public-health guidance;
- do not diagnose, prescribe or recommend personalised treatment;
- detect emergencies and direct users to local emergency services;
- keep health-related classroom discussions out of personal student profiles unless expressly required and lawfully processed.

### Law and governance

- identify jurisdiction and effective date;
- quote or explain official sources with citations;
- do not claim to be legal counsel or provide definitive personalised legal advice;
- route current legal questions to updated authoritative sources and qualified professionals.

### Finance, accounting and taxation

- teach concepts and worked educational examples;
- identify jurisdiction and tax year;
- do not create personalised investment, lending or tax filing decisions without appropriate regulated controls.

### Engineering, construction, chemistry and trades

- distinguish theory from real-world hazardous procedures;
- never improvise safety-critical instructions;
- cite applicable official standards and require qualified supervision where appropriate.

### Psychology and wellbeing

- provide educational explanations and supportive signposting;
- do not diagnose mental-health conditions or impersonate a therapist;
- escalate imminent safety concerns according to BEAN safeguarding procedures.

### All domains

- respect protected characteristics;
- do not invent qualifications, accreditation or professional status;
- do not use outdated standards as current;
- preserve source provenance and uncertainty.

---

## 15. Security, privacy, permissions and safeguarding

Keep all CI-1/CI-2 protections and extend them to the new fleet.

### 15.1 Least privilege

- Dispatcher may create a job only for an eligible class.
- Observer may access only the permitted room/session signals.
- Subject specialists may read only the evidence bundle for their task.
- Student agents may access only class-level or individually authorised learning data.
- Teacher agents may access only reports for that teacher's own approved profile.
- Administrators require server-side role checks.
- Curator cannot publish knowledge packs without the approval service.
- No model directly executes arbitrary SQL or writes the database.

### 15.2 Tool permissions

All agent tools must be narrow, typed BEAN service calls. No arbitrary shell, filesystem, database or unrestricted network access. Every tool call validates current identity, class scope, consent and allowed action.

### 15.3 Data minimisation

- collect the minimum evidence needed for the assigned task;
- avoid passing identity fields to subject evaluators if not required;
- redact secrets and unnecessary personal information;
- keep raw media out of permanent storage by default;
- maintain retention rules for every new record;
- implement export and deletion compatibility;
- ensure logs do not store transcripts, passwords or personal data unnecessarily.

### 15.4 Children and consent

BEAN serves school-age learners. Do not assume a student checkbox is sufficient verifiable parental consent. Obtain specialist legal review of the current Indian DPDP commencement schedule and applicable child safeguards before enabling audio/video processing or new profiling.

### 15.5 Human review

AI agents may suggest; authorised humans decide. AI cannot:
- suspend or reject a teacher;
- penalise a student;
- hide or rewrite a verified student review;
- decide safeguarding complaints;
- determine a teacher's earnings;
- withhold a payout;
- make admissions or qualification decisions.

The existing dispute, append-only event history and reviewer-separation workflow remains authoritative.

---

## 16. Performance, concurrency and resilience

### 16.1 No unbounded fan-out

- cap specialists per class;
- cap parallel agent jobs per tenant and global worker;
- prioritise live classroom tasks over optional after-class enrichment;
- use queue backpressure;
- use per-provider concurrency controls;
- skip optional specialist tasks when the capacity budget is exhausted;
- mark omitted work as pending/partial, not complete.

### 16.2 Durable execution

Reuse the proven BEAN evaluation queue:
- compare-and-swap claims;
- leases and heartbeats;
- bounded retries with jitter;
- idempotency keys;
- one class-session evaluation job identity;
- duplicate webhook protection;
- worker shutdown/restart recovery;
- cancelled task handling;
- stale-job recovery;
- immutable agent-run records.

Do not introduce a duplicate job engine unless the CI-3 architecture report proves a requirement that BEAN's queue cannot meet.

### 16.3 Load benchmarks

Test at staged levels, not by guessing:
- 1, 4, 8, 16, 32 concurrent classes;
- progressively higher worker concurrency;
- short and long lessons;
- multilingual and code-switch fixtures;
- provider slowdowns and outages;
- worker restarts and lease expiry.

Measure:
- active observers;
- queued/running specialist tasks;
- p50/p95/p99 latency;
- throughput;
- CPU and memory;
- GPU/VRAM if used;
- network bandwidth;
- provider failure/retry rate;
- report completeness;
- cost or compute per class where relevant.

Publish tested limits and bottlenecks. Never extrapolate a small benchmark to unlimited scale.

---

## 17. Quality and evaluation framework

Build a role-specific test programme before calling an agent expert or language verified.

### 17.1 Domain fixtures

For every domain pack, include:
- correct lesson examples;
- common misconceptions;
- ambiguous and incomplete material;
- outdated references;
- conflicting sources;
- interdisciplinary content;
- jurisdiction differences;
- high-risk/prohibited requests;
- explicit insufficient-evidence cases.

### 17.2 Language fixtures

For each target language/script:
- native-speaker reviewed examples where possible;
- code-switching and local terminology;
- accents/dialects and noise where speech is enabled;
- technical vocabulary;
- names, formulas and abbreviations;
- negation, numbers, dates and units;
- translation adequacy and citation preservation.

### 17.3 Metrics

- evidence grounding rate;
- unsupported-claim rate;
- correct abstention rate;
- source citation accuracy;
- subject answer correctness;
- curriculum mapping precision;
- translation adequacy;
- ASR WER/CER where applicable;
- language/script detection accuracy;
- inter-reviewer agreement;
- fairness error analysis;
- report completeness;
- latency and resource use.

Always report per-domain and per-language results. Do not hide weak languages behind a global average.

### 17.4 Regression protection

- preserve all CI-1/CI-2 tests;
- add contract tests for every role;
- run prompt/model version comparisons;
- keep a held-out evaluation set;
- avoid test leakage into prompt tuning;
- rerun evaluation when the model, prompt, retrieval source, domain pack or language adapter changes.

---

## 18. Teacher and student experience

### 18.1 Teacher experience

Teacher dashboard should remain concise and actionable:
- classes observed/evaluated;
- available reports and incomplete evidence notices;
- teaching strengths;
- repeated development suggestions;
- subject-specific findings;
- language/transcription confidence only when relevant;
- report version history;
- dispute and appeal status;
- option to submit contextual notes.

Do not show a swarm of agent names, fake typing indicators or meaningless token/agent counts. Present one coherent BEAN Classroom Intelligence result with expandable evidence details.

### 18.2 Student experience

Student view should focus on:
- actual class topics;
- class summary;
- learning objectives;
- relevant existing syllabus pages;
- practice and revision recommendations;
- language preference;
- accessible explanation format;
- privacy and class-level scope note.

Do not expose teacher-confidential evaluation details or another student's information.

### 18.3 Administrator experience

Admin Trust Center should show:
- disputes and appeals;
- original report and version;
- evidence register;
- agent/model/domain-pack versions;
- missing/failed specialists;
- reviewer separation;
- decision history;
- privacy/consent status required for the review.

Do not expose more student content than is necessary for the case.

---

## 19. Implementation plan — CI-3

### CI-3A — Architecture audit and upstream decision

- inspect live BEAN repository state and CI-2 closure;
- inspect `livekit/agents-js` source/API/licence and BEAN LiveKit code;
- inspect Agno/LangGraph only for comparison;
- inspect language model and taxonomy licences;
- record final architecture and rejected alternatives;
- create a minimal integration proof before adding dependencies.

Deliverables:
- `docs/BEAN-CLASSROOM-INTELLIGENCE-AGENT-RESEARCH.md`
- this operating charter;
- dependency/licence bill of materials;
- compatibility report.

### CI-3B — Agent registry and domain-pack foundation

- typed agent registry;
- versioned specialist contracts;
- domain-pack schema and validator;
- subject/profession taxonomy adapter;
- source/licence registry;
- first verified sample packs.

### CI-3C — Fleet dispatcher and bounded worker pools

- extend BEAN queue rather than duplicate it;
- domain-aware task router;
- concurrency caps and backpressure;
- worker health, retries, leases and cancellation;
- per-class idempotency.

### CI-3D — LiveKit observer adapter

- prototype using LiveKit Agents JS;
- one visible observer per eligible consented room;
- explicit dispatch only;
- structured-only mode first;
- lifecycle and reconnect verification;
- no audio transcription enabled by this milestone unless separately approved.

### CI-3E — Subject specialist fleet

- add the core domain families;
- dynamic specialist selection;
- source-grounded checking;
- domain and cross-domain handoff;
- evidence auditor and critic pass.

### CI-3F — Multilingual foundation

- language capability registry;
- text routing and script/code-switch handling;
- benchmark current text model(s);
- evaluate Omnilingual ASR resource/license and consent fit;
- speech transcription remains disabled until consent/privacy acceptance passes.

### CI-3G — Teacher/student workflow integration

- teacher coach;
- student revision coach;
- links into existing BEAN syllabus, question bank, learning workspace and revision planner;
- preserve teacher dispute and student privacy boundaries.

### CI-3H — Evaluation, safety and production verification

- full domain and language fixture sets;
- load/recovery benchmarks;
- role-based access and privacy audit;
- UI browser verification;
- production build and tests;
- docs, ledger and PR.

---

## 20. Acceptance criteria

CI-3 cannot be called complete unless all relevant points are evidenced:

1. The three existing CI-1 agents/workflows remain functional and regression-tested.
2. A typed registry can register and version specialist roles.
3. The dispatcher selects relevant specialists based on verified class metadata.
4. Multiple concurrent classes can be processed within measured capacity limits.
5. One visible observer joins only eligible, consented rooms through explicit dispatch.
6. Observer failure cannot break classroom attendance or class completion.
7. Specialist agents do not all join the same room or receive unnecessary personal data.
8. At least the initial subject/profession packs have sources, licences, versioning and expert-reviewed test fixtures.
9. A domain without reliable support returns an honest capability limitation.
10. Language capability is measured separately for text, ASR, translation and TTS.
11. No speech processing starts without the separate consent/legal gate.
12. Reports preserve evidence, uncertainty, disagreements and failed tasks.
13. Agent tools are permission-scoped and cannot directly execute arbitrary code or SQL.
14. Teacher/student/admin access is tested in authenticated browser sessions.
15. Student ownership, teacher ownership, export, deletion, consent withdrawal and admin review remain correct.
16. No AI agent can make disciplinary, safeguarding, rating or payment decisions.
17. Full test suite, lint, typecheck, schema validation, build, smoke tests and required browser checks pass.
18. Every verified milestone commit is pushed immediately and independently checked on GitHub.

---

## 21. GitHub and implementation discipline

Repository: https://github.com/mrjoker0471/bean-education

Use the repository's current established branch/worktree and publication conventions. Re-fetch all refs before acting.

**Immediate commit-and-push rule:** after each independently verified implementation unit, create a descriptive commit and push it to the dedicated feature branch immediately. Verify the exact remote SHA after every push and update the milestone ledger. Do not accumulate all work locally.

Safety:
- no force-push or force-with-lease;
- no published-history rewrite;
- no destructive reset;
- no branch deletion;
- no overwriting unique commits;
- no pushing unverified work;
- no claiming tests, browser checks, provider runs or GitHub publication without evidence.

If write access is blocked, report the exact blocker. Use the owner's authorised GitHub session or the repository's registered write-enabled deploy key. Never request a private key or personal access token in chat.

Open a PR through the established owner-session workflow, verify CI and merge only through normal protections when authorised.

---

## 22. Required documents to maintain

At minimum:

- `docs/BEAN-CLASSROOM-INTELLIGENCE-AGENT-CHARTER.md` — this operating charter;
- `docs/BEAN-CLASSROOM-INTELLIGENCE-AGENT-RESEARCH.md` — upstream research and licence audit;
- `docs/BEAN-CLASSROOM-INTELLIGENCE-DOMAIN-COVERAGE.md` — profession/subject coverage, gaps and sources;
- `docs/BEAN-CLASSROOM-INTELLIGENCE-LANGUAGE-COVERAGE.md` — verified language/task matrix and measured quality;
- `docs/BEAN-CLASSROOM-INTELLIGENCE-AGENT-API.md` — role contracts, tools and workflow;
- `docs/BEAN-CLASSROOM-INTELLIGENCE-PRIVACY-AND-SECURITY.md` — keep aligned with real implementation;
- `docs/BEAN-CLASSROOM-INTELLIGENCE-CI3-RESULTS.md` — tests, browser proof, resource benchmarks and limitations.

Do not create duplicate docs if equivalent files already exist; update the existing canonical documents.

---

## 23. Source references checked while preparing this charter

- LiveKit Agents for Node.js: https://github.com/livekit/agents-js
- LiveKit Agents JS licence: https://github.com/livekit/agents-js/blob/main/LICENSE
- LiveKit dispatch documentation: https://docs.livekit.io/agents/server/agent-dispatch/
- LiveKit agent server overview: https://docs.livekit.io/agents/server/
- LiveKit Python Agents: https://github.com/livekit/agents
- Agno: https://github.com/agno-agi/agno
- LangGraph: https://github.com/langchain-ai/langgraph
- Omnilingual ASR: https://github.com/facebookresearch/omnilingual-asr
- Omnilingual ASR licence: https://github.com/facebookresearch/omnilingual-asr/blob/main/LICENSE
- ESCO: https://esco.ec.europa.eu/en
- ESCO current scope and languages: https://esco.ec.europa.eu/en/about-esco/faq
- ESCO download and dataset formats: https://esco.ec.europa.eu/en/use-esco/download
- O*NET database: https://www.onetcenter.org/database.html
- O*NET licence: https://www.onetcenter.org/license_db.html
- UNESCO ISCED-F 2013: https://uis.unesco.org/en/methods-and-tools/isced
- Qwen3: https://github.com/QwenLM/Qwen3

All versions and licences must be rechecked immediately before adoption. This document is an architecture proposal and operating specification, not a legal opinion or a declaration that the listed tools/models are production-ready for BEAN.
