import { Types } from '@digitaldefiance/mongoose-types';
import { ECIESService } from '@digitaldefiance/node-ecies-lib';
import express, { Application, NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { sign } from 'jsonwebtoken';
import { UserController } from '../controllers/user';
import { BackupCodeService } from '../services/backup-code';
import { JwtService } from '../services/jwt';
import { RoleService } from '../services/role';
import { UserService } from '../services/user';

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
        encryptData: jest.fn().mockReturnValue(Buffer.from('encrypted-secret', 'utf-8')),
        decryptData: jest.fn().mockReturnValue(Buffer.from('JBSWY3DPEHPK3PXP', 'utf-8')),
      }),
    },
  };
});

// Shared mock TotpService returned by application.services.get
const mockTotpService = {
  generateSecret: jest.fn().mockReturnValue('JBSWY3DPEHPK3PXP'),
  generateProvisioningUri: jest.fn().mockReturnValue('otpauth://totp/host:test@example.com?secret=JBSWY3DPEHPK3PXP&issuer=host'),
  verifyCode: jest.fn().mockReturnValue(true),
};

function createMockApp(userDocOverrides: Record<string, unknown> = {}) {
  const mockUserId = new Types.ObjectId();
  const defaultUserDoc = {
    _id: mockUserId,
    email: 'test@example.com',
    username: 'testuser',
    totpEnabled: false,
    totpSecret: undefined as string | undefined,
    totpPendingSecret: undefined as string | undefined,
    siteLanguage: 'en-US',
    accountStatus: 'Active',
    deletedAt: null,
    set: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
    ...userDocOverrides,
  };

  return {
    userId: mockUserId,
    userDoc: defaultUserDoc,
    mockApp: {
      environment: {
        mongo: { useTransactions: false, transactionTimeout: 30000 },
        debug: false,
        jwtSecret: 'a'.repeat(64),
        systemPublicKeyHex: 'aabbccdd',
        host: 'localhost',
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
        JWT: { ALGORITHM: 'HS256' as const, EXPIRATION_SEC: 86400 },
      },
      getModel: jest.fn().mockReturnValue({
        findById: jest.fn().mockResolvedValue(defaultUserDoc),
      }),
      services: {
        get: jest.fn().mockReturnValue(mockTotpService),
      },
    },
  };
}

function createController(mockApp: ReturnType<typeof createMockApp>['mockApp']) {
  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
    verify: jest.fn(),
    createUserToken: jest.fn().mockResolvedValue('mock-token'),
    verifyToken: jest.fn(),
    signToken: jest.fn().mockResolvedValue({
      token: 'full-jwt-token',
      roles: [],
    }),
    signPendingTotpToken: jest.fn().mockReturnValue('pending-totp-token'),
  } as unknown as jest.Mocked<JwtService<any, any, any, any, any>>;

  const mockUserService = {} as jest.Mocked<UserService<any, any, any, any, any, any, any, any, any, any, any>>;
  const mockBackupCodeService = {} as jest.Mocked<BackupCodeService<any, any, any, any>>;
  const mockRoleService = {
    getUserRoles: jest.fn().mockResolvedValue([]),
    rolesToTokenRoles: jest.fn().mockReturnValue([]),
  } as unknown as jest.Mocked<RoleService<any, any, any>>;
  const mockEciesService = {} as jest.Mocked<ECIESService>;

  return {
    controller: new UserController(
      mockApp as any,
      mockJwtService,
      mockUserService,
      mockBackupCodeService,
      mockRoleService,
      mockEciesService,
    ),
    mockJwtService,
    mockRoleService,
  };
}

function buildExpressApp(controller: UserController): Application {
  const app = express();
  app.use(express.json());
  app.use('/api/user', controller.router);
  return app;
}

