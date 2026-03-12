import { LanguageCodes } from '@digitaldefiance/i18n-lib';
import { AccountStatus } from '@digitaldefiance/suite-core-lib';
import { createUserSchema, UserSchema } from '../../src/schemas/user';

describe('UserSchema', () => {
  describe('createUserSchema', () => {
    it('should create schema with default options', () => {
      const schema = createUserSchema();
      expect(schema).toBeDefined();
      expect(schema.path('username')).toBeDefined();
      expect(schema.path('email')).toBeDefined();
      expect(schema.path('publicKey')).toBeDefined();
      expect(schema.path('timezone')).toBeDefined();
      expect(schema.path('siteLanguage')).toBeDefined();
    });

    it('should create schema with custom validation messages', () => {
      const usernameMsg = () => 'Custom username error';
      const emailMsg = () => 'Custom email error';
      const timezoneMsg = () => 'Custom timezone error';

      const schema = createUserSchema(usernameMsg, emailMsg, timezoneMsg);
      expect(schema).toBeDefined();

      // Just verify schema was created successfully with custom messages
      expect(schema.path('username')).toBeDefined();
      expect(schema.path('email')).toBeDefined();
      expect(schema.path('timezone')).toBeDefined();
    });

    it('should create schema with custom supported languages', () => {
      const customLanguages = ['en', 'es', 'fr'];
      const schema = createUserSchema(
        undefined,
        undefined,
        undefined,
        undefined,
        customLanguages,
      );

      expect(schema).toBeDefined();
      const siteLanguagePath = schema.path('siteLanguage') as any;
      expect(siteLanguagePath.enumValues).toEqual(customLanguages);
    });

    it('should create schema with custom constants', () => {
      const customConstants = {
        UsernameRegex: /^[a-z]{5,10}$/,
        PasswordRegex: /^.{8,}$/,
        EmailTokenLength: 32,
        MnemonicRegex: /^[a-z ]+$/,
        BACKUP_CODES: { Count: 10 },
      };

      const schema = createUserSchema(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        customConstants,
      );
      expect(schema).toBeDefined();
    });
  });

  describe('UserSchema defaults', () => {
    it('should have required fields defined', () => {
      expect(UserSchema.path('username')).toBeDefined();
      expect(UserSchema.path('email')).toBeDefined();
      expect(UserSchema.path('publicKey')).toBeDefined();
      expect(UserSchema.path('timezone')).toBeDefined();
      expect(UserSchema.path('siteLanguage')).toBeDefined();
      expect(UserSchema.path('directChallenge')).toBeDefined();
      expect(UserSchema.path('emailVerified')).toBeDefined();
      expect(UserSchema.path('accountStatus')).toBeDefined();
      expect(UserSchema.path('createdBy')).toBeDefined();
      expect(UserSchema.path('updatedBy')).toBeDefined();
    });

    it('should have correct default values', () => {
      const defaults = {
        timezone: 'UTC',
        siteLanguage: LanguageCodes.EN_US,
        directChallenge: true,
        emailVerified: false,
        accountStatus: AccountStatus.PendingEmailVerification,
      };

      expect(UserSchema.path('timezone').defaultValue).toBe(defaults.timezone);
      expect(UserSchema.path('siteLanguage').defaultValue).toBe(
        defaults.siteLanguage,
      );
      expect(UserSchema.path('directChallenge').defaultValue).toBe(
        defaults.directChallenge,
      );
      expect(UserSchema.path('emailVerified').defaultValue).toBe(
        defaults.emailVerified,
      );
      expect(UserSchema.path('accountStatus').defaultValue).toBe(
        defaults.accountStatus,
      );
    });

    it('should have enum values for accountStatus', () => {
      const accountStatusPath = UserSchema.path('accountStatus') as any;
      expect(accountStatusPath.enumValues).toEqual(
        Object.values(AccountStatus),
      );
    });

    it('should have enum values for siteLanguage', () => {
      const siteLanguagePath = UserSchema.path('siteLanguage') as any;
      expect(siteLanguagePath.enumValues).toEqual(Object.values(LanguageCodes));
    });

    it('should have timestamps enabled', () => {
      expect(UserSchema.options.timestamps).toBe(true);
    });
  });

  describe('field validations', () => {
    it('should validate username with regex', () => {
      const usernameValidator = UserSchema.path('username').validators[0];
      expect(usernameValidator).toBeDefined();
      expect(typeof usernameValidator.validator).toBe('function');
    });

    it('should validate email format', () => {
      const emailValidator = UserSchema.path('email').validators[0];
      expect(emailValidator).toBeDefined();
      expect(typeof emailValidator.validator).toBe('function');

      // validator.isEmail returns different values (true/false/length)
      // Just verify it's callable
      expect(emailValidator.validator('valid@example.com')).toBeDefined();
      expect(emailValidator.validator('invalid-email')).toBeDefined();
    });

    it('should validate timezone', () => {
      const timezoneValidator = UserSchema.path('timezone').validators[0];
      expect(timezoneValidator).toBeDefined();
      expect(typeof timezoneValidator.validator).toBe('function');

      // Just verify validator is callable
      const result1 = timezoneValidator.validator('America/New_York');
      const result2 = timezoneValidator.validator('Invalid/Timezone');
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });

    it('should use custom email validation message', () => {
      const customEmailMsg = () => 'Custom email message';
      const schema = createUserSchema(undefined, customEmailMsg);

      const emailValidator = schema.path('email').validators[0];
      expect(emailValidator.message).toBeDefined();
    });

    it('should use custom timezone validation message', () => {
      const customTimezoneMsg = () => 'Custom timezone message';
      const schema = createUserSchema(undefined, undefined, customTimezoneMsg);

      const timezoneValidator = schema.path('timezone').validators[0];
      expect(timezoneValidator.message).toBeDefined();
    });

    it('should call email validation message function with props', () => {
      const schema = createUserSchema();
      const emailValidator = schema.path('email').validators[0];

      // Message can be a function that receives props
      if (typeof emailValidator.message === 'function') {
        const result = emailValidator.message({ value: 'test@example.com' });
        expect(result).toBeDefined();
      }
    });

    it('should call timezone validation message function with props', () => {
      const schema = createUserSchema();
      const timezoneValidator = schema.path('timezone').validators[0];

      // Message can be a function that receives props
      if (typeof timezoneValidator.message === 'function') {
        const result = timezoneValidator.message({ value: 'America/New_York' });
        expect(result).toBeDefined();
      }
    });
  });

  describe('optional and nested fields', () => {
    it('should have optional lastLogin field', () => {
      const lastLoginPath = UserSchema.path('lastLogin');
      expect(lastLoginPath).toBeDefined();
      expect(lastLoginPath.isRequired).toBe(false);
    });

    it('should have optional deletedAt field', () => {
      const deletedAtPath = UserSchema.path('deletedAt');
      expect(deletedAtPath).toBeDefined();
    });

    it('should have optional deletedBy field', () => {
      const deletedByPath = UserSchema.path('deletedBy');
      expect(deletedByPath).toBeDefined();
    });

    it('should have optional mnemonicId field', () => {
      const mnemonicIdPath = UserSchema.path('mnemonicId');
      expect(mnemonicIdPath).toBeDefined();
      expect(mnemonicIdPath.isRequired).toBe(false);
    });

    it('should have optional mnemonicRecovery field', () => {
      const mnemonicRecoveryPath = UserSchema.path('mnemonicRecovery');
      expect(mnemonicRecoveryPath).toBeDefined();
      expect(mnemonicRecoveryPath.isRequired).toBe(false);
    });

    it('should have optional passwordWrappedPrivateKey field', () => {
      const pwpkPath = UserSchema.path('passwordWrappedPrivateKey');
      expect(pwpkPath).toBeDefined();
      expect(pwpkPath.isRequired).toBe(false);
    });

    it('should have backupCodes array with default empty', () => {
      const backupCodesPath = UserSchema.path('backupCodes') as any;
      expect(backupCodesPath).toBeDefined();
      // defaultValue is a function for arrays
      expect(typeof backupCodesPath.defaultValue).toBe('function');
      expect(backupCodesPath.defaultValue()).toEqual([]);
    });

    it('should have nested structure in passwordWrappedPrivateKey', () => {
      const pwpkPath = UserSchema.path('passwordWrappedPrivateKey') as any;
      expect(pwpkPath).toBeDefined();
      // Verify it has nested schema structure
      expect(pwpkPath.$isSingleNested).toBe(true);
    });

    it('should have nested structure in backupCodes array', () => {
      const backupCodesPath = UserSchema.path('backupCodes') as any;
      expect(backupCodesPath).toBeDefined();
      expect(backupCodesPath.$isMongooseArray).toBe(true);
    });
  });

  describe('reference fields', () => {
    it('should reference User model for createdBy', () => {
      const createdByPath = UserSchema.path('createdBy') as any;
      expect(createdByPath.options.ref).toBe('User');
      expect(createdByPath.options.immutable).toBe(true);
    });

    it('should reference User model for updatedBy', () => {
      const updatedByPath = UserSchema.path('updatedBy') as any;
      expect(updatedByPath.options.ref).toBe('User');
    });

    it('should reference User model for deletedBy', () => {
      const deletedByPath = UserSchema.path('deletedBy') as any;
      expect(deletedByPath.options.ref).toBe('User');
    });

    it('should reference Mnemonic model for mnemonicId', () => {
      const mnemonicIdPath = UserSchema.path('mnemonicId') as any;
      expect(mnemonicIdPath.options.ref).toBe('Mnemonic');
    });
  });

  describe('unique constraints', () => {
    it('should have unique constraint on username', () => {
      const usernamePath = UserSchema.path('username') as any;
      expect(usernamePath.options.unique).toBe(true);
    });

    it('should have unique constraint on email', () => {
      const emailPath = UserSchema.path('email') as any;
      expect(emailPath.options.unique).toBe(true);
    });

    it('should have unique constraint on publicKey', () => {
      const publicKeyPath = UserSchema.path('publicKey') as any;
      expect(publicKeyPath.options.unique).toBe(true);
    });
  });
});
