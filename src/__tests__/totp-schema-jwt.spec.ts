/**
 * Unit tests for TOTP schema extensions and JwtService pending token.
 *
 * Schema tests validate:
 * - totpEnabled=true without totpSecret fails validation (Req 1.5)
 * - Default values are correct (Req 1.4, 1.6)
 * - Backward compatibility with no TOTP fields (Req 14.2)
 *
 * JwtService tests validate:
 * - Pending token contains correct claims and expiry (Req 6.2, 12.2)
 *
 * @module __tests__/totp-schema-jwt.spec
 */

import {
  clearMemoryDB,
  connectMemoryDB,
  disconnectMemoryDB,
} from '@digitaldefiance/express-suite-test-utils';
import { LanguageCodes } from '@digitaldefiance/i18n-lib';
import mongoose, { Model, Types } from '@digitaldefiance/mongoose-types';
import { AccountStatus } from '@digitaldefiance/suite-core-lib';
import { decode, verify } from 'jsonwebtoken';
import {
  IApplication,
  IEnvironment,
  LocalhostConstants,
} from '@digitaldefiance/node-express-suite';
import { IUserDocument } from '../documents/user';
import { createUserSchema } from '../schemas/user';
import { JwtService } from '../services/jwt';

// ─── Schema Tests ───────────────────────────────────────────────────────────

describe('User Schema - TOTP fields', () => {
  let UserModel: Model<IUserDocument>;

  const validUserData = {
    username: 'testuser',
    email: 'test@example.com',
    publicKey: '04' + 'a'.repeat(128),
    timezone: 'America/New_York',
    siteLanguage: LanguageCodes.EN_US,
    accountStatus: AccountStatus.Active,
    displayName: 'Test User',
    createdBy: new Types.ObjectId(),
    updatedBy: new Types.ObjectId(),
  };

  beforeAll(async () => {
    await connectMemoryDB();
    const schema = createUserSchema();
    UserModel = mongoose.model<IUserDocument>('TotpSchemaTest', schema);
  }, 30000);

  afterAll(async () => {
    await mongoose.connection.dropCollection('totpschematests').catch(() => {});
    await disconnectMemoryDB();
  }, 30000);

  afterEach(async () => {
    await clearMemoryDB();
  });

  /**
   * **Validates: Requirement 1.5**
   * WHEN totpEnabled is true, THE UserDocument SHALL require totpSecret to be present and non-empty.
   */
  describe('totpEnabled=true without totpSecret fails validation', () => {
    it('should reject when totpEnabled is true and totpSecret is absent', async () => {
      const user = new UserModel({
        ...validUserData,
        totpEnabled: true,
      });

      await expect(user.validate()).rejects.toThrow();
    });

    it('should reject when totpEnabled is true and totpSecret is empty string', async () => {
      const user = new UserModel({
        ...validUserData,
        totpEnabled: true,
        totpSecret: '',
      });

      await expect(user.validate()).rejects.toThrow();
    });

    it('should reject when totpEnabled is true and totpSecret is whitespace-only', async () => {
      const user = new UserModel({
        ...validUserData,
        totpEnabled: true,
        totpSecret: '   ',
      });

      await expect(user.validate()).rejects.toThrow();
    });

    it('should include totpSecret in validation errors when totpEnabled is true without secret', async () => {
      const user = new UserModel({
        ...validUserData,
        totpEnabled: true,
      });

      try {
        await user.validate();
        fail('Should have thrown validation error');
      } catch (error: unknown) {
        const mongooseError = error as { errors: Record<string, unknown> };
        expect(mongooseError.errors['totpSecret']).toBeDefined();
      }
    });

    it('should accept when totpEnabled is true and totpSecret is present', async () => {
      const user = new UserModel({
        ...validUserData,
        totpEnabled: true,
        totpSecret: 'JBSWY3DPEHPK3PXP',
      });

      await expect(user.validate()).resolves.not.toThrow();
    });
  });

  /**
   * **Validates: Requirements 1.4, 1.6**
   * WHEN totpEnabled is false, totpSecret may be absent.
   * THE createUserSchema factory SHALL include totpEnabled defaulting to false.
   */
  describe('default values are correct', () => {
    it('should default totpEnabled to false', () => {
      const user = new UserModel(validUserData);
      expect(user.get('totpEnabled')).toBe(false);
    });

    it('should default totpSecret to undefined', () => {
      const user = new UserModel(validUserData);
      expect(user.get('totpSecret')).toBeUndefined();
    });

    it('should default totpPendingSecret to undefined', () => {
      const user = new UserModel(validUserData);
      expect(user.get('totpPendingSecret')).toBeUndefined();
    });

    it('should pass validation with totpEnabled=false and no totpSecret', async () => {
      const user = new UserModel({
        ...validUserData,
        totpEnabled: false,
      });

      await expect(user.validate()).resolves.not.toThrow();
    });
  });

  /**
   * **Validates: Requirement 14.2**
   * THE createUserSchema factory SHALL remain backward compatible:
   * existing callers that do not pass TOTP-related options SHALL receive
   * a schema with totpEnabled defaulting to false and totpSecret absent.
   */
  describe('backward compatibility with no TOTP fields', () => {
    it('should validate successfully without any TOTP fields provided', async () => {
      const user = new UserModel(validUserData);
      await expect(user.validate()).resolves.not.toThrow();
    });

    it('should have totpEnabled path defined on the schema', () => {
      const schema = createUserSchema();
      expect(schema.path('totpEnabled')).toBeDefined();
    });

    it('should have totpSecret path defined on the schema', () => {
      const schema = createUserSchema();
      expect(schema.path('totpSecret')).toBeDefined();
    });

    it('should have totpPendingSecret path defined on the schema', () => {
      const schema = createUserSchema();
      expect(schema.path('totpPendingSecret')).toBeDefined();
    });

    it('should not require totpSecret when totpEnabled is not set', async () => {
      const user = new UserModel(validUserData);
      expect(user.get('totpEnabled')).toBe(false);
      expect(user.get('totpSecret')).toBeUndefined();
      await expect(user.validate()).resolves.not.toThrow();
    });

    it('should allow totpPendingSecret to be set independently', async () => {
      const user = new UserModel({
        ...validUserData,
        totpPendingSecret: 'PENDING_SECRET_VALUE',
      });

      await expect(user.validate()).resolves.not.toThrow();
      expect(user.get('totpPendingSecret')).toBe('PENDING_SECRET_VALUE');
    });
  });
});

