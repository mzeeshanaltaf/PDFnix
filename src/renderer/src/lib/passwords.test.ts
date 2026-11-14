import { describe, expect, it } from 'vitest'
import { passwordProblem, passwordStrength } from './passwords'
import { printerPageRanges } from './pageRanges'
import { formatSaving, formatSize } from '../dialogs/format'

describe('passwordStrength', () => {
  it.each([
    ['', 'weak'],
    ['abc123', 'weak'],
    ['abcdefgh', 'weak'],
    ['abcdefg1', 'fair'],
    ['abcdefghijkl', 'fair'],
    ['Abcdefg1!x', 'strong'],
    ['correct horse battery', 'strong'],
    ['horsebattery', 'fair'],
    ['correct horse battery 9', 'strong']
  ])('%s is %s', (password, expected) => {
    expect(passwordStrength(password)).toBe(expected)
  })
})

describe('passwordProblem', () => {
  it('accepts matching passwords and two empty boxes', () => {
    expect(passwordProblem('s3cret!', 's3cret!')).toBeNull()
    expect(passwordProblem('', '')).toBeNull()
  })

  it('names the problem', () => {
    expect(passwordProblem('s3cret!', 's3cret')).toMatch(/do not match/)
    expect(passwordProblem('', 'x')).toMatch(/first box/)
    expect(passwordProblem('ä'.repeat(64), 'ä'.repeat(64))).toMatch(/too long/)
  })
})

describe('formatting', () => {
  it('writes page lists for the printer', () => {
    expect(printerPageRanges([6, 0, 1, 2])).toBe('1-3,7')
    expect(printerPageRanges([4])).toBe('5')
  })

  it('writes sizes and savings', () => {
    expect(formatSize(900)).toBe('900 bytes')
    expect(formatSize(1536)).toBe('1.50 KB')
    expect(formatSize(4.2 * 1024 * 1024)).toBe('4.20 MB')
    expect(formatSaving(4 * 1024 * 1024, 1024 * 1024)).toBe('4.00 MB → 1.00 MB (75 % smaller)')
  })
})
