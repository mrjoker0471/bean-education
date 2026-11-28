// ─── OPS-1A/1B: worker-loop liveness contract ────────────────────────────────
// Minimal, read-only shape reported by each durable-queue module about its own
// worker loop. The DATA always comes from the queue's own registration
// authority (its ensure* globalThis singleton) — health reporting never
// maintains a second registry and never invents worker state.

export interface WorkerLoopLiveness {
  /** True when the queue module's own worker loop is registered in this process. */
  registered: boolean
  /** Epoch ms of the worker loop's most recent tick start, or null when the
   *  loop has not ticked yet (just bootstrapped) or is not registered. */
  lastTickAt: number | null
}
