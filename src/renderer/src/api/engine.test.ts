import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineConnection } from '../../../shared/api'
import { engine, EngineApiError, EngineUnavailableError, resetConnection } from './engine'

const CONNECTION: EngineConnection = { baseUrl: 'http://127.0.0.1:5000', token: 'secret' }

const HEALTH = {
  status: 'ok',
  engineVersion: '0.1.0',
  pymupdfVersion: '2.1',
  mupdfVersion: '1.28.6',
  pythonVersion: '3.12.7',
  openDocuments: 0
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function stubApi(getConnection: () => Promise<EngineConnection>): void {
  vi.stubGlobal('window', { api: { engine: { getConnection } } })
}

describe('engine client', () => {
  beforeEach(() => {
    resetConnection()
  })

  it('sends the token to the address supplied by the main process', async () => {
    const getConnection = vi.fn(async () => CONNECTION)
    const fetchMock = vi.fn(async () => json(HEALTH))
    stubApi(getConnection)
    vi.stubGlobal('fetch', fetchMock)

    await expect(engine.health()).resolves.toEqual(HEALTH)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5000/v1/health',
      expect.objectContaining({ method: 'GET', headers: { 'X-Engine-Token': 'secret' } })
    )
  })

  it('asks for the connection once and reuses it', async () => {
    const getConnection = vi.fn(async () => CONNECTION)
    stubApi(getConnection)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(HEALTH))
    )

    await engine.health()
    await engine.health()

    expect(getConnection).toHaveBeenCalledTimes(1)
  })

  it('asks again after resetConnection (the engine was restarted)', async () => {
    const getConnection = vi
      .fn<() => Promise<EngineConnection>>()
      .mockResolvedValueOnce(CONNECTION)
      .mockResolvedValueOnce({ baseUrl: 'http://127.0.0.1:6000', token: 'new' })
    const fetchMock = vi.fn(async () => json(HEALTH))
    stubApi(getConnection)
    vi.stubGlobal('fetch', fetchMock)

    await engine.health()
    resetConnection()
    await engine.health()

    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:6000/v1/health',
      expect.objectContaining({ headers: { 'X-Engine-Token': 'new' } })
    )
  })

  it('turns an engine error body into EngineApiError', async () => {
    stubApi(async () => CONNECTION)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({ error: { code: 'unauthorized', message: 'Missing or invalid engine token.' } }, 401)
      )
    )

    const error = await engine.health().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(EngineApiError)
    expect(error).toMatchObject({
      status: 401,
      code: 'unauthorized',
      message: 'Missing or invalid engine token.'
    })
  })

  it('copes with an error response that is not JSON', async () => {
    stubApi(async () => CONNECTION)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('oops', { status: 502 }))
    )

    const error = await engine.health().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(EngineApiError)
    expect(error).toMatchObject({ status: 502, code: 'http_error' })
  })

  it('reports an unreachable engine and drops the cached connection', async () => {
    const getConnection = vi.fn(async () => CONNECTION)
    stubApi(getConnection)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
    )

    await expect(engine.health()).rejects.toBeInstanceOf(EngineUnavailableError)
    await expect(engine.health()).rejects.toBeInstanceOf(EngineUnavailableError)

    expect(getConnection).toHaveBeenCalledTimes(2)
  })

  it('reports an engine that could not be started', async () => {
    stubApi(async () => {
      throw new Error('The engine did not become ready within 30 seconds.')
    })
    vi.stubGlobal('fetch', vi.fn())

    await expect(engine.health()).rejects.toBeInstanceOf(EngineUnavailableError)
  })
})
