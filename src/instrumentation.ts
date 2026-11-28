// ─── OPS-1B: eager, idempotent durable-worker bootstrap ──────────────────────
// Next.js instrumentation lifecycle: register() runs once per server process
// at startup (see the installed Next.js version's documentation — the file
// lives at src/instrumentation.ts because the app uses the src/ layout).
//
// Problem it fixes: the three durable-queue workers (Riishe document jobs,
// Classroom Intelligence evaluations, CI-3 specialist fleet) previously
// started LAZILY on first enqueue, so QUEUED work stayed idle after a process
// restart until someone touched the relevant feature. Eager registration
// makes restart recovery (expired-lease sweep → re-queue → drain) run at boot.
//
// Guarantees:
//   • Idempotent: the ensure* functions are globalThis singletons inside each
//     queue module — repeated calls never start duplicate loops. No new
//     queue system, no second registry.
//   • Runtime-safe: register() proceeds only on the Node.js server runtime
//     (the workers own the Prisma engine and native bindings); it is never
//     called during client rendering, and the NEXT_PHASE guard additionally
//     refuses to start background loops during build-time compilation.
//   • Executor side-effect parity with the lazy paths: the CI evaluation
//     pipeline and the fleet runtime register their executors via module
//     side effects (src/lib/ci/pipeline.ts, src/lib/ci/fleet/runtime.ts),
//     and the fleet registry resolves subject experts against the seed packs
//     (src/lib/ci/fleet/packs). Bootstrap imports exactly the same
//     side-effect modules the lazy enqueue/dispatch paths import — BEFORE
//     starting any loop — so an eagerly started worker can never claim a job
//     whose executor or pack registry is missing.
//   • Queue semantics untouched: claim CAS, leases, heartbeats, retries,
//     quotas and recovery are unchanged — bootstrap only calls each queue's
//     own ensure* function (the same one first-enqueue calls today).
//   • Startup failures are handled honestly: invalid core-startup
//     configuration fails clearly (no values echoed); a worker that fails to
//     start is logged and the OTHERS still start — /api/healthz then reports
//     the real registration state instead of assuming it.
//   • No shutdown hooks are added: the queue modules run unref()'d intervals
//     by design (they never hold the process open), and no stop path existed
//     before OPS-1 — behaviour preserved.

/** Start the three EXISTING durable-queue worker loops eagerly and idempotently.
 *  Exported for focused tests; production reaches it only through register(). */
export async function bootstrapDurableQueueWorkers(): Promise<void> {
  // 1. Executor/pack side-effect parity first (same imports the lazy paths do).
  //    Each queue is started independently — one failure must not take down
  //    the others; /api/healthz reports the honest per-queue outcome.
  const startRiishe = async (): Promise<void> => {
    const jobs = await import('@/lib/riishe/jobs')
    jobs.ensureWorker()
  }
  const startCiEvaluations = async (): Promise<void> => {
    // src/lib/ci/pipeline.ts registers the evaluation pipeline as an import
    // side effect (same side effect src/lib/ci/trigger.ts relies on).
    await import('@/lib/ci/pipeline')
    const queue = await import('@/lib/ci/queue')
    queue.ensureCiWorker()
  }
  const startSpecialistFleet = async (): Promise<void> => {
    // Same side-effect chain src/lib/ci/fleet/dispatcher.ts imports:
    // packs (subject-expert registry seed) + runtime (task executor).
    await import('@/lib/ci/fleet/packs')
    await import('@/lib/ci/fleet/runtime')
    const worker = await import('@/lib/ci/fleet/worker')
    worker.ensureFleetWorker()
  }

  const starters: Array<{ name: string; start: () => Promise<void> }> = [
    { name: 'riishe', start: startRiishe },
    { name: 'classroomEvaluations', start: startCiEvaluations },
    { name: 'specialistFleet', start: startSpecialistFleet },
  ]

  for (const worker of starters) {
    try {
      await worker.start()
    } catch (err) {
      console.error(
        `[worker bootstrap] ${worker.name} worker failed to start (healthz will report it unregistered):`,
        err instanceof Error ? err.message : err,
      )
    }
  }
}

/** Official Next.js instrumentation entry point. */
export async function register(): Promise<void> {
  // register() runs in every runtime Next.js supports; the durable workers
  // (Prisma engine, native bindings, Node timers) exist only on the Node.js
  // server runtime. Client rendering never calls register().
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // Defensive: never start background loops during build-time compilation.
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  // OPS-1D: fail clearly when genuine core-startup configuration is invalid
  // or missing. Only DATABASE_URL (SQLite) is a core requirement — OAuth,
  // LiveKit, OCR and legal publication variables stay optional by design.
  const { validateStartupEnvironment, startupEnvironmentErrorMessage } = await import('@/lib/env-startup')
  const report = validateStartupEnvironment()
  if (!report.ok) {
    throw new Error(startupEnvironmentErrorMessage(report))
  }

  await bootstrapDurableQueueWorkers()
}
