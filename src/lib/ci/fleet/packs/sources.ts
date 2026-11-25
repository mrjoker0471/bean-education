// ─── BEAN Classroom Intelligence (CI-3B): pack seed sources ──────────────────
// Sources cited by the first seed domain packs, registered in the source &
// licence registry on import. Every entry is a genuinely stable, well-known
// open-licensed reference; the licence statements record what was verified on
// the verification date and what must be re-read before any *content* (beyond
// referencing the source itself) is imported or retrieved into prompts.
//
// IMPORTANT: no copyrighted text from these sources is reproduced anywhere in
// this repository. The registry records provenance; the packs reference the
// sources; retrieval against them happens only through the licence-gated
// retrieval path (CI-3E) and never by wholesale copying.

import { registerSource } from '../sources'
import { SOURCE_QUALITY_CLASS } from '../constants'
import { ensureTaxonomySourcesRegistered } from '../taxonomy'

const VERIFIED_AT = '2026-11-24'
/** CI-4A audit date — the corrected/restricted records were re-verified then. */
const AUDIT_VERIFIED_AT = '2026-11-25'

let registered = false

export function ensurePackSourcesRegistered(): void {
  if (registered) return
  ensureTaxonomySourcesRegistered()

  registerSource({
    sourceId: 'openstax-mathematics',
    title: 'OpenStax Mathematics series (college algebra, precalculus, calculus, introductory statistics)',
    canonicalRef: 'https://openstax.org/subjects/math',
    publisher: 'OpenStax, Rice University',
    authors: [],
    publishedAt: null,
    jurisdiction: null,
    version: 'current editions (per-volume versioning upstream)',
    superseded: false,
    qualityClass: SOURCE_QUALITY_CLASS.PROFESSION_BODY,
    licence: {
      spdx: 'CC-BY-NC-SA-4.0',
      statement:
        'CI-4A AUDIT CORRECTION (2026-11-25): OpenStax textbooks are distributed under Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — NOT CC BY 4.0 as the CI-3 record claimed. Verified against OpenStax\'s official distribution (github.com/openstax/university-physics LICENSE: "Attribution-NonCommercial-ShareAlike 4.0 International") after the JS-rendered openstax.org pages could not be read server-side. NonCommercial forbids ingesting this content into BEAN\'s commercial operation absent separate written permission; ShareAlike would bind adaptations. Content ingestion is QUARANTINED; citation/reference use (naming the source with attribution) remains permitted. Per-volume third-party figure rights must still be checked if permission is ever granted.',
      verifiedAt: AUDIT_VERIFIED_AT,
      restrictions: ['NON_COMMERCIAL', 'SHARE_ALIKE'],
    },
    permittedUse:
      'Citation-level reference ONLY: naming the source with attribution for concept anchoring and curriculum-scope notes. Content ingestion/retrieval of textbook text into prompts or knowledge records is QUARANTINED (NonCommercial + ShareAlike vs commercial operation) until separate written permission from Rice University/OpenStax.',
    attribution:
      'OpenStax Mathematics titles © Rice University, licensed CC BY-NC-SA 4.0. View free at openstax.org.',
  })

  registerSource({
    sourceId: 'mdn-web-docs',
    title: 'MDN Web Docs',
    canonicalRef: 'https://developer.mozilla.org',
    publisher: 'Mozilla',
    authors: [],
    publishedAt: null,
    jurisdiction: null,
    version: 'continuously updated upstream',
    superseded: false,
    qualityClass: SOURCE_QUALITY_CLASS.ASSESSED_SECONDARY,
    licence: {
      spdx: 'CC-BY-SA-2.5',
      statement:
        'MDN Web Docs content is available under Creative Commons Attribution-ShareAlike 2.5; code samples under their own licences. Verified against the MDN content licence page; commercial use is permitted WITH attribution, but adaptations of ingested content carry the same ShareAlike obligation — recorded as a machine-checkable restriction in CI-4A.',
      verifiedAt: VERIFIED_AT,
      restrictions: ['SHARE_ALIKE'],
    },
    permittedUse: 'Reference for web-platform terminology and definitions in computing packs (attribution + share-alike on adaptations).',
    attribution: 'MDN Web Docs by Mozilla Contributors, licensed CC-BY-SA 2.5.',
  })

  registerSource({
    sourceId: 'python-docs-psf',
    title: 'Python Official Documentation',
    canonicalRef: 'https://docs.python.org/3/',
    publisher: 'Python Software Foundation',
    authors: [],
    publishedAt: null,
    jurisdiction: null,
    version: 'per-language-version (e.g. 3.x series docs)',
    superseded: false,
    qualityClass: SOURCE_QUALITY_CLASS.OFFICIAL_CURRICULUM,
    licence: {
      spdx: 'PSF-2.0',
      statement:
        'Python documentation is published under the PSF License Version 2 (permissive; attribution preserved in the licence notice). Version-specific docs must be pinned when retrieved — a claim valid for one Python version may be wrong for another.',
      verifiedAt: VERIFIED_AT,
    },
    permittedUse: 'Official reference for Python terminology, semantics and standard library behaviour in computing packs (version-pinned).',
    attribution: 'Python documentation © Python Software Foundation (PSF License 2.0).',
  })

  registerSource({
    sourceId: 'openstax-anatomy-physiology',
    title: 'OpenStax Anatomy and Physiology 2e',
    canonicalRef: 'https://openstax.org/details/books/anatomy-and-physiology-2e',
    publisher: 'OpenStax, Rice University',
    authors: [],
    publishedAt: '2022',
    jurisdiction: null,
    version: '2e',
    superseded: false,
    qualityClass: SOURCE_QUALITY_CLASS.PROFESSION_BODY,
    licence: {
      spdx: 'CC-BY-NC-SA-4.0',
      statement:
        'CI-4A AUDIT CORRECTION (2026-11-25): OpenStax A&P 2e is distributed under Attribution-NonCommercial-ShareAlike 4.0 International — NOT CC BY 4.0 as the CI-3 record claimed (same primary evidence as the other OpenStax records: OpenStax\'s official distribution LICENSE files). Content ingestion is QUARANTINED for the commercial operation; citation/reference use remains permitted. This is an EDUCATIONAL reference only — it never authorises diagnosis or personalised medical guidance (charter §14 health boundaries).',
      verifiedAt: AUDIT_VERIFIED_AT,
      restrictions: ['NON_COMMERCIAL', 'SHARE_ALIKE'],
    },
    permittedUse:
      'Citation-level reference ONLY for health-science education packs (never clinical decision support). Content ingestion of textbook text is QUARANTINED (NonCommercial + ShareAlike vs commercial operation) until separate written permission from Rice University/OpenStax.',
    attribution:
      'OpenStax Anatomy and Physiology 2e © Rice University, licensed CC BY-NC-SA 4.0.',
  })

  registerSource({
    sourceId: 'un-feed-the-minds-financial-literacy-note',
    title: 'BEAN-authored financial-literacy competency seed (no external dataset imported yet)',
    canonicalRef: 'bean:ci3:source:bean-authored-seed',
    publisher: 'BEAN Education',
    authors: [],
    publishedAt: '2026-11-24',
    jurisdiction: null,
    version: '1.0.0',
    superseded: false,
    qualityClass: SOURCE_QUALITY_CLASS.ASSESSED_SECONDARY,
    licence: {
      spdx: null,
      statement:
        'BEAN-authored seed content. Jurisdiction-specific finance/tax regulation datasets (e.g. national regulators or standards boards) require per-source licence verification before import — none imported in CI-3B.',
      verifiedAt: VERIFIED_AT,
    },
    permittedUse: 'Concept-level glossary authored by BEAN; explicitly NOT a regulatory source.',
    attribution: 'BEAN Education original content.',
  })

  registerSource({
    sourceId: 'openstax-science-series',
    title: 'OpenStax Science series (Physics, Chemistry 2e, Biology 2e, Astronomy)',
    canonicalRef: 'https://openstax.org/subjects/science',
    publisher: 'OpenStax, Rice University',
    authors: [],
    publishedAt: null,
    jurisdiction: null,
    version: 'current editions (per-volume versioning upstream)',
    superseded: false,
    qualityClass: SOURCE_QUALITY_CLASS.PROFESSION_BODY,
    licence: {
      spdx: 'CC-BY-NC-SA-4.0',
      statement:
        'CI-4A AUDIT CORRECTION (2026-11-25): OpenStax science textbooks are distributed under Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International — NOT CC BY 4.0 as the CI-3 record claimed. Verified against OpenStax\'s official distribution (github.com/openstax/university-physics LICENSE: "Attribution-NonCommercial-ShareAlike 4.0 International"). Content ingestion is QUARANTINED for BEAN\'s commercial operation; citation/reference use (naming the source with attribution) remains permitted. Per-volume third-party figure rights must still be checked if permission is ever granted.',
      verifiedAt: AUDIT_VERIFIED_AT,
      restrictions: ['NON_COMMERCIAL', 'SHARE_ALIKE'],
    },
    permittedUse:
      'Citation-level reference ONLY for physics/chemistry/biology/astronomy concept anchoring. Content ingestion/retrieval of textbook text is QUARANTINED (NonCommercial + ShareAlike vs commercial operation) until separate written permission from Rice University/OpenStax.',
    attribution:
      'OpenStax Science titles © Rice University, licensed CC BY-NC-SA 4.0. View free at openstax.org.',
  })

  registerSource({
    sourceId: 'ncert-textbooks',
    title: 'NCERT e-textbooks (National Council of Educational Research and Training, India)',
    canonicalRef: 'https://ncert.nic.in/textbook.php',
    publisher: 'NCERT, Government of India',
    authors: [],
    publishedAt: null,
    jurisdiction: 'India (curriculum reference)',
    version: 'current editions (per-title versioning upstream)',
    superseded: false,
    qualityClass: SOURCE_QUALITY_CLASS.OFFICIAL_CURRICULUM,
    licence: {
      spdx: null,
      statement:
        'NCERT publishes its e-textbooks for free educational use on ncert.nic.in. No formal open-licence instrument is published alongside the PDFs, so no SPDX id is claimed: only concept-level references are made and no NCERT text is reproduced. Terms must be re-read from ncert.nic.in before any content import. CI-4A records this as an explicit REFERENCE_ONLY restriction — a downloadable PDF is not a reuse licence.',
      verifiedAt: VERIFIED_AT,
      restrictions: ['REFERENCE_ONLY'],
    },
    permittedUse:
      'Official Indian curriculum reference for concept/terminology anchoring in school-level packs (curriculum alignment notes only; no text reproduction).',
    attribution: 'Reference: NCERT e-textbooks (ncert.nic.in), National Council of Educational Research and Training.',
  })

  registerSource({
    sourceId: 'cefr-companion-volume',
    title: 'CEFR Companion Volume (Common European Framework of Reference for Languages)',
    canonicalRef: 'https://www.coe.int/en/web/common-european-framework-reference-languages',
    publisher: 'Council of Europe',
    authors: [],
    publishedAt: '2020',
    jurisdiction: null,
    version: 'Companion Volume 2020',
    superseded: false,
    qualityClass: SOURCE_QUALITY_CLASS.OFFICIAL_REGULATOR,
    licence: {
      spdx: null,
      statement:
        'The Council of Europe publishes the CEFR/Companion Volume as a freely downloadable reference framework with attribution requested for reuse; no open-content licence instrument is published, so only level descriptors are REFERENCED (never reproduced) and terms are re-read from coe.int before any content import. CI-4A records this as an explicit REFERENCE_ONLY restriction.',
      verifiedAt: VERIFIED_AT,
      restrictions: ['REFERENCE_ONLY'],
    },
    permittedUse:
      'Reference framework for language-level descriptors (A1–C2) in language-education packs; level names and the framework are cited, descriptor text is not copied.',
    attribution: 'Reference: CEFR Companion Volume, Council of Europe (coe.int).',
  })

  // CI-4C: BEAN-authored domain seed sources for the new pack candidates —
  // registered under the SAME once-flag as the CI-3 pack sources so registry
  // resets (tests) always restore a complete, consistent seed set.
  for (const s of CI4_BEAN_AUTHORED_SOURCES) {
    registerSource({
      sourceId: s.sourceId,
      title: s.title,
      canonicalRef: `bean:ci4:source:${s.sourceId}`,
      publisher: 'BEAN Education',
      authors: [],
      publishedAt: '2026-11-25',
      jurisdiction: null,
      version: '1.0.0',
      superseded: false,
      qualityClass: SOURCE_QUALITY_CLASS.ASSESSED_SECONDARY,
      licence: {
        spdx: null,
        statement:
          'BEAN-authored seed content (original concept-level glossary and competency structure). Jurisdiction/domain-specific authoritative datasets (standards bodies, curriculum boards, textbooks) require per-source licence verification before any import — none imported in CI-4C. Content ingestion follows the CI-4A gate when such sources are registered later.',
        verifiedAt: AUDIT_VERIFIED_AT,
        restrictions: [],
      },
      permittedUse:
        'Concept-level glossary and competency anchoring authored by BEAN; not an authoritative external source — authoritative claims need a registered external source.',
      attribution: 'BEAN Education original content.',
    })
  }

  registered = true
}

