// ─── Browser-local AI foundation (BEAN Education) ───
//
// FOUNDATION SCOPE — what works NOW:
//   • detectLocalAi(): SSR-safe probe of WebGPU / WebAssembly / device facts,
//     returning an honest recommendation ('WEBGPU' | 'WASM' | 'UNAVAILABLE').
//   • LocalInferenceAdapter interface + WebLlmAdapter with graceful
//     missing-runtime behaviour: when the optional runtime is absent, init()
//     throws one clear, actionable error — nothing is downloaded, nothing
//     breaks the build.
//   • createLocalAdapter('WEBGPU' | 'WASM') factory for the settings UI.
//
// What comes LATER (evaluated + documented in docs/PHASE2A_AI_RUNTIME.md):
//   • The optional web-llm runtime shipped/bundled so opting in actually
//     enables a deliberate, per-device model download (WebGPU path).
//   • Transformers.js adapter for embeddings / NLP / audio tasks (the WASM
//     path — createLocalAdapter('WASM') currently throws by design).
//   • Optional desktop engine (llama.cpp) integration for capable machines.
//
// INVARIANTS that must survive every later milestone:
//   • Consent + explicit user action gate ALL downloads; the app never
//     downloads models automatically.
//   • Students' devices are never used for other users' inference.
//   • Prompts and files stay on device; local inference is additive to the
//     server-side BEAN chat, which remains the default path.

export { detectLocalAi } from './detect'
export type { LocalAiCapabilities } from './detect'

export {
  createLocalAdapter,
  DEFAULT_LOCAL_MODEL,
  WebLlmAdapter,
} from './adapter'
export type { LocalGenerateOptions, LocalInferenceAdapter } from './adapter'
