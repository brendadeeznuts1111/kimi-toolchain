/**
 * crypto-utils.ts — Shared cryptographic utility functions.
 */

/**
 * Compare two strings in constant time to prevent timing attacks.
 * Returns true if strings are equal.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
