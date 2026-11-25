// ─── Domain-pack registry bootstrap (CI-5H production-readiness fix) ──────────
// The 12 CI-3/CI-4 domain packs auto-register when `./index` is imported, but
// until CI-5H NO production entry point imported it — the registry lived only
// in test processes (which import it explicitly). The CI-5G browser
// walkthrough caught the real-server symptom: the admin packs API returned an
// empty registry and expert pack reviews would 404 on the deployed server.
//
// Production modules that consult the pack registry (curator, reviewer scope
// validation, the pack-review submit path) import THIS module, guaranteeing
// the registry is populated in every process that needs it. Importing is
// idempotent (module evaluation runs once per process).
//
// No cycle: packs/index imports only domain-packs + constants + packs/sources.
import './index'
