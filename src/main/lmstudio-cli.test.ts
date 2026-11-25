import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import type { AiServerInfo } from '../shared/ai'
import {
  findLms,
  lastLine,
  START_MESSAGES,
  startArgs,
  startServer,
  withStartOption,
  type Runner
} from './lmstudio-cli'

const UNREACHABLE: AiServerInfo = {
  reachable: false,
  url: 'http://127.0.0.1:1234',
  error: { code: 'unreachable', message: 'Not running.' },
  models: []
}

describe('startArgs', () => {
  it('starts on the port of a local address', () => {
    expect(startArgs('http://127.0.0.1:1234')).toEqual(['server', 'start', '--port', '1234'])
    expect(startArgs('http://localhost:5678')).toEqual(['server', 'start', '--port', '5678'])
    expect(startArgs('http://[::1]:1234')).toEqual(['server', 'start', '--port', '1234'])
    expect(startArgs('http://127.0.0.1')).toEqual(['server', 'start', '--port', '80'])
  })

  it('refuses other computers, https and nonsense', () => {
    expect(startArgs('http://192.168.1.20:1234')).toBeNull()
    expect(startArgs('http://studio.example.com:1234')).toBeNull()
    expect(startArgs('https://127.0.0.1:1234')).toBeNull()
    expect(startArgs('not a url')).toBeNull()
  })
})

describe('findLms', () => {
  const home = join('C:', 'Users', 'me')
  const own = join(home, '.lmstudio', 'bin', 'lms.exe')
  const onPath = join('D:', 'tools', 'lms.exe')

  it("prefers LM Studio's folder in the user profile", () => {
    const exists = (path: string): boolean => path === own || path === onPath
    expect(
      findLms({ env: { USERPROFILE: home, PATH: join('D:', 'tools') }, exists, platform: 'win32' })
    ).toBe(own)
  })

  it('falls back to PATH, and gives null when it is nowhere', () => {
    const env = { USERPROFILE: home, PATH: join('D:', 'tools') }
    expect(findLms({ env, exists: (path) => path === onPath, platform: 'win32' })).toBe(onPath)
    expect(findLms({ env, exists: () => false, platform: 'win32' })).toBeNull()
  })
})

describe('withStartOption', () => {
  it('offers a start only for an unreachable local server with lms installed', () => {
    expect(withStartOption(UNREACHABLE, 'lms.exe').canStartServer).toBe(true)
    expect(withStartOption(UNREACHABLE, null).canStartServer).toBe(false)
    const remote = { ...UNREACHABLE, url: 'http://192.168.1.20:1234' }
    expect(withStartOption(remote, 'lms.exe').canStartServer).toBe(false)
    const running: AiServerInfo = { reachable: true, url: UNREACHABLE.url, models: [] }
    expect(withStartOption(running, 'lms.exe')).toBe(running)
  })
})

describe('lastLine', () => {
  it('drops colour codes and blank lines', () => {
    expect(lastLine('Starting…\n\u001b[31mError: port in use\u001b[0m\n\n')).toBe(
      'Error: port in use'
    )
    expect(lastLine('  \n')).toBe('')
  })
})

describe('startServer', () => {
  it('runs lms server start on the settings port', async () => {
    const run = vi.fn<Runner>(async () => ({ code: 0, output: 'Success! Server is now running' }))
    await expect(
      startServer({ serverUrl: 'http://127.0.0.1:4321', lmsPath: 'lms.exe', run, timeoutMs: 5 })
    ).resolves.toEqual({ ok: true })
    expect(run).toHaveBeenCalledWith('lms.exe', ['server', 'start', '--port', '4321'], 5)
  })

  it("says why it didn't start", async () => {
    const run: Runner = async () => ({ code: 1, output: 'Checking…\nError: port 1234 is busy\n' })
    await expect(
      startServer({ serverUrl: 'http://127.0.0.1:1234', lmsPath: 'lms.exe', run })
    ).resolves.toEqual({ ok: false, message: `${START_MESSAGES.failed} Error: port 1234 is busy` })

    const crashed: Runner = async () => ({ code: null, output: '\n', error: 'spawn EACCES' })
    await expect(
      startServer({ serverUrl: 'http://127.0.0.1:1234', lmsPath: 'lms.exe', run: crashed })
    ).resolves.toEqual({ ok: false, message: `${START_MESSAGES.failed} spawn EACCES` })
  })

  it('does not run anything for another computer or without lms', async () => {
    const run = vi.fn<Runner>()
    await expect(
      startServer({ serverUrl: 'http://10.0.0.5:1234', lmsPath: 'lms.exe', run })
    ).resolves.toEqual({ ok: false, message: START_MESSAGES.remote })
    await expect(
      startServer({ serverUrl: 'http://127.0.0.1:1234', lmsPath: null, run })
    ).resolves.toEqual({ ok: false, message: START_MESSAGES.notInstalled })
    expect(run).not.toHaveBeenCalled()
  })
})
