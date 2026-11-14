/** Checks for the passwords typed into the Protect dialog. */

export type Strength = 'weak' | 'fair' | 'strong'

/**
 * A rough strength hint: length counts most, then the mix of kinds of
 * characters. Only a hint; nothing is refused for being weak.
 */
export function passwordStrength(password: string): Strength {
  if (password.length < 8) return 'weak'
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/].filter((kind) => kind.test(password)).length
  if (password.length >= 14 && kinds >= 2) return 'strong'
  if (password.length >= 10 && kinds >= 3) return 'strong'
  if (kinds >= 2 || password.length >= 12) return 'fair'
  return 'weak'
}

export const STRENGTH_HINTS: Record<Strength, string> = {
  weak: 'Weak: use at least 10 characters, mixing letters, digits and symbols.',
  fair: 'Fair: longer, or with more kinds of characters, is better.',
  strong: 'Strong.'
}

/** PDF passwords: at most 127 bytes in UTF-8 (AES-256). */
export const MAX_PASSWORD_BYTES = 127

/**
 * The problem with a password and its confirmation, or null if they are
 * fine. An empty password is fine (the field is optional) only when the
 * confirmation is empty too.
 */
export function passwordProblem(password: string, confirmation: string): string | null {
  if (password === '' && confirmation === '') return null
  if (password === '') return 'Type the password in the first box too.'
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return 'The password is too long (at most 127 bytes).'
  }
  if (password !== confirmation) return 'The two passwords do not match.'
  return null
}
