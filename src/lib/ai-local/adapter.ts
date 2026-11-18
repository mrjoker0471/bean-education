// ─── Browser-local inference adapters (BEAN Learn, foundation scope) ───
// Consent-gated, lazily-loaded adapter interface. The concrete runtime is an
// OPTIONAL dependency: it is intentionally NOT installed in this foundation
// build, and every failure path here is honest about that (clear errors,
// zero downloads, zero side effects).
//
// ─── CONSENT AND PRIVACY MODEL (non-negotiable for this module) ───
// 1. Consent + an explicit user action gate ALL downloads. Nothing in this
//    module runs automatically: `init()` is the single gate, and it may only
//    be called after the user has opted in and pressed a visible control.
// 2. The app never downloads models automatically — not on page load, not in
//    the background, not "pre-warmed". A model reaches a device only when a
//    user of THAT device deliberately asks for it.
// 3. Students' devices are never used for other users' inference — a local
//    engine serves only the prompts issued in this tab, on this device.
// 4. Prompts and files stay on device — local inference never uploads study
//    content, prompts, or generated text anywhere. It is additive to the
//    existing server-side BEAN/Riishe chat (the default path), never a
//    replacement that quietly moves student data off the device.

/** Options for a single local generation call. */
export interface LocalGenerateOptions {
  maxTokens?: number
  temperature?: number
  /** Streaming-style status text (e.g. download / load progress). */
  onProgress?: (s: string) => void
}

/** Uniform contract for every on-device inference backend. */
export interface LocalInferenceAdapter {
  /** Stable identifier, e.g. 'webllm' — persisted with the user's consent choice. */
  readonly id: string
  /**
   * Prepare the runtime AND load the model. Consent must be obtained and the
   * user must have acted BEFORE this is called: this is the only method that
   * can trigger a (deliberate, per-device) model download.
   */
  init(onProgress?: (s: string) => void): Promise<void>
  /** Run one prompt against the loaded local model. Throws if init() has not completed. */
  generate(prompt: string, opts?: LocalGenerateOptions): Promise<string>
  /** Release the model + engine memory. Safe to call twice. */
  dispose(): Promise<void>
}

// ─── Narrow local view of the optional `web-llm` runtime ───
// The real package is not installed in this foundation build, so these minimal
// shapes are what keep this file type-safe and compiling. When the optional
// runtime lands, `as unknown as` still holds (unknown is the intermediary), and
// the shapes below can be replaced by the package's own types.

interface WebLlmProgressReport {
  progress?: number
  text?: string
}

interface WebLlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface WebLlmCompletionRequest {
  messages: WebLlmMessage[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
}

interface WebLlmCompletion {
  choices?: { message?: { content?: string | null } }[]
}

interface WebLlmEngine {
  chat: {
    completions: {
      create(request: WebLlmCompletionRequest): Promise<WebLlmCompletion>
    }
  }
  resetChat?: () => Promise<void>
  unload?: () => Promise<void>
}

/** Narrow shape of the `web-llm` module this adapter actually uses. */
type WebLlmModule = {
  CreateMLCEngine(
    model: string,
    config?: { initProgressCallback?: (report: WebLlmProgressReport) => void },
  ): Promise<WebLlmEngine>
}

/**
 * Small default model for on-device chat. Referenced by the consent UI so the
 * user knows exactly what would be downloaded to THEIR device before opting in.
 */
export const DEFAULT_LOCAL_MODEL = 'Llama-3.2-1B-Instruct-q4f16_1-MLC'

const WEB_LLM_MODULE_ID = 'web-llm'

/** Exact, honest failure message when the optional runtime is absent. */
const RUNTIME_MISSING_MESSAGE =
  'WebLLM runtime is not installed in this build — on-device models require opting in and ' +
  'installing the optional runtime (see docs/PHASE2A_AI_RUNTIME.md). Nothing was downloaded.'

/** Honest failure message for the not-yet-built WASM adapter. */
const WASM_ADAPTER_MESSAGE =
  'Transformers.js WASM adapter lands in a later milestone — CPU-only on-device inference is a ' +
  'documented foundation boundary (see docs/PHASE2A_AI_RUNTIME.md). Nothing was downloaded.'

/**
 * Import the OPTIONAL WebLLM runtime.
 *
 * Deliberately dynamic and deliberately NON-LITERAL (`import(WEB_LLM_MODULE_ID)`
 * with a variable specifier, plus the `turbopackIgnore` hint):
 *  - tsc cannot statically resolve an absent optional package, so the narrow
 *    `WebLlmModule` cast is what keeps this file compiling — no ts-ignore needed;
 *  - the bundler therefore cannot eagerly resolve (and fail on) a missing
 *    optional dependency; module absence surfaces at RUNTIME, where init()
 *    converts it into the honest error below instead of a build failure.
 */
async function loadWebLlmModule(): Promise<WebLlmModule> {
  try {
    const mod = (await import(/* turbopackIgnore: true */ WEB_LLM_MODULE_ID)) as unknown as WebLlmModule
    if (!mod || typeof mod.CreateMLCEngine !== 'function') {
      throw new Error(RUNTIME_MISSING_MESSAGE)
    }
    return mod
  } catch (err) {
    // Package absent (our intended foundation path) or a broken install: either
    // way the user gets one clear, actionable message. Original error kept as
    // `cause` for debugging.
    throw new Error(RUNTIME_MISSING_MESSAGE, { cause: err })
  }
}

/**
 * WebLLM-backed adapter (WebGPU). `init()` is the consent gate: only after it
 * is called does anything get fetched — the runtime module and, if installed,
 * the model weights — and only onto the device of the user who opted in.
 */
export class WebLlmAdapter implements LocalInferenceAdapter {
  readonly id = 'webllm'