/** Clear the once-only flag so the next ensure call re-registers (tests only). */
export function resetPackSourcesForTests(): void {
  registered = false
}

// ─── CI-4C: BEAN-authored domain seed sources for the new pack candidates ────
// Same discipline as the CI-3B finance seed: the packs' explanatory concepts
// are BEAN-authored originals; no external dataset is imported yet. Each new
// domain gets its own registered seed record so provenance stays explicit and
// the licence gate (assertSourceUsable / assertSourceContentUsable) applies.

export const CI4_BEAN_AUTHORED_SOURCES: { sourceId: string; title: string; domain: string }[] = [
  { sourceId: 'bean-authored-knowledge-corpus', title: 'BEAN-authored knowledge corpus seed — glossary definitions authored by BEAN across all packs (no external dataset imported)', domain: 'all-packs' },
  { sourceId: 'bean-authored-education-pedagogy-seed', title: 'BEAN-authored education & pedagogy competency seed (no external dataset imported yet)', domain: 'education-pedagogy' },
  { sourceId: 'bean-authored-engineering-seed', title: 'BEAN-authored engineering fundamentals competency seed (no external dataset imported yet)', domain: 'engineering' },
  { sourceId: 'bean-authored-agriculture-agritech-seed', title: 'BEAN-authored agriculture & agritech competency seed (no external dataset imported yet)', domain: 'agriculture-agritech' },
  { sourceId: 'bean-authored-history-culture-seed', title: 'BEAN-authored history, culture & humanities competency seed (no external dataset imported yet)', domain: 'history-philosophy' },
]

