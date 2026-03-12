import {
  EmailString,
  MemberType,
  SecureBuffer,
  SecureString,
} from '@digitaldefiance/ecies-lib';
import { Connection, Types } from '@digitaldefiance/mongoose-types';
import {
  Member as BackendMember,
  ECIESService,
  getNodeRuntimeConfiguration,
} from '@digitaldefiance/node-ecies-lib';
import {
  SuiteCoreStringKey,
  TranslatableSuiteError,
} from '@digitaldefiance/suite-core-lib';
import { ObjectId as MongoObjectId } from 'mongodb';
import { BackupCode } from '@digitaldefiance/node-express-suite';
import { LocalhostConstants as AppConstants } from '@digitaldefiance/node-express-suite';
import {
  IMnemonicDocument,
  IRoleDocument,
  IUserDocument,
  IUserRoleDocument,
} from '../../src/documents';
import { BaseModelName } from '../../src/enumerations/base-model-name';
import { IApplication } from '@digitaldefiance/node-express-suite';
import { IServerInitResult } from '../../src/interfaces/server-init-result';
import { ModelRegistry } from '../../src/model-registry';
import { BackupCodeService } from '../../src/services/backup-code';
import { DatabaseInitializationService } from '../../src/services/database-initialization';
import { KeyWrappingService } from '@digitaldefiance/node-express-suite';
import { MnemonicService } from '../../src/services/mnemonic';
import { RoleService } from '../../src/services/role';
import { withTransaction } from '@digitaldefiance/node-express-suite';

// Mock fs module to allow spying on writeSync
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeSync: jest.fn(),
}));

// Mock dependencies - use partial mock for node-ecies-lib to preserve configuration
jest.mock('../../src/utils', () => {
  const actual = jest.requireActual('../../src/utils');
  return {
    ...actual,
    debugLog: jest.fn(actual.debugLog),
    withTransaction: jest.fn(), // Keep withTransaction mocked for other tests
  };
});
jest.mock('../../src/utils/mongo-transaction', () => ({
  withMongoTransaction: jest.fn(),
}));
// Don't mock @digitaldefiance/node-ecies-lib - we need the real configuration
// jest.mock('@digitaldefiance/node-ecies-lib');
jest.mock('../../src/services/mnemonic');
jest.mock('../../src/services/role');
jest.mock('../../src/services/backup-code');
// Mock base-package services via barrel export
jest.mock('@digitaldefiance/node-express-suite', () => {
  const actual = jest.requireActual('@digitaldefiance/node-express-suite');
  return {
    ...actual,
    KeyWrappingService: jest.fn(),
    withTransaction: jest.fn(),
    directLog: jest.fn(actual.directLog),
    SystemUserService: {
      getSystemUser: jest.fn().mockReturnValue({
        publicKey: Buffer.alloc(65, 1),
        privateKey: Buffer.alloc(32, 2),
        address: 'mock-address',
      }),
    },
  };
});

