# Third-Party Notices

This file records the third-party components whose code the BEAN Education
Classroom Intelligence CI-3 implementation imports or directly adapts, with
their licences and upstream references, as required by the operating charter
(`docs/BEAN-CLASSROOM-INTELLIGENCE-AGENT-CHARTER.md` §3) and the CI-3A
research decision record (`docs/BEAN-CLASSROOM-INTELLIGENCE-AGENT-RESEARCH.md`).

Components that were only *evaluated* (not imported) are listed in the
research document and are intentionally **not** included here. Versions are
the exact pinned versions in `package.json`; re-verify upstream licences when
bumping.

---

## Apache-2.0

### @livekit/rtc-node 1.2.3

- Upstream: https://github.com/livekit/rtc-node
- Licence: Apache-2.0 (verified against the npm registry metadata and the
  installed package manifest, 2026-11-24)
- Copyright: Copyright 2024 LiveKit, Inc.
- Usage: server-side RTC room-join engine used by the consent-gated BEAN
  Classroom Observer adapter (CI-3D) to appear as a visible, disclosed,
  least-privilege programmatic participant in eligible rooms.
- Carrier dependency: `@livekit/rtc-ffi-bindings` (prebuilt native bindings,
  Apache-2.0, same upstream project).

### livekit-server-sdk 2.20.0

- Upstream: https://github.com/livekit/agents-js (server SDK lives in the
  LiveKit JS ecosystem; package: https://www.npmjs.com/package/livekit-server-sdk)
- Licence: Apache-2.0 (verified against the installed package manifest,
  2026-11-24)
- Usage: pre-existing BEAN dependency (Phase 5 live classrooms). CI-3 uses its
  `AgentDispatchClient` for explicit, eligibility-gated observer dispatch and
  its `AccessToken` for the observer's least-privilege identity.

Apache License 2.0 full text: http://www.apache.org/licenses/LICENSE-2.0

The licence text is likewise shipped with the installed packages under
`node_modules/@livekit/rtc-node/LICENSE` and
`node_modules/livekit-server-sdk/LICENSE` and applies to the distributed
artefacts of those packages.

---

## Statement on evaluation-only candidates

The following were inspected/evaluated in CI-3A (or earlier in CI-1A) and are
**not** imported, executed, bundled, or copied into BEAN. Their licences are
recorded in the research document for traceability only:
`@livekit/agents` (Apache-2.0), Agno (Apache-2.0), LangGraph (MIT), CrewAI
(MIT), LiveKit Agents Python (Apache-2.0), Omnilingual ASR (Apache-2.0),
Qwen3 open-weight models (Apache-2.0 per upstream README). No source text,
prompt content, or model weights from these projects are included in this
repository.

## Statement on taxonomy datasets

No ESCO, O*NET or UNESCO ISCED-F data has been imported as of CI-3A. When a
dataset import happens (CI-3B onward), its licence, version, attribution text
and verification date will be recorded in the source/licence registry and an
attribution notice will be added to this file before the first use.
