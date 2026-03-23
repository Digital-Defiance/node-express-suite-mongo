import {
  clearMemoryDB,
  connectMemoryDB,
  disconnectMemoryDB,
} from '@digitaldefiance/express-suite-test-utils';
import { LanguageCodes } from '@digitaldefiance/i18n-lib';
import mongoose, { Model, Types } from '@digitaldefiance/mongoose-types';
import { AccountStatus } from '@digitaldefiance/suite-core-lib';
import { IUserDocument } from '../../src/documents/user';
import { createUserSchema } from '../../src/schemas/user';

describe('UserSchema validation with Mongoose', () => {
  let UserModel: Model<IUserDocument>;

  beforeAll(async () => {
    await connectMemoryDB();
    const schema = createUserSchema();
    UserModel = mongoose.model<IUserDocument>('UserValidation', schema);
  }, 30000); // Increase timeout for connection

  afterAll(async () => {
    await mongoose.connection.dropCollection('uservalidations').catch(() => {});
    await disconnectMemoryDB();
  }, 30000); // Increase timeout for cleanup

  afterEach(async () => {
    await clearMemoryDB();
  });

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

  describe('username validation', () => {
    it('should accept valid username', async () => {
      const user = new UserModel(validUserData);
      await expect(user.validate()).resolves.not.toThrow();
    });

    it('should reject invalid username pattern', async () => {
      const user = new UserModel({
        ...validUserData,
        username: 'invalid username with spaces',
      });

      await expect(user.validate()).rejects.toThrow();
    });

    it('should require username', async () => {
      const user = new UserModel({
        ...validUserData,
        username: undefined,
      });

      await expect(user.validate()).rejects.toThrow();
    });
  });

  describe('email validation', () => {
    it('should accept valid email', async () => {
      const user = new UserModel(validUserData);
      await expect(user.validate()).resolves.not.toThrow();
    });

    it('should reject invalid email format', async () => {
      const user = new UserModel({
        ...validUserData,
        email: 'not-an-email',
      });

      await expect(user.validate()).rejects.toThrow();
    });

    it('should require email', async () => {
      const user = new UserModel({
        ...validUserData,
        email: undefined,
      });

      await expect(user.validate()).rejects.toThrow();
    });
  });

  describe('timezone validation', () => {
    it('should accept valid timezone', async () => {
      const user = new UserModel({
        ...validUserData,
        timezone: 'Europe/London',
      });
      await expect(user.validate()).resolves.not.toThrow();
    });

    it('should reject invalid timezone', async () => {
      const user = new UserModel({
        ...validUserData,
        timezone: 'Invalid/Timezone',
      });

      await expect(user.validate()).rejects.toThrow();
    });

    it('should use UTC as default', async () => {
      const user = new UserModel({
        ...validUserData,
        timezone: undefined,
      });

      expect(user.timezone).toBe('UTC');
    });
  });

  describe('siteLanguage validation', () => {
    it('should accept valid language code', async () => {
      const user = new UserModel({
        ...validUserData,
        siteLanguage: LanguageCodes.ES_ES,
      });
      await expect(user.validate()).resolves.not.toThrow();
    });

    it('should reject invalid language code', async () => {
      const user = new UserModel({
        ...validUserData,
        siteLanguage: 'invalid-lang' as any,
      });

      await expect(user.validate()).rejects.toThrow();
    });

    it('should default to EN_US', () => {
      const user = new UserModel({
        ...validUserData,
        siteLanguage: undefined,
      });

      expect(user.siteLanguage).toBe(LanguageCodes.EN_US);
    });
  });

  describe('accountStatus validation', () => {
    it('should accept valid account status', async () => {
      const user = new UserModel({
        ...validUserData,
        accountStatus: AccountStatus.Locked,
      });
      await expect(user.validate()).resolves.not.toThrow();
    });

    it('should reject invalid account status', async () => {
      const user = new UserModel({
        ...validUserData,
        accountStatus: 'InvalidStatus' as any,
      });

      await expect(user.validate()).rejects.toThrow();
    });

    it('should default to PendingEmailVerification', () => {
      const user = new UserModel({
        ...validUserData,
        accountStatus: undefined,
      });

      expect(user.accountStatus).toBe(AccountStatus.PendingEmailVerification);
    });
  });

  describe('timestamps', () => {
    it('should automatically add createdAt and updatedAt', async () => {
      // Ensure we have a fresh connection and the collection exists
      await mongoose.connection
        .createCollection('uservalidations')
        .catch(() => {});

      const user = new UserModel(validUserData);
      await user.save();

      expect(user.createdAt).toBeDefined();
      expect(user.updatedAt).toBeDefined();
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    }, 30000);
  });

  describe('custom validation messages', () => {
    it('should use custom username validation message', async () => {
      const customMsg = () => 'Custom username error message';
      const schema = createUserSchema(customMsg);
      const CustomModel = mongoose.model<IUserDocument>(
        'UserCustomUsername',
        schema,
      );

      const user = new CustomModel({
        ...validUserData,
        username: '!!!invalid!!!',
      });

      try {
        await user.validate();
        fail('Should have thrown validation error');
      } catch (error: any) {
        expect(error.errors.username).toBeDefined();
      }

      await mongoose.connection
        .dropCollection('usercustomusernames')
        .catch(() => {});
      mongoose.deleteModel('UserCustomUsername');
    }, 30000);

    it('should use custom email validation message', async () => {
      const customMsg = () => 'Custom email error message';
      const schema = createUserSchema(undefined, customMsg);
      const CustomModel = mongoose.model<IUserDocument>(
        'UserCustomEmail',
        schema,
      );

      const user = new CustomModel({
        ...validUserData,
        email: 'not-an-email',
      });

      try {
        await user.validate();
        fail('Should have thrown validation error');
      } catch (error: any) {
        expect(error.errors.email).toBeDefined();
      }

      await mongoose.connection
        .dropCollection('usercustomemails')
        .catch(() => {});
      mongoose.deleteModel('UserCustomEmail');
    }, 30000);

    it('should use custom timezone validation message', async () => {
      const customMsg = () => 'Custom timezone error message';
      const schema = createUserSchema(undefined, undefined, customMsg);
      const CustomModel = mongoose.model<IUserDocument>(
        'UserCustomTimezone',
        schema,
      );

      const user = new CustomModel({
        ...validUserData,
        timezone: 'Bad/Timezone',
      });

      try {
        await user.validate();
        fail('Should have thrown validation error');
      } catch (error: any) {
        expect(error.errors.timezone).toBeDefined();
      }

      await mongoose.connection
        .dropCollection('usercustomtimezones')
        .catch(() => {});
      mongoose.deleteModel('UserCustomTimezone');
    }, 30000);
  });

  describe('unsupported languages', () => {
    it('should accept only specified languages', async () => {
      const customLangs = ['en', 'es', 'fr'];
      const schema = createUserSchema(
        undefined,
        undefined,
        undefined,
        undefined,
        customLangs,
      );
      const CustomModel = mongoose.model<IUserDocument>(
        'UserCustomLangs',
        schema,
      );

      const validUser = new CustomModel({
        ...validUserData,
        siteLanguage: 'es' as any,
      });
      await expect(validUser.validate()).resolves.not.toThrow();

      const invalidUser = new CustomModel({
        ...validUserData,
        siteLanguage: 'de' as any,
      });
      await expect(invalidUser.validate()).rejects.toThrow();

      await mongoose.connection
        .dropCollection('usercustomlangs')
        .catch(() => {});
      mongoose.deleteModel('UserCustomLangs');
    }, 30000);
  });

  describe('boolean defaults', () => {
    it('should default directChallenge to true', () => {
      const user = new UserModel(validUserData);
      expect(user.directChallenge).toBe(true);
    });

    it('should default emailVerified to false', () => {
      const user = new UserModel(validUserData);
      expect(user.emailVerified).toBe(false);
    });
  });

  describe('optional fields', () => {
    it('should allow optional lastLogin', async () => {
      const user = new UserModel(validUserData);
      expect(user.lastLogin).toBeUndefined();
      await expect(user.validate()).resolves.not.toThrow();
    });

    it('should allow optional mnemonicId', async () => {
      const user = new UserModel(validUserData);
      expect(user.mnemonicId).toBeUndefined();
      await expect(user.validate()).resolves.not.toThrow();
    });

    it('should allow optional mnemonicRecovery', async () => {
      const user = new UserModel(validUserData);
      expect(user.mnemonicRecovery).toBeUndefined();
      await expect(user.validate()).resolves.not.toThrow();
    });

    it('should allow optional passwordWrappedPrivateKey', async () => {
      const user = new UserModel(validUserData);
      expect(user.passwordWrappedPrivateKey).toBeUndefined();
      await expect(user.validate()).resolves.not.toThrow();
    });

    it('should allow passwordWrappedPrivateKey with all required nested fields', async () => {
      const user = new UserModel({
        ...validUserData,
        passwordWrappedPrivateKey: {
          salt: 'salt123',
          iv: 'iv123',
          authTag: 'tag123',
          ciphertext: 'cipher123',
          iterations: 100000,
        },
      });
      await expect(user.validate()).resolves.not.toThrow();
    });
  });

  describe('backupCodes array', () => {
    it('should default to empty array', () => {
      const user = new UserModel(validUserData);
      expect(user.backupCodes).toEqual([]);
    });

    it('should accept valid backup codes', async () => {
      const user = new UserModel({
        ...validUserData,
        backupCodes: [
          {
            version: '1.0',
            checksumSalt: 'salt1',
            checksum: 'check1',
            encrypted: 'enc1',
          },
          {
            version: '1.0',
            checksumSalt: 'salt2',
            checksum: 'check2',
            encrypted: 'enc2',
          },
        ],
      });

      await expect(user.validate()).resolves.not.toThrow();
      expect(user.backupCodes.length).toBe(2);
    });
  });
});
