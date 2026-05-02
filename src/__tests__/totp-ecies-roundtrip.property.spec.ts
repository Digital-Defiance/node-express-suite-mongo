/**
 * Property-Based Tests for ECIES Encryption Round-Trip of TOTP Secrets
 *
 * Feature: totp-2fa, Property 10: ECIES Encryption Round-Trip for TOTP Secret
 * Uses fast-check to validate that encrypting a TOTP secret with a member's
 * ECIES public key and decrypting it yields the original base32 string.
 *
 * **Validates: Requirements 13.1**
 *
 * @module __tests__/totp-ecies-roundtrip.property.spec
 */

import * as fc from 'fast-check';
import { EmailString } from '@digitaldefiance/ecies-lib';
import { MemberType } from '@digitaldefiance/ecies-lib';
import {
  Member as BackendMember,
  ECIESService,
} from '@digitaldefiance/node-ecies-lib';
import { TotpService } from '@digitaldefiance/node-express-suite';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a BackendMember with a fresh key pair for ECIES encrypt/decrypt.
 * This mirrors how the system user is created in SystemUserService.
 */
function createTestMember(): BackendMember {
  const eciesService = new ECIESService();
  const { member } = BackendMember.newMember(
    eciesService,
    MemberType.System,
    'TestSystemUser',
    new EmailString('test@example.com'),
  );
  return member;
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Base32 alphabet used by TOTP secrets (RFC 4648).
 */
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Arbitrary for base32-encoded TOTP secrets.
 * Generates strings of length 32 (160 bits / 5 bits per char = 32 chars),
 * matching the output of TotpService.generateSecret().
 */
const base32SecretArbitrary = fc
  .array(fc.constantFrom(...BASE32_CHARS.split('')), {
    minLength: 32,
    maxLength: 32,
  })
  .map((chars) => chars.join(''));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ECIES Encryption Round-Trip - Property Tests', () => {
  const member = createTestMember();
  const totpService = new TotpService();

  describe('Feature: totp-2fa, Property 10: ECIES Encryption Round-Trip for TOTP Secret', () => {
    /**
     * **Validates: Requirements 13.1**
     *
     * For any generated TOTP secret, encrypting it with a member's ECIES
     * public key via encryptData() and then decrypting with decryptData()
     * SHALL yield the original base32 secret string.
     *
     * This mirrors the exact pattern used in UserController:
     *   encrypt: member.encryptData(Buffer.from(secret, 'utf-8'), member.publicKey) → hex
     *   decrypt: member.decryptData(Buffer.from(hex, 'hex')).toString('utf-8') → secret
     */
    it('encrypt then decrypt round-trip preserves the original TOTP secret (generated secrets)', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          // Generate a real TOTP secret using TotpService (same as production)
          const secret = totpService.generateSecret();

          // Encrypt with the member's public key (mirrors controller pattern)
          const encryptedBuffer = member.encryptData(
            Buffer.from(secret, 'utf-8'),
            member.publicKey,
          );

          // Store as hex string (mirrors how it's stored in MongoDB)
          const encryptedHex = encryptedBuffer.toString('hex');

          // Decrypt from hex (mirrors controller decryption pattern)
          const decryptedBuffer = member.decryptData(
            Buffer.from(encryptedHex, 'hex'),
          );
          const decryptedSecret = decryptedBuffer.toString('utf-8');

          // Round-trip must preserve the original secret
          expect(decryptedSecret).toBe(secret);
        }),
        { numRuns: 100 },
      );
    });

    it('encrypt then decrypt round-trip preserves arbitrary base32 secrets', () => {
      fc.assert(
        fc.property(base32SecretArbitrary, (secret) => {
          // Encrypt with the member's public key (mirrors controller pattern)
          const encryptedBuffer = member.encryptData(
            Buffer.from(secret, 'utf-8'),
            member.publicKey,
          );

          // Store as hex string (mirrors how it's stored in MongoDB)
          const encryptedHex = encryptedBuffer.toString('hex');

          // Decrypt from hex (mirrors controller decryption pattern)
          const decryptedBuffer = member.decryptData(
            Buffer.from(encryptedHex, 'hex'),
          );
          const decryptedSecret = decryptedBuffer.toString('utf-8');

          // Round-trip must preserve the original secret
          expect(decryptedSecret).toBe(secret);
        }),
        { numRuns: 100 },
      );
    });
  });
});
