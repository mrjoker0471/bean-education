// ─── Browser-local AI capability detection (BEAN Education, foundation scope) ───
// Client-only, SSR-safe probe of what the CURRENT browser can do for on-device
// inference. Pure read-only detection: nothing is downloaded, loaded, or
// initialised here — this module never touches a runtime or model.
//
// The shapes below are narrow local interfaces instead of the full DOM lib
// types so this file compiles identically across TypeScript / lib.dom
// versions (WebGPU typings are recent and not guaranteed present).

/** Minimal slice of a WebGPU adapter we care about. */
interface GpuAdapterLike {
  /** Available on modern Chromium (GPUAdapterInfo); optional everywhere. */
  info?: { description?: string; vendor?: string; architecture?: string }
  /** Legacy experimental path, still present in some builds. */
  requestAdapterInfo?: () => Promise<{ description?: string; vendor?: string } | undefined>
}

/** Minimal slice of the WebGPU entry point on Navigator. */
interface GpuLike {
  requestAdapter(options?: { powerPreference?: 'low-power' | 'high-performance' }): Promise<GpuAdapterLike | null>
}

/**
 * Navigator re-typed with the optional, feature-detected surfaces we read.
 * `Omit` first so we never collide with whichever properties the installed
 * lib.dom version does or does not declare (deviceMemory, gpu).
 */
type FeatureNavigator = Omit<Navigator, 'gpu' | 'deviceMemory'> & {
  gpu?: GpuLike
  /** Chrome/Android only, may be missing or blocked (privacy). */
  deviceMemory?: number
}

export interface LocalAiCapabilities {
  /** A WebGPU adapter was successfully requested. */
  webgpu: boolean
  /** Best-effort adapter description (vendor/driver strings when absent). */
  adapterName?: string
  /** WebAssembly engine validated a minimal module (the WASM fallback path). */
  wasm: boolean
  /** navigator.deviceMemory, when the browser exposes it (~GB, capped at 8). */
  memoryGB?: number
  /** navigator.hardwareConcurrency, when exposed. */
  cores?: number
  /** navigator.storage.estimate().quota, rounded to 0.1 GB, when available. */
  storageQuotaGB?: number
  /** Which adapter class fits this browser, or none. */
  recommendation: 'WEBGPU' | 'WASM' | 'UNAVAILABLE'
  /** Honest one-liner explaining the recommendation. */
  detail: string
}

const WASM_PROBE_BYTES = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]) // "\0asm" version 1
const GB = 1024 * 1024 * 1024

function roundGb(bytes: number): number {
  return Math.round((bytes / GB) * 10) / 10
}

/**
 * Detect browser-local AI capabilities. Safe to call anywhere: on the server
 * (or any non-browser context) it immediately reports UNAVAILABLE instead of
 * throwing. Every probe below is individually feature-detected and wrapped so
 * one broken surface never fails the whole report.
 */
export async function detectLocalAi(): Promise<LocalAiCapabilities> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      webgpu: false,
      wasm: false,
      recommendation: 'UNAVAILABLE',
      detail: 'Browser APIs are not available in this context (server-side render or non-browser environment).',
    }
  }

  const nav = navigator as unknown as FeatureNavigator

  // ── WebGPU: feature-detect the entry point, then actually request an
  // adapter (a present `navigator.gpu` does not guarantee a working device —
  // blocklisted drivers, disabled flags, or software fallbacks can all fail).
  let webgpu = false
  let adapterName: string | undefined
  if (nav.gpu && typeof nav.gpu.requestAdapter === 'function') {
    try {
      const adapter = await nav.gpu.requestAdapter()
      if (adapter) {
        webgpu = true
        // Preferred: adapter.info (modern). Fallback: requestAdapterInfo()
        // (deprecated but still shipped in some browsers). Both wrapped so a
        // missing or throwing name source never loses the capability result.
        const fromInfo = adapter.info?.description?.trim()
        if (fromInfo) {
          adapterName = fromInfo
        } else if (typeof adapter.requestAdapterInfo === 'function') {
          try {
            adapterName = (await adapter.requestAdapterInfo())?.description?.trim() || undefined
          } catch {
            /* adapter info denied by the browser — keep it unnamed */
          }
        }
      }
    } catch {
      /* requestAdapter rejected (driver blocklist / flags) → treat as absent */
    }
  }

  // ── WebAssembly: validate the magic header + version bytes. Cheap, offline,
  // and enough to prove the engine exists (full wasm-SIMD probing is later work).
  let wasm = false
  try {
    wasm = typeof WebAssembly === 'object' && WebAssembly.validate(WASM_PROBE_BYTES)
  } catch {
    wasm = false
  }

  // ── Device facts: all optional; browsers may hide any of them for privacy.
  const memoryGB = typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 ? nav.deviceMemory : undefined
  const cores =
    typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : undefined

  let storageQuotaGB: number | undefined
  try {
    const estimate = await nav.storage?.estimate?.()
    if (estimate && typeof estimate.quota === 'number' && estimate.quota > 0) {
      storageQuotaGB = roundGb(estimate.quota)
    }
  } catch {
    /* storage estimate unavailable / denied — leave undefined */
  }

  // ── Recommendation + honest one-liner. Detection says what the HARDWARE and
  // BROWSER can do; it does NOT say a runtime or model is present. No runtime
  // ships in this build, and no model is ever downloaded automatically.
  if (webgpu) {
    const gpu = adapterName ? `WebGPU adapter available (${adapterName})` : 'WebGPU adapter available'
    return {
      webgpu: true,
      adapterName,
      wasm,
      memoryGB,
      cores,
      storageQuotaGB,
      recommendation: 'WEBGPU',
      detail: `${gpu}${wasm ? '' : ', but WebAssembly is unavailable'} — this browser could run browser-local models once the optional runtime is opted into and a model is deliberately downloaded.`,
    }
  }

  if (wasm) {
    return {
      webgpu: false,
      wasm: true,
      memoryGB,
      cores,
      storageQuotaGB,
      recommendation: 'WASM',
      detail:
        'No usable WebGPU adapter, but WebAssembly works — CPU-only on-device inference is the fallback path (slower; smaller models only).',
    }
  }

  return {
    webgpu: false,
    wasm,
    memoryGB,
    cores,
    storageQuotaGB,
    recommendation: 'UNAVAILABLE',
    detail:
      'Neither a WebGPU adapter nor a working WebAssembly engine is available — on-device AI is not possible here; the server-side BEAN chat remains the path.',
  }
}