  private engine: WebLlmEngine | null = null

  async init(onProgress?: (s: string) => void): Promise<void> {
    // Idempotent by design: a second init on an already-loaded engine is a no-op.
    if (this.engine) return

    onProgress?.('Looking for the optional WebLLM runtime in this build…')
    const mod = await loadWebLlmModule()

    // ── PAST THE CONSENT GATE ──
    // Everything below only runs because a user on THIS device explicitly
    // opted in and triggered init(). The model download is deliberate,
    // per-device, and reported step by step.
    onProgress?.(`Preparing ${DEFAULT_LOCAL_MODEL} — downloaded to this device only, after your confirmation.`)
    this.engine = await mod.CreateMLCEngine(DEFAULT_LOCAL_MODEL, {
      initProgressCallback: (report) => {
        const pct = typeof report.progress === 'number' ? `${Math.round(report.progress * 100)}%` : ''
        const text = report.text ?? 'Loading model…'
        onProgress?.(pct ? `${text} ${pct}` : text)
      },
    })
    onProgress?.('On-device model ready. Prompts and answers stay on this device.')
  }

  async generate(prompt: string, opts?: LocalGenerateOptions): Promise<string> {
    if (!this.engine) {
      throw new Error('Local model is not initialised — the consent-gated init() must complete before generate().')
    }
    const request: WebLlmCompletionRequest = {
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    }
    if (typeof opts?.temperature === 'number') request.temperature = opts.temperature
    if (typeof opts?.maxTokens === 'number') request.max_tokens = opts.maxTokens

    const completion = await this.engine.chat.completions.create(request)
    return completion.choices?.[0]?.message?.content ?? ''
  }

  async dispose(): Promise<void> {
    const engine = this.engine
    this.engine = null
    if (!engine) return
    try {
      await engine.resetChat?.()
      await engine.unload?.()
    } catch {
      // Best-effort unload; the engine reference is dropped regardless so
      // memory is reclaimable even if the runtime's cleanup path fails.
    }
  }
}

/**
 * Factory matching `LocalAiCapabilities.recommendation`.
 * - 'WEBGPU' → WebLlmAdapter (still fails honestly at init() when the optional
 *   runtime is absent from this build).
 * - 'WASM' → throws: the Transformers.js CPU adapter is a documented foundation
 *   boundary, not silently stubbed.
 */
export function createLocalAdapter(kind: 'WEBGPU' | 'WASM'): LocalInferenceAdapter {
  if (kind === 'WEBGPU') return new WebLlmAdapter()
  throw new Error(WASM_ADAPTER_MESSAGE)
}
