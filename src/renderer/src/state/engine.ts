import { toast } from 'sonner'
import { create } from 'zustand'
import type { EngineStatus } from '../../../shared/api'
import { engine, resetConnection, type EngineHealth } from '../api/engine'

export type EngineLink = 'connecting' | 'connected' | 'reconnecting' | 'failed'

interface EngineState {
  link: EngineLink
  /** Present while connected. */
  health: EngineHealth | null
  /** Why the engine is unavailable, when it is. */
  message: string | null
  /** Unexpected engine exits recovered from since the app started. */
  restarts: number
  /**
   * Which engine process we are connected to; it increases with every new
   * one. A new process knows nothing of the documents the old one had open.
   */
  generation: number
}

export const useEngine = create<EngineState>(() => ({
  link: 'connecting',
  health: null,
  message: null,
  restarts: 0,
  generation: 0
}))

/**
 * Follows the engine's lifecycle as reported by the main process and confirms
 * each new engine with a health request. Returns a function that stops it.
 */
export function startEngineMonitor(): () => void {
  let latest = 0
  let stopped = false

  const apply = async (status: EngineStatus): Promise<void> => {
    const ticket = ++latest
    const isCurrent = (): boolean => !stopped && ticket === latest
    const previous = useEngine.getState()

    switch (status.state) {
      case 'starting':
        useEngine.setState({ link: 'connecting', health: null, message: null })
        return
      case 'restarting':
        resetConnection()
        useEngine.setState({
          link: 'reconnecting',
          health: null,
          message: status.message ?? null,
          restarts: status.restarts
        })
        if (previous.link !== 'reconnecting') {
          toast.warning('The PDF engine stopped unexpectedly', {
            id: 'engine',
            description: 'Restarting it now…'
          })
        }
        return
      case 'failed': {
        resetConnection()
        const message = status.message ?? 'The PDF engine is not running.'
        useEngine.setState({ link: 'failed', health: null, message, restarts: status.restarts })
        // Replaces any earlier engine toast and stays until the engine is back.
        toast.error('The PDF engine is not running', {
          id: 'engine',
          description: message,
          duration: Infinity
        })
        return
      }
      case 'stopped':
        return
      case 'ready':
        break
    }

    resetConnection()
    try {
      const health = await engine.health()
      if (!isCurrent()) return
      useEngine.setState({
        link: 'connected',
        health,
        message: null,
        restarts: status.restarts,
        generation: status.generation
      })
      if (previous.link === 'reconnecting' || previous.link === 'failed') {
        toast.success('The PDF engine is running again', {
          id: 'engine',
          description: undefined,
          duration: 4000
        })
      }
    } catch (error) {
      if (!isCurrent()) return
      const message = error instanceof Error ? error.message : String(error)
      useEngine.setState({ link: 'failed', health: null, message, restarts: status.restarts })
      toast.error('The PDF engine is not responding', {
        id: 'engine',
        description: message,
        duration: Infinity
      })
    }
  }

  const unsubscribe = window.api.engine.onStatus((status) => void apply(status))
  void window.api.engine.getStatus().then((status) => {
    // An event that arrived first is newer than this snapshot.
    if (latest === 0) void apply(status)
  })

  return () => {
    stopped = true
    unsubscribe()
  }
}
