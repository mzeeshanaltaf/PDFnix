import { describe, expect, it } from 'vitest'
import {
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

  it('rounds and limits the recovery interval', () => {
    expect(recoveryMinutesOrDefault(5)).toBe(5)
    expect(recoveryMinutesOrDefault(2.6)).toBe(3)
    expect(recoveryMinutesOrDefault(0)).toBe(1)
    expect(recoveryMinutesOrDefault(500)).toBe(30)
    expect(recoveryMinutesOrDefault(Number.NaN)).toBe(2)
    expect(recoveryMinutesOrDefault('10')).toBe(2)
  })
})
