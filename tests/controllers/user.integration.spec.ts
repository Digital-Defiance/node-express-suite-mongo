import { ECIESService } from '@digitaldefiance/node-ecies-lib';
import { UserController } from '../../src/controllers/user';
import { BackupCodeService } from '../../src/services/backup-code';
import { JwtService } from '@digitaldefiance/node-express-suite';
import { RoleService } from '../../src/services/role';
import { UserService } from '../../src/services/user';

// Mock SystemUserService before importing UserController (lives in base package)
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

describe('UserController', () => {
  let controller: UserController;
  let mockApp: any;
  let mockJwtService: jest.Mocked<JwtService<any, any, any, any, any>>;
  let mockUserService: jest.Mocked<
    UserService<any, any, any, any, any, any, any, any, any, any, any>
  >;
  let mockBackupCodeService: jest.Mocked<BackupCodeService<any, any, any, any>>;
  let mockRoleService: jest.Mocked<RoleService<any, any, any>>;
  let mockEciesService: jest.Mocked<ECIESService>;

  beforeEach(() => {
    process.env.JWT_SECRET = 'a'.repeat(64);
    process.env.MNEMONIC_HMAC_SECRET = 'a'.repeat(64);
    process.env.MNEMONIC_ENCRYPTION_KEY = 'b'.repeat(64);

    mockApp = {
      environment: {
        mongo: { useTransactions: false },
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
      },
      getModel: jest.fn().mockReturnValue({
        findById: jest.fn(),
        findOne: jest.fn(),
      }),
    };

    mockJwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
      verify: jest.fn(),
      createUserToken: jest.fn().mockResolvedValue('mock-token'),
      verifyToken: jest.fn(),
      signToken: jest.fn(),
    } as any;

    mockUserService = {
      findByUsername: jest.fn(),
      findByEmail: jest.fn(),
      createUser: jest.fn(),
      updateUser: jest.fn(),
      validatePassword: jest.fn(),
      updatePassword: jest.fn(),
      getUserWithRoles: jest.fn(),
      generateChallenge: jest.fn(),
      verifyChallenge: jest.fn(),
      newUser: jest.fn(),
      createAndSendEmailToken: jest.fn(),
      verifyAccountTokenAndComplete: jest.fn(),
      updateSiteLanguage: jest.fn(),
      resetUserBackupCodes: jest.fn(),
      changePassword: jest.fn(),
      generateDirectLoginChallenge: jest.fn(),
      verifyDirectLoginChallenge: jest.fn(),
      findUser: jest.fn(),
      validateEmailLoginTokenChallenge: jest.fn(),
      resendEmailToken: jest.fn(),
      verifyEmailToken: jest.fn(),
      resetPasswordWithToken: jest.fn(),
      recoverMnemonic: jest.fn(),
      findUserById: jest.fn(),
    } as any;

    mockBackupCodeService = {
      generateCodes: jest.fn().mockResolvedValue(['CODE1', 'CODE2']),
      getCodeCount: jest.fn().mockResolvedValue(10),
      validateCode: jest.fn(),
      regenerateCodes: jest.fn().mockResolvedValue(['NEW1', 'NEW2']),
      recoverKeyWithBackupCode: jest.fn(),
    } as any;

    mockRoleService = {
      getUserRoles: jest.fn().mockResolvedValue([]),
      addUserToRole: jest.fn(),
      removeUserFromRole: jest.fn(),
      getMemberType: jest.fn(),
    } as any;

    mockEciesService = {
      encrypt: jest.fn(),
      decrypt: jest.fn(),
      generateKeyPair: jest.fn(),
    } as any;

    controller = new UserController(
      mockApp,
      mockJwtService,
      mockUserService,
      mockBackupCodeService,
      mockRoleService,
      mockEciesService,
    );
  });

  describe('constructor', () => {
    it('should initialize with services', () => {
      expect(controller).toBeDefined();
      expect(controller['jwtService']).toBe(mockJwtService);
      expect(controller['userService']).toBe(mockUserService);
      expect(controller['backupCodeService']).toBe(mockBackupCodeService);
      expect(controller['roleService']).toBe(mockRoleService);
      expect(controller['eciesService']).toBe(mockEciesService);
    });

    it('should initialize system user', () => {
      expect(controller['systemUser']).toBeDefined();
    });
  });

  describe('router initialization', () => {
    it('should have router configured', () => {
      expect(controller.router).toBeDefined();
    });

    it('should register routes', () => {
      const stack = controller.router.stack;
      expect(stack.length).toBeGreaterThan(0);
    });

    it('should have POST /register route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasRegister = routes.some(
        (r: any) => r.path === '/register' && r.methods.includes('post'),
      );
      expect(hasRegister).toBe(true);
    });

    it('should have GET /refresh-token route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasRefreshToken = routes.some(
        (r: any) => r.path === '/refresh-token' && r.methods.includes('get'),
      );
      expect(hasRefreshToken).toBe(true);
    });

    it('should have POST /account-verification route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasAccountVerification = routes.some(
        (r: any) =>
          r.path === '/account-verification' && r.methods.includes('post'),
      );
      expect(hasAccountVerification).toBe(true);
    });

    it('should have GET /verify route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasVerify = routes.some(
        (r: any) => r.path === '/verify' && r.methods.includes('get'),
      );
      expect(hasVerify).toBe(true);
    });

    it('should have POST /change-password route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasChangePassword = routes.some(
        (r: any) => r.path === '/change-password' && r.methods.includes('post'),
      );
      expect(hasChangePassword).toBe(true);
    });

    it('should have GET /backup-codes route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasBackupCodes = routes.some(
        (r: any) => r.path === '/backup-codes' && r.methods.includes('get'),
      );
      expect(hasBackupCodes).toBe(true);
    });

    it('should have POST /backup-codes route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasPostBackupCodes = routes.some(
        (r: any) => r.path === '/backup-codes' && r.methods.includes('post'),
      );
      expect(hasPostBackupCodes).toBe(true);
    });

    it('should have POST /forgot-password route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasForgotPassword = routes.some(
        (r: any) => r.path === '/forgot-password' && r.methods.includes('post'),
      );
      expect(hasForgotPassword).toBe(true);
    });

    it('should have POST /reset-password route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasResetPassword = routes.some(
        (r: any) => r.path === '/reset-password' && r.methods.includes('post'),
      );
      expect(hasResetPassword).toBe(true);
    });

    it('should have POST /language route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasLanguage = routes.some(
        (r: any) => r.path === '/language' && r.methods.includes('post'),
      );
      expect(hasLanguage).toBe(true);
    });

    it('should have POST /request-direct-login route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasDirectLogin = routes.some(
        (r: any) =>
          r.path === '/request-direct-login' && r.methods.includes('post'),
      );
      expect(hasDirectLogin).toBe(true);
    });

    it('should have POST /direct-challenge route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasDirectChallenge = routes.some(
        (r: any) =>
          r.path === '/direct-challenge' && r.methods.includes('post'),
      );
      expect(hasDirectChallenge).toBe(true);
    });

    it('should have POST /request-email-login route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasEmailLogin = routes.some(
        (r: any) =>
          r.path === '/request-email-login' && r.methods.includes('post'),
      );
      expect(hasEmailLogin).toBe(true);
    });

    it('should have POST /email-challenge route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasEmailChallenge = routes.some(
        (r: any) => r.path === '/email-challenge' && r.methods.includes('post'),
      );
      expect(hasEmailChallenge).toBe(true);
    });

    it('should have POST /resend-verification route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasResendVerification = routes.some(
        (r: any) =>
          r.path === '/resend-verification' && r.methods.includes('post'),
      );
      expect(hasResendVerification).toBe(true);
    });

    it('should have POST /backup-code route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasBackupCode = routes.some(
        (r: any) => r.path === '/backup-code' && r.methods.includes('post'),
      );
      expect(hasBackupCode).toBe(true);
    });

    it('should have GET /verify-reset-token route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasVerifyResetToken = routes.some(
        (r: any) =>
          r.path === '/verify-reset-token' && r.methods.includes('get'),
      );
      expect(hasVerifyResetToken).toBe(true);
    });

    it('should have POST /recover-mnemonic route', () => {
      const routes = controller.router.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      const hasRecoverMnemonic = routes.some(
        (r: any) =>
          r.path === '/recover-mnemonic' && r.methods.includes('post'),
      );
      expect(hasRecoverMnemonic).toBe(true);
    });
  });

  describe('service integration', () => {
    it('should use UserService for user operations', () => {
      expect(controller['userService']).toBe(mockUserService);
    });

    it('should use JwtService for token operations', () => {
      expect(controller['jwtService']).toBe(mockJwtService);
    });

    it('should use BackupCodeService for backup codes', () => {
      expect(controller['backupCodeService']).toBe(mockBackupCodeService);
    });

    it('should use RoleService for role management', () => {
      expect(controller['roleService']).toBe(mockRoleService);
    });

    it('should use ECIESService for encryption', () => {
      expect(controller['eciesService']).toBe(mockEciesService);
    });

    it('should store system user from SystemUserService', () => {
      expect(controller['systemUser']).toBeDefined();
      expect(controller['systemUser'].publicKey).toEqual(Buffer.alloc(65, 1));
      expect(controller['systemUser'].privateKey).toEqual(Buffer.alloc(32, 2));
      expect(controller['systemUser'].address).toBe('mock-address');
    });
  });

  describe('route handler coverage', () => {
    it('should have all handler methods defined', () => {
      // Verify the decorated methods exist
      expect(typeof (controller as any).register).toBe('function');
      expect(typeof (controller as any).refreshToken).toBe('function');
      expect(typeof (controller as any).completeAccountVerification).toBe(
        'function',
      );
      expect(typeof (controller as any).tokenVerifiedResponse).toBe('function');
      expect(typeof (controller as any).changePassword).toBe('function');
      expect(typeof (controller as any).getBackupCodeCount).toBe('function');
      expect(typeof (controller as any).resetBackupCodes).toBe('function');
      expect(typeof (controller as any).forgotPassword).toBe('function');
      expect(typeof (controller as any).resetPassword).toBe('function');
      expect(typeof (controller as any).setLanguage).toBe('function');
      expect(typeof (controller as any).requestDirectLogin).toBe('function');
      expect(typeof (controller as any).directLoginChallenge).toBe('function');
      expect(typeof (controller as any).requestEmailLogin).toBe('function');
      expect(typeof (controller as any).emailLoginChallenge).toBe('function');
      expect(typeof (controller as any).resendVerification).toBe('function');
      expect(typeof (controller as any).useBackupCodeLogin).toBe('function');
      expect(typeof (controller as any).verifyResetToken).toBe('function');
      expect(typeof (controller as any).recoverMnemonic).toBe('function');
    });
  });
});
