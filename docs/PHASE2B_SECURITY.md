# Phase 2B — Security: PYQ Curator Permissions

## Threat model summary

Before Phase 2B, `POST /api/pyq/review` accepted any signed-in student — every account holder could verify historical questions for the whole bank. That is unacceptable for a public question bank: a single curious user could contaminate provenance at scale. The fix is a server-side role system with no client-controlled path to privilege.

## Role model

| Role | Assignment | Capabilities (enforced server-side) |
|---|---|---|
| STUDENT | **Always** assigned at registration | Everyday learner surfaces: dashboard, workspace, goals, practice, Riishe |
| PYQ_CURATOR | Operator CLI only | Everything a student has, PLUS: structured PYQ import, review approve/reject, batch/question listings |
| ADMIN | Operator CLI only | Same as curator (reserved for operators) |

Enforcement points (all server-side; the UI only mirrors them):

- `POST /api/pyq/import` → `requirePyqCurator()` — guest 401, student 403
- `POST /api/pyq/review` → same guard
- `GET /api/pyq/batches` → same guard
- `GET /api/pyq/questions` (new) → same guard

## Hard guarantees (all unit-tested + E2E-verified)

1. **Registration always creates STUDENT.** The register route parses `role` ONLY to refuse it (400 "Roles cannot be set through registration"). Verified by API E2E: a registration carrying `"role":"ADMIN"` is refused and the account is never created.
2. **No client path to privilege.** Profile updates do not include role in their schema (zod strips unknown keys); the route-level test proves a PATCH carrying `"role":"ADMIN"` leaves the stored role untouched. There is no promote/demote endpoint at all.
3. **Roles live in the DB** (`Student.role`, indexed) via an additive migration (default STUDENT — existing accounts were students before and stay students).
4. **401 vs 403 discipline** — signed-out visitors get 401 (identity missing); signed-in students get 403 (identity known, action forbidden). The refusal never leaks whether an endpoint exists beyond the role boundary.
5. **Reviewer accountability.** Every APPROVE/REJECT writes an append-only `PyqReviewEvent` (questionId, reviewerId, reviewerRole at decision time, action, justification, timestamp) IN ADDITION to the `Question.reviewedBy/At/Note` snapshot. Re-reviews append; history is never erased.
6. **No casual downgrade.** REJECT of a `PYQ_VERIFIED` row is refused (409); unverification is a deliberate curation action outside this endpoint. APPROVE of verified rows (re-confirmation) is allowed and audited.
7. **Import is curator-only — guest path removed.** The Phase 2A guest import option is gone; provenance `importedBy` is always an authenticated curator/admin id.

## Initial administrator provisioning & recovery

Roles can only be changed by the **operator CLI** (`scripts/grant-role.ts`), which runs where the database is held and talks to it directly — there is no HTTP endpoint that can raise a role.

```bash
# List privileged accounts
bun scripts/grant-role.ts --list

# Preview (dry-run default — nothing written without --yes)
bun scripts/grant-role.ts --email=ops@example.com --role=ADMIN

# Apply
bun scripts/grant-role.ts --email=ops@example.com --role=ADMIN --yes

# Demote (recovery)
bun scripts/grant-role.ts --email=x@example.com --role=STUDENT --yes
```

Safety properties:

- Valid roles only (STUDENT | PYQ_CURATOR | ADMIN); unknown roles exit 2.
- Dry-run by default; `--yes` required to write.
- **Last-admin protection**: demoting the final ADMIN is refused and rolled back automatically.
- The account must already exist (registered through the app); the CLI never creates accounts.
- The printed before→after transcript IS the operator audit log; keep it in the operator runbook.

### Recovery if no ADMIN remains (worst case)

The CLI refuses to leave zero ADMINs. If an operator ever loses access to all ADMIN accounts (e.g. account deletion), recover with direct DB access on the host that holds the database:

```sql
-- sqlite3 db/custom.db (server-side, never via HTTP)
UPDATE Student SET role='ADMIN' WHERE email='<operator email>';
```

Then rotate the operator's password through the app's normal sign-in flow. Document the action in the operator log.

### Curator session token handling (import CLI)

`scripts/pyq-import.ts` authenticates with a curator session cookie (`PYQ_COOKIE='bean_session=<token>'`). Session tokens are credentials: copy them manually from DevTools (they are httpOnly by design), never commit or share them, and prefer the web studio for imports when possible.

## Residual risks (honest)

- **Single-node SQLite**: role checks race only with the single writer; safe for the current deployment shape, revisit if the app scales beyond one writer.
- **No email verification**: an attacker can register accounts freely, but accounts without a role hold zero curation power; the attack surface added by open registration is exactly "403 for everything privileged".
- **Curator misuse**: a curator can approve bad rows. Mitigations: mandatory written justification, append-only audit trail, reviewer identity rendered everywhere in the studio, and ADMINs can demote via the CLI. Bulk re-verification of a bad curator's rows is future work (query by reviewedBy).
- **Session fixation/rotation**: unchanged from Phase 2A (hashed tokens, sliding 30-day expiry).
