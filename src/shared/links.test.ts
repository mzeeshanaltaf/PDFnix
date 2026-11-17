import { describe, expect, it } from 'vitest'
import { externalLinkTarget } from './links'

describe('externalLinkTarget', () => {
  it('accepts web and mail addresses', () => {
    expect(externalLinkTarget('https://zeeshanai.example/a?b=1#c')).toBe(
      'https://zeeshanai.example/a?b=1#c'
    )
    expect(externalLinkTarget('http://example.com')).toBe('http://example.com/')
    expect(externalLinkTarget('  https://example.com/x  ')).toBe('https://example.com/x')
    expect(externalLinkTarget('mailto:someone@example.com')).toBe('mailto:someone@example.com')
  })

  it('takes an address without a scheme that starts with www. as https', () => {
    expect(externalLinkTarget('www.example.com/page')).toBe('https://www.example.com/page')
  })

  it('refuses anything that could run a program or read files', () => {
    for (const raw of [
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'ms-settings:privacy',
      'C:\\Windows\\notepad.exe',
      '\\\\server\\share\\run.exe',
      'data:text/html,<script>1</script>',
      'vbscript:msgbox',
      'search-ms:query=x'
    ]) {
      expect(externalLinkTarget(raw), raw).toBeNull()
    }
  })

  it('refuses empty, malformed and disguised addresses', () => {
    expect(externalLinkTarget('')).toBeNull()
    expect(externalLinkTarget('   ')).toBeNull()
    expect(externalLinkTarget('example.com')).toBeNull()
    expect(externalLinkTarget('https://')).toBeNull()
    expect(externalLinkTarget('mailto:')).toBeNull()
    expect(externalLinkTarget('https://exa\nmple.com')).toBeNull()
    expect(externalLinkTarget(`https://example.com/${'a'.repeat(5000)}`)).toBeNull()
    expect(externalLinkTarget(42)).toBeNull()
    expect(externalLinkTarget(null)).toBeNull()
  })
})
