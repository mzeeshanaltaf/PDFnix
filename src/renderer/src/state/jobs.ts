/**
 * Background jobs (phase 6) from the renderer's side.
 *
 * - `pollJob` asks the engine for a job's state about twice a second until it
 *   finishes; everything else is built on it.
 * - `useJob(jobId)` is the same as a hook, for components that show a job's
 *   progress themselves (language downloads).
 * - `runJob` starts a job and shows it in the one `JobProgress` dialog
 *   (title, progress bar, current step, Cancel) until it finishes.
 * - `runDocumentJob` does that for a job that changes the open document,
 *   inside the tab's queue of changes (`mutate`), so its result (one undo step)
 *   is applied like any other change.
 */

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import {
  engine,
  isAbortError,
  type JobSnapshot,
  type JobType,
  type MutationResult
} from '../api/engine'
import { mutate } from './edits'
import { commitPending } from './pending'

/** Milliseconds between two status requests. */
export const POLL_INTERVAL = 500

export function isFinished(snapshot: Pick<JobSnapshot, 'status'>): boolean {
  return (
    snapshot.status === 'done' || snapshot.status === 'failed' || snapshot.status === 'cancelled'
  )
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export interface PollOptions<R> {
  interval?: number
  signal?: AbortSignal
  /** Called with every state the engine reports, the final one included. */
  onUpdate?: (snapshot: JobSnapshot<R>) => void
  /** The status request; replaced in tests. */
  fetchStatus?: (jobId: string, signal?: AbortSignal) => Promise<JobSnapshot<R>>
}

/**
 * Polls a job until it is done, failed or cancelled and resolves with its
 * final state. Rejects if the engine cannot be asked (the job is then lost),
 * or with an `AbortError` when `signal` aborts.
 */
export async function pollJob<R = unknown>(
  jobId: string,
  options: PollOptions<R> = {}
): Promise<JobSnapshot<R>> {
  const {
    interval = POLL_INTERVAL,
    signal,
    onUpdate,
    fetchStatus = (id, abort) => engine.jobStatus<R>(id, abort)
  } = options
  for (;;) {
    const snapshot = await fetchStatus(jobId, signal)
    onUpdate?.(snapshot)
    if (isFinished(snapshot)) return snapshot
    await wait(interval, signal)
  }
}

/**
 * The latest state of a job, polled about twice a second while it runs;
 * null before the first answer (or without a job).
 */
export function useJob<R = unknown>(jobId: string | null): JobSnapshot<R> | null {
  // Kept with the job it belongs to, so a new job id never shows the old job.
  const [state, setState] = useState<{ jobId: string; snapshot: JobSnapshot<R> } | null>(null)
  useEffect(() => {
    if (!jobId) return
    const controller = new AbortController()
    pollJob<R>(jobId, {
      signal: controller.signal,
      onUpdate: (snapshot) => setState({ jobId, snapshot })
    }).catch((error: unknown) => {
      if (isAbortError(error)) return
      setState((previous) => ({
        jobId,
        snapshot: {
          jobId,
          type: previous?.snapshot.type ?? '',
          docId: previous?.snapshot.docId ?? null,
          status: 'failed',
          progress: previous?.snapshot.progress ?? 0,
          message: '',
          error: {
            code: 'job_lost',
            message: error instanceof Error ? error.message : String(error)
          }
        }
      }))
    })
    return () => controller.abort()
  }, [jobId])
  return state !== null && state.jobId === jobId ? state.snapshot : null
}

// --- The job shown in the JobProgress dialog ------------------------------------

export interface ActiveJob {
  jobId: string
  title: string
  snapshot: JobSnapshot | null
  /** Cancel was pressed; waiting for the job to stop. */
  cancelling: boolean
}

export const useActiveJob = create<{ active: ActiveJob | null }>(() => ({ active: null }))

/**
 * Starts a job and shows its progress until it finishes. Resolves with the
 * final state (done, failed or cancelled). Rejects if the job could not be
 * started (bad parameters, files exist, …) or the engine went away.
 */
export async function runJob<R = unknown>(
  title: string,
  type: JobType,
  docId: string | null,
  params: object
): Promise<JobSnapshot<R>> {
  const started = await engine.startJob<R>(type, docId, params)
  useActiveJob.setState({
    active: { jobId: started.jobId, title, snapshot: started, cancelling: false }
  })
  try {
    return await pollJob<R>(started.jobId, {
      onUpdate: (snapshot) =>
        useActiveJob.setState((state) =>
          state.active?.jobId === started.jobId ? { active: { ...state.active, snapshot } } : state
        )
    })
  } finally {
    useActiveJob.setState((state) =>
      state.active?.jobId === started.jobId ? { active: null } : state
    )
  }
}

/** Asks the engine to stop the job in the progress dialog. */
export async function cancelActiveJob(): Promise<void> {
  const active = useActiveJob.getState().active
  if (!active || active.cancelling) return
  useActiveJob.setState({ active: { ...active, cancelling: true } })
  try {
    await engine.cancelJob(active.jobId)
  } catch {
    // The job may have finished meanwhile; polling reports what happened.
  }
}

/** The job finished without changing the document (nothing to apply). */
class NoChange extends Error {
  constructor() {
    super('No change')
  }
}

/** The job's own error as an exception, so the caller's report shows its message. */
export class JobFailedError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'JobFailedError'
  }
}

/**
 * Runs a job that changes the tab's document. The result, if the job changed
 * the document, is applied like any edit (one undo step). Failures are
 * reported with `failure` as the title. Resolves with the final state, or
 * null if the job could not run (reported) or the tab has gone.
 */
export async function runDocumentJob<R>(
  tabId: string,
  title: string,
  type: JobType,
  params: object,
  failure: string
): Promise<JobSnapshot<R> | null> {
  await commitPending()
  let final: JobSnapshot<R> | null = null
  await mutate(
    tabId,
    async (docId) => {
      final = await runJob<R>(title, type, docId, params)
      if (final.status === 'failed') {
        throw new JobFailedError(final.error?.code ?? 'failed', final.error?.message ?? 'Failed.')
      }
      const result = final.result as Partial<MutationResult> | undefined
      if (final.status !== 'done' || typeof result?.revision !== 'number') throw new NoChange()
      return result as MutationResult
    },
    failure,
    { ignore: (error) => error instanceof NoChange }
  )
  return final
}

/**
 * Runs a job that writes files. Failures (starting or running) are reported
 * with `failure` as the title, except errors `handle` deals with (return
 * true). Resolves with the final state when it is done, else null.
 */
export async function runFileJob<R>(
  title: string,
  type: JobType,
  docId: string | null,
  params: object,
  failure: string,
  handle?: (error: unknown) => boolean
): Promise<JobSnapshot<R> | null> {
  try {
    const final = await runJob<R>(title, type, docId, params)
    if (final.status === 'failed') {
      toast.error(failure, { description: final.error?.message })
      return null
    }
    if (final.status === 'cancelled') {
      toast(`${title} cancelled`, { duration: 2500 })
      return null
    }
    return final
  } catch (error) {
    if (handle?.(error)) return null
    toast.error(failure, { description: error instanceof Error ? error.message : String(error) })
    return null
  }
}
