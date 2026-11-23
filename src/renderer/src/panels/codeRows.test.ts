import { describe, expect, it } from 'vitest'
import type { PageCode } from '@/api/engine'
import type { FoundCode } from '@/viewer/codeScan'
import { codeLinkTarget, codesAsText, groupCodes } from './codeRows'

function found(
  page: number,
  index: number,
  text: string,
  extra: Partial<PageCode> = {}
): FoundCode {
  return {
    page,
    index,
    code: {
      format: 'QR Code',
      text,
      binary: false,
      quad: [],
      rect: [0, 0, 1, 1],
      ...extra
    }
  }
}

describe('code rows', () => {
  it('groups codes by page', () => {
    const groups = groupCodes([found(0, 0, 'a'), found(0, 1, 'b'), found(3, 0, 'c')])
    expect(groups.map((group) => [group.page, group.codes.length])).toEqual([
      [0, 2],
      [3, 1]
    ])
  })

  it('offers to open only web and mail addresses', () => {
    expect(codeLinkTarget(found(0, 0, 'https://efan.gov.pk/').code)).toBe('https://efan.gov.pk/')
    expect(codeLinkTarget(found(0, 0, 'www.lesco.gov.pk').code)).toBe('https://www.lesco.gov.pk/')
    expect(codeLinkTarget(found(0, 0, 'MAILTO:a@b.c').code)).toBe('mailto:a@b.c')
    expect(codeLinkTarget(found(0, 0, '16 11564 1570600U').code)).toBeNull()
    expect(codeLinkTarget(found(0, 0, 'file:///C:/Windows/notepad.exe').code)).toBeNull()
    expect(codeLinkTarget(found(0, 0, 'WIFI:S:home;T:WPA;P:secret;;').code)).toBeNull()
    expect(codeLinkTarget(found(0, 0, 'https://x.y', { binary: true }).code)).toBeNull()
  })

  it('writes all codes as text with their page', () => {
    expect(codesAsText([found(0, 0, 'a'), found(2, 0, 'b', { format: 'Code 128' })])).toBe(
      'Page 1 · QR Code\na\n\nPage 3 · Code 128\nb'
    )
  })
})
