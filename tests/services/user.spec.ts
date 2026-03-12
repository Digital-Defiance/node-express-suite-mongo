import { SecureString } from '@digitaldefiance/ecies-lib';
import { withConsoleMocks } from '@digitaldefiance/express-suite-test-utils';
import { Types } from '@digitaldefiance/mongoose-types';
import {
  Member as BackendMember,
  registerNodeRuntimeConfiguration,
} from '@digitaldefiance/node-ecies-lib';
import {
  AccountLockedError,
  AccountStatus,
  EmailInUseError,
  EmailTokenExpiredError,
  EmailTokenFailedToSendError,
  EmailTokenSentTooRecentlyError,
  EmailTokenType,
  EmailTokenUsedOrInvalidError,
  EmailVerifiedError,
  InvalidChallengeResponseError,
  InvalidCredentialsError,
  InvalidEmailError,
  InvalidNewPasswordError,
  InvalidUsernameError,
  LoginChallengeExpiredError,
  PasswordLoginNotEnabledError,
  UsernameInUseError,
  UsernameOrEmailRequiredError,
  UserNotFoundError,
} from '@digitaldefiance/suite-core-lib';
import { BackupCode } from '@digitaldefiance/node-express-suite';
import { IUserDocument } from '../../src/documents/user';
import { BaseModelName } from '../../src/enumerations/base-model-name';
import { IApplication } from '@digitaldefiance/node-express-suite';
import { IEmailService } from '@digitaldefiance/node-express-suite';
import { ModelRegistry } from '../../src/model-registry';
import { BackupCodeService } from '../../src/services/backup-code';
import { DirectLoginTokenService } from '../../src/services/direct-login-token';
import { ECIESService } from '@digitaldefiance/node-express-suite';
import { KeyWrappingService } from '@digitaldefiance/node-express-suite';
import { MnemonicService } from '../../src/services/mnemonic';
import { RequestUserService } from '../../src/services/request-user';
import { RoleService } from '../../src/services/role';
import { SystemUserService } from '@digitaldefiance/node-express-suite';
import { UserService } from '../../src/services/user';

