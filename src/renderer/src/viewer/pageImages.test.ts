import { describe, expect, it, vi } from 'vitest'
import { IMAGE_PRIORITY, PageImageStore, type ImageTarget } from './pageImages'

interface Call {
  target: ImageTarget
  signal: AbortSignal
  resolve: (blob: Blob) => void
  reject: (error: unknown) => void
}

function setup(options: { maxBytes?: number; concurrency?: number } = {}): {
  store: PageImageStore
  calls: Call[]
  revoked: string[]
  finish: (index: number, bytes?: number) => Promise<void>
} {
  const calls: Call[] = []
  const revoked: string[] = []
  let urls = 0
  const store = new PageImageStore(
    (target, signal) =>
      new Promise<Blob>((resolve, reject) => {
        calls.push({ target, signal, resolve, reject })
        signal.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        )
      }),
    {
      maxBytes: options.maxBytes ?? 1000,
      concurrency: options.concurrency ?? 10,
      createUrl: () => `blob:${++urls}`,
      revokeUrl: (url) => revoked.push(url)
    }
  )
  const finish = async (index: number, bytes = 100): Promise<void> => {
    calls[index].resolve(new Blob([new Uint8Array(bytes)]))
    await flush()
  }
  return { store, calls, revoked, finish }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

const target = (page: number, scale = 1, revision = 0, docId = 'doc'): ImageTarget => ({
  docId,
  page,
  revision,
  scale
})

