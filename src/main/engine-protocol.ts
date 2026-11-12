/**
 * Pure helpers for the engine launch contract. Kept free of Electron imports
 * so they can be unit-tested.
 */

const READY_LINE = /^ENGINE_READY port=(\d{1,5})$/

/** Returns the port if `line` is the engine's ready announcement, else null. */
export function parseReadyLine(line: string): number | null {
  const match = READY_LINE.exec(line.trim())
  if (!match) return null
  const port = Number(match[1])
  return port >= 1 && port <= 65535 ? port : null
}

/**
 * Splits a stream of chunks into complete lines, holding back a trailing
 * partial line until the rest of it arrives.
 */
export class LineSplitter {
  private pending = ''

  push(chunk: string): string[] {
    const parts = (this.pending + chunk).split(/\r?\n/)
    this.pending = parts.pop() ?? ''
    return parts
  }

  flush(): string | null {
    const rest = this.pending
    this.pending = ''
    return rest.length > 0 ? rest : null
  }
}

/** Keeps only the last `limit` characters written to it. */
export class TailBuffer {
  private text = ''

  constructor(private readonly limit: number) {}

  append(chunk: string): void {
    this.text = (this.text + chunk).slice(-this.limit)
  }

  clear(): void {
    this.text = ''
  }

  toString(): string {
    return this.text
  }
}

/**
 * Decides whether an unexpected exit may be answered with an automatic
 * restart. One restart is allowed; a second crash soon after the restarted
 * engine came up is treated as a crash loop. Once an engine has run for
 * `stableAfterMs`, the allowance is available again.
 */
export class RestartPolicy {
  private usedAt: number | null = null

  constructor(private readonly stableAfterMs: number) {}

  /** `readySince` is when the engine that just exited became ready. */
  shouldRestart(now: number, readySince: number | null): boolean {
    const ranStable = readySince !== null && now - readySince >= this.stableAfterMs
    if (this.usedAt !== null && !ranStable) return false
    this.usedAt = now
    return true
  }

  reset(): void {
    this.usedAt = null
  }
}
