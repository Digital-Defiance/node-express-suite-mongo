import { Types } from '@digitaldefiance/mongoose-types';
import { ECIESService } from '@digitaldefiance/node-ecies-lib';
import {
  getSuiteCoreTranslation,
  SuiteCoreStringKey,
} from '@digitaldefiance/suite-core-lib';
import express, { Application, NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { UserController } from '../../src/controllers/user';
import { BackupCodeService } from '../../src/services/backup-code';
import { JwtService } from '../../src/services/jwt';
import { RoleService } from '../../src/services/role';
import { UserService } from '../../src/services/user';

// Mock SystemUserService via barrel export
jest.mock('@digitaldefiance/node-express-suite', () => {
  const actual = jest.requireActual('@digitaldefiance/node-express-suite');
  return {
    ...actual,
    SystemUserService: {
      getSystemUser: jest.fn().mockReturnValue({
        publicKey: Buffer.alloc(65, 1),
        privateKey: Buffer.alloc(32, 2),
        address: 'mock-address',
      }),
    },
  };
});

describe('UserController - GET /settings', () => {
  let app: Application;
  let controller: UserController;
  let mockApp: any;
  let mockJwtService: jest.Mocked<JwtService<any, any, any, any, any>>;
  let mockUserService: jest.Mocked<
    UserService<any, any, any, any, any, any, any, any, any, any, any>
  >;
  let mockBackupCodeService: jest.Mocked<BackupCodeService<any, any, any, any>>;
  let mockRoleService: jest.Mocked<RoleService<any, any, any>>;
  let mockEciesService: jest.Mocked<ECIESService>;
  let mockToken: string;
  let mockUserId: Types.ObjectId;
  let authenticateRequestSpy: jest.SpyInstance;

  beforeEach(() => {
    // Spy on authenticateRequest BEFORE constructing the controller
    authenticateRequestSpy = jest
      .spyOn(UserController.prototype as any, 'authenticateRequest')
      .mockImplementation(
        async function (
          this: any,
          _route: any,
          req: Request,
          _res: Response,
          next: NextFunction,
        ) {
          req.user = {
            id: new Types.ObjectId().toString(),
            email: 'test@example.com',
            username: 'testuser',
            roles: [],
            timezone: 'UTC',
            emailVerified: true,
            darkMode: false,
            siteLanguage: 'en-US',
            directChallenge: false,
          };
          next();
        },
      );

    process.env.JWT_SECRET = 'a'.repeat(64);
    process.env.MNEMONIC_HMAC_SECRET = 'a'.repeat(64);
    process.env.MNEMONIC_ENCRYPTION_KEY = 'b'.repeat(64);

    mockUserId = new Types.ObjectId();
    const mockUserDoc = {
      _id: mockUserId,
      email: 'test@example.com',
      username: 'testuser',
      timezone: 'America/New_York',
      currency: 'USD',
      siteLanguage: 'en-US',
      darkMode: true,
      directChallenge: false,
      accountStatus: 'Active',
      deletedAt: null,
    };

    mockApp = {
      environment: {
        mongo: { useTransactions: false, transactionTimeout: 30000 },
        debug: false,
        jwtSecret: 'a'.repeat(64),
        systemPublicKeyHex: 'aabbccdd',
      },
      db: {
        connection: {
          startSession: jest.fn().mockResolvedValue({
            startTransaction: jest.fn(),
            commitTransaction: jest.fn(),
            abortTransaction: jest.fn(),
            endSession: jest.fn(),
          }),
        },
      },
      constants: {
        BACKUP_CODES: { Count: 10 },
        UsernameRegex: /^[a-zA-Z0-9_-]{3,30}$/,
        PasswordRegex: /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/,
        EmailTokenLength: 32,
        MnemonicRegex: /^[a-z ]{1,200}$/,
        JWT: { ALGORITHM: 'HS256', EXPIRATION_SEC: 86400 },
      },
      getModel: jest.fn().mockReturnValue({
        findById: jest.fn().mockResolvedValue(mockUserDoc),
      }),
    };

    mockJwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
      verify: jest.fn().mockReturnValue({
        id: mockUserId.toString(),
        email: 'test@example.com',
        username: 'testuser',
        roles: [],
      }),
      createUserToken: jest.fn().mockResolvedValue('mock-token'),
      verifyToken: jest.fn().mockResolvedValue({
        id: mockUserId.toString(),
        email: 'test@example.com',
        username: 'testuser',
        roles: [],
      }),
      signToken: jest.fn(),
    } as any;

    mockUserService = {
      updateUserSettings: jest.fn(),
    } as any;

    mockBackupCodeService = {} as any;
    mockRoleService = {
      getUserRoles: jest.fn().mockResolvedValue([]),
      rolesToTokenRoles: jest.fn().mockReturnValue([]),
    } as any;
    mockEciesService = {} as any;

    controller = new UserController(
      mockApp,
      mockJwtService,
      mockUserService,
      mockBackupCodeService,
      mockRoleService,
      mockEciesService,
    );

    app = express();
    app.use(express.json());
    app.use('/api/user', controller.router);

    mockToken = 'Bearer mock-token';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('successful retrieval', () => {
    it('should return user settings', async () => {
      const response = await request(app)
        .get('/api/user/settings')
        .set('Authorization', mockToken);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('settings');
      expect(response.body.settings).toEqual({
        email: 'test@example.com',
        timezone: 'America/New_York',
        currency: 'USD',
        siteLanguage: 'en-US',
        darkMode: true,
        directChallenge: false,
      });
    });

    it('should return success message', async () => {
      const response = await request(app)
        .get('/api/user/settings')
        .set('Authorization', mockToken);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe(
        getSuiteCoreTranslation(SuiteCoreStringKey.Settings_RetrievedSuccess),
      );
    });

    it('should handle missing optional fields', async () => {
      const mockUserDocWithMissingFields = {
        _id: mockUserId,
        email: 'test@example.com',
        username: 'testuser',
      };

      mockApp.getModel.mockReturnValue({
        findById: jest.fn().mockResolvedValue(mockUserDocWithMissingFields),
      });

      const response = await request(app)
        .get('/api/user/settings')
        .set('Authorization', mockToken);

      expect(response.status).toBe(200);
      expect(response.body.settings).toEqual({
        email: 'test@example.com',
        timezone: '',
        currency: '',
        siteLanguage: '',
        darkMode: false,
        directChallenge: false,
      });
    });
  });

  describe('authentication', () => {
    it('should require authentication', async () => {
      authenticateRequestSpy.mockClear();

      await request(app)
        .get('/api/user/settings')
        .set('Authorization', mockToken);

      expect(authenticateRequestSpy).toHaveBeenCalled();
    });

    it('should use authenticated user ID to fetch settings', async () => {
      const mockModel = {
        findById: jest.fn().mockResolvedValue({
          _id: mockUserId,
          email: 'test@example.com',
          timezone: 'UTC',
        }),
      };
      mockApp.getModel.mockReturnValue(mockModel);

      await request(app)
        .get('/api/user/settings')
        .set('Authorization', mockToken);

      expect(mockModel.findById).toHaveBeenCalledWith(expect.any(String));
    });
  });

  describe('response format', () => {
    it('should return settings object with all expected fields', async () => {
      const response = await request(app)
        .get('/api/user/settings')
        .set('Authorization', mockToken);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('settings');
      expect(response.body.settings).toHaveProperty('email');
      expect(response.body.settings).toHaveProperty('timezone');
      expect(response.body.settings).toHaveProperty('currency');
      expect(response.body.settings).toHaveProperty('siteLanguage');
      expect(response.body.settings).toHaveProperty('darkMode');
      expect(response.body.settings).toHaveProperty('directChallenge');
    });

    it('should include message in response', async () => {
      const response = await request(app)
        .get('/api/user/settings')
        .set('Authorization', mockToken);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
    });
  });
});

describe('UserController - POST /settings', () => {
  let app: Application;
  let controller: UserController;
  let mockApp: any;
  let mockJwtService: jest.Mocked<JwtService<any, any, any, any, any>>;
  let mockUserService: jest.Mocked<
    UserService<any, any, any, any, any, any, any, any, any, any, any>
  >;
  let mockBackupCodeService: jest.Mocked<BackupCodeService<any, any, any, any>>;
  let mockRoleService: jest.Mocked<RoleService<any, any, any>>;
  let mockEciesService: jest.Mocked<ECIESService>;
  let mockToken: string;
  let authenticateRequestSpy: jest.SpyInstance;

  beforeEach(() => {
    // Spy on authenticateRequest BEFORE constructing the controller
    authenticateRequestSpy = jest
      .spyOn(UserController.prototype as any, 'authenticateRequest')
      .mockImplementation(
        async function (
          this: any,
          _route: any,
          req: Request,
          _res: Response,
          next: NextFunction,
        ) {
          req.user = {
            id: new Types.ObjectId().toString(),
            email: 'test@example.com',
            username: 'testuser',
            roles: [],
            timezone: 'UTC',
            emailVerified: true,
            darkMode: false,
            siteLanguage: 'en-US',
            directChallenge: false,
          };
          next();
        },
      );

    process.env.JWT_SECRET = 'a'.repeat(64);
    process.env.MNEMONIC_HMAC_SECRET = 'a'.repeat(64);
    process.env.MNEMONIC_ENCRYPTION_KEY = 'b'.repeat(64);

    const mockUserId = new Types.ObjectId();
    const mockUserDoc = {
      _id: mockUserId,
      email: 'test@example.com',
      username: 'testuser',
      accountStatus: 'Active',
      deletedAt: null,
    };

    mockApp = {
      environment: {
        mongo: { useTransactions: false, transactionTimeout: 30000 },
        debug: false,
        jwtSecret: 'a'.repeat(64),
        systemPublicKeyHex: 'aabbccdd',
      },
      db: {
        connection: {
          startSession: jest.fn().mockResolvedValue({
            startTransaction: jest.fn(),
            commitTransaction: jest.fn(),
            abortTransaction: jest.fn(),
            endSession: jest.fn(),
          }),
        },
      },
      constants: {
        BACKUP_CODES: { Count: 10 },
        UsernameRegex: /^[a-zA-Z0-9_-]{3,30}$/,
        PasswordRegex: /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/,
        EmailTokenLength: 32,
        MnemonicRegex: /^[a-z ]{1,200}$/,
        JWT: { ALGORITHM: 'HS256', EXPIRATION_SEC: 86400 },
      },
      getModel: jest.fn().mockReturnValue({
        findById: jest.fn().mockReturnValue({
          session: jest.fn().mockResolvedValue(mockUserDoc),
        }),
      }),
    };

    mockJwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
      verify: jest.fn().mockReturnValue({
        id: mockUserId.toString(),
        email: 'test@example.com',
        username: 'testuser',
        roles: [],
      }),
      createUserToken: jest.fn().mockResolvedValue('mock-token'),
      verifyToken: jest.fn().mockResolvedValue({
        id: mockUserId.toString(),
        email: 'test@example.com',
        username: 'testuser',
        roles: [],
      }),
      signToken: jest.fn(),
    } as any;

    mockUserService = {
      updateUserSettings: jest.fn(),
    } as any;

    mockBackupCodeService = {} as any;
    mockRoleService = {
      getUserRoles: jest.fn().mockResolvedValue([]),
      rolesToTokenRoles: jest.fn().mockReturnValue([]),
    } as any;
    mockEciesService = {} as any;

    controller = new UserController(
      mockApp,
      mockJwtService,
      mockUserService,
      mockBackupCodeService,
      mockRoleService,
      mockEciesService,
    );

    app = express();
    app.use(express.json());
    app.use('/api/user', controller.router);

    mockToken = 'Bearer mock-token';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('successful updates', () => {
    it('should update email', async () => {
      const updatedUser = {
        _id: 'user-id',
        email: 'new@example.com',
        timezone: 'UTC',
        siteLanguage: 'en-US',
        darkMode: false,
        directChallenge: false,
      };

      mockUserService.updateUserSettings.mockResolvedValue(updatedUser as any);

      const response = await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ email: 'new@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.user.email).toBe('new@example.com');
      expect(mockUserService.updateUserSettings).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ email: 'new@example.com' }),
        undefined,
      );
    });

    it('should update timezone', async () => {
      const updatedUser = { _id: 'user-id', timezone: 'America/New_York' };
      mockUserService.updateUserSettings.mockResolvedValue(updatedUser as any);
      const response = await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ timezone: 'America/New_York' });
      expect(response.status).toBe(200);
      expect(mockUserService.updateUserSettings).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ timezone: 'America/New_York' }),
        undefined,
      );
    });

    it('should update siteLanguage', async () => {
      const updatedUser = { _id: 'user-id', siteLanguage: 'es' };
      mockUserService.updateUserSettings.mockResolvedValue(updatedUser as any);
      const response = await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ siteLanguage: 'es' });
      expect(response.status).toBe(200);
      expect(mockUserService.updateUserSettings).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ siteLanguage: 'es' }),
        undefined,
      );
    });

    it('should update currency', async () => {
      const updatedUser = { _id: 'user-id', currency: 'EUR' };
      mockUserService.updateUserSettings.mockResolvedValue(updatedUser as any);
      const response = await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ currency: 'EUR' });
      expect(response.status).toBe(200);
      expect(mockUserService.updateUserSettings).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ currency: 'EUR' }),
        undefined,
      );
    });

    it('should update darkMode', async () => {
      const updatedUser = { _id: 'user-id', darkMode: true };
      mockUserService.updateUserSettings.mockResolvedValue(updatedUser as any);
      const response = await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ darkMode: true });
      expect(response.status).toBe(200);
      expect(mockUserService.updateUserSettings).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ darkMode: true }),
        undefined,
      );
    });

    it('should update directChallenge', async () => {
      const updatedUser = { _id: 'user-id', directChallenge: true };
      mockUserService.updateUserSettings.mockResolvedValue(updatedUser as any);
      const response = await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ directChallenge: true });
      expect(response.status).toBe(200);
      expect(mockUserService.updateUserSettings).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ directChallenge: true }),
        undefined,
      );
    });

    it('should update multiple settings at once', async () => {
      const updatedUser = {
        _id: 'user-id',
        email: 'new@example.com',
        timezone: 'Europe/London',
        siteLanguage: 'fr',
        currency: 'GBP',
        darkMode: true,
        directChallenge: true,
      };
      mockUserService.updateUserSettings.mockResolvedValue(updatedUser as any);
      const response = await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({
          email: 'new@example.com',
          timezone: 'Europe/London',
          siteLanguage: 'fr',
          currency: 'GBP',
          darkMode: true,
          directChallenge: true,
        });
      expect(response.status).toBe(200);
      expect(mockUserService.updateUserSettings).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          email: 'new@example.com',
          timezone: 'Europe/London',
          siteLanguage: 'fr',
          currency: 'GBP',
          darkMode: true,
          directChallenge: true,
        }),
        undefined,
      );
    });

    it('should return success message', async () => {
      const updatedUser = { _id: 'user-id', timezone: 'UTC' };
      mockUserService.updateUserSettings.mockResolvedValue(updatedUser as any);
      const response = await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ timezone: 'UTC' });
      expect(response.status).toBe(200);
      expect(response.body.message).toBe(
        getSuiteCoreTranslation(SuiteCoreStringKey.Settings_SaveSuccess),
      );
    });
  });

  describe('validation errors', () => {
    it('should reject invalid email', async () => {
      const response = await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ email: 'invalid-email' });
      expect(response.status).toBe(422);
      expect(mockUserService.updateUserSettings).not.toHaveBeenCalled();
    });

    it('should reject invalid timezone', async () => {
      const response = await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ timezone: 'Invalid/Timezone' });
      expect(response.status).toBe(422);
      expect(mockUserService.updateUserSettings).not.toHaveBeenCalled();
    });

    it('should reject invalid siteLanguage', async () => {
      const response = await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ siteLanguage: 'invalid-lang' });
      expect(response.status).toBe(422);
      expect(mockUserService.updateUserSettings).not.toHaveBeenCalled();
    });

    it('should reject non-boolean darkMode', async () => {
      const response = await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ darkMode: 'invalid' });
      expect(response.status).toBe(422);
      expect(mockUserService.updateUserSettings).not.toHaveBeenCalled();
    });

    it('should reject non-boolean directChallenge', async () => {
      const response = await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ directChallenge: 'invalid' });
      expect(response.status).toBe(422);
      expect(mockUserService.updateUserSettings).not.toHaveBeenCalled();
    });

    it('should reject non-string currency', async () => {
      const response = await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ currency: 123 });
      expect(response.status).toBe(422);
      expect(mockUserService.updateUserSettings).not.toHaveBeenCalled();
    });
  });

  describe('partial updates', () => {
    it('should only pass defined fields to service', async () => {
      const updatedUser = { _id: 'user-id', timezone: 'Asia/Tokyo' };
      mockUserService.updateUserSettings.mockResolvedValue(updatedUser as any);
      await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ timezone: 'Asia/Tokyo' });
      const callArgs = mockUserService.updateUserSettings.mock.calls[0][1];
      expect(callArgs).toMatchObject({ timezone: 'Asia/Tokyo' });
      expect(callArgs.email).toBeUndefined();
    });

    it('should handle empty request body', async () => {
      const updatedUser = { _id: 'user-id' };
      mockUserService.updateUserSettings.mockResolvedValue(updatedUser as any);
      const response = await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({});
      expect(response.status).toBe(200);
      expect(mockUserService.updateUserSettings).toHaveBeenCalled();
    });
  });

  describe('authentication', () => {
    it('should require authentication', async () => {
      authenticateRequestSpy.mockClear();
      await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ timezone: 'UTC' });
      expect(authenticateRequestSpy).toHaveBeenCalled();
    });

    it('should use authenticated user ID', async () => {
      mockUserService.updateUserSettings.mockResolvedValue({} as any);
      await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ timezone: 'UTC' });
      const userId = mockUserService.updateUserSettings.mock.calls[0][0];
      expect(userId).toBeDefined();
      expect(typeof userId).toBe('string');
    });
  });

  describe('boolean field handling', () => {
    it('should handle darkMode false explicitly', async () => {
      const updatedUser = { _id: 'user-id', darkMode: false };
      mockUserService.updateUserSettings.mockResolvedValue(updatedUser as any);
      await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ darkMode: false });
      expect(mockUserService.updateUserSettings).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ darkMode: false }),
        undefined,
      );
    });

    it('should handle directChallenge false explicitly', async () => {
      const updatedUser = { _id: 'user-id', directChallenge: false };
      mockUserService.updateUserSettings.mockResolvedValue(updatedUser as any);
      await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ directChallenge: false });
      expect(mockUserService.updateUserSettings).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ directChallenge: false }),
        undefined,
      );
    });
  });

  describe('response format', () => {
    it('should return user object in response', async () => {
      const updatedUser = {
        _id: 'user-id',
        email: 'updated@example.com',
        timezone: 'UTC',
        siteLanguage: 'en-US',
        darkMode: true,
        directChallenge: true,
      };
      mockUserService.updateUserSettings.mockResolvedValue(updatedUser as any);
      const response = await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ darkMode: true });
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toEqual(updatedUser);
    });

    it('should include message in response', async () => {
      mockUserService.updateUserSettings.mockResolvedValue({} as any);
      const response = await request(app)
        .post('/api/user/settings')
        .set('Authorization', mockToken)
        .send({ timezone: 'UTC' });
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
    });
  });
});