describe('UserController - TOTP Endpoints', () => {
  let authenticateRequestSpy: jest.SpyInstance;
  let mockUserId: Types.ObjectId;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = new Types.ObjectId();

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
            id: mockUserId.toString(),
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── POST /totp/setup ───────────────────────────────────────────────

  describe('POST /totp/setup', () => {
    /**
     * Validates: Requirements 3.3
     * WHEN totpEnabled is already true, return HTTP 409
     */
    it('should return 409 when TOTP is already enabled', async () => {
      const { mockApp } = createMockApp({ totpEnabled: true });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const response = await request(app)
        .post('/api/user/totp/setup')
        .set('Authorization', 'Bearer mock-token')
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('already active');
    });

    it('should return 200 with provisioningUri and secret on success', async () => {
      const { mockApp, userDoc } = createMockApp({ totpEnabled: false });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const response = await request(app)
        .post('/api/user/totp/setup')
        .set('Authorization', 'Bearer mock-token')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('provisioningUri');
      expect(response.body).toHaveProperty('secret');
      expect(response.body.provisioningUri).toContain('otpauth://totp/');
      expect(typeof response.body.secret).toBe('string');
      expect(userDoc.set).toHaveBeenCalledWith('totpPendingSecret', expect.any(String));
      expect(userDoc.save).toHaveBeenCalled();
    });

    it('should overwrite existing totpPendingSecret on repeated setup', async () => {
      const { mockApp, userDoc } = createMockApp({
        totpEnabled: false,
        totpPendingSecret: 'old-encrypted-secret',
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const response = await request(app)
        .post('/api/user/totp/setup')
        .set('Authorization', 'Bearer mock-token')
        .send({});

      expect(response.status).toBe(200);
      expect(userDoc.set).toHaveBeenCalledWith('totpPendingSecret', expect.any(String));
    });
  });

  // ─── POST /totp/confirm ─────────────────────────────────────────────

  describe('POST /totp/confirm', () => {
    /**
     * Validates: Requirements 4.3
     * WHEN totpPendingSecret is absent, return HTTP 400
     */
    it('should return 400 when no pending secret exists', async () => {
      const { mockApp } = createMockApp({
        totpEnabled: false,
        totpPendingSecret: undefined,
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const response = await request(app)
        .post('/api/user/totp/confirm')
        .set('Authorization', 'Bearer mock-token')
        .send({ code: '123456' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('not been initiated');
    });

    /**
     * Validates: Requirements 4.4
     * WHEN the code is invalid, return HTTP 400
     */
    it('should return 400 when code is invalid', async () => {
      mockTotpService.verifyCode.mockReturnValueOnce(false);

      const { mockApp, userDoc } = createMockApp({
        totpEnabled: false,
        totpPendingSecret: 'encrypted-pending-secret',
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const response = await request(app)
        .post('/api/user/totp/confirm')
        .set('Authorization', 'Bearer mock-token')
        .send({ code: '999999' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid TOTP code');
      // Ensure no state change
      expect(userDoc.set).not.toHaveBeenCalledWith('totpEnabled', true);
    });

    it('should return 400 when code format is invalid (not 6 digits)', async () => {
      const { mockApp } = createMockApp({
        totpEnabled: false,
        totpPendingSecret: 'encrypted-pending-secret',
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const response = await request(app)
        .post('/api/user/totp/confirm')
        .set('Authorization', 'Bearer mock-token')
        .send({ code: 'abc' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('6 digits');
    });

    it('should return 200 and enable TOTP on valid code', async () => {
      mockTotpService.verifyCode.mockReturnValueOnce(true);

      const { mockApp, userDoc } = createMockApp({
        totpEnabled: false,
        totpPendingSecret: 'encrypted-pending-secret',
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const response = await request(app)
        .post('/api/user/totp/confirm')
        .set('Authorization', 'Bearer mock-token')
        .send({ code: '123456' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('enabled successfully');
      expect(userDoc.set).toHaveBeenCalledWith('totpSecret', 'encrypted-pending-secret');
      expect(userDoc.set).toHaveBeenCalledWith('totpEnabled', true);
      expect(userDoc.set).toHaveBeenCalledWith('totpPendingSecret', undefined);
      expect(userDoc.save).toHaveBeenCalled();
    });
  });

  // ─── POST /totp/disable ─────────────────────────────────────────────

  describe('POST /totp/disable', () => {
    /**
     * Validates: Requirements 5.4
     * WHEN totpEnabled is false, return HTTP 409
     */
    it('should return 409 when TOTP is not enabled', async () => {
      const { mockApp } = createMockApp({ totpEnabled: false });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const response = await request(app)
        .post('/api/user/totp/disable')
        .set('Authorization', 'Bearer mock-token')
        .send({ code: '123456' });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('not currently active');
    });

    /**
     * Validates: Requirements 5.3
     * WHEN the code is invalid, return HTTP 400
     */
    it('should return 400 when code is invalid', async () => {
      mockTotpService.verifyCode.mockReturnValueOnce(false);

      const { mockApp, userDoc } = createMockApp({
        totpEnabled: true,
        totpSecret: 'encrypted-active-secret',
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const response = await request(app)
        .post('/api/user/totp/disable')
        .set('Authorization', 'Bearer mock-token')
        .send({ code: '999999' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid TOTP code');
      // Ensure no state change
      expect(userDoc.set).not.toHaveBeenCalledWith('totpEnabled', false);
    });

    it('should return 400 when code format is invalid', async () => {
      const { mockApp } = createMockApp({
        totpEnabled: true,
        totpSecret: 'encrypted-active-secret',
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const response = await request(app)
        .post('/api/user/totp/disable')
        .set('Authorization', 'Bearer mock-token')
        .send({ code: '12345' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('6 digits');
    });

    it('should return 200 and disable TOTP on valid code', async () => {
      mockTotpService.verifyCode.mockReturnValueOnce(true);

      const { mockApp, userDoc } = createMockApp({
        totpEnabled: true,
        totpSecret: 'encrypted-active-secret',
        totpPendingSecret: 'some-pending',
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const response = await request(app)
        .post('/api/user/totp/disable')
        .set('Authorization', 'Bearer mock-token')
        .send({ code: '123456' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('disabled successfully');
      expect(userDoc.set).toHaveBeenCalledWith('totpEnabled', false);
      expect(userDoc.set).toHaveBeenCalledWith('totpSecret', undefined);
      expect(userDoc.set).toHaveBeenCalledWith('totpPendingSecret', undefined);
      expect(userDoc.save).toHaveBeenCalled();
    });
  });

  // ─── POST /totp/verify ──────────────────────────────────────────────

  describe('POST /totp/verify', () => {
    // The verify endpoint does its own JWT verification (auth: false),
    // so we need to provide a real signed pending token.
    const jwtSecret = 'a'.repeat(64);

    function signPendingToken(userId: string, options: { expired?: boolean } = {}): string {
      return sign(
        { userId, pendingTotp: true },
        jwtSecret,
        {
          algorithm: 'HS256',
          expiresIn: options.expired ? -10 : 600,
        },
      );
    }

    /**
     * Validates: Requirements 6.4
     * WHEN the code is invalid, return HTTP 400
     */
    it('should return 400 when code is invalid', async () => {
      mockTotpService.verifyCode.mockReturnValueOnce(false);

      const { mockApp, userId } = createMockApp({
        totpEnabled: true,
        totpSecret: 'encrypted-active-secret',
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const pendingToken = signPendingToken(userId.toString());

      const response = await request(app)
        .post('/api/user/totp/verify')
        .set('Authorization', `Bearer ${pendingToken}`)
        .send({ code: '999999' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid TOTP code');
    });

    /**
     * Validates: Requirements 6.5
     * WHEN the pending token is expired, return HTTP 401
     */
    it('should return 401 when pending token is expired', async () => {
      const { mockApp, userId } = createMockApp({
        totpEnabled: true,
        totpSecret: 'encrypted-active-secret',
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const expiredToken = signPendingToken(userId.toString(), { expired: true });

      const response = await request(app)
        .post('/api/user/totp/verify')
        .set('Authorization', `Bearer ${expiredToken}`)
        .send({ code: '123456' });

      expect(response.status).toBe(401);
    });

    it('should return 401 when no Authorization header is provided', async () => {
      const { mockApp } = createMockApp({
        totpEnabled: true,
        totpSecret: 'encrypted-active-secret',
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const response = await request(app)
        .post('/api/user/totp/verify')
        .send({ code: '123456' });

      expect(response.status).toBe(401);
    });

    it('should return 401 when token is not a pending TOTP token', async () => {
      const { mockApp } = createMockApp({
        totpEnabled: true,
        totpSecret: 'encrypted-active-secret',
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      // Sign a token without pendingTotp claim
      const regularToken = sign(
        { userId: 'some-id' },
        jwtSecret,
        { algorithm: 'HS256', expiresIn: 600 },
      );

      const response = await request(app)
        .post('/api/user/totp/verify')
        .set('Authorization', `Bearer ${regularToken}`)
        .send({ code: '123456' });

      expect(response.status).toBe(401);
    });

    it('should return 400 when code format is invalid', async () => {
      const { mockApp, userId } = createMockApp({
        totpEnabled: true,
        totpSecret: 'encrypted-active-secret',
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const pendingToken = signPendingToken(userId.toString());

      const response = await request(app)
        .post('/api/user/totp/verify')
        .set('Authorization', `Bearer ${pendingToken}`)
        .send({ code: 'abcdef' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('6 digits');
    });

    it('should return 200 with full JWT on valid code', async () => {
      mockTotpService.verifyCode.mockReturnValueOnce(true);

      const { mockApp, userId } = createMockApp({
        totpEnabled: true,
        totpSecret: 'encrypted-active-secret',
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const pendingToken = signPendingToken(userId.toString());

      const response = await request(app)
        .post('/api/user/totp/verify')
        .set('Authorization', `Bearer ${pendingToken}`)
        .send({ code: '123456' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('serverPublicKey');
    });

    it('should return 401 when user has TOTP disabled', async () => {
      const { mockApp, userId } = createMockApp({
        totpEnabled: false,
        totpSecret: undefined,
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const pendingToken = signPendingToken(userId.toString());

      const response = await request(app)
        .post('/api/user/totp/verify')
        .set('Authorization', `Bearer ${pendingToken}`)
        .send({ code: '123456' });

      expect(response.status).toBe(401);
    });
  });

  // ─── POST /totp/reset ───────────────────────────────────────────────

  describe('POST /totp/reset', () => {
    /**
     * Validates: Requirements 15.1, 15.4
     * WHEN totpEnabled is false, return HTTP 409
     */
    it('should return 409 when TOTP is not enabled', async () => {
      const { mockApp } = createMockApp({ totpEnabled: false });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const response = await request(app)
        .post('/api/user/totp/reset')
        .set('Authorization', 'Bearer mock-token')
        .send({ code: '123456' });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('not currently active');
    });

    /**
     * Validates: Requirements 15.3
     * WHEN the code is invalid, return HTTP 400
     */
    it('should return 400 when code is invalid', async () => {
      mockTotpService.verifyCode.mockReturnValueOnce(false);

      const { mockApp, userDoc } = createMockApp({
        totpEnabled: true,
        totpSecret: 'encrypted-active-secret',
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const response = await request(app)
        .post('/api/user/totp/reset')
        .set('Authorization', 'Bearer mock-token')
        .send({ code: '999999' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid TOTP code');
      // Ensure no state change
      expect(userDoc.set).not.toHaveBeenCalledWith('totpPendingSecret', expect.any(String));
    });

    it('should return 400 when code format is invalid', async () => {
      const { mockApp } = createMockApp({
        totpEnabled: true,
        totpSecret: 'encrypted-active-secret',
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const response = await request(app)
        .post('/api/user/totp/reset')
        .set('Authorization', 'Bearer mock-token')
        .send({ code: '' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('6 digits');
    });

    /**
     * Validates: Requirements 15.1
     * Success for reset with valid code returns new provisioning URI
     */
    it('should return 200 with new provisioningUri and secret on valid code', async () => {
      mockTotpService.verifyCode.mockReturnValueOnce(true);

      const { mockApp, userDoc } = createMockApp({
        totpEnabled: true,
        totpSecret: 'encrypted-active-secret',
      });
      const { controller } = createController(mockApp);
      const app = buildExpressApp(controller);

      const response = await request(app)
        .post('/api/user/totp/reset')
        .set('Authorization', 'Bearer mock-token')
        .send({ code: '123456' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('provisioningUri');
      expect(response.body).toHaveProperty('secret');
      expect(response.body.provisioningUri).toContain('otpauth://totp/');
      expect(typeof response.body.secret).toBe('string');
      expect(response.body.message).toContain('reset initiated');
      // totpPendingSecret should be set, but totpEnabled and totpSecret remain unchanged
      expect(userDoc.set).toHaveBeenCalledWith('totpPendingSecret', expect.any(String));
      expect(userDoc.set).not.toHaveBeenCalledWith('totpEnabled', false);
      expect(userDoc.set).not.toHaveBeenCalledWith('totpSecret', undefined);
      expect(userDoc.save).toHaveBeenCalled();
    });
  });
});
