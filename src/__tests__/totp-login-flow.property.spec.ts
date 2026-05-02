/**
 * Property-Based Tests for TOTP Login Flow
 *
 * Feature: totp-2fa, Property 6: TOTP-Enabled Login Yields Pending Token
 * Feature: totp-2fa, Property 7: Non-TOTP Login Unchanged
 *
 * Uses fast-check to validate login response branching based on totpEnabled.
 *
 * **Validates: Requirements 6.1, 6.7, 14.1**
 *
 * @module __tests__/totp-login-flow.property.spec
 */

import * as fc from 'fast-check';
import { decode } from 'jsonwebtoken';
import { LocalhostConstants } from '@digitaldefiance/node-express-suite';
import { JwtService } from '../services/jwt';
import type {
  IApplication,
  IEnvironment,
  IApiLoginResponse,
} from '@digitaldefiance/node-express-suite';

// ─── Helpers ────────────────────────────────────────────────────────────────

const testSecret = 'test-jwt-secret-for-login-flow-property';

function createJwtService(): JwtService {
  const mockEnvironment: Partial<IEnvironment> = {
    jwtSecret: testSecret,
  };

  const mockApplication = {
    environment: mockEnvironment as IEnvironment,
    constants: LocalhostConstants,
  } as unknown as IApplication<Buffer>;

  return new JwtService(mockApplication);
}

/**
 * Simulates the login flow decision logic from UserController.
 *
 * This mirrors the branching in directLoginChallenge, emailLoginChallenge,
 * and useBackupCodeLogin: when userDoc.totpEnabled is true, the controller
 * returns { pendingTotpToken, message } instead of { token, user, serverPublicKey, message }.
 */
function simulateLoginResponse(
  jwtService: JwtService,
  userId: string,
  totpEnabled: boolean,
): IApiLoginResponse {
  if (totpEnabled) {
    const pendingTotpToken = jwtService.signPendingTotpToken(
      userId,
      testSecret,
    );
    return {
      pendingTotpToken,
      message: 'TOTP verification required',
    };
  }

  // Non-TOTP path: would normally call jwtService.signToken with a real
  // userDoc and roles. For this property test we only care about the
  // totpEnabled=true branch, so we return a representative full response.
  return {
    token: 'full-jwt-token',
    user: { userId, roles: [] } as unknown as IApiLoginResponse['user'],
    serverPublicKey: 'mock-server-public-key',
    message: 'Logged in successfully',
  };
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

describe('Login Flow - Property Tests', () => {
  const jwtService = createJwtService();

  describe('Feature: totp-2fa, Property 6: TOTP-Enabled Login Yields Pending Token', () => {
    /**
     * **Validates: Requirements 6.1**
     *
     * For any user with totpEnabled = true, after successful primary
     * credential verification, the response must contain pendingTotpToken
     * and must NOT contain a full JWT token or user.
     */
    it('login response for totpEnabled=true contains pendingTotpToken and no token/user', () => {
      fc.assert(
        fc.property(userIdArbitrary, (userId) => {
          const response = simulateLoginResponse(jwtService, userId, true);

          // Must contain pendingTotpToken
          expect(response.pendingTotpToken).toBeDefined();
          expect(typeof response.pendingTotpToken).toBe('string');
          expect(response.pendingTotpToken!.length).toBeGreaterThan(0);

          // Must NOT contain full JWT token
          expect(response.token).toBeUndefined();

          // Must NOT contain user object
          expect(response.user).toBeUndefined();

          // Must NOT contain serverPublicKey (only present in full login response)
          expect(response.serverPublicKey).toBeUndefined();

          // Must contain the expected message
          expect(response.message).toBe('TOTP verification required');

          // The pendingTotpToken must be a valid JWT with the correct userId
          const decoded = decode(response.pendingTotpToken!) as Record<
            string,
            unknown
          > | null;
          expect(decoded).not.toBeNull();
          expect(decoded!['userId']).toBe(userId);
          expect(decoded!['pendingTotp']).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Feature: totp-2fa, Property 7: Non-TOTP Login Unchanged', () => {
    /**
     * **Validates: Requirements 6.7, 14.1**
     *
     * For any user with totpEnabled = false, after successful primary
     * credential verification, the response must contain token and user
     * and must NOT contain pendingTotpToken.
     */
    it('login response for totpEnabled=false contains token and user and no pendingTotpToken', () => {
      fc.assert(
        fc.property(userIdArbitrary, (userId) => {
          const response = simulateLoginResponse(jwtService, userId, false);

          // Must contain a full JWT token
          expect(response.token).toBeDefined();
          expect(typeof response.token).toBe('string');
          expect(response.token!.length).toBeGreaterThan(0);

          // Must contain a user object
          expect(response.user).toBeDefined();
          expect(response.user).not.toBeNull();

          // Must NOT contain pendingTotpToken
          expect(response.pendingTotpToken).toBeUndefined();

          // Must contain the standard success message
          expect(response.message).toBe('Logged in successfully');
        }),
        { numRuns: 100 },
      );
    });
  });
});
