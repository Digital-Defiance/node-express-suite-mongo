/**
 * Property-Based Tests for JwtService.signPendingTotpToken
 *
 * Feature: totp-2fa, Property 8: Pending Token Structure
 * Uses fast-check to validate that pending TOTP tokens have the correct
 * structure across many generated inputs.
 *
 * **Validates: Requirements 6.2, 12.2, 12.5**
 *
 * @module __tests__/totp-pending-token.property.spec
 */

import * as fc from 'fast-check';
import { decode } from 'jsonwebtoken';
import { LocalhostConstants } from '@digitaldefiance/node-express-suite';
import { JwtService } from '../services/jwt';
import {
  IApplication,
  IEnvironment,
} from '@digitaldefiance/node-express-suite';

// ─── Helpers ────────────────────────────────────────────────────────────────

const testSecret = 'test-jwt-secret-for-pending-token-property';

function createJwtService(): JwtService {
  const mockEnvironment: Partial<IEnvironment> = {
    jwtSecret: testSecret,
  };

  const mockApplication = {
    environment: mockEnvironment as IEnvironment,
    constants: LocalhostConstants,
  } as unknown as IApplication<any>;

  return new JwtService(mockApplication);
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Arbitrary for random userId strings: non-empty alphanumeric strings
 * of length 1–64, representative of MongoDB ObjectId hex strings and
 * other ID formats.
 */
const alphanumChars =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const userIdArbitrary = fc
  .array(fc.constantFrom(...alphanumChars.split('')), {
    minLength: 1,
    maxLength: 64,
  })
  .map((chars) => chars.join(''));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('JwtService - Property Tests', () => {
  const jwtService = createJwtService();

  describe('Feature: totp-2fa, Property 8: Pending Token Structure', () => {
    /**
     * **Validates: Requirements 6.2, 12.2, 12.5**
     *
     * For any generated pending TOTP token, decoding it SHALL reveal:
     * (a) a `userId` string matching the input,
     * (b) `pendingTotp` equal to `true`,
     * (c) an expiry (`exp - iat`) of at most 600 seconds,
     * (d) no `roles` or other privilege claims.
     */
    it('every pending token contains userId, pendingTotp=true, expiry ≤ 600s, and no roles', () => {
      fc.assert(
        fc.property(userIdArbitrary, (userId) => {
          const token = jwtService.signPendingTotpToken(userId, testSecret);

          // Decode without verification to inspect the payload structure
          const payload = decode(token) as Record<string, unknown> | null;

          expect(payload).not.toBeNull();

          // (a) userId must be a string matching the input
          expect(payload!['userId']).toBe(userId);
          expect(typeof payload!['userId']).toBe('string');

          // (b) pendingTotp must be exactly true
          expect(payload!['pendingTotp']).toBe(true);

          // (c) expiry must be at most 600 seconds
          const iat = payload!['iat'] as number;
          const exp = payload!['exp'] as number;
          expect(typeof iat).toBe('number');
          expect(typeof exp).toBe('number');
          expect(exp - iat).toBeLessThanOrEqual(600);
          expect(exp - iat).toBeGreaterThan(0);

          // (d) no roles or privilege claims
          expect(payload!['roles']).toBeUndefined();
          expect(payload!['role']).toBeUndefined();
          expect(payload!['permissions']).toBeUndefined();
          expect(payload!['scope']).toBeUndefined();
          expect(payload!['admin']).toBeUndefined();
        }),
        { numRuns: 100 },
      );
    });
  });
});