describe('UserService', () => {
  let service: UserService<any, Types.ObjectId, Date, string, string>;
  let mockApplication: jest.Mocked<IApplication>;
  let mockRoleService: jest.Mocked<RoleService<Types.ObjectId, Date, any>>;
  let mockEmailService: jest.Mocked<IEmailService>;
  let mockKeyWrappingService: jest.Mocked<KeyWrappingService>;
  let mockBackupCodeService: jest.Mocked<
    BackupCodeService<Types.ObjectId, Date, any, any>
  >;
  let mockMnemonicService: jest.Mocked<
    MnemonicService<Types.ObjectId, Date, any>
  >;
  let mockEciesService: jest.Mocked<ECIESService>;
  let mockUserModel: any;
  let mockEmailTokenModel: any;
  let mockMnemonicModel: any;

  beforeAll(() => {
    registerNodeRuntimeConfiguration('default-config', {});
  });

  beforeEach(() => {
    mockUserModel = jest.fn() as any;
    mockUserModel.findOne = jest.fn();
    mockUserModel.findById = jest.fn();
    mockUserModel.find = jest.fn();
    mockUserModel.findByIdAndUpdate = jest.fn();
    mockUserModel.updateOne = jest.fn();
    mockUserModel.countDocuments = jest.fn();
    mockUserModel.exists = jest.fn();

    mockEmailTokenModel = {
      findOne: jest.fn(),
      find: jest.fn(),
      findOneAndUpdate: jest.fn(),
      deleteOne: jest.fn(),
      constructor: jest.fn(),
    };

    mockMnemonicModel = {
      findOne: jest.fn(),
      constructor: jest.fn(),
    };

    jest
      .spyOn(ModelRegistry.instance, 'getTypedModel')
      .mockImplementation((modelName: string) => {
        switch (modelName) {
          case BaseModelName.User:
            return mockUserModel;
          case BaseModelName.EmailToken:
            return mockEmailTokenModel;
          case BaseModelName.Mnemonic:
            return mockMnemonicModel;
          default:
            return {};
        }
      });

    jest
      .spyOn(ModelRegistry.instance, 'get')
      .mockImplementation((modelName: string) => {
        switch (modelName) {
          case 'User':
            return { model: mockUserModel } as any;
          default:
            return undefined;
        }
      });

    mockApplication = {
      environment: {
        serverUrl: 'http://localhost:3000',
        disableEmailSend: false,
        mnemonicHmacSecret: 'test-secret',
        debug: false,
        mongo: {
          transactionTimeout: 30000,
        },
      },
      constants: {
        UsernameRegex: /^[a-zA-Z0-9_-]{3,20}$/,
        PasswordRegex: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/,
        MemberRole: 'member',
        DirectLoginChallengeLength: 104,
        LoginChallengeExpiration: 60_000,
        EmailTokenLength: 32,
        EmailTokenExpiration: 3_600_000,
        EmailTokenResendInterval: 60_000,
        MnemonicRegex: /^[a-z ]+$/i,
        ECIES: {
          CURVE_NAME: 'secp256k1',
          PRIMARY_KEY_DERIVATION_PATH: "m/44'/60'/0'/0/0",
          MNEMONIC_STRENGTH: 256,
          SYMMETRIC_ALGORITHM_CONFIGURATION: 'aes-256-gcm',
          PUBLIC_KEY_MAGIC: 0x02,
          SIGNATURE_SIZE: 64,
          SYMMETRIC: {
            KEY_BITS: 256,
            MODE: 'gcm',
          },
        },
      },
      db: {
        connection: {
          readyState: 1, // connected
        },
      },
      getModel: jest.fn().mockImplementation((modelName: string) => {
        if (modelName === BaseModelName.EmailToken) {
          return mockEmailTokenModel;
        }
        return mockUserModel;
      }),
    } as any;

    mockRoleService = {
      getUserRoles: jest.fn(),
      isUserAdmin: jest.fn(),
      rolesToTokenRoles: jest.fn(),
      getRoleIdByName: jest.fn(),
      addUserToRole: jest.fn(),
    } as any;

    mockEmailService = {
      sendEmail: jest.fn(),
    } as any;

    mockKeyWrappingService = {
      wrapSecret: jest.fn(),
      unwrapSecretAsync: jest.fn(),
      unwrapSecret: jest.fn(),
    } as any;

    mockBackupCodeService = {} as any;

    service = new UserService(
      mockApplication,
      mockRoleService,
      mockEmailService,
      mockKeyWrappingService,
      mockBackupCodeService,
    );

    // Mock the internal services
    (service as any).mnemonicService = {
      mnemonicExists: jest.fn(),
      addMnemonic: jest.fn(),
      getMnemonicHmac: jest.fn(),
    };
    (service as any).eciesService = {
      generateKeyPair: jest.fn(),
      walletAndSeedFromMnemonic: jest.fn(),
      getPublicKey: jest
        .fn()
        .mockReturnValue(Buffer.from([0x02, ...Array(32).fill(1)])),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('userToUserDTO', () => {
    it('should convert user document to DTO with string IDs', () => {
      const userId = new Types.ObjectId();
      const createdBy = new Types.ObjectId();
      const updatedBy = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        username: 'testuser',
        email: 'test@example.com',
        createdAt: new Date(),
        createdBy: createdBy, // This is ObjectId, not Date
        updatedAt: new Date(),
        updatedBy: updatedBy, // This is ObjectId, not Date
        accountStatus: AccountStatus.Active,
      };

      const result = UserService.userToUserDTO(userDoc);

      expect(result._id).toBe(userId.toString());
      expect(result.username).toBe('testuser');
      expect(result.email).toBe('test@example.com');
      // createdBy and updatedBy ARE converted to strings in userToUserDTO
      expect(result.createdBy).toBe(createdBy.toString());
      expect(result.updatedBy).toBe(updatedBy.toString());
    });

    it('should handle optional lastLogin field', () => {
      const lastLogin = new Date();
      const userDoc = {
        _id: new Types.ObjectId(),
        username: 'testuser',
        createdAt: new Date(),
        createdBy: new Types.ObjectId(),
        updatedAt: new Date(),
        updatedBy: new Types.ObjectId(),
        lastLogin: lastLogin,
      };

      const result = UserService.userToUserDTO(userDoc);

      expect(result.lastLogin).toBeDefined();
      expect(typeof result.lastLogin).toBe('string');
    });

    it('should handle deletedBy field when it is an ObjectId', () => {
      const deletedBy = new Types.ObjectId();
      const userDoc = {
        _id: new Types.ObjectId(),
        username: 'testuser',
        createdAt: new Date(),
        createdBy: new Types.ObjectId(),
        updatedAt: new Date(),
        updatedBy: new Types.ObjectId(),
        deletedBy: deletedBy,
      };

      const result = UserService.userToUserDTO(userDoc);

      expect(result.deletedBy).toBeDefined();
      expect(typeof result.deletedBy).toBe('string');
      expect(result.deletedBy).toBe(deletedBy.toString());
    });
  });

  describe('hydrateUserDTOToBackend', () => {
    it('should convert DTO back to backend object with ObjectIds', () => {
      const dto = {
        _id: new Types.ObjectId().toString(),
        username: 'testuser',
        email: 'test@example.com',
        createdAt: new Date().toISOString(),
        createdBy: new Types.ObjectId().toString(),
        updatedAt: new Date().toISOString(),
        updatedBy: new Types.ObjectId().toString(),
      } as any;

      const result = service.hydrateUserDTOToBackend(dto);

      expect(Types.ObjectId.isValid(result._id)).toBe(true);
      expect(Types.ObjectId.isValid(result.createdBy)).toBe(true);
      expect(Types.ObjectId.isValid(result.updatedBy)).toBe(true);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should handle optional fields', () => {
      const dto = {
        _id: new Types.ObjectId().toString(),
        username: 'testuser',
        createdAt: new Date().toISOString(),
        createdBy: new Types.ObjectId().toString(),
        updatedAt: new Date().toISOString(),
        updatedBy: new Types.ObjectId().toString(),
        lastLogin: new Date().toISOString(),
        deletedAt: new Date().toISOString(),
        deletedBy: new Types.ObjectId().toString(),
        mnemonicId: new Types.ObjectId().toString(),
      } as any;

      const result = service.hydrateUserDTOToBackend(dto);

      expect(result.lastLogin).toBeInstanceOf(Date);
      expect(result.deletedAt).toBeInstanceOf(Date);
      expect(Types.ObjectId.isValid(result.deletedBy)).toBe(true);
      expect(Types.ObjectId.isValid(result.mnemonicId)).toBe(true);
    });
  });

  describe('findUser', () => {
    it('should find user by username', async () => {
      const userId = new Types.ObjectId();
      const mockUser = {
        _id: userId,
        username: 'testuser',
        email: 'test@example.com',
        deletedAt: null,
        accountStatus: AccountStatus.Active,
      };

      const execMock = jest.fn().mockResolvedValue(mockUser);
      const sessionMock = jest.fn().mockReturnValue({ exec: execMock });
      const collationMock = jest.fn().mockReturnValue({ session: sessionMock });

      mockUserModel.findOne = jest.fn().mockReturnValue({
        collation: collationMock,
      });

      const result = await service.findUser(undefined, 'testuser');

      expect(result).toBeDefined();
      expect(result._id).toEqual(userId);
      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        username: 'testuser',
      });
    });

    it('should find user by email', async () => {
      const mockUser = {
        _id: new Types.ObjectId(),
        username: 'testuser',
        email: 'test@example.com',
        deletedAt: null,
        accountStatus: AccountStatus.Active,
      };

      const execMock = jest.fn().mockResolvedValue(mockUser);
      const sessionMock = jest.fn().mockReturnValue({ exec: execMock });

      mockUserModel.findOne = jest.fn().mockReturnValue({
        session: sessionMock,
      });

      const result = await service.findUser('test@example.com');

      expect(result).toBeDefined();
      expect(result.email).toBe('test@example.com');
      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        email: 'test@example.com',
      });
    });

    it('should throw InvalidEmailError when user not found by email', async () => {
      const execMock = jest.fn().mockResolvedValue(null);
      const sessionMock = jest.fn().mockReturnValue({ exec: execMock });

      mockUserModel.findOne = jest.fn().mockReturnValue({
        session: sessionMock,
      });

      await expect(
        service.findUser('nonexistent@example.com'),
      ).rejects.toThrow();
    });

    it('should throw UsernameOrEmailRequiredError when neither provided', async () => {
      await expect(service.findUser()).rejects.toThrow(
        UsernameOrEmailRequiredError,
      );
    });

    it('should throw InvalidCredentialsError on database error', async () => {
      mockUserModel.findOne = jest.fn().mockReturnValue({
        session: jest.fn().mockReturnValue({
          exec: jest.fn().mockRejectedValue(new Error('DB Error')),
        }),
      });

      await expect(service.findUser('test@example.com')).rejects.toThrow(
        InvalidCredentialsError,
      );
    });
  });

  describe('findUserById', () => {
    it('should find user by ID', async () => {
      const userId = new Types.ObjectId();
      const mockUser = {
        _id: userId,
        username: 'testuser',
        deletedAt: null,
        accountStatus: AccountStatus.Active,
      };

      const execMock = jest.fn().mockResolvedValue(mockUser);
      const sessionMock = jest.fn().mockReturnValue({ exec: execMock });

      mockUserModel.findById = jest.fn().mockReturnValue({
        session: sessionMock,
      });

      const result = await service.findUserById(userId, false);

      expect(result).toBeDefined();
      expect(result?._id).toEqual(userId);
      expect(mockUserModel.findById).toHaveBeenCalledWith(userId);
    });

    it('should throw UserNotFoundError when user not found by ID', async () => {
      const execMock = jest.fn().mockResolvedValue(null);
      const sessionMock = jest.fn().mockReturnValue({ exec: execMock });

      mockUserModel.findById = jest.fn().mockReturnValue({
        session: sessionMock,
      });

      await expect(
        service.findUserById(new Types.ObjectId(), false),
      ).rejects.toThrow();
    });

    it('should respect projection parameter', async () => {
      const userId = new Types.ObjectId();
      const mockUser = {
        _id: userId,
        username: 'testuser',
      };

      const execMock = jest.fn().mockResolvedValue(mockUser);
      const sessionMock = jest.fn().mockReturnValue({ exec: execMock });
      const selectMock = jest.fn().mockReturnValue({ session: sessionMock });

      mockUserModel.findById = jest.fn().mockReturnValue({
        session: jest.fn().mockReturnValue({
          select: selectMock,
          exec: execMock,
        }),
      });

      await service.findUserById(userId, false, undefined, { username: 1 });

      expect(mockUserModel.findById).toHaveBeenCalledWith(userId);
    });
  });

  describe('fillUserDefaults', () => {
    it('should fill in default values for new user', () => {
      const createdBy = new Types.ObjectId();
      const newUser = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'hashedpassword',
      } as any;
      const backupCodes = [];
      const encryptedMnemonic = 'encrypted';

      const result = service.fillUserDefaults(
        newUser,
        createdBy,
        backupCodes,
        encryptedMnemonic,
      );

      expect(result.accountStatus).toBe(AccountStatus.PendingEmailVerification);
      expect(result.timezone).toBe('UTC');
      expect(result.siteLanguage).toBe('en-US');
      expect(result.emailVerified).toBe(false);
      expect(result.email).toBe('test@example.com');
      expect(result.createdBy).toEqual(createdBy);
    });

    it('should not override provided email and convert to lowercase', () => {
      const createdBy = new Types.ObjectId();
      const newUser = {
        username: 'testuser',
        email: 'TEST@EXAMPLE.COM',
        password: 'hashedpassword',
      } as any;

      const result = service.fillUserDefaults(
        newUser,
        createdBy,
        [],
        'encrypted',
      );

      expect(result.email).toBe('test@example.com');
    });

    it('should include userId if provided', () => {
      const createdBy = new Types.ObjectId();
      const userId = new Types.ObjectId();
      const newUser = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'hashedpassword',
      } as any;

      const result = service.fillUserDefaults(
        newUser,
        createdBy,
        [],
        'encrypted',
        userId,
      );

      expect(result._id).toEqual(userId);
    });
  });

  describe('updateLastLogin', () => {
    it('should update user lastLogin timestamp', async () => {
      const userId = new Types.ObjectId();
      const sessionMock = jest.fn().mockResolvedValue({});

      mockUserModel.updateOne = jest.fn().mockReturnValue({
        session: sessionMock,
      });

      await service.updateLastLogin(userId);

      expect(mockUserModel.updateOne).toHaveBeenCalledWith(
        { _id: userId },
        expect.objectContaining({
          $set: expect.objectContaining({
            lastLogin: expect.any(Date),
          }),
        }),
        expect.any(Object), // Options like runValidators, upsert
      );
    });

    it('should return silently if database connection is not open', async () => {
      const userId = new Types.ObjectId();

      // Mock closed connection
      mockApplication.db.connection.readyState = 0;

      await service.updateLastLogin(userId);

      // Should not attempt to call updateOne
      expect(mockUserModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('makeUserDoc', () => {
    it('should create a new user document', async () => {
      const newUser = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'hashedpass',
        accountStatus: AccountStatus.PendingEmailVerification,
      } as any;

      const mockDoc = {
        ...newUser,
        validateSync: jest.fn().mockReturnValue(null),
      };

      // Replace the model with a constructor mock
      const UserModelConstructor = jest.fn().mockImplementation(() => mockDoc);
      jest
        .spyOn(ModelRegistry.instance, 'getTypedModel')
        .mockImplementation((modelName: string) => {
          if (modelName === BaseModelName.User) {
            return UserModelConstructor as any;
          }
          return mockUserModel;
        });

      const result = await service.makeUserDoc(newUser);

      expect(result).toBeDefined();
      expect(result.validateSync).toHaveBeenCalled();
      expect(UserModelConstructor).toHaveBeenCalledWith(newUser);
    });
  });

  describe('createEmailToken', () => {
    beforeEach(() => {
      mockApplication.constants.EmailTokenLength = 32;
      mockApplication.constants.EmailTokenExpiration = 3600000; // 1 hour
    });

    it('should create email token with session', async () => {
      const userId = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        email: 'test@example.com',
      } as any;

      const mockToken = {
        userId,
        email: 'test@example.com',
        token: 'abc123',
        type: 'verification',
        expiresAt: new Date(),
      };

      mockEmailTokenModel.findOneAndUpdate = jest
        .fn()
        .mockResolvedValue(mockToken);

      const result = await service.createEmailToken(
        userDoc,
        'verification' as any,
        {} as any,
      );

      expect(result).toBeDefined();
      expect(mockEmailTokenModel.findOneAndUpdate).toHaveBeenCalled();
    });

    it('should throw error if email token creation fails', async () => {
      const userId = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        email: 'test@example.com',
      } as any;

      mockEmailTokenModel.findOneAndUpdate = jest.fn().mockResolvedValue(null);

      await expect(
        service.createEmailToken(userDoc, 'verification' as any, {} as any),
      ).rejects.toThrow();
    });
  });

  describe('createAndSendEmailToken', () => {
    let createEmailTokenSpy: jest.SpyInstance;
    let sendEmailTokenSpy: jest.SpyInstance;
    const userDoc = {
      _id: new Types.ObjectId(),
      email: 'combo@example.com',
    } as any;
    const emailToken = { token: 'abc123' } as any;

    beforeEach(() => {
      createEmailTokenSpy = jest
        .spyOn(service, 'createEmailToken')
        .mockResolvedValue(emailToken);
      sendEmailTokenSpy = jest
        .spyOn(service, 'sendEmailToken')
        .mockResolvedValue(undefined);
    });

    afterEach(() => {
      createEmailTokenSpy.mockRestore();
      sendEmailTokenSpy.mockRestore();
    });

    it('should create and send an email token', async () => {
      const result = await service.createAndSendEmailToken(
        userDoc,
        EmailTokenType.AccountVerification,
        undefined,
        true,
      );

      expect(createEmailTokenSpy).toHaveBeenCalledWith(
        userDoc,
        EmailTokenType.AccountVerification,
        undefined,
      );
      expect(sendEmailTokenSpy).toHaveBeenCalledWith(
        emailToken,
        undefined,
        true,
      );
      expect(result).toBe(emailToken);
    });

    it('should still resolve when email sending fails', async () => {
      sendEmailTokenSpy.mockRejectedValue(new Error('smtp down'));

      const result = await service.createAndSendEmailToken(
        userDoc,
        EmailTokenType.PasswordReset,
      );

      expect(result).toBe(emailToken);
    });
  });

  describe('createAndSendEmailTokenDirect', () => {
    let sendEmailTokenSpy: jest.SpyInstance;
    const session = { id: 'session' } as any;

    beforeEach(() => {
      sendEmailTokenSpy = jest
        .spyOn(service, 'sendEmailToken')
        .mockResolvedValue(undefined);
    });

    afterEach(() => {
      sendEmailTokenSpy.mockRestore();
    });

    it('should upsert token inside session and send email', async () => {
      const userDoc = {
        _id: new Types.ObjectId(),
        email: 'direct@example.com',
      } as any;
      const tokenDoc = { token: 'direct-token' } as any;
      mockEmailTokenModel.findOneAndUpdate = jest
        .fn()
        .mockResolvedValue(tokenDoc);

      const result = await service.createAndSendEmailTokenDirect(
        userDoc,
        EmailTokenType.LoginRequest,
        session,
        true,
      );

      expect(mockEmailTokenModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          userId: userDoc._id,
          email: userDoc.email,
          type: EmailTokenType.LoginRequest,
        },
        expect.objectContaining({ userId: userDoc._id }),
        expect.objectContaining({ session, upsert: true, new: true }),
      );
      expect(sendEmailTokenSpy).toHaveBeenCalledWith(tokenDoc, session, true);
      expect(result).toBe(tokenDoc);
    });

    it('should ignore email send failures', async () => {
      const userDoc = {
        _id: new Types.ObjectId(),
        email: 'direct@example.com',
      } as any;
      const tokenDoc = { token: 'direct-token' } as any;
      mockEmailTokenModel.findOneAndUpdate = jest
        .fn()
        .mockResolvedValue(tokenDoc);
      sendEmailTokenSpy.mockRejectedValue(new Error('email offline'));

      const result = await service.createAndSendEmailTokenDirect(
        userDoc,
        EmailTokenType.AccountVerification,
        session,
      );

      expect(result).toBe(tokenDoc);
    });

    it('should throw when token creation fails', async () => {
      const userDoc = {
        _id: new Types.ObjectId(),
        email: 'direct@example.com',
      } as any;
      mockEmailTokenModel.findOneAndUpdate = jest.fn().mockResolvedValue(null);

      await expect(
        service.createAndSendEmailTokenDirect(
          userDoc,
          EmailTokenType.AccountVerification,
          session,
        ),
      ).rejects.toThrow();
    });
  });

  describe('ensureRequiredFieldsInProjection', () => {
    it('should handle string projection with inclusions', () => {
      const service_any = service as any;
      const result = service_any.ensureRequiredFieldsInProjection(
        'username email',
        ['accountStatus'],
      );

      expect(result).toContain('username');
      expect(result).toContain('email');
      expect(result).toContain('accountStatus');
    });

    it('should handle string projection with exclusions', () => {
      const service_any = service as any;
      const result = service_any.ensureRequiredFieldsInProjection(
        '-password -secret',
        ['password'],
      );

      // Required field 'password' should not be excluded
      expect(result).toContain('password');
      expect(result).toContain('-secret');
      expect(result).not.toContain('-password');
    });

    it('should handle object projection with inclusions', () => {
      const service_any = service as any;
      const result = service_any.ensureRequiredFieldsInProjection(
        { username: 1, email: 1 },
        ['accountStatus', 'deletedAt'],
      );

      expect(result.username).toBe(1);
      expect(result.email).toBe(1);
      expect(result.accountStatus).toBe(1);
      expect(result.deletedAt).toBe(1);
    });

    it('should handle object projection with exclusions', () => {
      const service_any = service as any;
      const result = service_any.ensureRequiredFieldsInProjection(
        { password: 0, secret: 0 },
        ['password'],
      );

      // Required field 'password' should not be excluded
      expect(result.password).toBeUndefined();
      expect(result.secret).toBe(0);
    });

    it('should handle boolean projection values', () => {
      const service_any = service as any;
      const result = service_any.ensureRequiredFieldsInProjection(
        { username: true, email: true },
        ['accountStatus'],
      );

      expect(result.username).toBe(true);
      expect(result.accountStatus).toBe(1);
    });
  });

  describe('recoverMnemonic', () => {
    it('should recover mnemonic from encrypted data', () => {
      const mockUser = {
        decryptData: jest
          .fn()
          .mockReturnValue(Buffer.from('test mnemonic words')),
      } as any;

      const encryptedMnemonic = Buffer.from('encrypted').toString('hex');

      const result = service.recoverMnemonic(mockUser, encryptedMnemonic);

      expect(result).toBeDefined();
      expect(mockUser.decryptData).toHaveBeenCalledWith(
        Buffer.from(encryptedMnemonic, 'hex'),
      );
    });

    it('should throw error if encrypted mnemonic is missing', () => {
      const mockUser = {} as any;

      expect(() => service.recoverMnemonic(mockUser, '')).toThrow();
    });
  });

  describe('getEncryptedUserBackupCodes', () => {
    it('should retrieve backup codes for a user', async () => {
      const userId = new Types.ObjectId();
      const mockBackupCodes = [{ code: 'abc123', used: false }];
      const mockUser = {
        _id: userId,
        backupCodes: mockBackupCodes,
        accountStatus: AccountStatus.Active,
        deletedAt: null,
      };

      const execMock = jest.fn().mockResolvedValue(mockUser);
      const selectMock = jest.fn().mockReturnValue({ exec: execMock });
      const sessionMock = jest
        .fn()
        .mockReturnValue({ select: selectMock, exec: execMock });

      mockUserModel.findById = jest.fn().mockReturnValue({
        session: sessionMock,
      });

      const result = await service.getEncryptedUserBackupCodes(userId);

      expect(result).toEqual(mockBackupCodes);
      expect(mockUserModel.findById).toHaveBeenCalledWith(userId);
    });
  });

  describe('findEmailToken', () => {
    it('should find unexpired email token', async () => {
      const mockToken = {
        token: 'abc123',
        type: 'verification',
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockEmailTokenModel.findOne = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(mockToken),
      });

      const result = await service.findEmailToken(
        'abc123',
        'verification' as any,
      );

      expect(result).toEqual(mockToken);
      expect(mockEmailTokenModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'abc123',
          type: 'verification',
          expiresAt: expect.objectContaining({ $gt: expect.any(Date) }),
        }),
      );
    });

    it('should find token without type filter', async () => {
      const mockToken = {
        token: 'abc123',
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockEmailTokenModel.findOne = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(mockToken),
      });

      await service.findEmailToken('abc123');

      expect(mockEmailTokenModel.findOne).toHaveBeenCalledWith(
        expect.not.objectContaining({
          type: expect.anything(),
        }),
      );
    });

    it('should return null if token not found', async () => {
      mockEmailTokenModel.findOne = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });

      const result = await service.findEmailToken('nonexistent');

      expect(result).toBeNull();
    });

    it('should trim and lowercase token', async () => {
      mockEmailTokenModel.findOne = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });

      await service.findEmailToken('  ABC123  ');

      expect(mockEmailTokenModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'abc123',
        }),
      );
    });
  });

  describe('Account status handling', () => {
    it('should allow Active users in findUser', async () => {
      const mockUser = {
        _id: new Types.ObjectId(),
        username: 'activeuser',
        accountStatus: AccountStatus.Active,
        deletedAt: null,
      };

      const execMock = jest.fn().mockResolvedValue(mockUser);
      const sessionMock = jest.fn().mockReturnValue({ exec: execMock });
      const collationMock = jest.fn().mockReturnValue({ session: sessionMock });

      mockUserModel.findOne = jest.fn().mockReturnValue({
        collation: collationMock,
      });

      const result = await service.findUser(undefined, 'activeuser');

      expect(result).toEqual(mockUser);
    });

    it('should reject PendingEmailVerification users in findUser', async () => {
      const mockUser = {
        _id: new Types.ObjectId(),
        username: 'pendinguser',
        accountStatus: AccountStatus.PendingEmailVerification,
        deletedAt: null,
      };

      const execMock = jest.fn().mockResolvedValue(mockUser);
      const sessionMock = jest.fn().mockReturnValue({ exec: execMock });
      const collationMock = jest.fn().mockReturnValue({ session: sessionMock });

      mockUserModel.findOne = jest.fn().mockReturnValue({
        collation: collationMock,
      });

      await expect(
        service.findUser(undefined, 'pendinguser'),
      ).rejects.toThrow();
    });

    it('should reject AdminLock users in findUser', async () => {
      const mockUser = {
        _id: new Types.ObjectId(),
        username: 'lockeduser',
        accountStatus: AccountStatus.AdminLock,
        deletedAt: null,
      };

      const execMock = jest.fn().mockResolvedValue(mockUser);
      const sessionMock = jest.fn().mockReturnValue({ exec: execMock });
      const collationMock = jest.fn().mockReturnValue({ session: sessionMock });

      mockUserModel.findOne = jest.fn().mockReturnValue({
        collation: collationMock,
      });

      await expect(service.findUser(undefined, 'lockeduser')).rejects.toThrow();
    });
  });

  describe('newUser', () => {
    let mockSystemUser: BackendMember;
    let withTransactionSpy: jest.SpyInstance;

    beforeEach(() => {
      // Create a mock system user
      mockSystemUser = {
        publicKey: Buffer.from('mock-public-key'),
        privateKey: { value: Buffer.from('mock-private-key') },
        encryptData: jest.fn().mockReturnValue(Buffer.from('encrypted-data')),
      } as any;

      withTransactionSpy = jest
        .spyOn(service as any, 'withTransaction')
        .mockImplementation(async (callback: any) => callback(undefined));
    });

    it('should reject invalid username', async () => {
      const userData = {
        username: 'ab', // Too short
        email: 'test@example.com',
      };

      await expect(service.newUser(mockSystemUser, userData)).rejects.toThrow(
        InvalidUsernameError,
      );
    });

    it('should reject invalid password', async () => {
      const userData = {
        username: 'validuser',
        email: 'test@example.com',
      };

      await expect(
        service.newUser(
          mockSystemUser,
          userData,
          undefined,
          undefined,
          undefined,
          false,
          'weak',
        ),
      ).rejects.toThrow(InvalidNewPasswordError);
    });

    it('should reject duplicate email', async () => {
      const userData = {
        username: 'newuser',
        email: 'existing@example.com',
      };

      const existingUser = {
        _id: new Types.ObjectId(),
        email: 'existing@example.com',
      };

      mockUserModel.findOne = jest.fn().mockImplementation((query: any) => {
        return {
          session: jest
            .fn()
            .mockReturnValue(
              Promise.resolve(query.email ? existingUser : null),
            ),
        };
      });

      await expect(service.newUser(mockSystemUser, userData)).rejects.toThrow(
        EmailInUseError,
      );
    });

    it('should reject duplicate username', async () => {
      const userData = {
        username: 'existinguser',
        email: 'new@example.com',
      };

      const existingUser = {
        _id: new Types.ObjectId(),
        username: 'existinguser',
      };

      mockUserModel.findOne = jest.fn().mockImplementation((query: any) => {
        return {
          session: jest
            .fn()
            .mockReturnValue(
              Promise.resolve(query.username ? existingUser : null),
            ),
        };
      });

      await expect(service.newUser(mockSystemUser, userData)).rejects.toThrow(
        UsernameInUseError,
      );
    });

    it('should create a new user with encrypted secrets and role assignment', async () => {
      const userData = {
        username: 'newmember',
        email: 'newmember@example.com',
      };

      const memberRoleId = new Types.ObjectId();
      mockRoleService.getRoleIdByName.mockResolvedValue(memberRoleId);
      mockRoleService.addUserToRole.mockResolvedValue(undefined as any);

      const generatedCodes = [{ value: 'code1' }, { value: 'code2' }] as any;
      const encryptedCodes = [{ value: 'enc1' }, { value: 'enc2' }] as any;
      jest
        .spyOn(BackupCode, 'generateBackupCodes')
        .mockReturnValue(generatedCodes);
      jest
        .spyOn(BackupCode, 'encryptBackupCodes')
        .mockResolvedValue(encryptedCodes);

      const mnemonicDocId = new Types.ObjectId();
      (service as any).mnemonicService.mnemonicExists.mockResolvedValue(false);
      (service as any).mnemonicService.addMnemonic.mockResolvedValue({
        _id: mnemonicDocId,
      });

      const backendMember = {
        publicKey: Buffer.from('abcd', 'hex'),
        encryptData: jest
          .fn()
          .mockReturnValue(Buffer.from('encrypted-mnemonic')),
      } as any;
      const mnemonic = { value: 'test mnemonic', dispose: jest.fn() } as any;
      jest.spyOn(BackendMember, 'newMember').mockReturnValue({
        member: backendMember,
        mnemonic,
      });

      const saveResult = {
        _id: new Types.ObjectId(),
        username: userData.username,
        email: userData.email,
      } as any;
      const saveMock = jest.fn().mockResolvedValue(saveResult);
      const validateMock = jest.fn().mockReturnValue(undefined);

      const userModelConstructor: any = jest.fn().mockImplementation((doc) => ({
        ...doc,
        save: saveMock,
        validateSync: validateMock,
      }));
      userModelConstructor.findOne = jest.fn().mockReturnValue({
        session: jest.fn().mockReturnValue(Promise.resolve(null)),
      });
      userModelConstructor.findById = mockUserModel.findById;
      mockUserModel = userModelConstructor;

      const result = await service.newUser(mockSystemUser, userData);

      expect(result.user).toBe(saveResult);
      expect(result.mnemonic).toBe('test mnemonic');
      expect(result.backupCodes).toEqual(['code1', 'code2']);
      const addUserToRoleCall = mockRoleService.addUserToRole.mock.calls[0];
      expect(addUserToRoleCall[0]).toBe(memberRoleId);
      expect(addUserToRoleCall[1]).toBe(saveResult._id);
      expect(Types.ObjectId.isValid(addUserToRoleCall[2])).toBe(true);
      expect(addUserToRoleCall[3]).toBeUndefined();
      expect(saveMock).toHaveBeenCalled();
      expect(validateMock).toHaveBeenCalled();
    });
  });

  describe('challengeUserWithMnemonic', () => {
    let userDoc: IUserDocument;
    let mnemonic: SecureString;
    let makeUserSpy: jest.SpyInstance;
    let systemUserSpy: jest.SpyInstance;

    const setupMnemonicDoc = (doc: any) => {
      const execMock = jest.fn().mockResolvedValue(doc);
      const leanMock = jest.fn().mockReturnValue({ exec: execMock });
      const sessionMock = jest.fn().mockReturnValue({ lean: leanMock });
      const selectMock = jest.fn().mockReturnValue({ session: sessionMock });
      mockMnemonicModel.findById = jest
        .fn()
        .mockReturnValue({ select: selectMock });
      return { execMock, leanMock, sessionMock, selectMock };
    };

    beforeEach(() => {
      userDoc = {
        _id: new Types.ObjectId(),
        username: 'challengeuser',
        email: 'challenge@example.com',
        accountStatus: AccountStatus.Active,
        deletedAt: null,
        mnemonicId: new Types.ObjectId(),
        publicKey: Buffer.from('a1b2', 'hex').toString('hex'),
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: new Types.ObjectId(),
      } as any;

      mnemonic = new SecureString(
        'legal winner thank year wave sausage worth useful legal winner thank yellow',
      );

      const wallet = {
        getPrivateKey: jest.fn().mockReturnValue(Buffer.alloc(32, 1)),
        getPublicKey: jest
          .fn()
          .mockReturnValue(
            Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, 2)]),
          ),
      };
      (service as any).eciesService.walletAndSeedFromMnemonic.mockReturnValue({
        wallet,
      });

      const userMember = {
        publicKey: Buffer.from(userDoc.publicKey, 'hex'),
        encryptData: jest.fn((payload: Buffer) => payload),
        decryptData: jest.fn((payload: Buffer) => payload),
        hasPrivateKey: true,
      } as any;

      makeUserSpy = jest
        .spyOn(service as any, 'makeUserFromUserDoc')
        .mockResolvedValue(userMember);

      systemUserSpy = jest
        .spyOn(SystemUserService, 'getSystemUser')
        .mockReturnValue({
          sign: jest.fn((nonce: Buffer) =>
            Buffer.concat([nonce, Buffer.alloc(32, 3)]),
          ),
          verify: jest.fn().mockReturnValue(true),
        } as any);

      (service as any).mnemonicService.getMnemonicHmac.mockReturnValue(
        'expected-hmac',
      );
    });

    afterEach(() => {
      mnemonic.dispose();
      makeUserSpy.mockRestore();
      systemUserSpy.mockRestore();
    });

    it('should return members when mnemonic matches stored hmac', async () => {
      await withConsoleMocks({ mute: true }, async () => {
        setupMnemonicDoc({ _id: userDoc.mnemonicId, hmac: 'expected-hmac' });

        const result = await service.challengeUserWithMnemonic(
          userDoc,
          mnemonic,
        );

        expect(result.userMember).toBeDefined();
        expect(result.adminMember).toBeDefined();
        expect(makeUserSpy).toHaveBeenCalled();
      });
    });

    it('should throw InvalidCredentialsError when mnemonic mismatches', async () => {
      await withConsoleMocks({ mute: true }, async () => {
        setupMnemonicDoc({ _id: userDoc.mnemonicId, hmac: 'stored-hmac' });
        (service as any).mnemonicService.getMnemonicHmac.mockReturnValue(
          'different-hmac',
        );

        await expect(
          service.challengeUserWithMnemonic(userDoc, mnemonic),
        ).rejects.toThrow(InvalidCredentialsError);
      });
    });

    it('should throw InvalidCredentialsError when mnemonic doc missing', async () => {
      setupMnemonicDoc(null);

      await expect(
        service.challengeUserWithMnemonic(userDoc, mnemonic),
      ).rejects.toThrow(InvalidCredentialsError);
    });
  });

  describe('loginWithMnemonic', () => {
    let mnemonic: SecureString;
    let challengeSpy: jest.SpyInstance;

    beforeEach(() => {
      mnemonic = new SecureString('test mnemonic');
      challengeSpy = jest
        .spyOn(service as any, 'challengeUserWithMnemonic')
        .mockResolvedValue({
          userMember: { id: 'member' } as any,
          adminMember: { id: 'admin' } as any,
        });
    });

    afterEach(() => {
      mnemonic.dispose();
      challengeSpy.mockRestore();
    });

    const createQueryChain = (result: any) => {
      const sessionMock = jest.fn().mockResolvedValue(result);
      const selectMock = jest.fn().mockReturnValue({ session: sessionMock });
      return { select: selectMock, sessionMock };
    };

    it('should authenticate user via email and return challenge response', async () => {
      const userDoc = {
        _id: new Types.ObjectId(),
        email: 'user@example.com',
        username: 'user',
        accountStatus: AccountStatus.Active,
        deletedAt: null,
      } as IUserDocument;

      const { select, sessionMock } = createQueryChain(userDoc);
      mockUserModel.findOne.mockImplementation((query: any) => {
        if (query.email) {
          return { select };
        }
        return { select, collation: jest.fn().mockReturnValue({ select }) };
      });

      const result = await service.loginWithMnemonic(
        'user@example.com',
        mnemonic,
      );

      expect(sessionMock).toHaveBeenCalledWith(null);
      expect(challengeSpy).toHaveBeenCalledWith(userDoc, mnemonic, undefined);
      expect(result.userDoc).toBe(userDoc);
      expect(result.userMember).toEqual({ id: 'member' });
      expect(result.adminMember).toEqual({ id: 'admin' });
    });

    it('should throw AccountLockedError when user is locked', async () => {
      const lockedUser = {
        _id: new Types.ObjectId(),
        email: 'locked@example.com',
        username: 'locked',
        accountStatus: AccountStatus.AdminLock,
        deletedAt: null,
      } as IUserDocument;

      const { select } = createQueryChain(lockedUser);
      mockUserModel.findOne.mockReturnValue({
        collation: jest.fn().mockReturnValue({ select }),
        select,
      });

      await expect(
        service.loginWithMnemonic('locked', mnemonic),
      ).rejects.toThrow(AccountLockedError);

      expect(challengeSpy).not.toHaveBeenCalled();
    });

    it('should throw InvalidCredentialsError when user not found', async () => {
      const sessionMock = jest.fn().mockResolvedValue(null);
      const selectMock = jest.fn().mockReturnValue({ session: sessionMock });
      mockUserModel.findOne.mockReturnValue({ select: selectMock });

      await expect(
        service.loginWithMnemonic('missing@example.com', mnemonic),
      ).rejects.toThrow(InvalidCredentialsError);

      expect(challengeSpy).not.toHaveBeenCalled();
    });
  });

  describe('loginWithClientVerifiedChallenge', () => {
    let mnemonic: SecureString;
    let userDoc: IUserDocument;
    let makeUserSpy: jest.SpyInstance;
    let systemUserSpy: jest.SpyInstance;
    let mnemonicModelViaApplication: { findById: jest.Mock };
    const rawPublicKey = Buffer.alloc(32, 9);

    const wireEmailQuery = (result: any) => {
      const sessionMock = jest.fn().mockResolvedValue(result);
      const selectMock = jest.fn().mockReturnValue({ session: sessionMock });
      mockUserModel.findOne = jest.fn().mockReturnValue({ select: selectMock });
      return { sessionMock };
    };

    const wireUsernameQuery = (result: any) => {
      const sessionMock = jest.fn().mockResolvedValue(result);
      const selectMock = jest.fn().mockReturnValue({ session: sessionMock });
      const collationMock = jest.fn().mockReturnValue({ select: selectMock });
      mockUserModel.findOne = jest
        .fn()
        .mockReturnValue({ collation: collationMock });
      return { collationMock };
    };

    const wireMnemonicDoc = (doc: any) => {
      const execMock = jest.fn().mockResolvedValue(doc);
      const leanMock = jest.fn().mockReturnValue({ exec: execMock });
      const sessionMock = jest.fn().mockReturnValue({ lean: leanMock });
      const selectMock = jest.fn().mockReturnValue({ session: sessionMock });
      mnemonicModelViaApplication.findById.mockReturnValue({
        select: selectMock,
      });
      return { execMock };
    };

    beforeEach(() => {
      mnemonic = new SecureString(
        'orange tiger worry gym honor practice secure idea portion maple prize gaze',
      );
      mnemonicModelViaApplication = { findById: jest.fn() } as any;
      mockApplication.getModel.mockImplementation((modelName: string) => {
        if (modelName === BaseModelName.Mnemonic) {
          return mnemonicModelViaApplication as any;
        }
        if (modelName === BaseModelName.EmailToken) {
          return mockEmailTokenModel;
        }
        return mockUserModel;
      });

      const prefixedPublicKey = Buffer.concat([
        Buffer.from([mockApplication.constants.ECIES.PUBLIC_KEY_MAGIC]),
        rawPublicKey,
      ]);
      userDoc = {
        _id: new Types.ObjectId(),
        email: 'client@example.com',
        username: 'clientuser',
        accountStatus: AccountStatus.Active,
        deletedAt: null,
        mnemonicId: new Types.ObjectId(),
        publicKey: prefixedPublicKey.toString('hex'),
      } as IUserDocument;

      const wallet = {
        getPrivateKey: jest.fn().mockReturnValue(Buffer.alloc(32, 5)),
        getPublicKey: jest.fn().mockReturnValue(rawPublicKey),
      };
      (service as any).eciesService.walletAndSeedFromMnemonic.mockReturnValue({
        wallet,
      });
      (service as any).mnemonicService.getMnemonicHmac.mockReturnValue(
        'expected-hmac',
      );

      const userMember = {
        publicKey: prefixedPublicKey,
        encryptData: jest.fn((payload: Buffer) => payload),
        decryptData: jest.fn((payload: Buffer) => payload),
      } as any;
      makeUserSpy = jest
        .spyOn(service as any, 'makeUserFromUserDoc')
        .mockResolvedValue(userMember);

      systemUserSpy = jest
        .spyOn(SystemUserService, 'getSystemUser')
        .mockReturnValue({
          sign: jest.fn().mockReturnValue(Buffer.alloc(64, 7)),
          verify: jest.fn().mockReturnValue(true),
        } as any);
    });

    afterEach(() => {
      mnemonic.dispose();
      makeUserSpy.mockRestore();
      systemUserSpy.mockRestore();
    });

    it('should authenticate when mnemonic matches for email input', async () => {
      wireEmailQuery(userDoc);
      wireMnemonicDoc({ _id: userDoc.mnemonicId, hmac: 'expected-hmac' });

      const result = await service.loginWithClientVerifiedChallenge(
        'client@example.com',
        mnemonic,
      );

      expect(result.userDoc).toBe(userDoc);
      expect(result.userMember).toBeDefined();
      expect(result.adminMember).toBeDefined();
      expect(makeUserSpy).toHaveBeenCalled();
    });

    it('should throw InvalidCredentialsError when mnemonic hash mismatches for username input', async () => {
      wireUsernameQuery(userDoc);
      wireMnemonicDoc({ _id: userDoc.mnemonicId, hmac: 'stored-hmac' });
      (service as any).mnemonicService.getMnemonicHmac.mockReturnValue(
        'different-hmac',
      );

      await expect(
        service.loginWithClientVerifiedChallenge('clientuser', mnemonic),
      ).rejects.toThrow(InvalidCredentialsError);
    });

    it('should throw AccountLockedError when account is locked', async () => {
      userDoc.accountStatus = AccountStatus.AdminLock;
      wireEmailQuery(userDoc);

      await expect(
        service.loginWithClientVerifiedChallenge(
          'client@example.com',
          mnemonic,
        ),
      ).rejects.toThrow(AccountLockedError);
    });

    it('should throw InvalidCredentialsError when user lookup fails', async () => {
      wireEmailQuery(null);

      await expect(
        service.loginWithClientVerifiedChallenge(
          'missing@example.com',
          mnemonic,
        ),
      ).rejects.toThrow(InvalidCredentialsError);
    });
  });

  describe('loginWithPassword', () => {
    let userDoc: IUserDocument;
    let makeUserSpy: jest.SpyInstance;
    let systemUserSpy: jest.SpyInstance;

    beforeEach(() => {
      userDoc = {
        _id: new Types.ObjectId(),
        email: 'pw@example.com',
        username: 'pwuser',
        accountStatus: AccountStatus.Active,
        deletedAt: null,
        passwordWrappedPrivateKey: Buffer.from('wrapped'),
        mnemonicId: new Types.ObjectId(),
      } as any;

      const userMember = {
        encryptData: jest.fn((payload: Buffer) => payload),
        decryptData: jest.fn((payload: Buffer) => payload),
      } as any;

      makeUserSpy = jest
        .spyOn(service as any, 'makeUserFromUserDoc')
        .mockResolvedValue(userMember);

      systemUserSpy = jest
        .spyOn(SystemUserService, 'getSystemUser')
        .mockReturnValue({
          sign: jest.fn().mockImplementation(() => Buffer.alloc(64, 2)),
          verify: jest.fn().mockReturnValue(true),
        } as any);

      mockKeyWrappingService.unwrapSecretAsync.mockResolvedValue({});
    });

    afterEach(() => {
      makeUserSpy.mockRestore();
      systemUserSpy.mockRestore();
    });

    const setupPasswordQuery = (result: any) => {
      const execMock = jest.fn().mockResolvedValue(result);
      const sessionMock = jest.fn().mockReturnValue({ exec: execMock });
      const collationMock = jest.fn().mockReturnValue({ session: sessionMock });
      mockUserModel.findOne.mockReturnValue({
        session: sessionMock,
        collation: collationMock,
      });
      return { execMock, sessionMock };
    };

    it('should authenticate user with password-wrapped key', async () => {
      setupPasswordQuery(userDoc);

      const result = await service.loginWithPassword(
        'pw@example.com',
        'StrongPass123!',
      );

      expect(mockKeyWrappingService.unwrapSecretAsync).toHaveBeenCalledWith(
        userDoc.passwordWrappedPrivateKey,
        'StrongPass123!',
        mockApplication.constants,
      );
      expect(makeUserSpy).toHaveBeenCalled();
      expect(systemUserSpy).toHaveBeenCalled();
      expect(result.userDoc).toBe(userDoc);
      expect(result.userMember).toBeDefined();
      expect(result.adminMember).toBeDefined();
    });

    it('should throw AccountLockedError for locked accounts', async () => {
      userDoc.accountStatus = AccountStatus.AdminLock;
      setupPasswordQuery(userDoc);

      await expect(
        service.loginWithPassword('pw@example.com', 'StrongPass123!'),
      ).rejects.toThrow(AccountLockedError);

      expect(mockKeyWrappingService.unwrapSecretAsync).not.toHaveBeenCalled();
    });

    it('should throw PasswordLoginNotEnabledError when credentials missing', async () => {
      userDoc.passwordWrappedPrivateKey = undefined as any;
      setupPasswordQuery(userDoc);

      await expect(
        service.loginWithPassword('pw@example.com', 'StrongPass123!'),
      ).rejects.toThrow(PasswordLoginNotEnabledError);
    });

    it('should throw InvalidCredentialsError when user not found', async () => {
      setupPasswordQuery(null);

      await expect(
        service.loginWithPassword('missing@example.com', 'StrongPass123!'),
      ).rejects.toThrow(InvalidCredentialsError);
    });
  });

  describe('loginWithChallengeResponse', () => {
    let userDoc: IUserDocument;
    let findUserSpy: jest.SpyInstance;
    let makeUserSpy: jest.SpyInstance;
    let systemUserSpy: jest.SpyInstance;
    let adminMember: { sign: jest.Mock };
    const nonce = Buffer.alloc(32, 4);

    const buildChallengeHex = (timeMs: number, signature?: Buffer) => {
      const timeBuffer = Buffer.alloc(8);
      timeBuffer.writeBigUInt64BE(BigInt(timeMs));
      const signatureBuffer = signature ?? Buffer.alloc(64, 6);
      return Buffer.concat([timeBuffer, nonce, signatureBuffer]).toString(
        'hex',
      );
    };

    beforeEach(() => {
      userDoc = {
        _id: new Types.ObjectId(),
        email: 'challenge@example.com',
        username: 'challenge-user',
      } as IUserDocument;

      findUserSpy = jest.spyOn(service, 'findUser').mockResolvedValue(userDoc);

      makeUserSpy = jest
        .spyOn(service as any, 'makeUserFromUserDoc')
        .mockResolvedValue({ user: true });

      adminMember = {
        sign: jest.fn(),
      };
      systemUserSpy = jest
        .spyOn(SystemUserService, 'getSystemUser')
        .mockReturnValue(adminMember as any);
    });

    afterEach(() => {
      findUserSpy.mockRestore();
      makeUserSpy.mockRestore();
      systemUserSpy.mockRestore();
    });

    it('should authenticate when challenge response is valid', async () => {
      const signature = Buffer.alloc(64, 9);
      adminMember.sign.mockReturnValue(signature);
      const challengeHex = buildChallengeHex(Date.now(), signature);

      const result = await service.loginWithChallengeResponse(
        challengeHex,
        'challenge@example.com',
      );

      expect(findUserSpy).toHaveBeenCalledWith(
        'challenge@example.com',
        undefined,
        undefined,
      );
      expect(makeUserSpy).toHaveBeenCalledWith(
        userDoc,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
      expect(result.userDoc).toBe(userDoc);
      expect(result.userMember).toEqual({ user: true });
    });

    it('should throw InvalidChallengeResponseError for malformed payload', async () => {
      await expect(
        service.loginWithChallengeResponse('abcd', 'challenge@example.com'),
      ).rejects.toThrow(InvalidChallengeResponseError);
    });

    it('should throw LoginChallengeExpiredError when expired', async () => {
      const signature = Buffer.alloc(64, 8);
      adminMember.sign.mockReturnValue(signature);
      const expiredTime =
        Date.now() - mockApplication.constants.LoginChallengeExpiration - 1000;
      const challengeHex = buildChallengeHex(expiredTime, signature);

      await expect(
        service.loginWithChallengeResponse(
          challengeHex,
          'challenge@example.com',
        ),
      ).rejects.toThrow(LoginChallengeExpiredError);
    });

    it('should throw InvalidChallengeResponseError when signature mismatches', async () => {
      adminMember.sign.mockReturnValue(Buffer.alloc(64, 7));
      const providedSignature = Buffer.alloc(64, 1);
      const challengeHex = buildChallengeHex(Date.now(), providedSignature);

      await expect(
        service.loginWithChallengeResponse(
          challengeHex,
          'challenge@example.com',
        ),
      ).rejects.toThrow(InvalidChallengeResponseError);
    });

    it('should throw InvalidEmailError when user not found by email', async () => {
      findUserSpy.mockResolvedValue(null);
      const signature = Buffer.alloc(64, 9);
      adminMember.sign.mockReturnValue(signature);
      const challengeHex = buildChallengeHex(Date.now(), signature);

      await expect(
        service.loginWithChallengeResponse(challengeHex, 'missing@example.com'),
      ).rejects.toThrow(InvalidEmailError);
    });

    it('should throw UserNotFoundError when user not found by username', async () => {
      findUserSpy.mockResolvedValue(null);
      const signature = Buffer.alloc(64, 9);
      adminMember.sign.mockReturnValue(signature);
      const challengeHex = buildChallengeHex(Date.now(), signature);

      await expect(
        service.loginWithChallengeResponse(
          challengeHex,
          undefined,
          'missing-user',
        ),
      ).rejects.toThrow(UserNotFoundError);
    });
  });

  describe('sendEmailToken', () => {
    let emailToken: any;

    beforeEach(() => {
      emailToken = {
        email: 'user@example.com',
        token: 'abc123',
        type: EmailTokenType.AccountVerification,
        save: jest.fn().mockResolvedValue(undefined),
        lastSent: undefined as Date | undefined,
        expiresAt: new Date(),
      };
      (service as any).disableEmailSend = false;
      mockEmailService.sendEmail.mockResolvedValue(undefined);
    });

    it('should short-circuit when email sending disabled', async () => {
      (service as any).disableEmailSend = true;

      await service.sendEmailToken(emailToken);

      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
      expect(emailToken.lastSent).toBeInstanceOf(Date);
      expect(emailToken.save).toHaveBeenCalledWith({ session: undefined });
    });

    it('should throw EmailTokenSentTooRecentlyError when resend interval not elapsed', async () => {
      emailToken.lastSent = new Date();

      await expect(service.sendEmailToken(emailToken)).rejects.toThrow(
        EmailTokenSentTooRecentlyError,
      );
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });

    it('should send email and update expiration when allowed', async () => {
      await service.sendEmailToken(emailToken);

      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        emailToken.email,
        expect.any(String),
        expect.any(String),
        expect.any(String),
      );
      expect(emailToken.lastSent).toBeInstanceOf(Date);
      expect(emailToken.expiresAt.getTime()).toBeGreaterThan(Date.now() - 1000);
      expect(emailToken.save).toHaveBeenCalled();
    });

    it('should throw EmailTokenFailedToSendError when email service fails', async () => {
      mockEmailService.sendEmail.mockRejectedValue(new Error('smtp down'));

      await expect(service.sendEmailToken(emailToken)).rejects.toThrow(
        EmailTokenFailedToSendError,
      );
    });
  });

  describe('verifyAccountTokenAndComplete', () => {
    let withTransactionSpy: jest.SpyInstance;
    let findEmailTokenSpy: jest.SpyInstance;
    let emailToken: any;
    let userDoc: any;
    let deleteSessionMock: jest.Mock;

    beforeEach(() => {
      emailToken = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        email: 'pending@example.com',
        expiresAt: new Date(Date.now() + 60_000),
        type: EmailTokenType.AccountVerification,
      };
      userDoc = {
        _id: emailToken.userId,
        email: 'pending@example.com',
        emailVerified: false,
        accountStatus: AccountStatus.PendingEmailVerification,
        save: jest.fn().mockResolvedValue(undefined),
      };

      withTransactionSpy = jest
        .spyOn(service as any, 'withTransaction')
        .mockImplementation(async (callback: any) => callback(undefined));
      findEmailTokenSpy = jest
        .spyOn(service, 'findEmailToken')
        .mockResolvedValue(emailToken as any);

      const userSessionMock = jest.fn().mockResolvedValue(userDoc);
      mockUserModel.findById = jest
        .fn()
        .mockReturnValue({ session: userSessionMock });

      deleteSessionMock = jest.fn().mockResolvedValue(undefined);
      mockEmailTokenModel.deleteOne = jest
        .fn()
        .mockReturnValue({ session: deleteSessionMock });

      mockRoleService.getRoleIdByName.mockResolvedValue(new Types.ObjectId());
    });

    afterEach(() => {
      withTransactionSpy.mockRestore();
      findEmailTokenSpy.mockRestore();
    });

    it('should verify user and add member role when token valid', async () => {
      await service.verifyAccountTokenAndComplete('token');

      expect(userDoc.emailVerified).toBe(true);
      expect(userDoc.accountStatus).toBe(AccountStatus.Active);
      expect(userDoc.save).toHaveBeenCalled();
      expect(mockRoleService.addUserToRole).toHaveBeenCalled();
      expect(mockEmailTokenModel.deleteOne).toHaveBeenCalledWith({
        _id: emailToken._id,
      });
    });

    it('should throw EmailTokenExpiredError when token expired', async () => {
      emailToken.expiresAt = new Date(Date.now() - 1000);

      await expect(
        service.verifyAccountTokenAndComplete('token'),
      ).rejects.toThrow(EmailTokenExpiredError);
      expect(mockEmailTokenModel.deleteOne).toHaveBeenCalledWith({
        _id: emailToken._id,
      });
    });

    it('should throw EmailVerifiedError when user already verified', async () => {
      userDoc.emailVerified = true;
      userDoc.accountStatus = AccountStatus.Active;

      await expect(
        service.verifyAccountTokenAndComplete('token'),
      ).rejects.toThrow(EmailVerifiedError);
      expect(mockRoleService.addUserToRole).not.toHaveBeenCalled();
    });

    it('should throw EmailTokenUsedOrInvalidError when token missing', async () => {
      findEmailTokenSpy.mockResolvedValue(null);

      await expect(
        service.verifyAccountTokenAndComplete('token'),
      ).rejects.toThrow(EmailTokenUsedOrInvalidError);
    });
  });

  describe('resetPasswordWithToken', () => {
    let withTransactionSpy: jest.SpyInstance;
    let findEmailTokenSpy: jest.SpyInstance;
    let emailToken: any;
    let userDoc: any;
    let deleteSessionMock: jest.Mock;
    let userSessionMock: jest.Mock;
    const mnemonicCredential = 'alpha beta gamma delta';

    beforeEach(() => {
      emailToken = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        email: 'user@example.com',
        type: EmailTokenType.PasswordReset,
      };
      const publicKeyTail = Buffer.alloc(32, 7);
      userDoc = {
        _id: emailToken.userId,
        publicKey: Buffer.concat([
          Buffer.from([mockApplication.constants.ECIES.PUBLIC_KEY_MAGIC]),
          publicKeyTail,
        ]).toString('hex'),
        passwordWrappedPrivateKey: Buffer.from('wrapped'),
        save: jest.fn().mockResolvedValue(undefined),
      };

      withTransactionSpy = jest
        .spyOn(service as any, 'withTransaction')
        .mockImplementation(async (callback: any) => callback(undefined));
      findEmailTokenSpy = jest
        .spyOn(service, 'findEmailToken')
        .mockResolvedValue(emailToken as any);

      userSessionMock = jest.fn().mockResolvedValue(userDoc);
      mockUserModel.findById = jest
        .fn()
        .mockReturnValue({ session: userSessionMock });

      deleteSessionMock = jest.fn().mockResolvedValue(undefined);
      mockEmailTokenModel.deleteOne = jest
        .fn()
        .mockReturnValue({ session: deleteSessionMock });

      (service as any).eciesService.walletAndSeedFromMnemonic.mockReturnValue({
        wallet: {
          getPublicKey: jest.fn().mockReturnValue(publicKeyTail),
          getPrivateKey: jest.fn().mockReturnValue(Buffer.alloc(32, 9)),
        },
      });

      // Mock eciesService.getPublicKey to return the full 33-byte compressed key
      (service as any).eciesService.getPublicKey = jest
        .fn()
        .mockReturnValue(
          Buffer.concat([
            Buffer.from([mockApplication.constants.ECIES.PUBLIC_KEY_MAGIC]),
            publicKeyTail,
          ]),
        );

      mockKeyWrappingService.wrapSecret.mockReturnValue(
        Buffer.from('newwrapped'),
      );
      mockKeyWrappingService.unwrapSecretAsync.mockResolvedValue({
        dispose: jest.fn(),
      } as any);
    });

    afterEach(() => {
      withTransactionSpy.mockRestore();
      findEmailTokenSpy.mockRestore();
    });

    it('should rewrap password using mnemonic credential', async () => {
      await service.resetPasswordWithToken(
        'token',
        'StrongPass123!',
        mnemonicCredential,
      );

      expect(mockKeyWrappingService.wrapSecret).toHaveBeenCalled();
      expect(mockKeyWrappingService.unwrapSecretAsync).not.toHaveBeenCalled();
      expect(userDoc.save).toHaveBeenCalled();
      expect(mockEmailTokenModel.deleteOne).toHaveBeenCalledWith({
        _id: emailToken._id,
      });
    });

    it('should rewrap password using current password credential', async () => {
      const originalWrappedKey = userDoc.passwordWrappedPrivateKey;
      await service.resetPasswordWithToken(
        'token',
        'StrongPass123!',
        'CurrentPass123!',
      );

      expect(mockKeyWrappingService.unwrapSecretAsync).toHaveBeenCalledWith(
        originalWrappedKey,
        'CurrentPass123!',
        mockApplication.constants,
      );
      expect(mockKeyWrappingService.wrapSecret).toHaveBeenCalled();
      expect(userDoc.save).toHaveBeenCalled();
    });

    it('should throw EmailTokenUsedOrInvalidError when token lookup fails', async () => {
      findEmailTokenSpy.mockResolvedValue(null);

      await expect(
        service.resetPasswordWithToken('token', 'StrongPass123!', 'cred'),
      ).rejects.toThrow(EmailTokenUsedOrInvalidError);
    });

    it('should throw EmailTokenUsedOrInvalidError when credential missing', async () => {
      await expect(
        service.resetPasswordWithToken('token', 'StrongPass123!'),
      ).rejects.toThrow(EmailTokenUsedOrInvalidError);
    });

    it('should throw InvalidNewPasswordError when password fails regex', async () => {
      await expect(
        service.resetPasswordWithToken('token', 'weak', 'cred'),
      ).rejects.toThrow(InvalidNewPasswordError);
    });
  });

  describe('resendEmailToken', () => {
    let withTransactionSpy: jest.SpyInstance;
    let sendEmailSpy: jest.SpyInstance;

    beforeEach(() => {
      withTransactionSpy = jest
        .spyOn(service as any, 'withTransaction')
        .mockImplementation(async (callback: any) => callback(undefined));
      sendEmailSpy = jest.spyOn(service, 'sendEmailToken').mockResolvedValue();
    });

    afterEach(() => {
      withTransactionSpy.mockRestore();
      sendEmailSpy.mockRestore();
    });

    it('should resend the most recent token when available', async () => {
      const emailToken = { _id: new Types.ObjectId() } as any;
      const limitMock = jest.fn().mockResolvedValue(emailToken);
      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      const sessionMock = jest.fn().mockReturnValue({ sort: sortMock });
      mockEmailTokenModel.findOne.mockReturnValue({ session: sessionMock });

      await service.resendEmailToken('user-id', EmailTokenType.LoginRequest);

      expect(mockEmailTokenModel.findOne).toHaveBeenCalledWith({
        userId: 'user-id',
        type: EmailTokenType.LoginRequest,
        expiresAt: { $gt: expect.any(Date) },
      });
      expect(limitMock).toHaveBeenCalledWith(1);
      expect(sendEmailSpy).toHaveBeenCalledWith(emailToken, undefined, false);
    });

    it('should throw when no token can be resent', async () => {
      const limitMock = jest.fn().mockResolvedValue(null);
      const sortMock = jest.fn().mockReturnValue({ limit: limitMock });
      const sessionMock = jest.fn().mockReturnValue({ sort: sortMock });
      mockEmailTokenModel.findOne.mockReturnValue({ session: sessionMock });

      await expect(
        service.resendEmailToken('user-id', EmailTokenType.LoginRequest),
      ).rejects.toThrow(EmailTokenUsedOrInvalidError);
    });
  });

  describe('validateEmailToken', () => {
    let withTransactionSpy: jest.SpyInstance;

    beforeEach(() => {
      withTransactionSpy = jest
        .spyOn(service as any, 'withTransaction')
        .mockImplementation(async (callback: any) => callback(undefined));
    });

    afterEach(() => {
      withTransactionSpy.mockRestore();
    });

    it('should resolve when token exists and is unexpired', async () => {
      const emailToken = {
        _id: new Types.ObjectId(),
        expiresAt: new Date(Date.now() + 10_000),
      };
      const sessionMock = jest.fn().mockResolvedValue(emailToken as any);
      mockEmailTokenModel.findOne.mockReturnValue({ session: sessionMock });

      await expect(
        service.validateEmailToken('token', EmailTokenType.PasswordReset),
      ).resolves.toBeUndefined();
      expect(mockEmailTokenModel.deleteOne).not.toHaveBeenCalled();
    });

    it('should delete and throw when token expired', async () => {
      const emailToken = {
        _id: new Types.ObjectId(),
        expiresAt: new Date(Date.now() - 10_000),
      };
      const sessionMock = jest.fn().mockResolvedValue(emailToken as any);
      mockEmailTokenModel.findOne.mockReturnValue({ session: sessionMock });
      const deleteSessionMock = jest.fn().mockResolvedValue(undefined);
      mockEmailTokenModel.deleteOne.mockReturnValue({
        session: deleteSessionMock,
      });

      await expect(
        service.validateEmailToken('token', EmailTokenType.PasswordReset),
      ).rejects.toThrow(EmailTokenExpiredError);
      expect(mockEmailTokenModel.deleteOne).toHaveBeenCalledWith({
        _id: emailToken._id,
      });
    });

    it('should throw when token not found', async () => {
      const sessionMock = jest.fn().mockResolvedValue(null);
      mockEmailTokenModel.findOne.mockReturnValue({ session: sessionMock });

      await expect(
        service.validateEmailToken('token', EmailTokenType.PasswordReset),
      ).rejects.toThrow(EmailTokenUsedOrInvalidError);
    });
  });

  describe('updateSiteLanguage', () => {
    let withTransactionSpy: jest.SpyInstance;
    let makeRequestUserDTOSpy: jest.SpyInstance;

    beforeEach(() => {
      withTransactionSpy = jest
        .spyOn(service as any, 'withTransaction')
        .mockImplementation(async (callback: any) => callback(undefined));
      makeRequestUserDTOSpy = jest
        .spyOn(RequestUserService, 'makeRequestUserDTO')
        .mockReturnValue({ _id: 'user-id', siteLanguage: 'fr' } as any);
      mockRoleService.getUserRoles.mockResolvedValue(['member'] as any);
      mockRoleService.rolesToTokenRoles.mockReturnValue(['member']);
    });

    afterEach(() => {
      withTransactionSpy.mockRestore();
      makeRequestUserDTOSpy.mockRestore();
    });

    it('should update language and return request user DTO', async () => {
      const userDoc = { _id: new Types.ObjectId() };
      const sessionMock = jest.fn().mockResolvedValue(userDoc);
      mockUserModel.findByIdAndUpdate.mockReturnValue({ session: sessionMock });

      const result = await service.updateSiteLanguage(
        userDoc._id.toString(),
        'fr',
      );

      const findByIdCall = mockUserModel.findByIdAndUpdate.mock.calls[0];
      expect(Types.ObjectId.isValid(findByIdCall[0])).toBe(true);
      expect(findByIdCall[1]).toEqual({ siteLanguage: 'fr' });
      expect(findByIdCall[2]).toEqual({ new: true });
      expect(mockRoleService.getUserRoles).toHaveBeenCalledWith(userDoc._id);
      expect(makeRequestUserDTOSpy).toHaveBeenCalledWith(userDoc, ['member']);
      expect(result).toEqual({ _id: 'user-id', siteLanguage: 'fr' });
    });

    it('should throw UserNotFoundError when update returns null', async () => {
      const sessionMock = jest.fn().mockResolvedValue(null);
      mockUserModel.findByIdAndUpdate.mockReturnValue({ session: sessionMock });

      await expect(
        service.updateSiteLanguage(new Types.ObjectId().toString(), 'es'),
      ).rejects.toThrow(UserNotFoundError);
    });
  });

  describe('changePassword', () => {
    let withTransactionSpy: jest.SpyInstance;

    beforeEach(() => {
      withTransactionSpy = jest
        .spyOn(service as any, 'withTransaction')
        .mockImplementation(async (callback: any) => callback(undefined));
    });

    afterEach(() => {
      withTransactionSpy.mockRestore();
    });

    it('should unwrap and rewrap password when inputs valid', async () => {
      const userDoc = {
        _id: new Types.ObjectId(),
        passwordWrappedPrivateKey: Buffer.from('wrapped'),
        save: jest.fn().mockResolvedValue(undefined),
      };
      const sessionMock = jest.fn().mockResolvedValue(userDoc);
      mockUserModel.findById.mockReturnValue({ session: sessionMock });
      const privMock = { dispose: jest.fn() } as any;
      mockKeyWrappingService.unwrapSecret.mockReturnValue(privMock);
      mockKeyWrappingService.wrapSecret.mockReturnValue(Buffer.from('new'));

      await service.changePassword(
        userDoc._id.toString(),
        'CurrentPass123!',
        'NewPass123!',
      );

      expect(mockKeyWrappingService.unwrapSecret).toHaveBeenCalled();
      expect(mockKeyWrappingService.wrapSecret).toHaveBeenCalledWith(
        privMock,
        expect.any(SecureString),
        mockApplication.constants,
      );
      expect(userDoc.save).toHaveBeenCalled();
      expect(privMock.dispose).toHaveBeenCalled();
    });

    it('should throw when password fails regex', async () => {
      const userDoc = {
        _id: new Types.ObjectId(),
        passwordWrappedPrivateKey: Buffer.from('wrapped'),
        save: jest.fn().mockResolvedValue(undefined),
      };
      const sessionMock = jest.fn().mockResolvedValue(userDoc);
      mockUserModel.findById.mockReturnValue({ session: sessionMock });

      await expect(
        service.changePassword(
          userDoc._id.toString(),
          'CurrentPass123!',
          'weak',
        ),
      ).rejects.toThrow(InvalidNewPasswordError);
    });

    it('should throw UserNotFoundError when user missing or lacks credential', async () => {
      const sessionMock = jest.fn().mockResolvedValue(null);
      mockUserModel.findById.mockReturnValue({ session: sessionMock });

      await expect(
        service.changePassword(
          new Types.ObjectId().toString(),
          'CurrentPass123!',
          'NewPass123!',
        ),
      ).rejects.toThrow(UserNotFoundError);
    });
  });

  describe('requestEmailLogin', () => {
    let withTransactionSpy: jest.SpyInstance;
    let findUserSpy: jest.SpyInstance;
    let createTokenSpy: jest.SpyInstance;

    beforeEach(() => {
      withTransactionSpy = jest
        .spyOn(service as any, 'withTransaction')
        .mockImplementation(async (callback: any) => callback(undefined));
      createTokenSpy = jest
        .spyOn(service, 'createAndSendEmailToken')
        .mockResolvedValue();
    });

    afterEach(() => {
      withTransactionSpy.mockRestore();
      createTokenSpy.mockRestore();
      findUserSpy?.mockRestore();
    });

    it('should create login token when user found', async () => {
      const userDoc = {
        _id: new Types.ObjectId(),
        email: 'user@example.com',
      } as any;
      findUserSpy = jest.spyOn(service, 'findUser').mockResolvedValue(userDoc);

      await service.requestEmailLogin('user@example.com');

      expect(findUserSpy).toHaveBeenCalledWith(
        'user@example.com',
        undefined,
        undefined,
      );
      expect(createTokenSpy).toHaveBeenCalledWith(
        userDoc,
        EmailTokenType.LoginRequest,
        undefined,
        mockApplication.environment.debug,
      );
    });

    it('should no-op when user not found', async () => {
      findUserSpy = jest.spyOn(service, 'findUser').mockResolvedValue(null);

      await service.requestEmailLogin('missing@example.com');

      expect(createTokenSpy).not.toHaveBeenCalled();
    });
  });

  describe('validateEmailLoginTokenChallenge', () => {
    let withTransactionSpy: jest.SpyInstance;
    let findEmailTokenSpy: jest.SpyInstance;
    let findUserSpy: jest.SpyInstance;
    let makeUserSpy: jest.SpyInstance;
    let updateLastLoginSpy: jest.SpyInstance;

    beforeEach(() => {
      withTransactionSpy = jest
        .spyOn(service as any, 'withTransaction')
        .mockImplementation(async (callback: any) => callback(undefined));
      findEmailTokenSpy = jest.spyOn(service, 'findEmailToken');
      findUserSpy = jest.spyOn(service, 'findUser');
      makeUserSpy = jest.spyOn(service as any, 'makeUserFromUserDoc');
      updateLastLoginSpy = jest
        .spyOn(service, 'updateLastLogin')
        .mockResolvedValue(undefined);
    });

    afterEach(() => {
      withTransactionSpy.mockRestore();
      findEmailTokenSpy.mockRestore();
      findUserSpy.mockRestore();
      makeUserSpy.mockRestore();
      updateLastLoginSpy.mockRestore();
    });

    it('should validate token, delete it, and update last login', async () => {
      const emailToken = {
        email: 'user@example.com',
        deleteOne: jest.fn().mockResolvedValue(undefined),
      } as any;
      const userDoc = { _id: new Types.ObjectId() } as any;
      const userMember = {
        verify: jest.fn().mockReturnValue(true),
      } as any;

      findEmailTokenSpy.mockResolvedValue(emailToken);
      findUserSpy.mockResolvedValue(userDoc);
      makeUserSpy.mockResolvedValue(userMember);

      const token = 'abcd';
      const signature = 'ef12';

      const result = await service.validateEmailLoginTokenChallenge(
        token,
        signature,
      );

      expect(userMember.verify).toHaveBeenCalled();
      expect(emailToken.deleteOne).toHaveBeenCalledWith({ session: null });
      expect(updateLastLoginSpy).toHaveBeenCalledWith(userDoc._id);
      expect(result).toBe(userDoc);
    });

    it('should throw when signature verification fails', async () => {
      const emailToken = {
        email: 'user@example.com',
        deleteOne: jest.fn(),
      } as any;
      const userDoc = { _id: new Types.ObjectId() } as any;
      const userMember = {
        verify: jest.fn().mockReturnValue(false),
      } as any;

      findEmailTokenSpy.mockResolvedValue(emailToken);
      findUserSpy.mockResolvedValue(userDoc);
      makeUserSpy.mockResolvedValue(userMember);

      await expect(
        service.validateEmailLoginTokenChallenge('abcd', 'ef12'),
      ).rejects.toThrow(InvalidChallengeResponseError);
      expect(updateLastLoginSpy).not.toHaveBeenCalled();
    });

    it('should throw EmailTokenUsedOrInvalidError when token missing', async () => {
      findEmailTokenSpy.mockResolvedValue(null);

      await expect(
        service.validateEmailLoginTokenChallenge('abcd', 'ef12'),
      ).rejects.toThrow(EmailTokenUsedOrInvalidError);
    });
  });

  describe('generateDirectLoginChallenge', () => {
    let systemUserSpy: jest.SpyInstance;

    beforeEach(() => {
      systemUserSpy = jest
        .spyOn(SystemUserService, 'getSystemUser')
        .mockReturnValue({
          sign: jest.fn(() => Buffer.alloc(64, 0xee)),
        } as any);
    });

    afterEach(() => {
      systemUserSpy.mockRestore();
    });

    it('should produce challenge with expected length', () => {
      const challenge = service.generateDirectLoginChallenge();

      expect(challenge).toHaveLength(
        (8 + 32 + mockApplication.constants.ECIES.SIGNATURE_SIZE) * 2,
      );
    });
  });

  describe('verifyDirectLoginChallenge', () => {
    let withTransactionSpy: jest.SpyInstance;
    let systemUserSpy: jest.SpyInstance;
    let findUserSpy: jest.SpyInstance;
    let makeUserSpy: jest.SpyInstance;
    let useTokenSpy: jest.SpyInstance;
    let updateLastLoginSpy: jest.SpyInstance;

    beforeEach(() => {
      withTransactionSpy = jest
        .spyOn(service as any, 'withTransaction')
        .mockImplementation(async (callback: any) => callback(undefined));
      findUserSpy = jest.spyOn(service, 'findUser');
      makeUserSpy = jest.spyOn(service as any, 'makeUserFromUserDoc');
      useTokenSpy = jest
        .spyOn(DirectLoginTokenService, 'useToken')
        .mockResolvedValue(undefined);
      updateLastLoginSpy = jest
        .spyOn(service, 'updateLastLogin')
        .mockResolvedValue(undefined);
    });

    afterEach(() => {
      withTransactionSpy.mockRestore();
      systemUserSpy?.mockRestore();
      findUserSpy.mockRestore();
      makeUserSpy.mockRestore();
      useTokenSpy.mockRestore();
      updateLastLoginSpy.mockRestore();
    });

    it('should validate direct login challenge and return user context', async () => {
      const now = Date.now();
      const timeBuf = Buffer.alloc(8);
      timeBuf.writeBigUInt64BE(BigInt(now));
      const nonce = Buffer.alloc(32, 0x11);
      const serverSignature = Buffer.alloc(
        mockApplication.constants.ECIES.SIGNATURE_SIZE,
        0x22,
      );
      const signedPayload = Buffer.concat([timeBuf, nonce]);
      systemUserSpy = jest
        .spyOn(SystemUserService, 'getSystemUser')
        .mockReturnValue({
          verify: jest.fn(
            (sig: Buffer, data: Buffer) =>
              sig.equals(serverSignature) && data.equals(signedPayload),
          ),
        } as any);
      const serverSignedRequestHex = Buffer.concat([
        timeBuf,
        nonce,
        serverSignature,
      ]).toString('hex');

      const userDoc = {
        _id: new Types.ObjectId(),
        directChallenge: true,
      } as any;
      const clientSignature = Buffer.alloc(
        mockApplication.constants.ECIES.SIGNATURE_SIZE,
        0x33,
      );
      const userMember = {
        verify: jest.fn(
          (sig: Buffer, data: Buffer) =>
            sig.equals(clientSignature) &&
            data.equals(Buffer.from(serverSignedRequestHex, 'hex')),
        ),
      } as any;

      findUserSpy.mockResolvedValue(userDoc);
      makeUserSpy.mockResolvedValue(userMember);

      const result = await service.verifyDirectLoginChallenge(
        serverSignedRequestHex,
        clientSignature.toString('hex'),
        'directuser',
      );

      expect(userMember.verify).toHaveBeenCalled();
      expect(useTokenSpy).toHaveBeenCalledWith(
        mockApplication,
        userDoc._id,
        nonce.toString('hex'),
      );
      expect(updateLastLoginSpy).toHaveBeenCalledWith(userDoc._id);
      expect(result).toEqual({ userDoc, userMember });
      expect(findUserSpy).toHaveBeenCalledWith(
        undefined,
        'directuser',
        undefined,
      );
    });
  });

  describe('updateDarkMode', () => {
    let withTransactionSpy: jest.SpyInstance;
    let makeRequestUserDTOSpy: jest.SpyInstance;

    beforeEach(() => {
      withTransactionSpy = jest
        .spyOn(service as any, 'withTransaction')
        .mockImplementation(async (callback: any) => callback(undefined));
      makeRequestUserDTOSpy = jest
        .spyOn(RequestUserService, 'makeRequestUserDTO')
        .mockReturnValue({ _id: 'user-id', darkMode: true } as any);
      mockRoleService.getUserRoles.mockResolvedValue(['member'] as any);
      mockRoleService.rolesToTokenRoles.mockReturnValue(['member']);
    });

    afterEach(() => {
      withTransactionSpy.mockRestore();
      makeRequestUserDTOSpy.mockRestore();
    });

    it('should update dark mode and return request user DTO', async () => {
      const userDoc = { _id: new Types.ObjectId() };
      const sessionMock = jest.fn().mockResolvedValue(userDoc);
      mockUserModel.findByIdAndUpdate.mockReturnValue({ session: sessionMock });

      const result = await service.updateDarkMode(userDoc._id.toString(), true);

      const findByIdCall = mockUserModel.findByIdAndUpdate.mock.calls[0];
      expect(Types.ObjectId.isValid(findByIdCall[0])).toBe(true);
      expect(findByIdCall[1]).toEqual({ darkMode: true });
      expect(findByIdCall[2]).toEqual({ new: true });
      expect(mockRoleService.getUserRoles).toHaveBeenCalledWith(userDoc._id);
      expect(makeRequestUserDTOSpy).toHaveBeenCalledWith(userDoc, ['member']);
      expect(result).toEqual({ _id: 'user-id', darkMode: true });
    });

    it('should throw UserNotFoundError when update returns null', async () => {
      const sessionMock = jest.fn().mockResolvedValue(null);
      mockUserModel.findByIdAndUpdate.mockReturnValue({ session: sessionMock });

      await expect(
        service.updateDarkMode(new Types.ObjectId().toString(), false),
      ).rejects.toThrow(UserNotFoundError);
    });
  });
});