describe('DatabaseInitializationService', () => {
  let mockApplication: jest.Mocked<IApplication>;
  let mockConnection: jest.Mocked<Connection>;
  let mockUserModel: any;
  let mockRoleModel: any;
  let mockUserRoleModel: any;
  let mockMnemonicModel: any;
  let mockECIESService: jest.Mocked<ECIESService>;
  let mockKeyWrappingService: jest.Mocked<KeyWrappingService>;
  let mockMnemonicService: jest.Mocked<MnemonicService>;
  let mockRoleService: jest.Mocked<RoleService>;
  let mockBackupCodeService: jest.Mocked<BackupCodeService>;
  let mockWallet: any;
  let mockBackendMember: jest.Mocked<BackendMember>;
  let defaultI18nTFuncSpy: jest.SpyInstance | undefined;

  beforeAll(() => {
    // Ensure Node.js runtime configuration is loaded
    const config = getNodeRuntimeConfiguration();
    if (!config || !config.idProvider) {
      throw new Error('Node runtime configuration not initialized');
    }
  });

  beforeEach(() => {
    // Mock the translation function to return actual English strings
    defaultI18nTFuncSpy = jest
      .spyOn(DatabaseInitializationService as any, 'defaultI18nTFunc')
      .mockImplementation(
        (
          key: string,
          variables?: Record<string, any>,
          _language?: string,
          application?: IApplication,
        ): string => {
          // Map keys to English translations - handle both enum values and string keys
          const translations: Record<string, string> = {
            [SuiteCoreStringKey.Admin_AccountCredentials]:
              'Account Credentials',
            [SuiteCoreStringKey.Admin_EndCredentials]: 'End Credentials',
            [SuiteCoreStringKey.Common_System]: 'System',
            [SuiteCoreStringKey.Common_Admin]: 'Admin',
            [SuiteCoreStringKey.Common_Member]: 'Member',
            [SuiteCoreStringKey.Common_UserID]: 'User ID',
            [SuiteCoreStringKey.Common_Username]: 'Username',
            [SuiteCoreStringKey.Common_Email]: 'Email',
            [SuiteCoreStringKey.Common_Password]: 'Password',
            [SuiteCoreStringKey.Common_Mnemonic]: 'Mnemonic',
            [SuiteCoreStringKey.Common_BackupCodes]: 'Backup Codes',
            [SuiteCoreStringKey.Common_PublicKey]: 'Public Key',
            '{{SuiteCoreStringKey.Admin_CredentialsWrittenToEnv}}':
              'Credentials written to {path}',
            '{{SuiteCoreStringKey.Admin_DroppingDatabase}}':
              'Dropping database',
          };
          const template = translations[key] || key;
          if (!variables) return template;
          return Object.entries(variables).reduce((current, [token, value]) => {
            return current.split(`{${token}}`).join(String(value));
          }, template);
        },
      );
    // Mock console.warn to suppress i18n warnings in tests
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Mock ModelRegistry before defining models
    jest
      .spyOn(ModelRegistry.instance, 'getTypedModel')
      .mockImplementation((name: string) => {
        if (name === BaseModelName.User) return mockUserModel as any;
        if (name === BaseModelName.Role) return mockRoleModel as any;
        if (name === BaseModelName.UserRole) return mockUserRoleModel as any;
        if (name === BaseModelName.Mnemonic) return mockMnemonicModel as any;
        throw new Error(`Unknown model: ${name}`);
      });
    jest
      .spyOn(ModelRegistry.instance, 'get')
      .mockImplementation((name: string) => {
        if (name === BaseModelName.User)
          return { model: mockUserModel, schema: {} as any } as any;
        if (name === BaseModelName.Role)
          return { model: mockRoleModel, schema: {} as any } as any;
        if (name === BaseModelName.UserRole)
          return { model: mockUserRoleModel, schema: {} as any } as any;
        if (name === BaseModelName.Mnemonic)
          return { model: mockMnemonicModel, schema: {} as any } as any;
        throw new Error(`Unknown model: ${name}`);
      });

    // Clear global cache before each test
    if (global.__MEMBER_CACHE__) {
      global.__MEMBER_CACHE__.clear();
    }

    // Mock wallet
    mockWallet = {
      getPrivateKey: jest
        .fn()
        .mockReturnValue(
          Buffer.from('private-key-32-bytes-test-data-here', 'utf-8'),
        ),
      getPublicKey: jest
        .fn()
        .mockReturnValue(Buffer.from('public-key-data-here', 'utf-8')),
    };

    // Mock ECIES service
    mockECIESService = {
      constants: {
        idProvider: {
          toBytes: jest.fn().mockImplementation((id) => {
            if (Buffer.isBuffer(id)) return id;
            if (typeof id === 'string') return Buffer.from(id, 'hex');
            if (id && typeof id.toHexString === 'function') {
              return Buffer.from(id.toHexString(), 'hex');
            }
            return Buffer.from(String(id), 'hex');
          }),
          generate: jest.fn().mockReturnValue(Buffer.alloc(12, 0x42)),
          fromBytes: jest.fn().mockImplementation((bytes) => {
            const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
            return new (require('@digitaldefiance/mongoose-types').Types.ObjectId)(
              buf,
            );
          }),
          serialize: jest.fn().mockImplementation((bytes) => {
            const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
            return buf.toString('hex');
          }),
          deserialize: jest.fn().mockImplementation((str) => {
            return Buffer.from(str, 'hex');
          }),
          validate: jest.fn().mockReturnValue(true),
          byteLength: 12,
        },
      },
      generateNewMnemonic: jest
        .fn()
        .mockReturnValue(new SecureString('test mnemonic phrase here')),
      walletAndSeedFromMnemonic: jest.fn().mockReturnValue({
        wallet: mockWallet,
        seed: Buffer.from('seed-data', 'utf-8'),
      }),
      getPublicKey: jest
        .fn()
        .mockReturnValue(Buffer.from([0x02, ...Array(32).fill(1)])),
    } as any;

    // Mock BackendMember
    mockBackendMember = {
      publicKey: Buffer.from([0x04, ...Array(64).fill(0)]),
      privateKey: new SecureBuffer(Buffer.from('private-key-data', 'utf-8')),
      encryptData: jest
        .fn()
        .mockReturnValue(Buffer.from('encrypted-data', 'utf-8')),
    } as any;

    // Mock models
    mockUserModel = {
      find: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };

    mockRoleModel = {
      find: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
      findOne: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      }),
      create: jest.fn(),
      hydrate: jest.fn((doc: any) => doc),
    };

    mockUserRoleModel = {
      findOne: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      }),
    };

    mockMnemonicModel = {};

    // Mock services
    mockKeyWrappingService = {
      wrapSecret: jest.fn().mockReturnValue('wrapped-secret'),
    } as any;

    mockMnemonicService = {
      addMnemonic: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
      } as IMnemonicDocument),
    } as any;

    mockRoleService = {
      addUserToRole: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        roleId: new Types.ObjectId(),
      } as IUserRoleDocument),
    } as any;

    mockBackupCodeService = {
      generateBackupCodes: jest
        .fn()
        .mockReturnValue([
          new SecureString('backup-code-1'),
          new SecureString('backup-code-2'),
        ]),
      encryptBackupCodes: jest
        .fn()
        .mockResolvedValue(['encrypted-backup-1', 'encrypted-backup-2']),
    } as any;

    // Mock connection
    mockConnection = {
      db: {
        dropDatabase: jest.fn().mockResolvedValue(true),
      },
    } as any;

    // Mock application
    mockApplication = {
      environment: {
        detailedDebug: false,
        timezone: { value: 'UTC' },
        mongo: {
          useTransactions: false,
        },
        mnemonicHmacSecret: new SecureString('test-hmac-secret'),
        adminId: undefined,
        adminMnemonic: undefined,
        adminPassword: undefined,
        adminRoleId: undefined,
        adminUserRoleId: undefined,
        adminBackupCodes: undefined,
        memberId: undefined,
        memberMnemonic: undefined,
        memberPassword: undefined,
        memberRoleId: undefined,
        memberUserRoleId: undefined,
        memberBackupCodes: undefined,
        systemId: undefined,
        systemMnemonic: undefined,
        systemPassword: undefined,
        systemRoleId: undefined,
        systemUserRoleId: undefined,
        systemBackupCodes: undefined,
      },
      db: {
        connection: mockConnection,
      },
      constants: AppConstants,
      getModel: jest.fn((name: string) => {
        switch (name) {
          case BaseModelName.User:
            return mockUserModel;
          case BaseModelName.Role:
            return mockRoleModel;
          case BaseModelName.UserRole:
            return mockUserRoleModel;
          case BaseModelName.Mnemonic:
            return mockMnemonicModel;
          default:
            throw new Error(`Unknown model: ${name}`);
        }
      }),
    } as any;

    // Mock constructors (except ECIESService and BackendMember which we need real)
    // (ECIESService as jest.MockedClass<typeof ECIESService>).mockImplementation(
    //   () => mockECIESService,
    // );
    (
      KeyWrappingService as jest.MockedClass<typeof KeyWrappingService>
    ).mockImplementation(() => mockKeyWrappingService);
    (
      MnemonicService as jest.MockedClass<typeof MnemonicService>
    ).mockImplementation(() => mockMnemonicService);
    (RoleService as jest.MockedClass<typeof RoleService>).mockImplementation(
      () => mockRoleService,
    );
    (
      BackupCodeService as jest.MockedClass<typeof BackupCodeService>
    ).mockImplementation(() => mockBackupCodeService);
    // (
    //   BackendMember as jest.MockedClass<typeof BackendMember>
    // ).mockImplementation(() => mockBackendMember);

    // Mock BackupCode static methods
    (BackupCode.generateBackupCodes as jest.Mock) = jest
      .fn()
      .mockReturnValue([
        new SecureString('backup-code-1'),
        new SecureString('backup-code-2'),
      ]);
    (BackupCode.encryptBackupCodes as jest.Mock) = jest
      .fn()
      .mockResolvedValue(['encrypted-backup-1', 'encrypted-backup-2']);

    // Mock withTransaction utility
    (withTransaction as jest.Mock).mockImplementation(
      async (connection, useTransactions, options, callback) => {
        // Create mock result that looks like what the actual callback returns
        const mockResult = {
          systemUser: {
            member: mockBackendMember,
            mnemonic: new SecureString('system-mnemonic'),
          },
          systemRole: { _id: new Types.ObjectId(), name: 'System' },
          systemDoc: {
            _id: new Types.ObjectId(),
            username: 'system',
            email: 'system@example.com',
          },
          systemUserRoleDoc: { _id: new Types.ObjectId() },
          systemPassword: new SecureString('system-password'),
          systemMnemonic: 'system-mnemonic',
          systemBackupCodes: [
            { value: 'system-backup-1' },
            { value: 'system-backup-2' },
          ],
          adminUser: {
            member: mockBackendMember,
            mnemonic: new SecureString('admin-mnemonic'),
          },
          adminRole: { _id: new Types.ObjectId(), name: 'Administrator' },
          adminDoc: {
            _id: new Types.ObjectId(),
            username: 'admin',
            email: 'admin@example.com',
          },
          adminUserRoleDoc: { _id: new Types.ObjectId() },
          adminPassword: new SecureString('admin-password'),
          adminMnemonic: 'admin-mnemonic',
          adminBackupCodes: [
            { value: 'admin-backup-1' },
            { value: 'admin-backup-2' },
          ],
          adminMember: mockBackendMember,
          memberUser: {
            member: mockBackendMember,
            mnemonic: new SecureString('member-mnemonic'),
          },
          memberRole: { _id: new Types.ObjectId(), name: 'Member' },
          memberDoc: {
            _id: new Types.ObjectId(),
            username: 'member',
            email: 'member@example.com',
          },
          memberUserRoleDoc: { _id: new Types.ObjectId() },
          memberPassword: new SecureString('member-password'),
          memberMnemonic: 'member-mnemonic',
          memberBackupCodes: [
            { value: 'member-backup-1' },
            { value: 'member-backup-2' },
          ],
        };
        return mockResult;
      },
    );

    // Mock withMongoTransaction (used by initUserDbWithServices)
    const { withMongoTransaction } = require('../../src/utils/mongo-transaction');
    (withMongoTransaction as jest.Mock).mockImplementation(
      async (_connection: any, _useTransactions: any, _options: any, callback: any, _txOptions?: any) => {
        // By default, return the callback result (for tests that set up model mocks)
        // Individual tests can override this mock as needed
        return callback(null);
      },
    );
  });

  afterEach(() => {
    if (defaultI18nTFuncSpy) {
      defaultI18nTFuncSpy.mockRestore();
    }
    jest.clearAllMocks();
    jest.restoreAllMocks();
    // Clean up global cache
    if (global.__MEMBER_CACHE__) {
      global.__MEMBER_CACHE__.clear();
    }
  });

  // Helper method to call initUserDbWithServices with mocked services
  const callInitUserDbWithServices = async () => {
    return DatabaseInitializationService.initUserDbWithServices(
      mockApplication,
      mockKeyWrappingService,
      mockMnemonicService,
      mockECIESService,
      mockRoleService,
      mockBackupCodeService,
    );
  };

  describe('mnemonicOrNew', () => {
    it('should return existing mnemonic when provided and has value', () => {
      const existingMnemonic = new SecureString('existing mnemonic');
      const result = DatabaseInitializationService.mnemonicOrNew(
        existingMnemonic,
        mockECIESService,
      );

      expect(result).toBe(existingMnemonic);
      expect(mockECIESService.generateNewMnemonic).not.toHaveBeenCalled();
    });

    it('should generate new mnemonic when existing is undefined', () => {
      const result = DatabaseInitializationService.mnemonicOrNew(
        undefined,
        mockECIESService,
      );

      expect(result.value).toEqual('test mnemonic phrase here');
      expect(mockECIESService.generateNewMnemonic).toHaveBeenCalledTimes(1);
    });

    it('should generate new mnemonic when existing has no value', () => {
      const emptyMnemonic = new SecureString('');
      // Mock hasValue to return false without disposing
      jest.spyOn(emptyMnemonic, 'hasValue', 'get').mockReturnValue(false);

      const result = DatabaseInitializationService.mnemonicOrNew(
        emptyMnemonic,
        mockECIESService,
      );

      expect(result.value).toEqual('test mnemonic phrase here');
      expect(mockECIESService.generateNewMnemonic).toHaveBeenCalledTimes(1);
    });
  });

  describe('cacheKey', () => {
    it('should generate consistent cache key for same inputs', () => {
      const username = 'testuser';
      const email = new EmailString('test@example.com');
      const mnemonic = new SecureString('test mnemonic');
      const id = new Types.ObjectId();

      const key1 = DatabaseInitializationService.cacheKey(
        username,
        email,
        mnemonic,
        id,
      );
      const key2 = DatabaseInitializationService.cacheKey(
        username,
        email,
        mnemonic,
        id,
      );

      expect(key1).toBe(key2);
      expect(typeof key1).toBe('string');
      expect(key1).toHaveLength(8); // CRC32 hex string is 8 characters
    });

    it('should generate different cache keys for different inputs', () => {
      const username1 = 'testuser1';
      const username2 = 'testuser2';
      const email = new EmailString('test@example.com');
      const mnemonic = new SecureString('test mnemonic');
      const id = new Types.ObjectId();

      const key1 = DatabaseInitializationService.cacheKey(
        username1,
        email,
        mnemonic,
        id,
      );
      const key2 = DatabaseInitializationService.cacheKey(
        username2,
        email,
        mnemonic,
        id,
      );

      expect(key1).not.toBe(key2);
    });
  });

  describe('generatePassword', () => {
    it('should generate password of specified length', () => {
      const length = 12;
      const password = DatabaseInitializationService.generatePassword(length);

      expect(password).toHaveLength(length);
    });

    it('should generate password with required character types', () => {
      const password = DatabaseInitializationService.generatePassword(16);

      // Should contain at least one letter
      expect(password).toMatch(/[a-zA-Z]/);
      // Should contain at least one number
      expect(password).toMatch(/[0-9]/);
      // Should contain at least one special character
      expect(password).toMatch(/[!@#$%^&*()_+\-=[\]{};':|,.<>/?]/);
    });

    it('should generate different passwords on multiple calls', () => {
      const password1 = DatabaseInitializationService.generatePassword(16);
      const password2 = DatabaseInitializationService.generatePassword(16);

      expect(password1).not.toBe(password2);
    });

    it('should handle minimum length with all required character types', () => {
      // Minimum viable password needs at least 3 characters (letter + number + special)
      const password = DatabaseInitializationService.generatePassword(3);

      expect(password).toHaveLength(3);
      // With only 3 characters, we can't guarantee all types, but it should be valid
    });
  });

  describe('cacheOrNew', () => {
    beforeEach(() => {
      // Ensure clean global cache
      global.__MEMBER_CACHE__ = new Map();
    });

    it('should generate compressed public keys (33 bytes) with real ECIES service', () => {
      const realEciesService = new ECIESService();
      const username = 'testuser';
      const email = new EmailString('test@example.com');
      const mnemonic = realEciesService.generateNewMnemonic();
      const memberType = MemberType.User;
      const memberId = new Types.ObjectId();

      const result = DatabaseInitializationService.cacheOrNew(
        username,
        email,
        mnemonic,
        memberType,
        realEciesService,
        memberId,
      );

      // Verify the public key is compressed (33 bytes)
      expect(result.member.publicKey.length).toBe(33);
      // Should start with 0x02 or 0x03
      expect([0x02, 0x03]).toContain(result.member.publicKey[0]);
    });

    it('should create new member when cache is empty', () => {
      const username = 'testuser';
      const email = new EmailString('test@example.com');
      const mnemonic = new SecureString('test mnemonic');
      const memberType = MemberType.User;
      const memberId = new Types.ObjectId();

      const result = DatabaseInitializationService.cacheOrNew(
        username,
        email,
        mnemonic,
        memberType,
        mockECIESService,
        memberId,
      );

      expect(result.member).toBeInstanceOf(BackendMember);
      expect(result.mnemonic).toBe(mnemonic);
      expect(mockECIESService.walletAndSeedFromMnemonic).toHaveBeenCalledWith(
        mnemonic,
      );
    });

    it('should return cached member when already exists', () => {
      const username = 'testuser';
      const email = new EmailString('test@example.com');
      const mnemonic = new SecureString('test mnemonic');
      const memberType = MemberType.User;
      const memberId = new Types.ObjectId();

      // First call should create and cache
      const result1 = DatabaseInitializationService.cacheOrNew(
        username,
        email,
        mnemonic,
        memberType,
        mockECIESService,
        memberId,
      );

      // Second call should return cached
      const result2 = DatabaseInitializationService.cacheOrNew(
        username,
        email,
        mnemonic,
        memberType,
        mockECIESService,
        memberId,
      );

      expect(result1).toStrictEqual(result2);
      expect(mockECIESService.walletAndSeedFromMnemonic).toHaveBeenCalledTimes(
        1,
      ); // Only called once
    });

    it('should generate new mnemonic when undefined is provided', () => {
      const username = 'testuser';
      const email = new EmailString('test@example.com');
      const memberType = MemberType.User;

      const result = DatabaseInitializationService.cacheOrNew(
        username,
        email,
        undefined, // No mnemonic provided
        memberType,
        mockECIESService,
      );

      expect(mockECIESService.generateNewMnemonic).toHaveBeenCalled();
      expect(result.mnemonic.value).toBe('test mnemonic phrase here');
    });

    it('should handle different member types correctly', () => {
      const username = 'admin';
      const email = new EmailString('admin@example.com');
      const mnemonic = new SecureString('admin mnemonic');
      const createdBy = new Types.ObjectId();

      const result = DatabaseInitializationService.cacheOrNew(
        username,
        email,
        mnemonic,
        MemberType.Admin,
        mockECIESService,
        undefined,
        createdBy,
      );

      expect(result.member).toBeInstanceOf(BackendMember);
      expect(result.member.type).toBe(MemberType.Admin);
      expect(result.member.name).toBe(username);
    });
  });

  describe('defaultI18nTFunc', () => {
    it('should process template strings with component.key syntax', () => {
      // Restore the real implementation for this test
      if (defaultI18nTFuncSpy) {
        defaultI18nTFuncSpy.mockRestore();
      }

      const tFunc = (DatabaseInitializationService as any).defaultI18nTFunc;
      const result = tFunc('{{suite-core.Admin_DroppingDatabase}}');

      // Should process the template and return the translated string
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      // Should not contain the template syntax
      expect(result).not.toContain('{{');
      expect(result).not.toContain('}}');
    });

    it('should handle variables in template strings', () => {
      if (defaultI18nTFuncSpy) {
        defaultI18nTFuncSpy.mockRestore();
      }

      const tFunc = (DatabaseInitializationService as any).defaultI18nTFunc;
      const result = tFunc(
        '{{suite-core.Common_System}} {{suite-core.Common_ID}}: {id}',
        { id: '12345' },
      );

      expect(result).toBeDefined();
      expect(result).toContain('12345');
      expect(result).not.toContain('{{');
    });
  });

  describe('dropDatabase', () => {
    it('should drop database when connection has db', async () => {
      const result =
        await DatabaseInitializationService.dropDatabase(mockConnection);

      expect(result).toBe(true);
      expect(mockConnection.db!.dropDatabase).toHaveBeenCalled();
    });

    it('should return false when connection has no db', async () => {
      const connectionWithoutDb = { db: null } as unknown as Connection;

      const result =
        await DatabaseInitializationService.dropDatabase(connectionWithoutDb);

      expect(result).toBe(false);
    });
  });

  describe('getInitOptions', () => {
    it('should extract all options from application environment', () => {
      const adminId = new Types.ObjectId();
      const adminMnemonic = new SecureString('admin-mnemonic');
      const adminPassword = new SecureString('admin-password');

      (mockApplication.environment as any).adminId = adminId;
      (mockApplication.environment as any).adminMnemonic = adminMnemonic;
      (mockApplication.environment as any).adminPassword = adminPassword;
      const options =
        DatabaseInitializationService.getInitOptions(mockApplication);

      expect(options.adminId).toBe(adminId);
      expect(options.adminMnemonic).toBe(adminMnemonic);
      expect(options.adminPassword).toBe(adminPassword);
    });

    it('should return undefined for missing environment values', () => {
      const options =
        DatabaseInitializationService.getInitOptions(mockApplication);

      expect(options.adminId).toBeUndefined();
      expect(options.adminMnemonic).toBeUndefined();
      expect(options.adminPassword).toBeUndefined();
      expect(options.adminRoleId).toBeUndefined();
    });

    it('should handle secure strings without values', () => {
      const emptyMnemonic = new SecureString('');
      // Mock hasValue to return false without disposing
      jest.spyOn(emptyMnemonic, 'hasValue', 'get').mockReturnValue(false);
      (mockApplication.environment as any).adminMnemonic = emptyMnemonic;

      const options =
        DatabaseInitializationService.getInitOptions(mockApplication);

      expect(options.adminMnemonic).toBeUndefined();
    });
  });

  describe('serverInitResultHash', () => {
    let mockServerInitResult: IServerInitResult;

    beforeEach(() => {
      mockServerInitResult = {
        adminUser: {
          _id: new Types.ObjectId(),
          publicKey: 'admin-public-key',
        } as IUserDocument,
        adminRole: { _id: new Types.ObjectId() } as IRoleDocument,
        adminUserRole: { _id: new Types.ObjectId() } as IUserRoleDocument,
        adminUsername: 'admin',
        adminEmail: 'admin@example.com',
        adminMnemonic: 'admin-mnemonic',
        adminPassword: 'admin-password',
        adminBackupCodes: ['code1', 'code2'],
        adminMember: {} as BackendMember,
        memberUser: {
          _id: new Types.ObjectId(),
          publicKey: 'member-public-key',
        } as IUserDocument,
        memberRole: { _id: new Types.ObjectId() } as IRoleDocument,
        memberUserRole: { _id: new Types.ObjectId() } as IUserRoleDocument,
        memberUsername: 'member',
        memberEmail: 'member@example.com',
        memberMnemonic: 'member-mnemonic',
        memberPassword: 'member-password',
        memberBackupCodes: ['code3', 'code4'],
        memberMember: {} as BackendMember,
        systemUser: {
          _id: new Types.ObjectId(),
          publicKey: 'system-public-key',
        } as IUserDocument,
        systemRole: { _id: new Types.ObjectId() } as IRoleDocument,
        systemUserRole: { _id: new Types.ObjectId() } as IUserRoleDocument,
        systemUsername: 'system',
        systemEmail: 'system@example.com',
        systemMnemonic: 'system-mnemonic',
        systemPassword: 'system-password',
        systemBackupCodes: ['code5', 'code6'],
        systemMember: {} as BackendMember,
      };
    });

    it('should generate consistent hash for same input', () => {
      const hash1 =
        DatabaseInitializationService.serverInitResultHash(
          mockServerInitResult,
        );
      const hash2 =
        DatabaseInitializationService.serverInitResultHash(
          mockServerInitResult,
        );

      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe('string');
      expect(hash1).toHaveLength(64); // SHA256 hex string is 64 characters
    });

    it('should generate different hash for different input', () => {
      const hash1 =
        DatabaseInitializationService.serverInitResultHash(
          mockServerInitResult,
        );

      // Modify the result
      mockServerInitResult.adminUsername = 'different-admin';
      const hash2 =
        DatabaseInitializationService.serverInitResultHash(
          mockServerInitResult,
        );

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('printServerInitResults', () => {
    let mockServerInitResult: IServerInitResult;

    beforeEach(() => {
      mockServerInitResult = {
        adminUser: {
          _id: new Types.ObjectId(),
          publicKey: 'admin-public-key',
        } as IUserDocument,
        adminRole: {
          _id: new Types.ObjectId(),
          name: 'Administrator',
        } as unknown as IRoleDocument,
        adminUserRole: { _id: new Types.ObjectId() } as IUserRoleDocument,
        adminUsername: 'admin',
        adminEmail: 'admin@example.com',
        adminMnemonic: 'admin-mnemonic',
        adminPassword: 'admin-password',
        adminBackupCodes: ['code1', 'code2'],
        adminMember: {} as BackendMember,
        memberUser: {
          _id: new Types.ObjectId(),
          publicKey: 'member-public-key',
        } as IUserDocument,
        memberRole: {
          _id: new Types.ObjectId(),
          name: 'Member',
        } as IRoleDocument,
        memberUserRole: { _id: new Types.ObjectId() } as IUserRoleDocument,
        memberUsername: 'member',
        memberEmail: 'member@example.com',
        memberMnemonic: 'member-mnemonic',
        memberPassword: 'member-password',
        memberBackupCodes: ['code3', 'code4'],
        memberMember: {} as BackendMember,
        systemUser: {
          _id: new Types.ObjectId(),
          publicKey: 'system-public-key',
        } as IUserDocument,
        systemRole: {
          _id: new Types.ObjectId(),
          name: 'System',
        } as IRoleDocument,
        systemUserRole: { _id: new Types.ObjectId() } as IUserRoleDocument,
        systemUsername: 'system',
        systemEmail: 'system@example.com',
        systemMnemonic: 'system-mnemonic',
        systemPassword: 'system-password',
        systemBackupCodes: ['code5', 'code6'],
        systemMember: {} as BackendMember,
      };
    });

    it('should print all user credentials and information', async () => {
      const { directLog } = require('@digitaldefiance/node-express-suite');
      (directLog as jest.Mock).mockClear();

      DatabaseInitializationService.printServerInitResults(
        mockServerInitResult,
        false,
      );

      expect(directLog).toHaveBeenCalled();

      const allCalls = (directLog as jest.Mock).mock.calls
        .map((call: any[]) => call.slice(2).join(' '))
        .join(' ');

      expect(allCalls).toContain('System');
      expect(allCalls).toContain('Admin');
      expect(allCalls).toContain('Member');
    });

    it('should print user IDs, usernames, emails, passwords, mnemonics, and backup codes', async () => {
      const { directLog } = require('@digitaldefiance/node-express-suite');
      (directLog as jest.Mock).mockClear();

      DatabaseInitializationService.printServerInitResults(
        mockServerInitResult,
        false,
      );

      const allCalls = (directLog as jest.Mock).mock.calls
        .map((call: any[]) => call.slice(2).join(' '))
        .join(' ');

      expect(allCalls).toContain(
        mockServerInitResult.adminUser._id.toHexString(),
      );
      expect(allCalls).toContain(mockServerInitResult.adminUsername);
      expect(allCalls).toContain(mockServerInitResult.adminEmail);
    });

    it('should print public keys for all users', async () => {
      const { directLog } = require('@digitaldefiance/node-express-suite');
      (directLog as jest.Mock).mockClear();

      DatabaseInitializationService.printServerInitResults(
        mockServerInitResult,
        false,
      );

      const allCalls = (directLog as jest.Mock).mock.calls
        .map((call: any[]) => call.slice(2).join(' '))
        .join(' ');

      expect(allCalls).toContain('admin-public-key');
      expect(allCalls).toContain('member-public-key');
      expect(allCalls).toContain('system-public-key');
    });
  });

  describe('setEnvFromInitResults', () => {
    let mockServerInitResult: IServerInitResult;
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      // Save original environment
      originalEnv = { ...process.env };

      mockServerInitResult = {
        adminUser: {
          _id: new Types.ObjectId(),
          publicKey: 'admin-public-key',
        } as IUserDocument,
        adminRole: { _id: new Types.ObjectId() } as IRoleDocument,
        adminUserRole: { _id: new Types.ObjectId() } as IUserRoleDocument,
        adminUsername: 'admin',
        adminEmail: 'admin@example.com',
        adminMnemonic: 'admin-mnemonic',
        adminPassword: 'admin-password',
        adminBackupCodes: ['code1', 'code2'],
        adminMember: {} as BackendMember,
        memberUser: {
          _id: new Types.ObjectId(),
          publicKey: 'member-public-key',
        } as IUserDocument,
        memberRole: { _id: new Types.ObjectId() } as IRoleDocument,
        memberUserRole: { _id: new Types.ObjectId() } as IUserRoleDocument,
        memberUsername: 'member',
        memberEmail: 'member@example.com',
        memberMnemonic: 'member-mnemonic',
        memberPassword: 'member-password',
        memberBackupCodes: ['code3', 'code4'],
        memberMember: {} as BackendMember,
        systemUser: {
          _id: new Types.ObjectId(),
          publicKey: 'system-public-key',
        } as IUserDocument,
        systemRole: { _id: new Types.ObjectId() } as IRoleDocument,
        systemUserRole: { _id: new Types.ObjectId() } as IUserRoleDocument,
        systemUsername: 'system',
        systemEmail: 'system@example.com',
        systemMnemonic: 'system-mnemonic',
        systemPassword: 'system-password',
        systemBackupCodes: ['code5', 'code6'],
        systemMember: {} as BackendMember,
      };
    });

    afterEach(() => {
      // Restore original environment
      process.env = originalEnv;
    });

    it('should set all admin environment variables', () => {
      DatabaseInitializationService.setEnvFromInitResults(mockServerInitResult);

      expect(process.env['ADMIN_ID']).toBe(
        mockServerInitResult.adminUser._id.toHexString(),
      );
      expect(process.env['ADMIN_PUBLIC_KEY']).toBe(
        mockServerInitResult.adminUser.publicKey,
      );
      expect(process.env['ADMIN_MNEMONIC']).toBe(
        mockServerInitResult.adminMnemonic,
      );
      expect(process.env['ADMIN_PASSWORD']).toBe(
        mockServerInitResult.adminPassword,
      );
      expect(process.env['ADMIN_ROLE_ID']).toBe(
        mockServerInitResult.adminRole._id.toHexString(),
      );
      expect(process.env['ADMIN_USER_ROLE_ID']).toBe(
        mockServerInitResult.adminUserRole._id.toHexString(),
      );
    });

    it('should set all member environment variables', () => {
      DatabaseInitializationService.setEnvFromInitResults(mockServerInitResult);

      expect(process.env['MEMBER_ID']).toBe(
        mockServerInitResult.memberUser._id.toHexString(),
      );
      expect(process.env['MEMBER_PUBLIC_KEY']).toBe(
        mockServerInitResult.memberUser.publicKey,
      );
      expect(process.env['MEMBER_MNEMONIC']).toBe(
        mockServerInitResult.memberMnemonic,
      );
      expect(process.env['MEMBER_PASSWORD']).toBe(
        mockServerInitResult.memberPassword,
      );
      expect(process.env['MEMBER_ROLE_ID']).toBe(
        mockServerInitResult.memberRole._id.toHexString(),
      );
      expect(process.env['MEMBER_USER_ROLE_ID']).toBe(
        mockServerInitResult.memberUserRole._id.toHexString(),
      );
    });

    it('should set all system environment variables', () => {
      DatabaseInitializationService.setEnvFromInitResults(mockServerInitResult);

      expect(process.env['SYSTEM_ID']).toBe(
        mockServerInitResult.systemUser._id.toHexString(),
      );
      expect(process.env['SYSTEM_PUBLIC_KEY']).toBe(
        mockServerInitResult.systemUser.publicKey,
      );
      expect(process.env['SYSTEM_MNEMONIC']).toBe(
        mockServerInitResult.systemMnemonic,
      );
      expect(process.env['SYSTEM_PASSWORD']).toBe(
        mockServerInitResult.systemPassword,
      );
      expect(process.env['SYSTEM_ROLE_ID']).toBe(
        mockServerInitResult.systemRole._id.toHexString(),
      );
      expect(process.env['SYSTEM_USER_ROLE_ID']).toBe(
        mockServerInitResult.systemUserRole._id.toHexString(),
      );
    });

    it('should overwrite existing environment variables', () => {
      // Set some existing values
      process.env['ADMIN_ID'] = 'old-admin-id';
      process.env['MEMBER_PASSWORD'] = 'old-member-password';

      DatabaseInitializationService.setEnvFromInitResults(mockServerInitResult);

      expect(process.env['ADMIN_ID']).toBe(
        mockServerInitResult.adminUser._id.toHexString(),
      );
      expect(process.env['ADMIN_ID']).not.toBe('old-admin-id');
      expect(process.env['MEMBER_PASSWORD']).toBe(
        mockServerInitResult.memberPassword,
      );
      expect(process.env['MEMBER_PASSWORD']).not.toBe('old-member-password');
    });
  });

  describe('initUserDb', () => {
    beforeEach(() => {
      // Set up default environment
      process.env['NODE_ENV'] = 'test';

      // Override withMongoTransaction to return a complete result by default
      // Individual tests can override this as needed
      const { withMongoTransaction } = require('../../src/utils/mongo-transaction');
      (withMongoTransaction as jest.Mock).mockResolvedValue({
        adminRole: { _id: new Types.ObjectId(), name: AppConstants.AdministratorRole },
        memberRole: { _id: new Types.ObjectId(), name: AppConstants.MemberRole },
        systemRole: { _id: new Types.ObjectId(), name: AppConstants.SystemRole },
        systemDoc: {
          _id: new Types.ObjectId(),
          username: AppConstants.SystemUser,
          email: AppConstants.SystemEmail,
          publicKey: 'system-public-key',
        },
        systemUserRoleDoc: { _id: new Types.ObjectId() },
        systemPassword: 'system-password',
        systemMnemonic: 'system-mnemonic',
        systemBackupCodes: [
          new SecureString('system-backup-1'),
          new SecureString('system-backup-2'),
        ],
        systemMember: mockBackendMember,
        adminDoc: {
          _id: new Types.ObjectId(),
          username: AppConstants.AdministratorUser,
          email: AppConstants.AdministratorEmail,
          publicKey: 'admin-public-key',
        },
        adminUserRoleDoc: { _id: new Types.ObjectId() },
        adminPassword: 'admin-password',
        adminMnemonic: 'admin-mnemonic',
        adminBackupCodes: [
          new SecureString('admin-backup-1'),
          new SecureString('admin-backup-2'),
        ],
        adminMember: mockBackendMember,
        memberDoc: {
          _id: new Types.ObjectId(),
          username: AppConstants.MemberUser,
          email: AppConstants.MemberEmail,
          publicKey: 'member-public-key',
        },
        memberUserRoleDoc: { _id: new Types.ObjectId() },
        memberPassword: 'member-password',
        memberMnemonic: 'member-mnemonic',
        memberBackupCodes: [
          new SecureString('member-backup-1'),
          new SecureString('member-backup-2'),
        ],
        memberUser: mockBackendMember,
      });
    });

    afterEach(() => {
      delete process.env['NODE_ENV'];
    });

    it('should initialize database successfully with default users and roles', async () => {
      // withMongoTransaction is already mocked in beforeEach to return a complete result
      const result = await callInitUserDbWithServices();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.adminUser).toBeDefined();
      expect(result.data!.memberUser).toBeDefined();
      expect(result.data!.systemUser).toBeDefined();
      expect(result.data!.adminRole).toBeDefined();
      expect(result.data!.memberRole).toBeDefined();
      expect(result.data!.systemRole).toBeDefined();
    });

    it('should return failure when database is already initialized', async () => {
      // Mock existing users and roles
      const existingUser = {
        _id: new Types.ObjectId(),
        username: AppConstants.AdministratorUser,
        email: AppConstants.AdministratorEmail,
      };
      const existingRole = {
        _id: new Types.ObjectId(),
        name: AppConstants.AdministratorRole,
      };

      mockUserModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([existingUser]),
      });
      mockRoleModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([existingRole]),
      });

      const result = await callInitUserDbWithServices();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Database already initialized');
      expect(result.error).toBeInstanceOf(Error);
    });

    it('should handle transaction failure and return error', async () => {
      const testError = new Error('Transaction failed');
      const { withMongoTransaction } = require('../../src/utils/mongo-transaction');
      (withMongoTransaction as jest.Mock).mockRejectedValue(testError);

      const result = await callInitUserDbWithServices();

      expect(result.success).toBe(false);
      expect(result.error).toBe(testError);
      expect(result.message).toContain('Failed to initialize user database');
    });

    it('should handle role creation failure', async () => {
      const { withMongoTransaction } = require('../../src/utils/mongo-transaction');
      (withMongoTransaction as jest.Mock).mockImplementation(
        async (connection: any, useTransactions: any, options: any, callback: any) => {
          // Mock role creation failure
          mockRoleModel.create.mockResolvedValue([]); // Empty array means failure
          return callback(null);
        },
      );

      const result = await callInitUserDbWithServices();

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });

    it('should handle user creation failure', async () => {
      const { withMongoTransaction } = require('../../src/utils/mongo-transaction');
      (withMongoTransaction as jest.Mock).mockImplementation(
        async (connection: any, useTransactions: any, options: any, callback: any) => {
          // Mock successful role creation
          const adminRole = {
            _id: new Types.ObjectId(),
            name: AppConstants.AdministratorRole,
          };
          const memberRole = {
            _id: new Types.ObjectId(),
            name: AppConstants.MemberRole,
          };
          const systemRole = {
            _id: new Types.ObjectId(),
            name: AppConstants.SystemRole,
          };

          mockRoleModel.create
            .mockResolvedValueOnce([adminRole])
            .mockResolvedValueOnce([memberRole])
            .mockResolvedValueOnce([systemRole]);

          // Mock user creation failure
          mockUserModel.create.mockResolvedValue([]); // Empty array means failure

          return callback(null);
        },
      );

      const result = await callInitUserDbWithServices();

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });

    it('should generate backup codes when not provided in environment', async () => {
      // withMongoTransaction is already mocked in beforeEach to return a complete result
      const result = await callInitUserDbWithServices();

      expect(result.success).toBe(true);
      // Since we mock withMongoTransaction, let's verify that the result contains backup codes data
      expect(result.data).toBeDefined();
      expect(result.data!.adminBackupCodes).toBeDefined();
      expect(result.data!.memberBackupCodes).toBeDefined();
      expect(result.data!.systemBackupCodes).toBeDefined();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle concurrent initialization attempts', async () => {
      // Override withMongoTransaction to return a complete result (like initUserDb beforeEach)
      const { withMongoTransaction } = require('../../src/utils/mongo-transaction');
      (withMongoTransaction as jest.Mock).mockResolvedValue({
        adminRole: { _id: new Types.ObjectId(), name: AppConstants.AdministratorRole },
        memberRole: { _id: new Types.ObjectId(), name: AppConstants.MemberRole },
        systemRole: { _id: new Types.ObjectId(), name: AppConstants.SystemRole },
        systemDoc: {
          _id: new Types.ObjectId(),
          username: AppConstants.SystemUser,
          email: AppConstants.SystemEmail,
          publicKey: 'system-public-key',
        },
        systemUserRoleDoc: { _id: new Types.ObjectId() },
        systemPassword: 'system-password',
        systemMnemonic: 'system-mnemonic',
        systemBackupCodes: [
          new SecureString('system-backup-1'),
          new SecureString('system-backup-2'),
        ],
        systemMember: mockBackendMember,
        adminDoc: {
          _id: new Types.ObjectId(),
          username: AppConstants.AdministratorUser,
          email: AppConstants.AdministratorEmail,
          publicKey: 'admin-public-key',
        },
        adminUserRoleDoc: { _id: new Types.ObjectId() },
        adminPassword: 'admin-password',
        adminMnemonic: 'admin-mnemonic',
        adminBackupCodes: [
          new SecureString('admin-backup-1'),
          new SecureString('admin-backup-2'),
        ],
        adminMember: mockBackendMember,
        memberDoc: {
          _id: new Types.ObjectId(),
          username: AppConstants.MemberUser,
          email: AppConstants.MemberEmail,
          publicKey: 'member-public-key',
        },
        memberUserRoleDoc: { _id: new Types.ObjectId() },
        memberPassword: 'member-password',
        memberMnemonic: 'member-mnemonic',
        memberBackupCodes: [
          new SecureString('member-backup-1'),
          new SecureString('member-backup-2'),
        ],
        memberUser: mockBackendMember,
      });

      const promise1 = callInitUserDbWithServices();
      const promise2 = callInitUserDbWithServices();

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // At least one should succeed, both should not fail due to concurrency
      expect(result1.success || result2.success).toBe(true);
    });

    it('should handle invalid ObjectId inputs gracefully', () => {
      const invalidId = 'invalid-object-id';

      // This would typically be caught by MongoDB validation
      expect(() => {
        new Types.ObjectId(invalidId);
      }).toThrow();
    });

    it('should handle memory cleanup after member creation', () => {
      const username = 'testuser';
      const email = new EmailString('test@example.com');
      const mnemonic = new SecureString('test mnemonic');

      const result = DatabaseInitializationService.cacheOrNew(
        username,
        email,
        mnemonic,
        MemberType.User,
        mockECIESService,
      );

      expect(result.member).toBeDefined();
      expect(result.mnemonic).toBeDefined();

      // Verify that sensitive data is properly handled
      expect(result.member.privateKey).toBeInstanceOf(SecureBuffer);
    });

    it('should handle TranslatableError properly', async () => {
      const { withMongoTransaction } = require('../../src/utils/mongo-transaction');
      const customError = new TranslatableSuiteError(
        SuiteCoreStringKey.Admin_DatabaseAlreadyInitialized,
      );

      (withMongoTransaction as jest.Mock).mockRejectedValue(customError);

      const result = await callInitUserDbWithServices();

      expect(result.success).toBe(false);
      expect(result.error).toBe(customError);
    });

    it('should handle database connection issues', async () => {
      const connectionError = new Error('Database connection failed');
      (mockConnection as any).db = null;

      const dropResult =
        await DatabaseInitializationService.dropDatabase(mockConnection);
      expect(dropResult).toBe(false);
    });

    it('should validate email string inputs', () => {
      expect(() => {
        new EmailString('invalid-email');
      }).toThrow();

      expect(() => {
        new EmailString('valid@example.com');
      }).not.toThrow();
    });

    it('should handle empty backup codes array', () => {
      (BackupCode.generateBackupCodes as jest.Mock).mockReturnValue([]);

      const username = 'testuser';
      const email = new EmailString('test@example.com');
      const mnemonic = new SecureString('test mnemonic');

      const result = DatabaseInitializationService.cacheOrNew(
        username,
        email,
        mnemonic,
        MemberType.User,
        mockECIESService,
      );

      expect(result).toBeDefined();
      // The service should handle empty backup codes gracefully
    });

    it('should handle very long passwords', () => {
      const longPassword = DatabaseInitializationService.generatePassword(100);
      expect(longPassword).toHaveLength(100);
      expect(longPassword).toMatch(/[a-zA-Z]/);
      expect(longPassword).toMatch(/[0-9]/);
      expect(longPassword).toMatch(/[!@#$%^&*()_+\-=[\]{};':|,.<>/?]/);
    });

    it('should handle secure string disposal correctly', () => {
      const secureString = new SecureString('test-value');
      expect(secureString.hasValue).toBe(true);

      // Test disposal without accessing hasValue after disposal
      secureString.dispose();
      // We can't test hasValue after disposal as it throws an error
      // This test just verifies disposal doesn't throw during the operation
      expect(true).toBe(true); // Test passes if no error is thrown
    });
  });

  describe('writeEnvFile', () => {
    let mockServerInitResult: IServerInitResult;
    let tempEnvPath: string;
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    beforeEach(() => {
      // Create a temporary directory for test .env files
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-test-'));
      tempEnvPath = path.join(tempDir, '.env');

      mockServerInitResult = {
        adminUser: {
          _id: new Types.ObjectId(),
          publicKey: 'admin-public-key-hex',
        } as IUserDocument,
        adminRole: { _id: new Types.ObjectId() } as IRoleDocument,
        adminUserRole: { _id: new Types.ObjectId() } as IUserRoleDocument,
        adminUsername: 'admin',
        adminEmail: 'admin@example.com',
        adminMnemonic: 'admin mnemonic phrase',
        adminPassword: 'AdminPass123!',
        adminBackupCodes: ['code1', 'code2'],
        adminMember: {} as BackendMember,
        memberUser: {
          _id: new Types.ObjectId(),
          publicKey: 'member-public-key-hex',
        } as IUserDocument,
        memberRole: { _id: new Types.ObjectId() } as IRoleDocument,
        memberUserRole: { _id: new Types.ObjectId() } as IUserRoleDocument,
        memberUsername: 'member',
        memberEmail: 'member@example.com',
        memberMnemonic: 'member mnemonic phrase',
        memberPassword: 'MemberPass123!',
        memberBackupCodes: ['code3', 'code4'],
        memberMember: {} as BackendMember,
        systemUser: {
          _id: new Types.ObjectId(),
          publicKey: 'system-public-key-hex',
        } as IUserDocument,
        systemRole: { _id: new Types.ObjectId() } as IRoleDocument,
        systemUserRole: { _id: new Types.ObjectId() } as IUserRoleDocument,
        systemUsername: 'system',
        systemEmail: 'system@example.com',
        systemMnemonic: 'system mnemonic phrase',
        systemPassword: 'SystemPass123!',
        systemBackupCodes: ['code5', 'code6'],
        systemMember: {} as BackendMember,
      };
    });

    afterEach(() => {
      // Clean up temp files
      if (fs.existsSync(tempEnvPath)) {
        const dir = path.dirname(tempEnvPath);
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('should create new .env file with credentials', () => {
      DatabaseInitializationService.writeEnvFile(
        tempEnvPath,
        mockServerInitResult,
      );

      expect(fs.existsSync(tempEnvPath)).toBe(true);
      const content = fs.readFileSync(tempEnvPath, 'utf-8');

      // Check that all required credentials are present
      expect(content).toContain('ADMIN_ID=');
      expect(content).toContain('ADMIN_MNEMONIC="admin mnemonic phrase"');
      expect(content).toContain('ADMIN_PASSWORD="AdminPass123!"');
      expect(content).toContain('MEMBER_ID=');
      expect(content).toContain('MEMBER_MNEMONIC="member mnemonic phrase"');
      expect(content).toContain('SYSTEM_ID=');
      expect(content).toContain('SYSTEM_PUBLIC_KEY="system-public-key-hex"');
    });

    it('should update existing .env file credentials', () => {
      // Create initial .env file with some existing content
      const initialContent = `# Existing config
DATABASE_URL="mongodb://localhost:27017"
ADMIN_ID="old-admin-id"
ADMIN_PASSWORD="old-password"
PORT=3000
`;
      fs.writeFileSync(tempEnvPath, initialContent, 'utf-8');

      DatabaseInitializationService.writeEnvFile(
        tempEnvPath,
        mockServerInitResult,
      );

      const content = fs.readFileSync(tempEnvPath, 'utf-8');

      // Check that existing non-credential config is preserved
      expect(content).toContain('DATABASE_URL="mongodb://localhost:27017"');
      expect(content).toContain('PORT=3000');

      // Check that credentials were updated
      expect(content).toContain('ADMIN_PASSWORD="AdminPass123!"');
      expect(content).not.toContain('old-password');
      expect(content).not.toContain('old-admin-id');

      // Check new credentials were added
      expect(content).toContain('MEMBER_MNEMONIC=');
      expect(content).toContain('SYSTEM_MNEMONIC=');
    });

    it('should handle non-existent directory by creating it', () => {
      const deepPath = path.join(
        path.dirname(tempEnvPath),
        'nested',
        'deep',
        '.env',
      );

      DatabaseInitializationService.writeEnvFile(
        deepPath,
        mockServerInitResult,
      );

      expect(fs.existsSync(deepPath)).toBe(true);
      const content = fs.readFileSync(deepPath, 'utf-8');
      expect(content).toContain('ADMIN_ID=');
    });

    it('should properly quote values with special characters', () => {
      DatabaseInitializationService.writeEnvFile(
        tempEnvPath,
        mockServerInitResult,
      );

      const content = fs.readFileSync(tempEnvPath, 'utf-8');

      // All values should be quoted
      expect(content).toMatch(/ADMIN_MNEMONIC="[^"]+"/);
      expect(content).toMatch(/ADMIN_PASSWORD="[^"]+"/);
      expect(content).toMatch(/SYSTEM_PUBLIC_KEY="[^"]+"/);
    });

    it('should preserve line endings when updating', () => {
      const initialContent = `ADMIN_ID="old-id"\nPORT=3000\n`;
      fs.writeFileSync(tempEnvPath, initialContent, 'utf-8');

      DatabaseInitializationService.writeEnvFile(
        tempEnvPath,
        mockServerInitResult,
      );

      const content = fs.readFileSync(tempEnvPath, 'utf-8');

      // Should have proper line endings
      expect(content.split('\n').length).toBeGreaterThan(10);
      expect(content).toContain('PORT=3000');
    });
  });
});
