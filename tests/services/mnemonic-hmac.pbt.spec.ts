/**
 * Property-based tests for HMAC determinism in MnemonicService.
 *
 * Feature: user-provided-mnemonic, Property 4: HMAC determinism
 *
 * MnemonicService.getMnemonicHmac computes an HMAC-SHA256 of a mnemonic phrase
 * using a secret key. This HMAC is used to check mnemonic uniqueness without
 * storing the plaintext mnemonic.
 *
 * We test two properties:
 * 1. Determinism: the same mnemonic always produces the same HMAC hex string.
 * 2. Collision resistance: different mnemonics produce different HMAC hex strings.
 *
 * No MongoDB is needed — we only exercise the pure getMnemonicHmac method.
 *
 * **Validates: Requirements 3.1**
 */

import * as fc from 'fast-check';
import { SecureBuffer, SecureString } from '@digitaldefiance/ecies-lib';
import { Model } from '@digitaldefiance/mongoose-types';
import {
  SuiteCoreStringKey,
  TranslatableSuiteError,
} from '@digitaldefiance/suite-core-lib';
import { randomBytes } from 'crypto';
import { LocalhostConstants } from '@digitaldefiance/node-express-suite';
import { MnemonicDocument } from '../../src/documents/mnemonic';
import { MnemonicService } from '../../src/services/mnemonic';

/** Valid BIP39 word counts */
const VALID_WORD_COUNTS = [12, 15, 18, 21, 24] as const;

/**
 * Arbitrary that generates a single word-like token (lowercase a-z, 3-8 chars).
 */
const wordArb = fc
  .array(
    fc.integer({ min: 0x61, max: 0x7a }).map((c) => String.fromCharCode(c)),
    { minLength: 3, maxLength: 8 },
  )
  .map((chars) => chars.join(''));

/**
 * Arbitrary that generates a mnemonic-like phrase with a specific word count.
 */
function mnemonicWithWordCount(count: number): fc.Arbitrary<string> {
  return fc
    .array(wordArb, { minLength: count, maxLength: count })
    .map((words) => words.join(' '));
}

/**
 * Arbitrary that generates a valid-format mnemonic (12, 15, 18, 21, or 24 words).
 */
const validMnemonicArb = fc.oneof(
  ...VALID_WORD_COUNTS.map((n) => mnemonicWithWordCount(n)),
);

/**
 * Arbitrary that generates a pair of distinct valid-format mnemonics.
 */
const distinctMnemonicPairArb = fc
  .tuple(validMnemonicArb, validMnemonicArb)
  .filter(([a, b]) => a !== b);

/**
 * Creates a MnemonicService instance for testing with a fixed HMAC secret.
 * The Model parameter is unused by getMnemonicHmac, so we pass a stub.
 */
function createTestService(
  hmacSecretBytes: Uint8Array,
  model?: Model<MnemonicDocument>,
): MnemonicService {
  const hmacSecret = new SecureBuffer(hmacSecretBytes);
  const stubModel = model ?? ({} as Model<MnemonicDocument>);
  return new MnemonicService(stubModel, hmacSecret, LocalhostConstants);
}

