import type { FaultMode } from '@contoso/shared';
import { config as defaultConfig, type AppConfig } from './config.js';

/**
 * Deliberate fault injection.
 *
 * ⚠️ This is intentional, demo-only functionality. The Agentic SDLC accelerator
 * uses it to prove that Azure Monitor / the Azure SRE Agent detect, triage and
 * remediate incidents end to end. It is guarded by `ADMIN_ENABLED` (off by
 * default in production) and every activated fault auto-expires.
 */

export interface FaultState {
  mode: FaultMode;
  /** ISO timestamp of when the fault was activated, or null when inactive. */
  activatedAt: string | null;
  /** ISO timestamp of when the fault auto-expires, or null when inactive. */
  expiresAt: string | null;
  durationSeconds: number | null;
  /** Bytes currently retained by the `memory` fault. */
  retainedBytes: number;
}

export interface FaultControllerOptions {
  defaultDurationSeconds: number;
  memoryChunkBytes: number;
  memoryMaxBytes: number;
  latencyMinMs: number;
  latencyMaxMs: number;
  now: () => number;
}

const LATENCY_MIN_MS = 3_000;
const LATENCY_MAX_MS = 5_000;

export class FaultController {
  #mode: FaultMode = 'none';
  #activatedAt: number | null = null;
  #expiresAt: number | null = null;
  #durationSeconds: number | null = null;
  #buffers: Buffer[] = [];
  readonly #options: FaultControllerOptions;

  constructor(options: Partial<FaultControllerOptions> = {}, config: AppConfig = defaultConfig) {
    this.#options = {
      defaultDurationSeconds: config.defaultFaultDurationSeconds,
      memoryChunkBytes: config.faultMemoryChunkBytes,
      memoryMaxBytes: config.faultMemoryMaxBytes,
      latencyMinMs: LATENCY_MIN_MS,
      latencyMaxMs: LATENCY_MAX_MS,
      now: () => Date.now(),
      ...options,
    };
  }

  /** Activates a fault mode; `none` clears any active fault. */
  activate(mode: FaultMode, durationSeconds?: number): FaultState {
    if (mode === 'none') {
      this.reset();
      return this.current();
    }

    const duration = durationSeconds ?? this.#options.defaultDurationSeconds;
    const now = this.#options.now();

    this.#releaseMemory();
    this.#mode = mode;
    this.#activatedAt = now;
    this.#durationSeconds = duration;
    this.#expiresAt = now + duration * 1000;

    if (mode === 'memory') {
      this.allocate();
    }

    return this.current();
  }

  /** Returns the current state, expiring the fault when its lifetime elapsed. */
  current(): FaultState {
    if (this.#mode !== 'none' && this.#expiresAt !== null && this.#options.now() >= this.#expiresAt) {
      this.reset();
    }

    return {
      mode: this.#mode,
      activatedAt: this.#activatedAt === null ? null : new Date(this.#activatedAt).toISOString(),
      expiresAt: this.#expiresAt === null ? null : new Date(this.#expiresAt).toISOString(),
      durationSeconds: this.#durationSeconds,
      retainedBytes: this.retainedBytes,
    };
  }

  /** Clears the active fault and frees any retained memory. */
  reset(): void {
    this.#mode = 'none';
    this.#activatedAt = null;
    this.#expiresAt = null;
    this.#durationSeconds = null;
    this.#releaseMemory();
  }

  get retainedBytes(): number {
    return this.#buffers.reduce((total, buffer) => total + buffer.byteLength, 0);
  }

  /** Injected latency, jittered across the configured window. */
  latencyMs(): number {
    const { latencyMinMs, latencyMaxMs } = this.#options;
    return Math.round(latencyMinMs + Math.random() * (latencyMaxMs - latencyMinMs));
  }

  /**
   * Allocates and retains another buffer, simulating a leak. Allocation stops
   * once the configured ceiling is reached so the demo degrades rather than
   * hard-crashing the container.
   */
  allocate(): number {
    if (this.retainedBytes + this.#options.memoryChunkBytes > this.#options.memoryMaxBytes) {
      return this.retainedBytes;
    }

    const buffer = Buffer.alloc(this.#options.memoryChunkBytes, 1);
    this.#buffers.push(buffer);
    return this.retainedBytes;
  }

  #releaseMemory(): void {
    this.#buffers = [];
  }
}

/** Process-wide controller used by the running server. */
export const faultController = new FaultController();
