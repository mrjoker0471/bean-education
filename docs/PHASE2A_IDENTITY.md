# Phase 2A — Student Identity (BEAN LEARN)

Status: implemented (auth API + sign-in panel). This document is the source of truth for the
identity model, its security properties, and the exact integration contract for
`src/lib/store.ts` / `src/lib/api.ts`.

---

## 1. Identity model — guest + student coexistence

BEAN has always been usable without an account: a device-local `guestId` scopes every owned row
(attempts, study documents, Riishe tests, chat turns). Phase 2A adds real accounts **without**
removing that property.

### Row ownership

Every owned row carries **both** identities:

| Column       | Meaning                                                              |
| ------------ | -------------------------------------------------------------------- |
| `guestId`    | Device-local identity. Never rewritten by the auth layer.            |
| `studentId`  | Nullable. Set when a signed-in student owns the row (guest → claim). |

Ownership check for any row: `row.guestId === guestId` **OR** (`student.id` is signed in **AND**
`row.studentId === student.id`). See `resolveOwnerScope` / `ownedBy` in `src/lib/auth.ts`.

### Claim flow (guest → student)

1. The student signs in / registers (session cookie set).
2. The app shell sends `POST /api/auth/claim-guest { guestId }`.
3. The server runs `updateMany` on the four owned tables with
   `where: { guestId, studentId: null }`, setting `studentId` to the session student.

Safety properties:

- `studentId: null` in the where-clause means rows already owned by **another** student are
  never deleted or overwritten.
- Claiming is idempotent — a second call claims 0 rows.
- Guest data is never deleted by signing in; the guest identity keeps working for fresh
  guest activity (both identities can coexist on one device).

Deletion is the mirror image: `POST /api/auth/account/delete` deletes strictly by
`studentId`, so claimed rows are removed while other students' rows (same `guestId`, different
owner) are untouched.

---

## 2. Security model

### Passwords — scrypt (node:crypto, no external dependency)

- Parameters: **N=16384, r=8, p=1**, 16-byte random salt, 64-byte derived key.
- Storage format: `scrypt$N$r$p$salt$hash` (base64 salt/hash) in `Student.passwordHash`.
- Passwords are normalized with Unicode NFKC before hashing/verification.
- Plaintext passwords and hashes are never logged and never returned by any endpoint.
- Verification is timing-safe (`timingSafeEqual`) and derives with the stored parameters.

### Sessions — hashed bearer tokens

- On sign-in the server issues a random **256-bit token** (`base64url`) and stores **only its
  SHA-256 hash** in `Session.tokenHash` (unique). A database leak cannot be replayed as cookies.
- The raw token exists only inside an **httpOnly** cookie (`bean_session`):
  `HttpOnly; SameSite=Lax; Path=/; Expires=<30 days>; Secure` in production.
- TTL: **30 days**, sliding — renewed when more than half the TTL has elapsed on activity.
- Logout deletes the current session row and clears the cookie. All of a student's sessions are
  deleted when the account is deleted (explicit delete + schema cascade).

### CSRF-lite origin check

Every mutating auth endpoint (`register`, `login`, `logout`, `claim-guest`, `account/delete`)
calls `sameOrigin(req)` first: when a browser sends an `Origin` header it must match the request
host, otherwise **403**. Non-browser clients (no `Origin` header) pass — the API stays scriptable.
Combined with `SameSite=Lax` cookies, this blocks cross-site POSTs from other origins.

### Why NOT next-auth

`next-auth` is present in `package.json` but is deliberately **not used** here:

- It is not configured (no provider setup, no adapter, no `NEXTAUTH_SECRET`), so wiring it up
  would mean new configuration surface for zero benefit.
- BEAN's credential needs are minimal: email + password, one session cookie, no OAuth, no
  external identity provider, no paid services.
- The in-house `src/lib/auth.ts` keeps the whole flow inspectable, dependency-free
  (node:crypto only) and tightly coupled to the Prisma models we already have.

---

## 3. Endpoints

All bodies and responses are JSON. Error responses are `{ error: string }`.
Mutating endpoints require the same-origin check (403 on mismatch).

| Method | Path                         | Auth        | Body                                  | Success                                                                                          | Errors                                                                                       |
| ------ | ---------------------------- | ----------- | ------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| POST   | `/api/auth/register`         | guest       | `{ email, password, displayName? }`   | 200 `{ student }` + session cookie                                                               | 403 cross-origin · 400 invalid email/password/name (message from rule) · 409 email taken · 500 |
| POST   | `/api/auth/login`            | guest       | `{ email, password }`                 | 200 `{ student }` + session cookie                                                               | 403 cross-origin · **401 `Invalid email or password`** (same for unknown email) · 500          |
| POST   | `/api/auth/logout`           | optional    | —                                     | 200 `{ ok: true }`                                                                               | 403 cross-origin · 500                                                                         |
| GET    | `/api/auth/me`               | optional    | —                                     | 200 `{ student: Student \| null }` (`Cache-Control: no-store`)                                    | 500 (`{ student: null, error }`)                                                               |
| POST   | `/api/auth/claim-guest`      | student     | `{ guestId }` (8–64 chars)            | 200 `{ claims: { attempts, documents, tests, chatTurns } }`                                       | 403 cross-origin · 401 not signed in · 400 invalid request · 500                                |
| GET    | `/api/auth/account/export`   | student     | —                                     | 200 JSON file, `Content-Disposition: attachment; filename="bean-export-YYYY-MM-DD.json"`         | 401 not signed in · 500                                                                        |
| POST   | `/api/auth/account/delete`   | student     | `{ confirm: 'DELETE' }`               | 200 `{ ok: true }` (session cleared)                                                             | 403 cross-origin · 401 not signed in · 400 confirm missing · 500                                |

