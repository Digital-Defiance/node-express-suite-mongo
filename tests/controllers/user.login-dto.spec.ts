import { Types } from '@digitaldefiance/mongoose-types';
import { ECIESService } from '@digitaldefiance/node-ecies-lib';
import {
  AccountStatus,
  IRoleDTO,
  ITokenRole,
} from '@digitaldefiance/suite-core-lib';
import { Request, Response } from 'express';
import { UserController } from '../../src/controllers/user';
import { IUserDocument } from '../../src/documents';
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

/**
 * Test suite to verify that login endpoints return properly formatted IRequestUserDTO objects
 * with roles array instead of raw MongoDB documents.
 *
 * This addresses a bug where direct-challenge and email-challenge endpoints were returning
 * raw userDoc objects (with roles as ObjectIds) instead of using RequestUserService.makeRequestUserDTO
 * which properly formats the roles as IRoleDTO objects.
 */
describe('UserController - Login DTO Validation', () => {
  let controller: UserController;
  let mockApp: any;
  let mockJwtService: jest.Mocked<JwtService<any, any, any, any, any>>;
  let mockUserService: jest.Mocked<
    UserService<any, any, any, any, any, any, any, any, any, any, any>
  >;
  let mockBackupCodeService: jest.Mocked<BackupCodeService<any, any, any, any>>;
  let mockRoleService: jest.Mocked<RoleService<any, any, any>>;
  let mockEciesService: jest.Mocked<ECIESService>;

  const mockUserId = new Types.ObjectId();
  const mockRoleId = new Types.ObjectId();

  // Mock role objects with all required properties
  const mockTokenRole: ITokenRole<Types.ObjectId> = {
    _id: mockRoleId,
    name: 'member',
    admin: false,
    member: true,
    child: false,
    system: false,
    createdAt: new Date(),
    createdBy: mockUserId,
    updatedAt: new Date(),
    updatedBy: mockUserId,
  } as any;

  const mockRoleDTO: IRoleDTO = {
    _id: mockRoleId.toString(),
    name: 'member',
    admin: false,
    member: true,
    child: false,
    system: false,
    createdAt: new Date().toISOString(),
    createdBy: mockUserId.toString(),
    updatedAt: new Date().toISOString(),
    updatedBy: mockUserId.toString(),
  } as any;

  // Mock user document
  const mockUserDoc: Partial<IUserDocument> = {
    _id: mockUserId,
    username: 'testuser',
    email: 'test@example.com',
    timezone: 'UTC',
    currency: 'USD',
    accountStatus: AccountStatus.Active,
    emailVerified: true,
    directChallenge: true,
    darkMode: false,
    siteLanguage: 'en-US',
    lastLogin: new Date(),
  };

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
        findById: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue(null),
        }),
        findOne: jest.fn(),
      }),
    };

    mockJwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
      verify: jest.fn(),
      createUserToken: jest.fn().mockResolvedValue('mock-token'),
      verifyToken: jest.fn().mockResolvedValue({
        userId: mockUserId.toString(),
      }),
      signToken: jest.fn().mockResolvedValue({
        token: 'mock-jwt-token',
        roles: [mockTokenRole],
      }),
    } as any;

    mockUserService = {
      verifyDirectLoginChallenge: jest.fn().mockResolvedValue({
        userDoc: mockUserDoc,
      }),
      validateEmailLoginTokenChallenge: jest
        .fn()
        .mockResolvedValue(mockUserDoc),
      findUser: jest.fn().mockResolvedValue(mockUserDoc),
      updateLastLogin: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockBackupCodeService = {
      generateCodes: jest.fn().mockResolvedValue(['CODE1', 'CODE2']),
      getCodeCount: jest.fn().mockResolvedValue(10),
      validateCode: jest.fn(),
      regenerateCodes: jest.fn().mockResolvedValue(['NEW1', 'NEW2']),
      recoverKeyWithBackupCode: jest.fn().mockResolvedValue({
        user: { publicKey: Buffer.alloc(65) },
        userDoc: mockUserDoc,
        codeCount: 5,
      }),
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
      signMessage: jest.fn(),
      verifySignature: jest.fn(),
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

  describe('POST /direct-challenge', () => {
    it('should return user DTO with properly formatted roles array', async () => {
      const mockReq = {
        body: {
          username: 'testuser',
          challenge: 'a'.repeat(128),
          signature: 'b'.repeat(128),
        },
        validatedBody: {
          username: 'testuser',
          challenge: 'a'.repeat(128),
          signature: 'b'.repeat(128),
        },
        user: undefined,
        headers: {},
      } as any as Request;

      const mockRes = {} as Response;
      const mockNext = jest.fn();

      // Set the active request context
      (controller as any).activeRequest = mockReq;
      (controller as any).activeResponse = mockRes;

      const result = await controller.directLoginChallenge(
        mockReq,
        mockRes,
        mockNext,
      );

      // Clear the active request context
      (controller as any).activeRequest = null;
      (controller as any).activeResponse = null;

      // Verify the response structure
      expect(result.statusCode).toBe(200);
      expect(result.response).toHaveProperty('user');
      expect(result.response).toHaveProperty('token');
      expect(result.response).toHaveProperty('message');

      // Verify user is a DTO, not a raw document
      const user = (result.response as any).user;
      expect(user).toBeDefined();
      expect(user.id).toBe(mockUserId.toString()); // DTO has 'id' as string
      expect(user._id).toBeUndefined(); // Raw doc would have _id

      // Verify roles are properly formatted as IRoleDTO[]
      expect(user.roles).toBeDefined();
      expect(Array.isArray(user.roles)).toBe(true);
      expect(user.roles.length).toBeGreaterThan(0);

      const role = user.roles[0];
      expect(typeof role._id).toBe('string'); // DTO has _id as string
      expect(role._id).toBe(mockRoleId.toString()); // Verify it's the expected role
      expect(role.name).toBe('member');
      expect(role.admin).toBe(false);
      expect(role.member).toBe(true);
      expect(role.child).toBe(false);
      expect(role.system).toBe(false);

      // Verify rolePrivileges are properly set
      expect(user.rolePrivileges).toBeDefined();
      expect(user.rolePrivileges.admin).toBe(false);
      expect(user.rolePrivileges.member).toBe(true);
      expect(user.rolePrivileges.child).toBe(false);
      expect(user.rolePrivileges.system).toBe(false);
    });
  });

  describe('POST /email-challenge', () => {
    it('should return user DTO with properly formatted roles array', async () => {
      const mockReq = {
        body: {
          token: 'email-token-123',
          signature: 'b'.repeat(128),
        },
        validatedBody: {
          token: 'email-token-123',
          signature: 'b'.repeat(128),
        },
        user: undefined,
        headers: {},
      } as any as Request;

      const mockRes = {} as Response;
      const mockNext = jest.fn();

      // Set the active request context
      (controller as any).activeRequest = mockReq;
      (controller as any).activeResponse = mockRes;

      const result = await controller.emailLoginChallenge(
        mockReq,
        mockRes,
        mockNext,
      );

      // Clear the active request context
      (controller as any).activeRequest = null;
      (controller as any).activeResponse = null;

      // Verify the response structure
      expect(result.statusCode).toBe(200);
      expect(result.response).toHaveProperty('user');
      expect(result.response).toHaveProperty('token');
      expect(result.response).toHaveProperty('message');

      // Verify user is a DTO, not a raw document
      const user = (result.response as any).user;
      expect(user).toBeDefined();
      expect(user.id).toBe(mockUserId.toString()); // DTO has 'id' as string
      expect(user._id).toBeUndefined(); // Raw doc would have _id

      // Verify roles are properly formatted as IRoleDTO[]
      expect(user.roles).toBeDefined();
      expect(Array.isArray(user.roles)).toBe(true);
      expect(user.roles.length).toBeGreaterThan(0);

      const role = user.roles[0];
      expect(typeof role._id).toBe('string'); // DTO has _id as string
      expect(role._id).toBe(mockRoleId.toString()); // Verify it's the expected role
      expect(role.name).toBe('member');
      expect(role.admin).toBe(false);
      expect(role.member).toBe(true);
      expect(role.child).toBe(false);
      expect(role.system).toBe(false);

      // Verify rolePrivileges are properly set
      expect(user.rolePrivileges).toBeDefined();
      expect(user.rolePrivileges.admin).toBe(false);
      expect(user.rolePrivileges.member).toBe(true);
      expect(user.rolePrivileges.child).toBe(false);
      expect(user.rolePrivileges.system).toBe(false);
    });
  });

  describe('POST /backup-code', () => {
    it('should return user DTO with properly formatted roles array', async () => {
      const mockReq = {
        body: {
          identifier: 'testuser',
          code: 'backup-code-123',
          isEmail: false,
          recoverMnemonic: false,
        },
        validatedBody: {
          identifier: 'testuser',
          code: 'backup-code-123',
          isEmail: false,
          recoverMnemonic: false,
        },
        user: undefined,
        headers: {},
      } as any as Request;

      const mockRes = {} as Response;
      const mockNext = jest.fn();

      // Set the active request context
      (controller as any).activeRequest = mockReq;
      (controller as any).activeResponse = mockRes;

      const result = await controller.useBackupCodeLogin(
        mockReq,
        mockRes,
        mockNext,
      );

      // Clear the active request context
      (controller as any).activeRequest = null;
      (controller as any).activeResponse = null;

      // Verify the response structure
      expect(result.statusCode).toBe(200);
      expect(result.response).toHaveProperty('user');
      expect(result.response).toHaveProperty('token');
      expect(result.response).toHaveProperty('codeCount');

      // Verify user is a DTO, not a raw document
      const user = (result.response as any).user;
      expect(user).toBeDefined();
      expect(user.id).toBe(mockUserId.toString()); // DTO has 'id' as string
      expect(user._id).toBeUndefined(); // Raw doc would have _id

      // Verify roles are properly formatted as IRoleDTO[]
      expect(user.roles).toBeDefined();
      expect(Array.isArray(user.roles)).toBe(true);
      expect(user.roles.length).toBeGreaterThan(0);

      const role = user.roles[0];
      expect(typeof role._id).toBe('string'); // DTO has _id as string
      expect(role._id).toBe(mockRoleId.toString()); // Verify it's the expected role
      expect(role.name).toBe('member');
      expect(role.admin).toBe(false);
      expect(role.member).toBe(true);
      expect(role.child).toBe(false);
      expect(role.system).toBe(false);

      // Verify rolePrivileges are properly set
      expect(user.rolePrivileges).toBeDefined();
      expect(user.rolePrivileges.admin).toBe(false);
      expect(user.rolePrivileges.member).toBe(true);
      expect(user.rolePrivileges.child).toBe(false);
      expect(user.rolePrivileges.system).toBe(false);
    });
  });

  describe('GET /verify', () => {
    it('should return user DTO with properly formatted roles array', async () => {
      const mockReq = {
        user: {
          id: mockUserId.toString(),
          username: 'testuser',
          email: 'test@example.com',
          roles: [mockRoleDTO],
          rolePrivileges: {
            admin: false,
            member: true,
            child: false,
            system: false,
          },
          timezone: 'UTC',
          currency: 'USD',
          emailVerified: true,
          directChallenge: true,
          darkMode: false,
          siteLanguage: 'en-US',
          lastLogin: new Date().toISOString(),
        },
        headers: {
          authorization: 'Bearer mock-jwt-token',
        },
      } as any as Request;

      const mockRes = {} as Response;
      const mockNext = jest.fn();

      // Set the active request context
      (controller as any).activeRequest = mockReq;
      (controller as any).activeResponse = mockRes;

      const result = await controller.tokenVerifiedResponse(
        mockReq,
        mockRes,
        mockNext,
      );

      // Clear the active request context
      (controller as any).activeRequest = null;
      (controller as any).activeResponse = null;

      // Verify the response structure
      expect(result.statusCode).toBe(200);
      expect(result.response).toHaveProperty('user');
      expect(result.response).toHaveProperty('message');

      // Verify user is a DTO, not a raw document
      const user = (result.response as any).user;
      expect(user).toBeDefined();
      expect(user.id).toBe(mockUserId.toString()); // DTO has 'id' as string
      expect(user._id).toBeUndefined(); // Raw doc would have _id

      // Verify roles are properly formatted as IRoleDTO[]
      expect(user.roles).toBeDefined();
      expect(Array.isArray(user.roles)).toBe(true);
      expect(user.roles.length).toBeGreaterThan(0);

      const role = user.roles[0];
      expect(typeof role._id).toBe('string'); // DTO has _id as string
      expect(role._id).toBe(mockRoleId.toString()); // Verify it's the expected role
      expect(role.name).toBe('member');
      expect(role.admin).toBe(false);
      expect(role.member).toBe(true);
      expect(role.child).toBe(false);
      expect(role.system).toBe(false);

      // Verify rolePrivileges are properly set
      expect(user.rolePrivileges).toBeDefined();
      expect(user.rolePrivileges.admin).toBe(false);
      expect(user.rolePrivileges.member).toBe(true);
      expect(user.rolePrivileges.child).toBe(false);
      expect(user.rolePrivileges.system).toBe(false);

      // Verify all role properties are preserved from req.user.roles
      expect(role).toEqual(mockRoleDTO);
    });

    it('should preserve all role properties from JWT token', async () => {
      const fullMockRoleDTO: IRoleDTO = {
        _id: mockRoleId.toString(),
        name: 'member',
        admin: false,
        member: true,
        child: false,
        system: false,
        createdAt: new Date().toISOString(),
        createdBy: mockUserId.toString(),
        updatedAt: new Date().toISOString(),
        updatedBy: mockUserId.toString(),
      } as any;

      const mockReq = {
        user: {
          id: mockUserId.toString(),
          username: 'testuser',
          email: 'test@example.com',
          roles: [fullMockRoleDTO],
          rolePrivileges: {
            admin: false,
            member: true,
            child: false,
            system: false,
          },
          timezone: 'UTC',
          currency: 'USD',
          emailVerified: true,
          directChallenge: true,
          darkMode: false,
          siteLanguage: 'en-US',
        },
        headers: {
          authorization: 'Bearer mock-jwt-token',
        },
      } as any as Request;

      const mockRes = {} as Response;
      const mockNext = jest.fn();

      // Set the active request context
      (controller as any).activeRequest = mockReq;
      (controller as any).activeResponse = mockRes;

      const result = await controller.tokenVerifiedResponse(
        mockReq,
        mockRes,
        mockNext,
      );

      // Clear the active request context
      (controller as any).activeRequest = null;
      (controller as any).activeResponse = null;

      const user = (result.response as any).user;
      const role = user.roles[0];

      // Verify all properties are preserved, not just admin
      expect(role.name).toBe('member');
      expect(role.admin).toBe(false);
      expect(role.member).toBe(true);
      expect(role.child).toBe(false);
      expect(role.system).toBe(false);
      expect(role.createdAt).toBeDefined();
      expect(role.createdBy).toBeDefined();
    });
  });

  describe('GET /refresh-token', () => {
    it('should return user DTO with properly formatted roles array', async () => {
      const mockReq = {
        user: {
          id: mockUserId.toString(),
          username: 'testuser',
          email: 'test@example.com',
          roles: [mockRoleDTO],
          rolePrivileges: {
            admin: false,
            member: true,
            child: false,
            system: false,
          },
          siteLanguage: 'en-US',
        },
        headers: {
          authorization: 'Bearer mock-jwt-token',
        },
      } as any as Request;

      const mockRes = {} as Response;
      const mockNext = jest.fn();

      // Mock the getModel to return a user doc with Active status
      const activeUserDoc = {
        ...mockUserDoc,
        accountStatus: AccountStatus.Active,
      };
      mockApp.getModel.mockReturnValue({
        findById: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue(activeUserDoc),
        }),
      });

      // Set the active request context
      (controller as any).activeRequest = mockReq;
      (controller as any).activeResponse = mockRes;

      const result = await controller.refreshToken(mockReq, mockRes, mockNext);

      // Clear the active request context
      (controller as any).activeRequest = null;
      (controller as any).activeResponse = null;

      // Verify the response structure
      expect(result.statusCode).toBe(200);
      expect(result.response).toHaveProperty('user');
      expect(result.response).toHaveProperty('token');
      expect(result.response).toHaveProperty('message');

      // Verify user is a DTO, not a raw document
      const user = (result.response as any).user;
      expect(user).toBeDefined();
      expect(user.id).toBe(mockUserId.toString()); // DTO has 'id' as string
      expect(user._id).toBeUndefined(); // Raw doc would have _id

      // Verify roles are properly formatted as IRoleDTO[]
      expect(user.roles).toBeDefined();
      expect(Array.isArray(user.roles)).toBe(true);
      expect(user.roles.length).toBeGreaterThan(0);

      const role = user.roles[0];
      expect(typeof role._id).toBe('string'); // DTO has _id as string
      expect(role._id).toBe(mockRoleId.toString()); // Verify it's the expected role

      // Verify rolePrivileges are properly set
      expect(user.rolePrivileges).toBeDefined();
      expect(user.rolePrivileges.admin).toBe(false);
      expect(user.rolePrivileges.member).toBe(true);
      expect(user.rolePrivileges.child).toBe(false);
      expect(user.rolePrivileges.system).toBe(false);
    });
  });

  describe('Role DTO validation helper', () => {
    it('should validate IRoleDTO structure', () => {
      const validateRoleDTO = (role: any): role is IRoleDTO => {
        return (
          typeof role === 'object' &&
          typeof role._id === 'string' && // DTO has _id as string
          typeof role.name === 'string' &&
          typeof role.admin === 'boolean' &&
          typeof role.child === 'boolean'
        );
      };

      // Test with valid DTO
      expect(validateRoleDTO(mockRoleDTO)).toBe(true);

      // Test with invalid structures
      expect(validateRoleDTO({ ...mockRoleDTO, _id: mockRoleId })).toBe(false); // _id is ObjectId not string
      expect(validateRoleDTO({ ...mockRoleDTO, admin: 'true' })).toBe(false); // admin is string
    });
  });

  describe('User DTO validation helper', () => {
    it('should validate IRequestUserDTO structure', () => {
      const validateUserDTO = (user: any): boolean => {
        return (
          typeof user === 'object' &&
          typeof user.id === 'string' &&
          typeof user.username === 'string' &&
          typeof user.email === 'string' &&
          Array.isArray(user.roles) &&
          user.roles.every((role: any) => typeof role._id === 'string') &&
          typeof user.rolePrivileges === 'object' &&
          typeof user.rolePrivileges.admin === 'boolean' &&
          typeof user.rolePrivileges.member === 'boolean' &&
          typeof user.rolePrivileges.child === 'boolean' &&
          typeof user.rolePrivileges.system === 'boolean' &&
          user._id === undefined // Should not have MongoDB ObjectId
        );
      };

      const validUserDTO = {
        id: mockUserId.toString(),
        username: 'testuser',
        email: 'test@example.com',
        roles: [mockRoleDTO],
        rolePrivileges: {
          admin: false,
          member: true,
          child: false,
          system: false,
        },
        timezone: 'UTC',
        currency: 'USD',
        emailVerified: true,
        directChallenge: true,
        darkMode: false,
        siteLanguage: 'en-US',
      };

      // Test with valid DTO
      expect(validateUserDTO(validUserDTO)).toBe(true);

      // Test with invalid structures
      expect(validateUserDTO({ ...validUserDTO, id: mockUserId })).toBe(false); // id is ObjectId
      expect(validateUserDTO({ ...validUserDTO, _id: mockUserId })).toBe(false); // has _id
      expect(
        validateUserDTO({
          ...validUserDTO,
          roles: [{ ...mockRoleDTO, _id: mockRoleId }],
        }),
      ).toBe(false); // role._id is ObjectId
    });
  });
});
