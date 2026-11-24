/**
 * Validation of stored and incoming settings values. Pure, so it is tested
 * without electron-store (settings-rules.test.ts).
 */

import {
  isDefaultZoom,
  isLayoutMode,
  MAX_OCR_LANGUAGES,
  RECOVERY_MINUTES,
  type DefaultZoom,
  type LayoutMode
} from '../shared/api'
import {
  AI_LIMITS,
  AI_MAX_CONTEXT,
  DEFAULT_AI_SERVER_URL,
  isAiContextMode,
  normalizeServerUrl,
  type AiContextMode
} from '../shared/ai'

export { normalizeServerUrl }

/** 100 %, as documents opened before the setting existed. */
export const DEFAULT_ZOOM: DefaultZoom = 'actual-size'
export const DEFAULT_LAYOUT: LayoutMode = 'continuous'
export const DEFAULT_OCR_LANGUAGES = ['eng']

/** Tesseract codes look like "eng", "chi_sim", "deu_latf". */
const LANGUAGE_CODE = /^[a-z][a-z0-9_]{1,30}$/i

export function zoomOrDefault(value: unknown): DefaultZoom {
  return isDefaultZoom(value) ? value : DEFAULT_ZOOM
}

export function layoutOrDefault(value: unknown): LayoutMode {
  return isLayoutMode(value) ? value : DEFAULT_LAYOUT
}

/** Valid, distinct codes, at most three; English when none are left. */
export function ocrLanguagesOrDefault(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_OCR_LANGUAGES]
  const codes = [
    ...new Set(
      value.filter((code): code is string => typeof code === 'string' && LANGUAGE_CODE.test(code))
    )
  ].slice(0, MAX_OCR_LANGUAGES)
  return codes.length > 0 ? codes : [...DEFAULT_OCR_LANGUAGES]
}

export function serverUrlOrDefault(value: unknown): string {
  return normalizeServerUrl(value) ?? DEFAULT_AI_SERVER_URL
}

/** A model key as LM Studio names models; null for none or anything else. */
export function aiModelOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const key = value.trim()
  return key.length >= 1 && key.length <= AI_LIMITS.model ? key : null
}

export function aiContextOrDefault(value: unknown): AiContextMode {
  return isAiContextMode(value) ? value : 'page'
}

/** Whole tokens within 4,096–131,072; the default for anything that is not a number. */
export function aiMaxContextOrDefault(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return AI_MAX_CONTEXT.default
  return Math.min(AI_MAX_CONTEXT.max, Math.max(AI_MAX_CONTEXT.min, Math.round(value)))
}

/** Whole minutes within the allowed range; the default for anything else. */
export function recoveryMinutesOrDefault(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return RECOVERY_MINUTES.default
  return Math.min(RECOVERY_MINUTES.max, Math.max(RECOVERY_MINUTES.min, Math.round(value)))
}