`student` DTO everywhere:

```json
{ "id": "…", "email": "you@example.com", "displayName": "Aarav", "learningLevel": "SCHOOL_11_12" }
```

(`displayName` and `learningLevel` may be `null`.)

Emails are always stored **normalized** (`trim().toLowerCase()`); login applies the same
normalization before lookup.

---

## 4. Export & delete behavior

### Export (`GET /api/auth/account/export`, `format: 'bean-export-v1'`)

```json
{
  "format": "bean-export-v1",
  "exportedAt": "2026-02-14T09:30:00.000Z",
  "student":   { "id", "email", "displayName", "learningLevel", "interests", "preferences", "createdAt", "updatedAt" },
  "goals":     [ { "id", "title", "examId", "topicId", "targetDate", "status", "createdAt", "updatedAt" } ],
  "attempts":  [ { "id", "title", "examLabel", "status", "score", "maxScore", "correctCount",
                   "wrongCount", "skippedCount", "startedAt", "submittedAt" } ],
  "documents": [ { "id", "title", "originalName", "mimeType", "fileSize", "pageCount", "status",
                   "statusDetail", "examLabel", "subjectLabel", "topicLabel", "createdAt", "updatedAt" } ],
  "riisheTests":     [ { "id", "title", "status", "requestedCount", "createdAt" } ],
  "riisheChatTurns": [ { "role", "content", "createdAt", "documentId" } ]
}
```

Excluded by design: `passwordHash`, uploaded file bytes, `storedPath`, `contentHash`,
extraction/analysis payloads. Documents are exported as **metadata only**.

### Delete (`POST /api/auth/account/delete { confirm: 'DELETE' }`)

One `db.$transaction` (studentId-scoped everywhere):

1. Collect owned attempt ids + owned `StudyDocument (id, storedPath)` rows.
2. Delete `RiisheExplanation` rows for owned attempts (plain FK — no cascade in schema).
3. Delete owned **attempts**, **chat turns**, **tests** (catches stragglers before the cascade),
   **documents** (cascades remaining tests/questions), **goals** and **sessions** (also cascade
   from the student row), then delete the **Student** row.
4. After commit: best-effort `unlink` of each collected stored file (errors ignored — a missing
   file must not block deletion).
5. Session cookie is cleared; the device returns to guest mode.

Rows owned by other students are never touched, even when a guestId is shared.

---

## 5. Limitations (honest list)

- **No email verification.** Any reachable-looking address can register; nothing is sent by mail.
- **No password reset.** Requires an email service that we do not operate yet.
- **No session enumeration/management UI.** Students cannot list or revoke individual devices;
  logout affects only the current session.
- **CSRF-lite, not full CSRF protection.** Origin checking + SameSite=Lax is strong for this
  threat model but is not a token-based CSRF defense.
- **Rate limiting** is not applied to login/register (see quotas in the Riishe pipeline instead).
- **One cookie, one active session per browser.** Signing in on a second device creates a second
  session; there is no single-session enforcement.

---

## 6. Integration notes for `store.ts` / `api.ts`

These are the exact changes to make while integrating (files intentionally untouched by this task):

### `src/lib/types.ts`

```ts
export interface AuthedStudent { id: string; email: string; displayName: string | null; learningLevel: string | null }
export interface GuestClaims   { attempts: number; documents: number; tests: number; chatTurns: number }
```

### `src/lib/api.ts` (add four thin wrappers over `jsonFetch`)

```ts
async register(email: string, password: string, displayName?: string) {
  return jsonFetch('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, displayName }) })
  // → { student: AuthedStudent }
},
async login(email: string, password: string) {
  return jsonFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  // → { student: AuthedStudent } ; 401 body { error: 'Invalid email or password' }
},
async logout() {
  return jsonFetch('/api/auth/logout', { method: 'POST' })            // → { ok: true }
},
async claimGuest(guestId: string) {
  return jsonFetch('/api/auth/claim-guest', { method: 'POST', body: JSON.stringify({ guestId }) })
  // → { claims: GuestClaims }
},
async me() {
  return jsonFetch('/api/auth/me')                                     // → { student: AuthedStudent | null }
},
async deleteAccount() {
  return jsonFetch('/api/auth/account/delete', { method: 'POST', body: JSON.stringify({ confirm: 'DELETE' }) })
  // → { ok: true }
},
async exportAccount() → plain fetch + res.blob() to trigger the download
  // GET /api/auth/account/export — NOT jsonFetch (it is a file download)
```

`jsonFetch` already surfaces `{ error }` as thrown `Error` messages — all auth endpoints emit
exactly one string error field, so messages display as-is.

### `src/lib/store.ts`

```ts
// state
authedStudent: AuthedStudent | null    // null = guest mode (default)
authChecked: boolean                   // false until first me() resolves
authBusy: boolean

// actions
refreshAuth()   → GET /api/auth/me → set authedStudent + authChecked (call once on app boot)
signUp(email, password, displayName?) → POST register → set authedStudent → claimGuest(guestId)
signIn(email, password)               → POST login    → set authedStudent → claimGuest(guestId)
signOut()                             → POST logout   → set authedStudent = null
deleteAccount()                       → POST account/delete → set authedStudent = null
```

Claim should fire **after** the auth call succeeds, with the store's existing `guestId`, and can
log/ignore per-table counts (the operation is safe and idempotent). `auth-view.tsx` calls
`onAuthed({ id, email, displayName })`; the shell wires that to `store.signIn`/`signUp` state that
already owns the `guestId` (or simply calls the store actions directly). The panel deliberately
does not touch the store itself.
