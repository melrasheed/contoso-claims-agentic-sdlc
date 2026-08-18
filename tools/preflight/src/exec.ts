import { execFile } from 'node:child_process';
import type { CheckCategory, CheckResult } from './types.js';

export interface ExecResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process could not be spawned at all (missing binary, timeout, ...). */
  error?: string;
}

export interface RunOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * On Windows the Azure/GitHub CLIs are `.cmd` shims which Node refuses to spawn
 * without a shell, so arguments are quoted defensively before handing them over.
 */
function quoteForShell(arg: string): string {
  if (arg.length > 0 && /^[A-Za-z0-9_./:@=-]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

export function run(command: string, args: string[] = [], options: RunOptions = {}): Promise<ExecResult> {
  const useShell = process.platform === 'win32';
  // On Windows everything is folded into a single shell command line: passing an
  // args array together with `shell: true` triggers Node's DEP0190 warning.
  const finalCommand = useShell ? [command, ...args.map(quoteForShell)].join(' ') : command;
  const finalArgs = useShell ? [] : args;

  return new Promise((resolve) => {
    execFile(
      finalCommand,
      finalArgs,
      {
        shell: useShell,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, ...(options.env ?? {}) }
      },
      (error, stdout, stderr) => {
        const out = String(stdout ?? '');
        const err = String(stderr ?? '');
        if (error) {
          const code = typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
            ? ((error as unknown as { code: number }).code)
            : null;
          resolve({ ok: false, code, stdout: out, stderr: err, error: error.message });
          return;
        }
        resolve({ ok: true, code: 0, stdout: out, stderr: err });
      }
    );
  });
}

/** Runs a command and parses stdout as JSON. Returns undefined on any failure. */
export async function runJson<T>(command: string, args: string[], options: RunOptions = {}): Promise<T | undefined> {
  const res = await run(command, args, options);
  if (!res.ok) return undefined;
  try {
    return JSON.parse(res.stdout) as T;
  } catch {
    return undefined;
  }
}

/** True when the binary responds to a version probe. */
export async function commandExists(command: string, versionArgs: string[] = ['--version']): Promise<ExecResult> {
  return run(command, versionArgs, { timeoutMs: 20_000 });
}

/** Redacts anything that looks like a token so it can never reach stdout. */
export function redact(value: string): string {
  return value
    .replace(/gh[pousr]_[A-Za-z0-9]{10,}/g, '***redacted***')
    .replace(/github_pat_[A-Za-z0-9_]{10,}/g, '***redacted***')
    .replace(/\b[A-Za-z0-9]{52}\b/g, '***redacted***')
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***redacted***');
}

/** Collapses multi-line CLI output into a single, short, secret-free line. */
export function firstLine(value: string, max = 160): string {
  const line = redact(value).split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return redact(err.message);
  return redact(String(err));
}

/**
 * Runs a single check in isolation: an unexpected throw degrades to a `warn`
 * instead of taking the whole doctor run down.
 */
export async function safeCheck(
  id: string,
  category: CheckCategory,
  name: string,
  fn: () => Promise<CheckResult>
): Promise<CheckResult> {
  try {
    return await fn();
  } catch (err) {
    return {
      id,
      category,
      name,
      status: 'warn',
      detail: `Check could not complete: ${errorMessage(err)}`,
      hint: 'Re-run with `npm run preflight -- --json` and inspect the raw output; this check was skipped.'
    };
  }
}
