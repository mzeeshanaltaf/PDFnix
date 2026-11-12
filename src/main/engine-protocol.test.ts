import { describe, expect, it } from 'vitest'
import { LineSplitter, parseReadyLine, RestartPolicy, TailBuffer } from './engine-protocol'

describe('parseReadyLine', () => {
  it('reads the port from the ready line', () => {
    expect(parseReadyLine('ENGINE_READY port=51234')).toBe(51234)
    expect(parseReadyLine('ENGINE_READY port=51234\r')).toBe(51234)
  })

  it('ignores anything else', () => {
    expect(parseReadyLine('')).toBeNull()
    expect(parseReadyLine('INFO: started')).toBeNull()
    expect(parseReadyLine('ENGINE_READY port=')).toBeNull()
    expect(parseReadyLine('prefix ENGINE_READY port=5000')).toBeNull()
    expect(parseReadyLine('ENGINE_READY port=5000 extra')).toBeNull()
  })

  it('rejects ports outside the valid range', () => {
    expect(parseReadyLine('ENGINE_READY port=0')).toBeNull()
    expect(parseReadyLine('ENGINE_READY port=65536')).toBeNull()
    expect(parseReadyLine('ENGINE_READY port=65535')).toBe(65535)
  })
})

describe('LineSplitter', () => {
  it('joins a line that arrives in pieces', () => {
    const splitter = new LineSplitter()
    expect(splitter.push('ENGINE_RE')).toEqual([])
    expect(splitter.push('ADY port=80')).toEqual([])
    expect(splitter.push('80\r\nnext')).toEqual(['ENGINE_READY port=8080'])
    expect(splitter.flush()).toBe('next')
    expect(splitter.flush()).toBeNull()
  })

  it('returns several lines from one chunk', () => {
    expect(new LineSplitter().push('a\nb\n')).toEqual(['a', 'b'])
  })
})

describe('TailBuffer', () => {
  it('keeps only the most recent characters', () => {
    const tail = new TailBuffer(5)
    tail.append('abc')
    tail.append('defgh')
    expect(tail.toString()).toBe('defgh')
    tail.clear()
    expect(tail.toString()).toBe('')
  })
})

describe('RestartPolicy', () => {
  const STABLE = 60_000

  it('allows one restart', () => {
    const policy = new RestartPolicy(STABLE)
    expect(policy.shouldRestart(1_000, 0)).toBe(true)
  })

  it('refuses a second restart when the restarted engine crashed quickly', () => {
    const policy = new RestartPolicy(STABLE)
    expect(policy.shouldRestart(1_000, 0)).toBe(true)
    expect(policy.shouldRestart(6_000, 2_000)).toBe(false)
  })

  it('refuses a second restart when the restarted engine never became ready', () => {
    const policy = new RestartPolicy(STABLE)
    expect(policy.shouldRestart(1_000, 0)).toBe(true)
    expect(policy.shouldRestart(6_000, null)).toBe(false)
  })

  it('allows another restart after the engine has been stable', () => {
    const policy = new RestartPolicy(STABLE)
    expect(policy.shouldRestart(1_000, 0)).toBe(true)
    expect(policy.shouldRestart(2_000 + STABLE, 2_000)).toBe(true)
  })

  it('starts over after a reset', () => {
    const policy = new RestartPolicy(STABLE)
    expect(policy.shouldRestart(1_000, 0)).toBe(true)
    policy.reset()
    expect(policy.shouldRestart(2_000, 1_500)).toBe(true)
  })
})
