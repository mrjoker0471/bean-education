# PHASE 2A — On-Device AI Runtime (evaluation, privacy model, foundation scope)

Status: **FOUNDATION ONLY — on-device AI is not yet usable.** This document records the runtime evaluation, the privacy/consent model, and the exact boundary of what shipped. Read the "Current boundary" section before assuming anything works.

## 1. Why on-device AI at all

BEAN LEARN already has server-side AI (the Riishe/BEAN chat path). On-device inference is an *additive* option, evaluated for three reasons:

- **Privacy by architecture**: prompts, study material context, and answers never leave the student's device. Nothing to leak, nothing to log, nothing to subpoena.
- **No server cost per token**: local inference scales with students' own hardware, not with our bill.
- **Offline resilience**: revision on a bus or in a low-connectivity area keeps working.

It is not a replacement for the server path: on-device models are small, slower, and dumber than the server-side models. The server-side Riishe/BEAN chat **remains the default** everywhere in the product.

## 2. Runtime evaluation

### WebLLM — chosen for browser-local LLM chat

- Runs an LLM fully in the browser tab via **WebGPU**; WebAssembly CPU fallback is possible but impractically slow for real chat.
- **Model streaming**: weights are fetched as sharded safetensors and cached in the browser's storage; a second session on the same device does not re-download.
- OpenAI-compatible `chat.completions` surface, so our adapter code mirrors the server chat shape.
- **Privacy**: the engine runs inside the page sandbox; prompts never leave the device. No network call exists in the inference path at all once weights are cached.
- Costs/constraints: ~0.5–1.5 GB download per device for a small instruct model, WebGPU availability is Chromium-weighted (recent Chrome/Edge; Safari support is maturing), and VRAM limits cap usable model size.
- Decision: **selected** as the browser-local LLM runtime (`WebLlmAdapter`, default model `Llama-3.2-1B-Instruct-q4f16_1-MLC`).

### Transformers.js — chosen for future embeddings / NLP / audio tasks

- ONNX-runtime based, CPU (WASM) by default with WebGPU acceleration where present.
- Not competitive for LLM chat quality/speed at current small-model sizes, but excellent at **embeddings**, reranking, classification, whisper-class audio transcription.
- Decision: **deferred to a later milestone** as the WASM/embeddings adapter. `createLocalAdapter('WASM')` deliberately throws today — the boundary is documented, not silently stubbed.

### llama.cpp — desktop engine, later optional integration

- Native binary with far better performance per watt and access to bigger models than a browser tab allows.
- Requires installing and running a separate process on the user's machine plus a local-server bridge (and for the web app, careful CORS/origin handling against a localhost engine).
- Decision: **not mandatory, deferred**. Evaluated as a later *optional* integration for power users; the adapter interface (`LocalInferenceAdapter`) is designed so a native-engine adapter can slot in without UI changes.

## 3. Privacy and consent model (non-negotiable)

These rules hold for every current and future milestone in this area:

1. **Explicit opt-in, per device.** Local AI is off by default. It is enabled only by a visible user action on the specific device, after that user has been told what will be downloaded and stored locally.
2. **No automatic downloads.** The app never downloads a runtime or model automatically — not on page load, not in the background, not "pre-warmed while you browse". A model reaches a device only when the user of that device deliberately asks for it.
3. **No cross-user compute.** A student's device is never used to serve other users' inference. Local engines only answer prompts issued in their own tab.
4. **Prompts and files stay on device.** In local mode, study material context, prompts and generated text are processed and kept locally; nothing is uploaded to our servers or third parties.
5. **Server chat stays the default.** The existing server-side Riishe/BEAN chat remains the primary path. Local inference is presented as an opt-in alternative with honest quality/size tradeoffs, never as a silent default.
6. **Deletion is real.** Disabling local AI unloads the engine; a future milestone adds an explicit "delete downloaded model" control that clears the browser-cached weights.

## 4. Architecture

```
detect ──► consent ──► lazy dynamic import ──► adapter
```

- **detect** — `src/lib/ai-local/detect.ts` → `detectLocalAi()` probes WebGPU (including a real `requestAdapter()` and adapter naming via `adapter.info?.description` with a `requestAdapterInfo()` fallback), WebAssembly (minimal module validation), plus optional device facts (memory, cores, storage quota). SSR-safe: returns `UNAVAILABLE` outside a browser. Pure detection — no network, no runtime load.
- **consent** — the UI layer (settings, task 12-b) renders the capability report and asks the user to opt in. Consent must be obtained *and* the user must act before anything else happens.
- **lazy dynamic import** — only after consent does the UI call `adapter.init()`; the adapter then dynamically imports the optional runtime module. The import site is deliberately non-literal and bundler-opaque so a missing optional package surfaces at **runtime** as a clear error, never as a build failure.
- **adapter** — `src/lib/ai-local/adapter.ts` defines `LocalInferenceAdapter` (`init` / `generate` / `dispose`) and the factory `createLocalAdapter('WEBGPU' | 'WASM')`. `WebLlmAdapter` is the only concrete adapter; it loads `Llama-3.2-1B-Instruct-q4f16_1-MLC` via `CreateMLCEngine`, reports progress through `onProgress`, generates via `chat.completions.create`, and unloads on `dispose()`.

## 5. Current boundary (what actually shipped)

Shipped in this foundation milestone:

- `src/lib/ai-local/detect.ts` — capability detection (complete, usable today; the settings UI can render it now).
- `src/lib/ai-local/adapter.ts` — adapter interface, `WebLlmAdapter`, `createLocalAdapter` factory, `DEFAULT_LOCAL_MODEL`.
- `src/lib/ai-local/index.ts` — barrel export.

Not shipped / not working yet:

- **The `web-llm` package is intentionally not installed.** Calling `WebLlmAdapter.init()` therefore always throws: *"WebLLM runtime is not installed in this build — on-device models require opting in and installing the optional runtime (see docs/PHASE2A_AI_RUNTIME.md). Nothing was downloaded."* This is the designed behaviour, not a bug.
- **No WASM adapter.** `createLocalAdapter('WASM')` throws: *"Transformers.js WASM adapter lands in a later milestone — CPU-only on-device inference is a documented foundation boundary."*
- **No model has ever been downloaded**, by anyone, through this code. There is no code path that could.

## 6. Honest usability statement

**On-device LLM chat is NOT usable until (a) the optional `web-llm` runtime is installed into the build, and (b) a user deliberately opts in and downloads a model to their own device.** Until both happen, `detectLocalAi()` is truthful reporting of hardware capability only, and every init attempt fails with the message above. Nothing in the current foundation downloads, fetches, or initializes a model.

## 7. Next steps

1. **Bundle the optional runtime.** Add `web-llm` as an optional dependency, gated behind the settings-UI consent flow; keep the non-literal dynamic import so absence still degrades gracefully on builds that exclude it.
2. **Settings UI (task 12-b).** Capability card from `detectLocalAi()`, plain-language consent copy naming the exact model and its download size, progress surface wired to `onProgress`, enable/disable that maps to `init()`/`dispose()`.
3. **WASM/embeddings adapter (Transformers.js)** for local semantic search and study aids — the adapter interface already accommodates it.
4. **Desktop engine (llama.cpp) integration** as an optional, clearly-flagged path for users who install a local server; no product dependency on it.
5. **Model cache management UI**: show cached weights, storage used (from `navigator.storage.estimate()`), and a delete control.
