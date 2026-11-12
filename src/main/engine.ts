import { app } from 'electron'
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { EventEmitter } from 'events'
import { join } from 'path'
import type { EngineConnection, EngineStatus } from '../shared/api'
import { LineSplitter, parseReadyLine, RestartPolicy, TailBuffer } from './engine-protocol'

/** `uv run` may have to create or sync the virtual environment first. */
const READY_TIMEOUT_MS = app.isPackaged ? 30_000 : 120_000
/** An engine that ran this long before crashing earns a fresh automatic restart. */
const STABLE_AFTER_MS = 60_000
const STDERR_TAIL_CHARS = 8_000

export class EngineStartError extends Error {
  constructor(
    message: string,
    /** The last output the engine wrote to stderr, for the error dialog. */
    readonly stderr: string
  ) {
    super(message)
    this.name = 'EngineStartError'
  }
}

interface Launch {
  command: string
  args: string[]
  cwd: string
}

function resolveLaunch(): Launch {
  if (app.isPackaged) {
    // Wired for phase 7, when the engine is frozen into an executable.
    const dir = join(process.resourcesPath, 'engine')
    return { command: join(dir, 'pdfengine.exe'), args: [], cwd: dir }
  }
  return {
    command: 'uv',
    args: ['run', 'python', '-m', 'pdfengine'],
    cwd: join(app.getAppPath(), 'engine')
  }
}

/** Ends the process and everything it started (uv -> python launcher -> python). */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    })
  } else {
    child.kill('SIGTERM')
  }
}

export interface EngineManagerEvents {
  status: [status: EngineStatus]
  failed: [error: EngineStartError]
}

/**
 * Owns the engine process: starts it, waits for its ready line, restarts it
 * once if it exits unexpectedly, and kills it when the app quits.
 */
export class EngineManager extends EventEmitter<EngineManagerEvents> {
  private child: ChildProcess | null = null
  private attempt: Promise<EngineConnection> | null = null
  private status: EngineStatus = { state: 'starting', generation: 0, restarts: 0 }
  private readySince: number | null = null
  private stopping = false
  private readonly policy = new RestartPolicy(STABLE_AFTER_MS)
  private readonly stderrTail = new TailBuffer(STDERR_TAIL_CHARS)

  constructor(private readonly allowedOrigins: string[]) {
    super()
  }

  getStatus(): EngineStatus {
    return { ...this.status }
  }

  /** Resolves when the current engine is ready; rejects if it could not start. */
  getConnection(): Promise<EngineConnection> {
    return this.attempt ?? this.start()
  }

  /** Starts the engine (first launch, or a manual retry after a failure). */
  start(): Promise<EngineConnection> {
    if (this.child) {
      const stale = this.child
      this.child = null
      killTree(stale)
    }
    this.stopping = false
    this.policy.reset()
    return this.begin('starting')
  }

  /** Kills the engine for good. Synchronous, so it is safe to call while quitting. */
  stop(): void {
    if (this.stopping) return
    this.stopping = true
    const child = this.child
    this.child = null
    this.readySince = null
    this.setStatus({ state: 'stopped', message: undefined })
    if (child) killTree(child)
  }

  private begin(state: 'starting' | 'restarting'): Promise<EngineConnection> {
    this.setStatus({ state })
    const attempt = this.launch().then(
      (connection) => {
        this.readySince = Date.now()
        this.setStatus({
          state: 'ready',
          generation: this.status.generation + 1,
          message: undefined
        })
        return connection
      },
      (error: EngineStartError) => {
        if (!this.stopping) this.fail(error)
        throw error
      }
    )
    // Callers attach their own handlers; this keeps a failure nobody is
    // waiting on from surfacing as an unhandled rejection.
    attempt.catch(() => {})
    this.attempt = attempt
    return attempt
  }

  private launch(): Promise<EngineConnection> {
    const { command, args, cwd } = resolveLaunch()
    const token = randomBytes(32).toString('hex')
    this.stderrTail.clear()

    return new Promise<EngineConnection>((resolve, reject) => {
      let settled = false

      const child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          PDFENGINE_TOKEN: token,
          PDFENGINE_PARENT_PID: String(process.pid),
          PDFENGINE_ALLOWED_ORIGINS: this.allowedOrigins.join(','),
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8'
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
      this.child = child

      const fail = (reason: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        killTree(child)
        reject(new EngineStartError(reason, this.stderrTail.toString()))
      }

      const timer = setTimeout(() => {
        fail(`The engine did not become ready within ${READY_TIMEOUT_MS / 1000} seconds.`)
      }, READY_TIMEOUT_MS)

      const lines = new LineSplitter()
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        for (const line of lines.push(chunk)) {
          const port = parseReadyLine(line)
          if (port !== null && !settled) {
            settled = true
            clearTimeout(timer)
            resolve({ baseUrl: `http://127.0.0.1:${port}`, token })
          }
        }
      })

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        this.stderrTail.append(chunk)
        if (!app.isPackaged) process.stderr.write(`[engine] ${chunk}`)
      })

      child.on('error', (error) => {
        fail(`Could not start the engine (${command}): ${error.message}`)
      })

      child.on('exit', (code, signal) => {
        const wasCurrent = this.child === child
        if (wasCurrent) this.child = null
        if (!settled) {
          fail(`The engine exited before it was ready (${describeExit(code, signal)}).`)
        } else if (wasCurrent && !this.stopping) {
          this.handleUnexpectedExit(code, signal)
        }
      })
    })
  }

  private handleUnexpectedExit(code: number | null, signal: NodeJS.Signals | null): void {
    const readySince = this.readySince
    this.readySince = null
    const what = `The engine stopped unexpectedly (${describeExit(code, signal)}).`

    if (this.policy.shouldRestart(Date.now(), readySince)) {
      this.setStatus({
        state: 'restarting',
        restarts: this.status.restarts + 1,
        message: what
      })
      void this.begin('restarting').catch(() => {})
      return
    }

    const error = new EngineStartError(
      `${what} It had already been restarted once and stopped again.`,
      this.stderrTail.toString()
    )
    const rejected = Promise.reject<EngineConnection>(error)
    rejected.catch(() => {})
    this.attempt = rejected
    this.fail(error)
  }

  private fail(error: EngineStartError): void {
    this.readySince = null
    this.setStatus({ state: 'failed', message: error.message })
    this.emit('failed', error)
  }

  private setStatus(patch: Partial<EngineStatus>): void {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.getStatus())
  }
}

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) return `signal ${signal}`
  return `exit code ${code ?? 'unknown'}`
}
