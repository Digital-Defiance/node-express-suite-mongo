/**
 * Property-Based Tests for TOTP Code Format Validation
 *
 * Feature: totp-2fa, Property 5: Code Format Validation
 *
 * Uses fast-check to validate that any string not matching `/^\d{6}$/`
 * is rejected by the TOTP endpoint code validation logic.
 *
 * **Validates: Requirements 4.6**
 *
 * @module __tests__/totp-code-format.property.spec
 */

import * as fc from 'fast-check';
import { HandleableError } from '@digitaldefiance/i18n-lib';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Mirrors the code validation logic used in the TOTP controller endpoints
 * (confirm, disable, verify, reset). Each endpoint performs:
 *
 *   if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
 *     throw new HandleableError(
 *       new Error('Code must be exactly 6 digits'),
 *       { statusCode: 400 },
 *     );
 *   }
 *
 * This function replicates that exact check so we can property-test it
 * without spinning up HTTP infrastructure.
 */
function validateTotpCode(code: unknown): void {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    throw new HandleableError(new Error('Code must be exactly 6 digits'), {
      statusCode: 400,
    });
  }
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Arbitrary that generates strings which do NOT match `/^\d{6}$/`.
 *
 * Strategy: combine several categories of invalid inputs:
 * 1. Empty strings
 * 2. Strings shorter than 6 characters (digits only)
 * 3. Strings longer than 6 characters (digits only)
 * 4. Strings of exactly 6 characters containing at least one non-digit
 * 5. Arbitrary unicode strings (overwhelmingly unlikely to be exactly 6 digits)
 * 6. Strings with whitespace, special characters, or letters mixed with digits
 */

const digitChars = '0123456789';
const nonDigitChars =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()-_=+[]{}|;:,.<>?/~ ';

// Category 1: empty string
const emptyString = fc.constant('');

// Category 2: digit-only strings shorter than 6
const shortDigitString = fc
  .array(fc.constantFrom(...digitChars.split('')), {
    minLength: 1,
    maxLength: 5,
  })
  .map((chars) => chars.join(''));

// Category 3: digit-only strings longer than 6
const longDigitString = fc
  .array(fc.constantFrom(...digitChars.split('')), {
    minLength: 7,
    maxLength: 20,
  })
  .map((chars) => chars.join(''));

// Category 4: exactly 6 characters with at least one non-digit
const sixCharsWithNonDigit = fc
  .tuple(
    // Position where we inject a non-digit (0–5)
    fc.integer({ min: 0, max: 5 }),
    // The non-digit character to inject
    fc.constantFrom(...nonDigitChars.split('')),
    // 5 digit characters for the remaining positions
    fc.array(fc.constantFrom(...digitChars.split('')), {
      minLength: 5,
      maxLength: 5,
    }),
  )
  .map(([pos, nonDigit, digits]) => {
    const result = [...digits];
    result.splice(pos, 0, nonDigit);
    return result.join('');
  });

// Category 5: arbitrary strings (filtered to exclude valid 6-digit codes)
const arbitraryString = fc
  .string({ minLength: 0, maxLength: 50 })
  .filter((s) => !/^\d{6}$/.test(s));

// Category 6: strings with leading/trailing whitespace around digits
const paddedDigitString = fc
  .tuple(
    fc.constantFrom(' ', '\t', '\n', '\r'),
    fc.array(fc.constantFrom(...digitChars.split('')), {
      minLength: 6,
      maxLength: 6,
    }),
    fc.constantFrom(' ', '\t', '\n', '\r'),
  )
  .map(([prefix, digits, suffix]) => prefix + digits.join('') + suffix);

/**
 * Combined arbitrary: picks uniformly from all invalid-code categories.
 */
const invalidCodeArbitrary = fc.oneof(
  emptyString,
  shortDigitString,
  longDigitString,
  sixCharsWithNonDigit,
  arbitraryString,
  paddedDigitString,
);

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('TOTP Code Format Validation - Property Tests', () => {
  describe('Feature: totp-2fa, Property 5: Code Format Validation', () => {
    /**
     * **Validates: Requirements 4.6**
     *
     * For any string that does not match `/^\d{6}$/`, the TOTP endpoints
     * (confirm, disable, verify, reset) must reject with a validation error.
     */
    it('rejects any string that does not match /^\\d{6}$/ with a 400 HandleableError', () => {
      fc.assert(
        fc.property(invalidCodeArbitrary, (invalidCode) => {
          // Precondition: the generated string must NOT match the valid pattern
          // (the arbitraries are designed to avoid it, but this is a safety net)
          expect(/^\d{6}$/.test(invalidCode)).toBe(false);

          // The validation must throw
          expect(() => validateTotpCode(invalidCode)).toThrow(HandleableError);

          // Verify the thrown error has the correct status code and message
          try {
            validateTotpCode(invalidCode);
          } catch (err) {
            expect(err).toBeInstanceOf(HandleableError);
            const handleableErr = err as HandleableError;
            expect(handleableErr.statusCode).toBe(400);
            expect(handleableErr.message).toBe('Code must be exactly 6 digits');
          }
        }),
        { numRuns: 100 },
      );
    });

    /**
     * Complementary check: valid 6-digit codes must NOT be rejected.
     * This ensures the validation function is correctly implemented
     * (not rejecting everything).
     */
    it('accepts any valid 6-digit string without throwing', () => {
      const validCodeArbitrary = fc
        .array(fc.constantFrom(...digitChars.split('')), {
          minLength: 6,
          maxLength: 6,
        })
        .map((chars) => chars.join(''));

      fc.assert(
        fc.property(validCodeArbitrary, (validCode) => {
          expect(/^\d{6}$/.test(validCode)).toBe(true);
          expect(() => validateTotpCode(validCode)).not.toThrow();
        }),
        { numRuns: 100 },
      );
    });

    /**
     * Non-string types must also be rejected.
     * The endpoints receive request body values which could be non-strings.
     */
    it('rejects non-string types (numbers, null, undefined, objects) with a 400 HandleableError', () => {
      const nonStringArbitrary = fc.oneof(
        fc.integer(),
        fc.constant(null),
        fc.constant(undefined),
        fc.boolean(),
        fc.array(fc.integer()),
        fc.dictionary(fc.string(), fc.integer()),
      );

      fc.assert(
        fc.property(nonStringArbitrary, (nonStringValue) => {
          expect(() => validateTotpCode(nonStringValue)).toThrow(
            HandleableError,
          );

          try {
            validateTotpCode(nonStringValue);
          } catch (err) {
            const handleableErr = err as HandleableError;
            expect(handleableErr.statusCode).toBe(400);
            expect(handleableErr.message).toBe('Code must be exactly 6 digits');
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
