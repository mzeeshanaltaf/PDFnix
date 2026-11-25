/**
 * Starts LM Studio's server with its command-line tool (`lms server start`),
 * for the assistant panel's "Start server" button. Free of Electron, so
 * lmstudio-cli.test.ts runs it with a fake runner; ipc.ts wires it up.
 *
 * Only an address on this computer can be started, and always on the port of
 * the address in the settings, so the server comes up where PDFnix looks.
 * The tool runs without a shell, with fixed arguments.
 */

import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'
import type { AiServerInfo, AiStartResult } from '../shared/ai'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
/** Starting LM Studio's background service the first time can take a while. */
const START_TIMEOUT_MS = 60_000
const MAX_MESSAGE = 300

export const START_MESSAGES = {
  notInstalled:
    "PDFnix couldn't find LM Studio's command-line tool (lms). Start the server in LM Studio instead.",
  remote: 'The server address in Settings is on another computer; start LM Studio there.',
  failed: "LM Studio's server didn't start."
}

/**
 * The arguments that start a server answering at `serverUrl`; null when that
 * address is not a plain http address on this computer.
 */
export function startArgs(serverUrl: string): string[] | null {
  let url: URL
  try {
    url = new URL(serverUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' || !LOCAL_HOSTS.has(url.hostname)) return null
  return ['server', 'start', '--port', url.port || '80']
}

export interface FindOptions {
  env?: Record<string, string | undefined>
  home?: string
  exists?: (path: string) => boolean
  platform?: NodeJS.Platform
}

/** Where `lms` is: LM Studio's own folder in the user profile first, then PATH. */
export function findLms(options: FindOptions = {}): string | null {
  const env = options.env ?? process.env
  const exists = options.exists ?? existsSync
  const name = (options.platform ?? process.platform) === 'win32' ? 'lms.exe' : 'lms'
  const home = env.USERPROFILE || options.home || homedir()
  const candidates = [join(home, '.lmstudio', 'bin', name)]
  for (const folder of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (folder.trim()) candidates.push(join(folder.trim(), name))
  }
  return candidates.find((path) => exists(path)) ?? null
}

/** Adds `canStartServer` to an "unreachable" answer when PDFnix can start that server. */
export function withStartOption(info: AiServerInfo, lmsPath: string | null): AiServerInfo {
  if (info.error?.code !== 'unreachable') return info
  return { ...info, canStartServer: lmsPath !== null && startArgs(info.url) !== null }
}

export interface RunResult {
  /** Null when the tool could not be run or was stopped. */
  code: number | null
  output: string
  error?: string
}

export type Runner = (file: string, args: string[], timeoutMs: number) => Promise<RunResult>

const ANSI = new RegExp(String.raw`\u001b\[[0-9;?]*[A-Za-z]`, 'g')

/** The last meaningful line the tool printed, for the user. */
export function lastLine(output: string): string {
  const lines = output
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return (lines.at(-1) ?? '').slice(0, MAX_MESSAGE)
}

export const runFile: Runner = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`
        if (!error) return resolve({ code: 0, output })
        const code = typeof error.code === 'number' ? error.code : null
        resolve({ code, output, error: error.message })
      }
    )
  })

export interface StartOptions {
  serverUrl: string
  lmsPath: string | null
  run?: Runner
  timeoutMs?: number
}

/** Runs `lms server start --port <port>`. Never rejects. */
export async function startServer(options: StartOptions): Promise<AiStartResult> {
  const args = startArgs(options.serverUrl)
  if (!args) return { ok: false, message: START_MESSAGES.remote }
  if (!options.lmsPath) return { ok: false, message: START_MESSAGES.notInstalled }
  const run = options.run ?? runFile
  const result = await run(options.lmsPath, args, options.timeoutMs ?? START_TIMEOUT_MS)
  if (result.code === 0) return { ok: true }
  const detail = lastLine(result.output) || lastLine(result.error ?? '')
  return {
    ok: false,
    message: detail ? `${START_MESSAGES.failed} ${detail}` : START_MESSAGES.failed
  }
}
