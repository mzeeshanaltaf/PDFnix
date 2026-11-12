/**
 * The typed client for the Python engine. Every engine request made by the
 * renderer goes through this module; components never call `fetch` directly.
 */

import type { EngineConnection } from '../../../shared/api'

const TOKEN_HEADER = 'X-Engine-Token'
const API_PREFIX = '/v1'

/** The engine answered with an error (`{ error: { code, message } }`). */
export class EngineApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'EngineApiError'
  }
}

/** The engine could not be reached at all (not started, crashed, restarting). */
export class EngineUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EngineUnavailableError'
  }
}

export interface EngineHealth {
  status: 'ok'
  engineVersion: string
  pymupdfVersion: string
  mupdfVersion: string
  pythonVersion: string
  openDocuments: number
}

let connection: Promise<EngineConnection> | null = null

/**
 * Forgets the cached address and token. Call when the engine has been
 * restarted: the replacement listens on a new port with a new token.
 */
export function resetConnection(): void {
  connection = null
}

function getConnection(): Promise<EngineConnection> {
  connection ??= window.api.engine.getConnection()
  return connection
}

async function toApiError(response: Response): Promise<EngineApiError> {
  let code = 'http_error'
  let message = `The engine returned HTTP ${response.status}.`
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const error = (body as { error: { code?: unknown; message?: unknown } }).error
      if (typeof error?.code === 'string') code = error.code
      if (typeof error?.message === 'string') message = error.message
    }
  } catch {
    // Not JSON; keep the generic message.
  }
  return new EngineApiError(response.status, code, message)
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let target: EngineConnection
  try {
    target = await getConnection()
  } catch (cause) {
    resetConnection()
    throw new EngineUnavailableError('The PDF engine is not running.', { cause })
  }

  const headers: Record<string, string> = { [TOKEN_HEADER]: target.token }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(`${target.baseUrl}${API_PREFIX}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch (cause) {
    resetConnection()
    throw new EngineUnavailableError('The PDF engine cannot be reached.', { cause })
  }

  if (!response.ok) throw await toApiError(response)
  return (await response.json()) as T
}

export const engine = {
  health: (): Promise<EngineHealth> => request<EngineHealth>('GET', '/health')
}
