import { Types } from '@digitaldefiance/mongoose-types';
import {
  EmailInUseError,
  EmailTokenType,
  UserNotFoundError,
} from '@digitaldefiance/suite-core-lib';
import { LocalhostConstants } from '@digitaldefiance/node-express-suite';
import { BaseModelName } from '../../src/enumerations/base-model-name';
import { IApplication } from '@digitaldefiance/node-express-suite';
import { IEmailService } from '@digitaldefiance/node-express-suite';
import { ModelRegistry } from '../../src/model-registry';
import { BackupCodeService } from '../../src/services/backup-code';
import { KeyWrappingService } from '@digitaldefiance/node-express-suite';
import { RequestUserService } from '../../src/services/request-user';
import { RoleService } from '../../src/services/role';
import { UserService } from '../../src/services/user';

describe('UserService - updateUserSettings', () => {
  let service: UserService<any, Types.ObjectId, Date, string, string>;
  let mockApplication: jest.Mocked<IApplication>;
  let mockRoleService: jest.Mocked<RoleService<Types.ObjectId, Date, any>>;
  let mockEmailService: jest.Mocked<IEmailService>;
  let mockKeyWrappingService: jest.Mocked<KeyWrappingService>;
  let mockBackupCodeService: jest.Mocked<
    BackupCodeService<Types.ObjectId, Date, any, any>
  >;
  let mockUserModel: any;
  let mockEmailTokenModel: any;
  let createAndSendEmailTokenDirectSpy: jest.SpyInstance;

  beforeEach(() => {
    mockUserModel = {
      findById: jest.fn(),
      findOne: jest.fn(),
    };

    mockEmailTokenModel = {
      findOneAndUpdate: jest.fn(),
    };

    jest
      .spyOn(ModelRegistry.instance, 'getTypedModel')
      .mockImplementation((modelName: string) => {
        if (modelName === BaseModelName.User) return mockUserModel;
        if (modelName === BaseModelName.EmailToken) return mockEmailTokenModel;
        return {};
      });

    mockApplication = {
      environment: {
        debug: false,
        mongo: { transactionTimeout: 30000, useTransactions: false },
        disableEmailSend: true,
      },
      constants: LocalhostConstants,
      db: { connection: {} },
    } as any;

    mockRoleService = {
      getUserRoles: jest.fn().mockResolvedValue([]),
      rolesToTokenRoles: jest.fn().mockReturnValue([]),
    } as any;

    mockEmailService = {
      sendEmail: jest.fn(),
    } as any;

    mockKeyWrappingService = {} as any;
    mockBackupCodeService = {} as any;

    service = new UserService(
      mockApplication,
      mockRoleService,
      mockEmailService,
      mockKeyWrappingService,
      mockBackupCodeService,
    );

    createAndSendEmailTokenDirectSpy = jest
      .spyOn(service, 'createAndSendEmailTokenDirect')
      .mockResolvedValue({} as any);

    jest.spyOn(RequestUserService, 'makeRequestUserDTO').mockReturnValue({
      _id: 'user-id',
      email: 'updated@example.com',
      rolePrivileges: {
        admin: false,
        member: true,
        child: false,
        system: false,
      },
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('email updates', () => {
    it('should update email and send verification token', async () => {
      const userId = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        email: 'old@example.com',
        save: jest.fn().mockResolvedValue(undefined),
      } as any;

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(userDoc),
      });
      mockUserModel.findOne.mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });

      await service.updateUserSettings(userId.toString(), {
        email: 'new@example.com',
      });

      expect(userDoc.email).toBe('new@example.com');
      expect(createAndSendEmailTokenDirectSpy).toHaveBeenCalledWith(
        userDoc,
        EmailTokenType.AccountVerification,
        undefined,
        false,
      );
      expect(userDoc.save).toHaveBeenCalled();
    });

    it('should throw EmailInUseError when email already exists', async () => {
      const userId = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        email: 'old@example.com',
      } as any;
      const existingUser = {
        _id: new Types.ObjectId(),
        email: 'taken@example.com',
      };

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(userDoc),
      });
      mockUserModel.findOne.mockReturnValue({
        session: jest.fn().mockResolvedValue(existingUser),
      });

      await expect(
        service.updateUserSettings(userId.toString(), {
          email: 'taken@example.com',
        }),
      ).rejects.toThrow(EmailInUseError);
    });

    it('should not send verification when email unchanged', async () => {
      const userId = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        email: 'same@example.com',
        save: jest.fn().mockResolvedValue(undefined),
      } as any;

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(userDoc),
      });

      await service.updateUserSettings(userId.toString(), {
        email: 'same@example.com',
      });

      expect(createAndSendEmailTokenDirectSpy).not.toHaveBeenCalled();
      expect(userDoc.save).toHaveBeenCalled();
    });

    it('should handle case-insensitive email comparison', async () => {
      const userId = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        email: 'user@example.com',
        save: jest.fn().mockResolvedValue(undefined),
      } as any;

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(userDoc),
      });

      await service.updateUserSettings(userId.toString(), {
        email: 'USER@EXAMPLE.COM',
      });

      expect(createAndSendEmailTokenDirectSpy).not.toHaveBeenCalled();
    });
  });

  describe('timezone updates', () => {
    it('should update timezone', async () => {
      const userId = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        email: 'user@example.com',
        timezone: 'UTC',
        save: jest.fn().mockResolvedValue(undefined),
      } as any;

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(userDoc),
      });

      await service.updateUserSettings(userId.toString(), {
        timezone: 'America/New_York',
      });

      expect(userDoc.timezone).toBe('America/New_York');
      expect(userDoc.save).toHaveBeenCalled();
    });
  });

  describe('siteLanguage updates', () => {
    it('should update siteLanguage', async () => {
      const userId = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        email: 'user@example.com',
        siteLanguage: 'en-US',
        save: jest.fn().mockResolvedValue(undefined),
      } as any;

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(userDoc),
      });

      await service.updateUserSettings(userId.toString(), {
        siteLanguage: 'es',
      });

      expect(userDoc.siteLanguage).toBe('es');
      expect(userDoc.save).toHaveBeenCalled();
    });
  });

  describe('currency updates', () => {
    it('should update currency', async () => {
      const userId = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        email: 'user@example.com',
        currency: 'USD',
        save: jest.fn().mockResolvedValue(undefined),
      } as any;

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(userDoc),
      });

      await service.updateUserSettings(userId.toString(), {
        currency: 'EUR',
      });

      expect(userDoc.currency).toBe('EUR');
      expect(userDoc.save).toHaveBeenCalled();
    });
  });

  describe('darkMode updates', () => {
    it('should update darkMode to true', async () => {
      const userId = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        email: 'user@example.com',
        darkMode: false,
        save: jest.fn().mockResolvedValue(undefined),
      } as any;

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(userDoc),
      });

      await service.updateUserSettings(userId.toString(), {
        darkMode: true,
      });

      expect(userDoc.darkMode).toBe(true);
      expect(userDoc.save).toHaveBeenCalled();
    });

    it('should update darkMode to false', async () => {
      const userId = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        email: 'user@example.com',
        darkMode: true,
        save: jest.fn().mockResolvedValue(undefined),
      } as any;

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(userDoc),
      });

      await service.updateUserSettings(userId.toString(), {
        darkMode: false,
      });

      expect(userDoc.darkMode).toBe(false);
      expect(userDoc.save).toHaveBeenCalled();
    });
  });

  describe('directChallenge updates', () => {
    it('should update directChallenge to true', async () => {
      const userId = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        email: 'user@example.com',
        directChallenge: false,
        save: jest.fn().mockResolvedValue(undefined),
      } as any;

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(userDoc),
      });

      await service.updateUserSettings(userId.toString(), {
        directChallenge: true,
      });

      expect(userDoc.directChallenge).toBe(true);
      expect(userDoc.save).toHaveBeenCalled();
    });

    it('should update directChallenge to false', async () => {
      const userId = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        email: 'user@example.com',
        directChallenge: true,
        save: jest.fn().mockResolvedValue(undefined),
      } as any;

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(userDoc),
      });

      await service.updateUserSettings(userId.toString(), {
        directChallenge: false,
      });

      expect(userDoc.directChallenge).toBe(false);
      expect(userDoc.save).toHaveBeenCalled();
    });
  });

  describe('multiple settings updates', () => {
    it('should update all settings atomically', async () => {
      const userId = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        email: 'old@example.com',
        timezone: 'UTC',
        siteLanguage: 'en-US',
        currency: 'USD',
        darkMode: false,
        directChallenge: false,
        save: jest.fn().mockResolvedValue(undefined),
      } as any;

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(userDoc),
      });
      mockUserModel.findOne.mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });

      await service.updateUserSettings(userId.toString(), {
        email: 'new@example.com',
        timezone: 'Europe/London',
        siteLanguage: 'fr',
        currency: 'GBP',
        darkMode: true,
        directChallenge: true,
      });

      expect(userDoc.email).toBe('new@example.com');
      expect(userDoc.timezone).toBe('Europe/London');
      expect(userDoc.siteLanguage).toBe('fr');
      expect(userDoc.currency).toBe('GBP');
      expect(userDoc.darkMode).toBe(true);
      expect(userDoc.directChallenge).toBe(true);
      expect(userDoc.save).toHaveBeenCalled();
      expect(createAndSendEmailTokenDirectSpy).toHaveBeenCalled();
    });

    it('should update only provided settings', async () => {
      const userId = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        email: 'user@example.com',
        timezone: 'UTC',
        siteLanguage: 'en-US',
        currency: 'USD',
        darkMode: false,
        directChallenge: false,
        save: jest.fn().mockResolvedValue(undefined),
      } as any;

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(userDoc),
      });

      await service.updateUserSettings(userId.toString(), {
        timezone: 'Asia/Tokyo',
        darkMode: true,
      });

      expect(userDoc.timezone).toBe('Asia/Tokyo');
      expect(userDoc.darkMode).toBe(true);
      expect(userDoc.email).toBe('user@example.com');
      expect(userDoc.siteLanguage).toBe('en-US');
      expect(userDoc.currency).toBe('USD');
      expect(userDoc.directChallenge).toBe(false);
      expect(userDoc.save).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw UserNotFoundError when user not found', async () => {
      const userId = new Types.ObjectId();

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.updateUserSettings(userId.toString(), {
          timezone: 'UTC',
        }),
      ).rejects.toThrow(UserNotFoundError);
    });

    it('should handle empty settings object', async () => {
      const userId = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        email: 'user@example.com',
        save: jest.fn().mockResolvedValue(undefined),
      } as any;

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(userDoc),
      });

      await service.updateUserSettings(userId.toString(), {});

      expect(userDoc.save).toHaveBeenCalled();
    });
  });

  describe('return value', () => {
    it('should return IRequestUserDTO with updated values', async () => {
      const userId = new Types.ObjectId();
      const userDoc = {
        _id: userId,
        email: 'user@example.com',
        timezone: 'UTC',
        save: jest.fn().mockResolvedValue(undefined),
      } as any;

      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(userDoc),
      });

      const result = await service.updateUserSettings(userId.toString(), {
        timezone: 'America/Los_Angeles',
      });

      expect(result).toBeDefined();
      expect(result._id).toBe('user-id');
      expect(mockRoleService.getUserRoles).toHaveBeenCalledWith(userDoc._id);
      expect(RequestUserService.makeRequestUserDTO).toHaveBeenCalled();
    });
  });
});
