import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobSnapshot } from '../api/engine'

const engineMock = vi.hoisted(() => ({
  startJob: vi.fn(),
  jobStatus: vi.fn(),
  cancelJob: vi.fn()
}))
const mutateMock = vi.hoisted(() => vi.fn())

vi.mock('../api/engine', () => ({
  engine: engineMock,
  isAbortError: (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
}))
vi.mock('./edits', () => ({ mutate: mutateMock }))
vi.mock('./pending', () => ({ commitPending: vi.fn(async () => undefined) }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

import {
  JobFailedError,
  POLL_INTERVAL,
  cancelActiveJob,
  pollJob,
  runDocumentJob,
  runJob,
  useActiveJob
} from './jobs'

function snapshot(
  status: JobSnapshot['status'],
  progress: number,
  extra: Partial<JobSnapshot> = {}
): JobSnapshot {
  return { jobId: 'j1', type: 'ocr', docId: 'd1', status, progress, message: '', ...extra }
}

/** A fake engine status that walks through `steps`, one per request. */
type FetchStatus = (jobId: string, signal?: AbortSignal) => Promise<JobSnapshot>

function scripted(steps: JobSnapshot[]): ReturnType<typeof vi.fn<FetchStatus>> {
  let index = 0
  return vi.fn<FetchStatus>(async () => steps[Math.min(index++, steps.length - 1)])
}

beforeEach(() => {
  vi.useFakeTimers()
  useActiveJob.setState({ active: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('pollJob', () => {
  it('asks about twice a second until the job is finished', async () => {
    const fetchStatus = scripted([
      snapshot('queued', 0),
      snapshot('running', 0.4),
      snapshot('running', 0.8),
      snapshot('done', 1, { result: { answer: 42 } })
    ])
    const seen: number[] = []
    const promise = pollJob('j1', { fetchStatus, onUpdate: (s) => seen.push(s.progress) })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL * 3)
    const final = await promise
    expect(final.status).toBe('done')
    expect(final.result).toEqual({ answer: 42 })
    expect(seen).toEqual([0, 0.4, 0.8, 1])
    expect(fetchStatus).toHaveBeenCalledTimes(4)
    expect(POLL_INTERVAL).toBe(500)
  })

  it('stops at failed and cancelled too', async () => {
    for (const status of ['failed', 'cancelled'] as const) {
      const fetchStatus = scripted([snapshot('running', 0.2), snapshot(status, 0.2)])
      const promise = pollJob('j1', { fetchStatus })
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL)
      expect((await promise).status).toBe(status)
    }
  })

  it('can be stopped with a signal', async () => {
    const fetchStatus = scripted([snapshot('running', 0.1)])
    const controller = new AbortController()
    const promise = pollJob('j1', { fetchStatus, signal: controller.signal })
    const settled = expect(promise).rejects.toThrow('Aborted')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL)
    controller.abort()
    await settled
    const calls = fetchStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL * 4)
    expect(fetchStatus.mock.calls.length).toBe(calls)
  })

  it('passes on an engine that cannot be reached', async () => {
    const fetchStatus = vi.fn<FetchStatus>(async () => {
      throw new Error('The PDF engine cannot be reached.')
    })
    await expect(pollJob('j1', { fetchStatus })).rejects.toThrow('cannot be reached')
  })
})

describe('runJob', () => {
  it('shows the job while it runs and clears it at the end', async () => {
    engineMock.startJob.mockResolvedValue(snapshot('queued', 0))
    engineMock.jobStatus
      .mockResolvedValueOnce(snapshot('running', 0.5, { message: 'Page 2' }))
      .mockResolvedValueOnce(snapshot('done', 1))
    const promise = runJob('Compressing', 'compress', 'd1', { preset: 'light' })
    await vi.advanceTimersByTimeAsync(0)
    const active = useActiveJob.getState().active
    expect(active?.title).toBe('Compressing')
    expect(active?.snapshot?.message).toBe('Page 2')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL)
    expect((await promise).status).toBe('done')
    expect(useActiveJob.getState().active).toBeNull()
    expect(engineMock.startJob).toHaveBeenCalledWith('compress', 'd1', { preset: 'light' })
  })

  it('cancel asks the engine once and marks the dialog as cancelling', async () => {
    engineMock.startJob.mockResolvedValue(snapshot('queued', 0))
    engineMock.jobStatus.mockResolvedValue(snapshot('running', 0.3))
    engineMock.cancelJob.mockResolvedValue(snapshot('running', 0.3))
    const promise = runJob('OCR', 'ocr', 'd1', {})
    await vi.advanceTimersByTimeAsync(0)
    await cancelActiveJob()
    await cancelActiveJob()
    expect(engineMock.cancelJob).toHaveBeenCalledTimes(1)
    expect(useActiveJob.getState().active?.cancelling).toBe(true)
    engineMock.jobStatus.mockResolvedValue(snapshot('cancelled', 0.3))
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL)
    expect((await promise).status).toBe('cancelled')
    expect(useActiveJob.getState().active).toBeNull()
  })
})

describe('runDocumentJob', () => {
  beforeEach(() => {
    // mutate(tabId, call, failure, options): run the call like the real queue,
    // returning null on errors it was told to ignore and rethrowing the rest.
    mutateMock.mockImplementation(
      async (
        _tab: string,
        call: (docId: string) => Promise<unknown>,
        _failure: string,
        options: { ignore?: (error: unknown) => boolean } = {}
      ) => {
        try {
          return await call('d1')
        } catch (error) {
          if (options.ignore?.(error)) return null
          throw error
        }
      }
    )
  })

  it('applies a result that changed the document', async () => {
    engineMock.startJob.mockResolvedValue(snapshot('queued', 0))
    engineMock.jobStatus.mockResolvedValue(
      snapshot('done', 1, { result: { revision: 4, dirtyPages: [0], smaller: true } })
    )
    const final = await runDocumentJob('t1', 'Compressing', 'compress', {}, 'Could not compress')
    expect(final?.status).toBe('done')
    expect(await mutateMock.mock.results[0].value).toEqual({
      revision: 4,
      dirtyPages: [0],
      smaller: true
    })
  })

  it('applies nothing when the job changed nothing or was cancelled', async () => {
    for (const final of [
      snapshot('done', 1, { result: { smaller: false } }),
      snapshot('cancelled', 0.5)
    ]) {
      engineMock.startJob.mockResolvedValue(snapshot('queued', 0))
      engineMock.jobStatus.mockResolvedValue(final)
      mutateMock.mockClear()
      const answer = await runDocumentJob('t1', 'Compressing', 'compress', {}, 'Could not')
      expect(answer?.status).toBe(final.status)
      expect(await mutateMock.mock.results[0].value).toBeNull()
    }
  })

  it('reports a failed job with its own message', async () => {
    engineMock.startJob.mockResolvedValue(snapshot('queued', 0))
    engineMock.jobStatus.mockResolvedValue(
      snapshot('failed', 0.2, { error: { code: 'document_changed', message: 'Changed.' } })
    )
    await expect(runDocumentJob('t1', 'OCR', 'ocr', {}, 'Could not')).rejects.toBeInstanceOf(
      JobFailedError
    )
  })
})