describe('PageImageStore', () => {
  it('fetches an image once and shares it', async () => {
    const { store, calls, finish } = setup()
    const releaseA = store.request(target(0), IMAGE_PRIORITY.visible)
    const releaseB = store.request(target(0), IMAGE_PRIORITY.visible)
    expect(calls).toHaveLength(1)

    await finish(0)
    expect(store.peek('doc', 0, 0, 1)?.url).toBe('blob:1')
    // Asking again is served from the cache.
    store.request(target(0), IMAGE_PRIORITY.visible)
    expect(calls).toHaveLength(1)
    releaseA()
    releaseB()
  })

  it('notifies subscribers when an image arrives', async () => {
    const { store, finish } = setup()
    const listener = vi.fn()
    store.subscribe(listener)
    store.request(target(0), IMAGE_PRIORITY.visible)
    await finish(0)
    expect(listener).toHaveBeenCalled()
  })

  it('evicts the least recently used images nobody shows once over budget', async () => {
    const { store, finish, revoked } = setup({ maxBytes: 250 })
    for (let page = 0; page < 3; page += 1) {
      const release = store.request(target(page), IMAGE_PRIORITY.visible)
      await finish(page)
      release()
    }
    expect(store.bytes).toBeLessThanOrEqual(250)
    expect(store.size).toBe(2)
    expect(store.peek('doc', 0, 0, 1)).toBeNull()
    expect(store.peek('doc', 2, 0, 1)).not.toBeNull()
    expect(revoked).toEqual(['blob:1'])
  })

  it('never evicts an image that is on screen', async () => {
    const { store, finish } = setup({ maxBytes: 150 })
    store.request(target(0), IMAGE_PRIORITY.visible) // kept
    await finish(0)
    store.request(target(1), IMAGE_PRIORITY.visible) // kept
    await finish(1)
    expect(store.size).toBe(2)
    expect(store.bytes).toBe(200)
  })

  it('evicts once a pinned image is released, if still over budget', async () => {
    const { store, finish } = setup({ maxBytes: 150 })
    const release0 = store.request(target(0), IMAGE_PRIORITY.visible)
    await finish(0)
    store.request(target(1), IMAGE_PRIORITY.visible)
    await finish(1)
    release0()
    expect(store.size).toBe(1)
    expect(store.peek('doc', 0, 0, 1)).toBeNull()
  })

  it('counts a recently requested image as recently used', async () => {
    const { store, finish } = setup({ maxBytes: 250 })
    const r0 = store.request(target(0), IMAGE_PRIORITY.visible)
    await finish(0)
    r0()
    const r1 = store.request(target(1), IMAGE_PRIORITY.visible)
    await finish(1)
    r1()
    store.request(target(0), IMAGE_PRIORITY.visible)() // touch page 0
    const r2 = store.request(target(2), IMAGE_PRIORITY.visible)
    await finish(2)
    r2()
    expect(store.peek('doc', 0, 0, 1)).not.toBeNull()
    expect(store.peek('doc', 1, 0, 1)).toBeNull()
  })

  it('cancels a request nobody waits for any more', () => {
    const { store, calls } = setup()
    const release = store.request(target(0), IMAGE_PRIORITY.visible)
    release()
    expect(calls[0].signal.aborted).toBe(true)
  })

  it('keeps a request alive while someone still waits for it', () => {
    const { store, calls } = setup()
    const a = store.request(target(0), IMAGE_PRIORITY.visible)
    store.request(target(0), IMAGE_PRIORITY.visible)
    a()
    expect(calls[0].signal.aborted).toBe(false)
  })

  it('runs only a few requests at once, most urgent and most recent first', async () => {
    const { store, calls, finish } = setup({ concurrency: 1 })
    store.request(target(0), IMAGE_PRIORITY.visible)
    store.request(target(1), IMAGE_PRIORITY.thumbnail)
    store.request(target(2), IMAGE_PRIORITY.nearby)
    store.request(target(3), IMAGE_PRIORITY.nearby)
    expect(calls.map((call) => call.target.page)).toEqual([0])
    await finish(0)
    expect(calls.map((call) => call.target.page)).toEqual([0, 3])
    await finish(1)
    expect(calls.map((call) => call.target.page)).toEqual([0, 3, 2])
    await finish(2)
    expect(calls.map((call) => call.target.page)).toEqual([0, 3, 2, 1])
  })

  it('offers the nearest other scale while the wanted one loads', async () => {
    const { store, finish } = setup()
    store.request(target(0, 1), IMAGE_PRIORITY.visible)
    await finish(0)
    store.request(target(0, 3), IMAGE_PRIORITY.visible)
    await finish(1)
    // 2 is wanted: the sharper 3 beats the blurrier 1.
    expect(store.peek('doc', 0, 0, 2)?.scale).toBe(3)
    // 5 is wanted: nothing sharper, so the sharpest there is.
    expect(store.peek('doc', 0, 0, 5)?.scale).toBe(3)
    // Never an image of another revision of the page.
    expect(store.peek('doc', 0, 1, 2)).toBeNull()
  })

  it('remembers a failure and retries when asked again', async () => {
    const { store, calls } = setup()
    store.request(target(0), IMAGE_PRIORITY.visible)
    calls[0].reject(new Error('boom'))
    await flush()
    expect(store.hasFailed('doc', 0, 0, 1)).toBe(true)
    store.request(target(0), IMAGE_PRIORITY.visible)
    expect(store.hasFailed('doc', 0, 0, 1)).toBe(false)
    expect(calls).toHaveLength(2)
  })

  it('a cancelled request is not a failure', async () => {
    const { store } = setup()
    store.request(target(0), IMAGE_PRIORITY.visible)()
    await flush()
    expect(store.hasFailed('doc', 0, 0, 1)).toBe(false)
  })

  it('drops everything of a closed document', async () => {
    const { store, calls, finish, revoked } = setup()
    store.request(target(0, 1, 0, 'a'), IMAGE_PRIORITY.visible)
    store.request(target(0, 1, 0, 'b'), IMAGE_PRIORITY.visible)
    store.request(target(1, 1, 0, 'a'), IMAGE_PRIORITY.visible)
    await finish(0)
    await finish(1)
    store.dropDocument('a')
    expect(calls[2].signal.aborted).toBe(true)
    expect(store.peek('a', 0, 0, 1)).toBeNull()
    expect(store.peek('b', 0, 0, 1)).not.toBeNull()
    expect(revoked).toEqual(['blob:1'])
  })
})