// ─── JwtService Pending Token Tests ─────────────────────────────────────────

describe('JwtService - signPendingTotpToken unit tests', () => {
  const testSecret = 'test-jwt-secret-for-unit-tests';
  let jwtService: JwtService;

  beforeEach(() => {
    const mockEnvironment: Partial<IEnvironment> = {
      jwtSecret: testSecret,
    };

    const mockApplication = {
      environment: mockEnvironment as IEnvironment,
      constants: LocalhostConstants,
    } as unknown as IApplication<never>;

    jwtService = new JwtService(mockApplication);
  });

  /**
   * **Validates: Requirements 6.2, 12.2**
   * THE Pending_TOTP_Token SHALL contain only the user's ID and a pendingTotp: true claim.
   */
  describe('pending token contains correct claims', () => {
    it('should produce a token with the exact expected claims for a known userId', () => {
      const userId = '507f1f77bcf86cd799439011';
      const token = jwtService.signPendingTotpToken(userId, testSecret);

      const payload = decode(token) as Record<string, unknown>;

      expect(payload).not.toBeNull();
      expect(payload['userId']).toBe('507f1f77bcf86cd799439011');
      expect(payload['pendingTotp']).toBe(true);
      expect(payload['iat']).toBeDefined();
      expect(payload['exp']).toBeDefined();

      // Only expected keys: userId, pendingTotp, iat, exp
      const keys = Object.keys(payload);
      expect(keys).toHaveLength(4);
      expect(keys.sort()).toEqual(['exp', 'iat', 'pendingTotp', 'userId']);
    });

    it('should not contain roles or privilege claims', () => {
      const token = jwtService.signPendingTotpToken('someUserId', testSecret);

      const payload = decode(token) as Record<string, unknown>;

      expect(payload['roles']).toBeUndefined();
      expect(payload['role']).toBeUndefined();
      expect(payload['permissions']).toBeUndefined();
      expect(payload['scope']).toBeUndefined();
      expect(payload['admin']).toBeUndefined();
    });
  });

  /**
   * **Validates: Requirement 12.2**
   * THE Pending_TOTP_Token SHALL expire within 10 minutes of issuance.
   */
  describe('pending token expiry', () => {
    it('should have an expiry of exactly 600 seconds', () => {
      const token = jwtService.signPendingTotpToken('testUserId', testSecret);

      const payload = decode(token) as Record<string, unknown>;
      const iat = payload['iat'] as number;
      const exp = payload['exp'] as number;

      expect(exp - iat).toBe(600);
    });
  });

  /**
   * **Validates: Requirement 12.2**
   * Token can be verified with the same secret.
   */
  describe('pending token verification', () => {
    it('should be verifiable with the same secret', () => {
      const userId = '507f1f77bcf86cd799439011';
      const token = jwtService.signPendingTotpToken(userId, testSecret);

      const verified = verify(token, testSecret, {
        algorithms: [LocalhostConstants.JWT.ALGORITHM],
      }) as Record<string, unknown>;

      expect(verified['userId']).toBe(userId);
      expect(verified['pendingTotp']).toBe(true);
    });

    it('should fail verification with a different secret', () => {
      const token = jwtService.signPendingTotpToken('testUserId', testSecret);

      expect(() =>
        verify(token, 'wrong-secret', {
          algorithms: [LocalhostConstants.JWT.ALGORITHM],
        }),
      ).toThrow();
    });
  });
});
