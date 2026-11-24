import { describe, expect, it } from 'vitest'
import {
  aiContextOrDefault,
  aiMaxContextOrDefault,
  aiModelOrNull,
  normalizeServerUrl,
  serverUrlOrDefault,
  layoutOrDefault,
  ocrLanguagesOrDefault,
  recoveryMinutesOrDefault,
  zoomOrDefault
} from './settings-rules'

describe('settings rules', () => {
  it('keeps known zoom and layout choices and falls back otherwise', () => {
    expect(zoomOrDefault('fit-page')).toBe('fit-page')
    expect(zoomOrDefault('fit-width')).toBe('fit-width')
    expect(zoomOrDefault('huge')).toBe('actual-size')
    expect(zoomOrDefault(undefined)).toBe('actual-size')
    expect(layoutOrDefault('two-page')).toBe('two-page')
    expect(layoutOrDefault(3)).toBe('continuous')
  })

  it('keeps up to three distinct valid OCR language codes', () => {
    expect(ocrLanguagesOrDefault(['deu', 'eng'])).toEqual(['deu', 'eng'])
    expect(ocrLanguagesOrDefault(['eng', 'eng', 'chi_sim', 'fra', 'spa'])).toEqual([
      'eng',
      'chi_sim',
      'fra'
    ])
    expect(ocrLanguagesOrDefault(['../evil', '', 7, 'deu'])).toEqual(['deu'])
    expect(ocrLanguagesOrDefault([])).toEqual(['eng'])
    expect(ocrLanguagesOrDefault('eng')).toEqual(['eng'])
  })

  it('accepts http and https server addresses without a trailing slash', () => {
    expect(normalizeServerUrl('http://127.0.0.1:1234')).toBe('http://127.0.0.1:1234')
    expect(normalizeServerUrl(' http://127.0.0.1:1234/ ')).toBe('http://127.0.0.1:1234')
    expect(normalizeServerUrl('https://lm.example:8443/proxy//')).toBe(
      'https://lm.example:8443/proxy'
    )
    expect(normalizeServerUrl('HTTP://LOCALHOST:1234')).toBe('http://localhost:1234')
    for (const bad of [
      'ftp://127.0.0.1',
      'file:///C:/x',
      'javascript:alert(1)',
      '127.0.0.1:1234',
      'http://user:pw@127.0.0.1:1234',
      'http://127.0.0.1:1234/?a=1',
      'http://127.0.0.1:1234/#x',
      '',
      42
    ]) {
      expect(normalizeServerUrl(bad)).toBeNull()
    }
    expect(serverUrlOrDefault('nonsense')).toBe('http://127.0.0.1:1234')
  })

  it('keeps a model key of 1–200 characters', () => {
    expect(aiModelOrNull('google/gemma-4-26b-a4b')).toBe('google/gemma-4-26b-a4b')
    expect(aiModelOrNull('  a  ')).toBe('a')
    expect(aiModelOrNull('')).toBeNull()
    expect(aiModelOrNull('m'.repeat(201))).toBeNull()
    expect(aiModelOrNull(null)).toBeNull()
  })

  it('keeps the context mode and limits the largest context', () => {
    expect(aiContextOrDefault('document')).toBe('document')
    expect(aiContextOrDefault('everything')).toBe('page')
    expect(aiMaxContextOrDefault(8192)).toBe(8192)
    expect(aiMaxContextOrDefault(1000)).toBe(4096)
    expect(aiMaxContextOrDefault(1_000_000)).toBe(131072)
    expect(aiMaxContextOrDefault(10000.4)).toBe(10000)
    expect(aiMaxContextOrDefault('8192')).toBe(32768)
    expect(aiMaxContextOrDefault(Number.NaN)).toBe(32768)
  })

  it('rounds and limits the recovery interval', () => {
    expect(recoveryMinutesOrDefault(5)).toBe(5)
    expect(recoveryMinutesOrDefault(2.6)).toBe(3)
    expect(recoveryMinutesOrDefault(0)).toBe(1)
    expect(recoveryMinutesOrDefault(500)).toBe(30)
    expect(recoveryMinutesOrDefault(Number.NaN)).toBe(2)
    expect(recoveryMinutesOrDefault('10')).toBe(2)
  })
})