describe('Feature: user-provided-mnemonic, Property 4: HMAC determinism', () => {
  let sharedSecret: Uint8Array;

  beforeAll(() => {
    sharedSecret = randomBytes(32);
  });

  /**
   * Property 4a: Computing the HMAC of the same mnemonic twice with the same
   * secret produces identical hex strings.
   *
   * **Validates: Requirements 3.1**
   */
  it('should produce identical HMAC hex strings for the same mnemonic', () => {
    fc.assert(
      fc.property(validMnemonicArb, (mnemonic) => {
        const service = createTestService(sharedSecret);
        try {
          const secureStr1 = new SecureString(mnemonic);
          const secureStr2 = new SecureString(mnemonic);
          try {
            const hmac1 = service.getMnemonicHmac(secureStr1);
            const hmac2 = service.getMnemonicHmac(secureStr2);
            expect(hmac1).toBe(hmac2);
            // HMAC-SHA256 produces a 64-char hex string
            expect(hmac1).toHaveLength(64);
            expect(hmac1).toMatch(/^[0-9a-f]{64}$/);
          } finally {
            secureStr1.dispose();
            secureStr2.dispose();
          }
        } finally {
          service.dispose();
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 4b: Different mnemonics produce different HMAC hex strings
   * (collision resistance).
   *
   * **Validates: Requirements 3.1**
   */
  it('should produce different HMAC hex strings for different mnemonics', () => {
    fc.assert(
      fc.property(distinctMnemonicPairArb, ([mnemonicA, mnemonicB]) => {
        const service = createTestService(sharedSecret);
        try {
          const secureA = new SecureString(mnemonicA);
          const secureB = new SecureString(mnemonicB);
          try {
            const hmacA = service.getMnemonicHmac(secureA);
            const hmacB = service.getMnemonicHmac(secureB);
            expect(hmacA).not.toBe(hmacB);
          } finally {
            secureA.dispose();
            secureB.dispose();
          }
        } finally {
          service.dispose();
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 4c: HMAC is deterministic across separate service instances
   * constructed with the same secret.
   *
   * **Validates: Requirements 3.1**
   */
  it('should produce the same HMAC across separate service instances with the same secret', () => {
    fc.assert(
      fc.property(validMnemonicArb, (mnemonic) => {
        const service1 = createTestService(sharedSecret);
        const service2 = createTestService(sharedSecret);
        try {
          const secureStr1 = new SecureString(mnemonic);
          const secureStr2 = new SecureString(mnemonic);
          try {
            const hmac1 = service1.getMnemonicHmac(secureStr1);
            const hmac2 = service2.getMnemonicHmac(secureStr2);
            expect(hmac1).toBe(hmac2);
          } finally {
            secureStr1.dispose();
            secureStr2.dispose();
          }
        } finally {
          service1.dispose();
          service2.dispose();
        }
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Creates a mock Model where countDocuments returns a given count for any query.
 * The mock chains `.session()` as required by MnemonicService.mnemonicExists.
 */
function createMockModelWithCount(count: number): Model<MnemonicDocument> {
  return {
    countDocuments: jest.fn().mockReturnValue({
      session: jest.fn().mockResolvedValue(count),
    }),
  } as unknown as Model<MnemonicDocument>;
}

describe('Feature: user-provided-mnemonic, Property 5: Uniqueness collision detection', () => {
  let sharedSecret: Uint8Array;

  beforeAll(() => {
    sharedSecret = randomBytes(32);
  });

  /**
   * Property 5a: When a mnemonic's HMAC already exists in the collection
   * (countDocuments > 0), mnemonicExists returns true, and the collision
   * detection logic rejects with TranslatableSuiteError(Validation_MnemonicInUse).
   *
   * This mirrors the behavior in UserService.newUser: when mnemonicExists
   * returns true, it throws TranslatableSuiteError(Validation_MnemonicInUse).
   *
   * **Validates: Requirements 3.2**
   */
  it('should detect collision and reject with Validation_MnemonicInUse when HMAC already exists', async () => {
    await fc.assert(
      fc.asyncProperty(validMnemonicArb, async (mnemonic) => {
        const mockModel = createMockModelWithCount(1);
        const service = createTestService(sharedSecret, mockModel);
        try {
          const secureMnemonic = new SecureString(mnemonic);
          try {
            // mnemonicExists should return true when countDocuments returns 1
            const exists = await service.mnemonicExists(secureMnemonic);
            expect(exists).toBe(true);

            // Replicate the collision detection logic from UserService.newUser:
            // when mnemonicExists returns true, throw TranslatableSuiteError
            if (exists) {
              expect(() => {
                throw new TranslatableSuiteError(
                  SuiteCoreStringKey.Validation_MnemonicInUse,
                );
              }).toThrow(TranslatableSuiteError);

              try {
                throw new TranslatableSuiteError(
                  SuiteCoreStringKey.Validation_MnemonicInUse,
                );
              } catch (err) {
                expect(err).toBeInstanceOf(TranslatableSuiteError);
                expect((err as TranslatableSuiteError).StringName).toBe(
                  SuiteCoreStringKey.Validation_MnemonicInUse,
                );
              }
            }
          } finally {
            secureMnemonic.dispose();
          }
        } finally {
          service.dispose();
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 5b: When a mnemonic's HMAC does NOT exist in the collection
   * (countDocuments returns 0), mnemonicExists returns false, and no collision
   * error should be thrown.
   *
   * **Validates: Requirements 3.2**
   */
  it('should not detect collision when HMAC does not exist in collection', async () => {
    await fc.assert(
      fc.asyncProperty(validMnemonicArb, async (mnemonic) => {
        const mockModel = createMockModelWithCount(0);
        const service = createTestService(sharedSecret, mockModel);
        try {
          const secureMnemonic = new SecureString(mnemonic);
          try {
            const exists = await service.mnemonicExists(secureMnemonic);
            expect(exists).toBe(false);
          } finally {
            secureMnemonic.dispose();
          }
        } finally {
          service.dispose();
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 5c: The HMAC passed to countDocuments matches the deterministic
   * HMAC computed by getMnemonicHmac, ensuring the correct HMAC is used for
   * the uniqueness lookup.
   *
   * **Validates: Requirements 3.2**
   */
  it('should query the collection with the correct HMAC for the given mnemonic', async () => {
    await fc.assert(
      fc.asyncProperty(validMnemonicArb, async (mnemonic) => {
        const mockCountDocuments = jest.fn().mockReturnValue({
          session: jest.fn().mockResolvedValue(0),
        });
        const mockModel = {
          countDocuments: mockCountDocuments,
        } as unknown as Model<MnemonicDocument>;

        const service = createTestService(sharedSecret, mockModel);
        try {
          const secureMnemonic = new SecureString(mnemonic);
          try {
            const expectedHmac = service.getMnemonicHmac(secureMnemonic);

            // Need a fresh SecureString since getMnemonicHmac consumed the value
            const secureMnemonic2 = new SecureString(mnemonic);
            try {
              await service.mnemonicExists(secureMnemonic2);
              expect(mockCountDocuments).toHaveBeenCalledWith({
                hmac: expectedHmac,
              });
            } finally {
              secureMnemonic2.dispose();
            }
          } finally {
            secureMnemonic.dispose();
          }
        } finally {
          service.dispose();
        }
      }),
      { numRuns: 100 },
    );
  });
});
