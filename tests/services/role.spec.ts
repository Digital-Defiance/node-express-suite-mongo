import { MemberType } from '@digitaldefiance/ecies-lib';
import { I18nEngine } from '@digitaldefiance/i18n-lib';
import { Document, Types } from '@digitaldefiance/mongoose-types';
import {
  IRoleBase,
  LastAdminError,
  Role,
} from '@digitaldefiance/suite-core-lib';
import { registerNodeRuntimeConfiguration } from '@digitaldefiance/node-ecies-lib';
import { ModelRegistry } from '../../src/model-registry';
import { RoleService } from '../../src/services/role';

describe('RoleService', () => {
  let service: RoleService;
  let mockApp: any;
  let mockRoleModel: any;
  let mockUserRoleModel: any;
  let mockUserModel: any;

  beforeAll(() => {
    registerNodeRuntimeConfiguration('default-config', {});
  });

  beforeEach(() => {
    mockApp = {
      db: { connection: {} },
      environment: {},
      constants: {},
    };

    const mockRoleConstructor = jest.fn().mockImplementation((data) => ({
      ...data,
      save: jest.fn().mockResolvedValue({ ...data }),
    }));
    mockRoleConstructor.findOne = jest.fn();
    mockRoleConstructor.findById = jest.fn();
    mockRoleConstructor.find = jest.fn();
    mockRoleModel = mockRoleConstructor;

    const mockUserRoleConstructor = jest.fn().mockImplementation((data) => ({
      ...data,
      save: jest.fn().mockResolvedValue({ ...data }),
    }));
    mockUserRoleConstructor.findOne = jest.fn();
    mockUserRoleConstructor.find = jest.fn();
    mockUserRoleConstructor.countDocuments = jest.fn();
    mockUserRoleConstructor.findOneAndUpdate = jest.fn();
    mockUserRoleModel = mockUserRoleConstructor;

    mockUserModel = {
      findById: jest.fn(),
    };

    jest
      .spyOn(ModelRegistry.instance, 'get')
      .mockImplementation((modelName: string) => {
        if (modelName === 'Role') {
          return { model: mockRoleModel } as any;
        }
        if (modelName === 'UserRole') {
          return { model: mockUserRoleModel } as any;
        }
        if (modelName === 'User') {
          return { model: mockUserModel } as any;
        }
        return { model: {} } as any;
      });

    // Mock i18n
    jest.spyOn(I18nEngine, 'getInstance').mockReturnValue({
      t: jest.fn((key) => key),
      translateEnum: jest.fn((enumObj, value, lang) => value),
    } as any);

    service = new RoleService(mockApp);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('roleToRoleDTO', () => {
    it('should convert ITokenRole to ITokenRoleDTO', () => {
      const role = {
        _id: new Types.ObjectId(),
        name: Role.Admin,
        translatedName: 'Administrator',
        createdBy: new Types.ObjectId(),
        updatedBy: new Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = RoleService.roleToRoleDTO(role);

      expect(result._id).toBe(role._id.toString());
      expect(result.translatedName).toBe('Administrator');
    });

    it('should handle IRoleDocument with toObject', () => {
      const roleData = {
        _id: new Types.ObjectId(),
        name: Role.Member,
        createdBy: new Types.ObjectId(),
        updatedBy: new Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDocument = {
        ...roleData,
        toObject: jest.fn().mockReturnValue(roleData),
      } as unknown as Document;
      Object.setPrototypeOf(mockDocument, Document.prototype);

      const result = RoleService.roleToRoleDTO(mockDocument as any);

      expect(mockDocument.toObject).toHaveBeenCalled();
      expect(mockDocument.toObject).toHaveBeenCalled();
    });
  });

  describe('hydrateRoleDTOToBackend', () => {
    it('should convert ITokenRoleDTO to IRoleBackendObject', () => {
      const roleDTO = {
        _id: new Types.ObjectId().toString(),
        name: Role.Admin,
        translatedName: 'Administrator',
        createdBy: new Types.ObjectId().toString(),
        updatedBy: new Types.ObjectId().toString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = RoleService.hydrateRoleDTOToBackend(roleDTO as any);

      expect(Types.ObjectId.isValid(result._id)).toBe(true);
      expect(Types.ObjectId.isValid(result.createdBy)).toBe(true);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect('translatedName' in result).toBe(false);
    });

    it('should handle deletedAt and deletedBy fields', () => {
      const roleDTO = {
        _id: new Types.ObjectId().toString(),
        name: Role.Member,
        createdBy: new Types.ObjectId().toString(),
        updatedBy: new Types.ObjectId().toString(),
        deletedBy: new Types.ObjectId().toString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: new Date().toISOString(),
      };

      const result = RoleService.hydrateRoleDTOToBackend(roleDTO as any);

      expect(Types.ObjectId.isValid(result.deletedBy)).toBe(true);
      expect(result.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('getRoleIdByName', () => {
    it('should return role ID when role exists', async () => {
      const roleId = new Types.ObjectId();
      mockRoleModel.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue({ _id: roleId }),
      });

      const result = await service.getRoleIdByName(Role.Admin);

      expect(result).toBe(roleId);
    });

    it('should return null when role does not exist', async () => {
      mockRoleModel.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      });

      const result = await service.getRoleIdByName(Role.Admin);

      expect(result).toBeNull();
    });
  });

  describe('createRole', () => {
    it('should create a new role', async () => {
      const roleData: IRoleBase<Types.ObjectId, Date, Role> = {
        _id: new Types.ObjectId(),
        name: Role.Admin,
        createdBy: new Types.ObjectId(),
        updatedBy: new Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await service.createRole(roleData);

      expect(result).toHaveProperty('_id');
      expect(mockRoleModel).toHaveBeenCalled();
    });
  });

  describe('addUserToRole', () => {
    it('should return existing user-role if it exists', async () => {
      const roleId = new Types.ObjectId();
      const userId = new Types.ObjectId();
      const createdBy = new Types.ObjectId();
      const existingUserRole = { userId, roleId };

      mockUserRoleModel.findOne.mockReturnValue({
        session: jest.fn().mockResolvedValue(existingUserRole),
      });

      const result = await service.addUserToRole(roleId, userId, createdBy);

      expect(result).toBe(existingUserRole);
    });

    it('should create new user-role if it does not exist', async () => {
      const roleId = new Types.ObjectId();
      const userId = new Types.ObjectId();
      const createdBy = new Types.ObjectId();

      mockUserRoleModel.findOne.mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });

      const result = await service.addUserToRole(roleId, userId, createdBy);

      expect(result).toHaveProperty('userId');
      expect(mockUserRoleModel).toHaveBeenCalled();
    });
  });

  describe('removeUserFromRole', () => {
    it('should throw LastAdminError when removing last admin', async () => {
      const adminRoleId = new Types.ObjectId();
      const userId = new Types.ObjectId();
      const deletedBy = new Types.ObjectId();

      mockRoleModel.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue({
          _id: adminRoleId,
          name: Role.Admin,
          admin: true,
        }),
      });

      mockUserRoleModel.countDocuments.mockReturnValue({
        session: jest.fn().mockResolvedValue(1),
      });

      await expect(
        service.removeUserFromRole(adminRoleId, userId, deletedBy),
      ).rejects.toThrow(LastAdminError);
    });

    it('should remove user from role successfully', async () => {
      const roleId = new Types.ObjectId();
      const userId = new Types.ObjectId();
      const deletedBy = new Types.ObjectId();

      mockRoleModel.findById.mockReturnValue({
        session: jest
          .fn()
          .mockResolvedValue({ _id: roleId, name: Role.Member, admin: false }),
      });

      mockUserRoleModel.findOneAndUpdate.mockResolvedValue({
        userId,
        roleId,
        deletedAt: new Date(),
        deletedBy,
      });

      await service.removeUserFromRole(roleId, userId, deletedBy);

      expect(mockUserRoleModel.findOneAndUpdate).toHaveBeenCalledWith(
        { userId, roleId, deletedAt: { $exists: false } },
        { deletedAt: expect.any(Date), deletedBy },
        { session: undefined },
      );
    });
  });

  describe('deleteRole', () => {
    it('should hard delete a role', async () => {
      const roleId = new Types.ObjectId();
      const deleterId = new Types.ObjectId();

      mockRoleModel.findByIdAndDelete = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(undefined),
      });

      await service.deleteRole(roleId, deleterId, true);

      expect(mockRoleModel.findByIdAndDelete).toHaveBeenCalledWith(roleId);
    });

    it('should soft delete a role', async () => {
      const roleId = new Types.ObjectId();
      const deleterId = new Types.ObjectId();

      mockRoleModel.findByIdAndUpdate = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(undefined),
      });

      await service.deleteRole(roleId, deleterId, false);

      expect(mockRoleModel.findByIdAndUpdate).toHaveBeenCalledWith(roleId, {
        deletedAt: expect.any(Date),
        deletedBy: deleterId,
      });
    });
  });

  describe('getUserRoles', () => {
    it('should get all roles for a user', async () => {
      const userId = new Types.ObjectId();
      const roleId1 = new Types.ObjectId();
      const roleId2 = new Types.ObjectId();

      mockUserRoleModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          session: jest
            .fn()
            .mockResolvedValue([{ roleId: roleId1 }, { roleId: roleId2 }]),
        }),
      });

      mockRoleModel.find.mockReturnValue({
        session: jest.fn().mockResolvedValue([
          { _id: roleId1, name: Role.Admin },
          { _id: roleId2, name: Role.Member },
        ]),
      });

      const result = await service.getUserRoles(userId);

      expect(result).toHaveLength(2);
      expect(mockUserRoleModel.find).toHaveBeenCalledWith({
        userId,
        deletedAt: { $exists: false },
      });
    });

    it('should throw error if models not registered', async () => {
      jest.spyOn(ModelRegistry.instance, 'get').mockReturnValue({
        model: null,
      } as any);

      await expect(service.getUserRoles(new Types.ObjectId())).rejects.toThrow(
        'Model not registered',
      );
    });
  });

  describe('getRoleUsers', () => {
    it('should get all users for a role', async () => {
      const roleId = new Types.ObjectId();
      const userId1 = new Types.ObjectId();
      const userId2 = new Types.ObjectId();

      mockUserRoleModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          session: jest
            .fn()
            .mockResolvedValue([{ userId: userId1 }, { userId: userId2 }]),
        }),
      });

      const result = await service.getRoleUsers(roleId);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(userId1);
      expect(result[1]).toBe(userId2);
    });
  });

  describe('rolesToTokenRoles', () => {
    it('should convert roles array to token roles', () => {
      const roles = [
        {
          _id: new Types.ObjectId(),
          name: Role.Admin,
          createdBy: new Types.ObjectId(),
          updatedBy: new Types.ObjectId(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          _id: new Types.ObjectId(),
          name: Role.Member,
          createdBy: new Types.ObjectId(),
          updatedBy: new Types.ObjectId(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const result = service.rolesToTokenRoles(roles as any);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe(Role.Admin);
      expect(result[1].name).toBe(Role.Member);
    });
  });

  describe('isUserAdmin', () => {
    it('should return true if user is admin', async () => {
      const userId = new Types.ObjectId();
      const userDoc = { _id: userId } as any;
      const adminRoleId = new Types.ObjectId();

      // Reset mocks for this test
      mockUserRoleModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          session: jest.fn().mockResolvedValue([{ roleId: adminRoleId }]),
        }),
      });

      mockRoleModel.find = jest.fn().mockReturnValue({
        session: jest
          .fn()
          .mockResolvedValue([{ name: Role.Admin, admin: true }]),
      });

      const result = await service.isUserAdmin(userDoc);

      expect(result).toBe(true);
    });

    it('should return false if user is not admin', async () => {
      const userId = new Types.ObjectId();
      const userDoc = { _id: userId } as any;

      mockUserRoleModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          session: jest.fn().mockResolvedValue([]),
        }),
      });

      mockRoleModel.find = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue([]),
      });

      const result = await service.isUserAdmin(userDoc);

      expect(result).toBe(false);
    });
  });

  describe('isUserMember', () => {
    it('should return true if user is member', async () => {
      const userId = new Types.ObjectId();
      const userDoc = { _id: userId } as any;
      const memberRoleId = new Types.ObjectId();

      mockUserRoleModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          session: jest.fn().mockResolvedValue([{ roleId: memberRoleId }]),
        }),
      });

      mockRoleModel.find = jest.fn().mockReturnValue({
        session: jest
          .fn()
          .mockResolvedValue([{ name: Role.Member, member: true }]),
      });

      const result = await service.isUserMember(userDoc);

      expect(result).toBe(true);
    });
  });

  describe('isUserChild', () => {
    it('should return true if user is child', async () => {
      const userId = new Types.ObjectId();
      const userDoc = { _id: userId } as any;
      const childRoleId = new Types.ObjectId();

      mockUserRoleModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          session: jest.fn().mockResolvedValue([{ roleId: childRoleId }]),
        }),
      });

      mockRoleModel.find = jest.fn().mockReturnValue({
        session: jest
          .fn()
          .mockResolvedValue([{ name: Role.Child, child: true }]),
      });

      const result = await service.isUserChild(userDoc);

      expect(result).toBe(true);
    });
  });

  describe('isSystemUser', () => {
    it('should return true if user has system role', async () => {
      const userId = new Types.ObjectId();
      const userDoc = { _id: userId } as any;
      const systemRoleId = new Types.ObjectId();

      mockUserRoleModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          session: jest.fn().mockResolvedValue([{ roleId: systemRoleId }]),
        }),
      });

      mockRoleModel.find = jest.fn().mockReturnValue({
        session: jest
          .fn()
          .mockResolvedValue([{ name: Role.Admin, system: true }]),
      });

      const result = await service.isSystemUser(userDoc);

      expect(result).toBe(true);
    });

    it('should return false if user does not have system role', async () => {
      const userId = new Types.ObjectId();
      const userDoc = { _id: userId } as any;

      mockUserRoleModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          session: jest.fn().mockResolvedValue([]),
        }),
      });

      mockRoleModel.find = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue([]),
      });

      const result = await service.isSystemUser(userDoc);

      expect(result).toBe(false);
    });
  });

  describe('getMemberType', () => {
    beforeEach(() => {
      mockUserRoleModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          session: jest.fn().mockResolvedValue([]),
        }),
      });
      mockRoleModel.find = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue([]),
      });
    });

    it('should return Admin for admin users', async () => {
      const userId = new Types.ObjectId();
      const userDoc = { _id: userId } as any;
      mockUserRoleModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          session: jest
            .fn()
            .mockResolvedValue([{ roleId: new Types.ObjectId() }]),
        }),
      });
      mockRoleModel.find = jest.fn().mockReturnValue({
        session: jest
          .fn()
          .mockResolvedValue([{ name: Role.Admin, admin: true }]),
      });

      const result = await service.getMemberType(userDoc);

      expect(result).toBe(MemberType.Admin);
    });

    it('should return User for member users', async () => {
      const userId = new Types.ObjectId();
      const userDoc = { _id: userId } as any;
      mockUserRoleModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          session: jest
            .fn()
            .mockResolvedValue([{ roleId: new Types.ObjectId() }]),
        }),
      });
      mockRoleModel.find = jest.fn().mockReturnValue({
        session: jest
          .fn()
          .mockResolvedValue([{ name: Role.Member, member: true }]),
      });

      const result = await service.getMemberType(userDoc);

      expect(result).toBe(MemberType.User);
    });

    it('should return Anonymous for users with no specific role', async () => {
      const userDoc = { _id: new Types.ObjectId() } as any;
      const result = await service.getMemberType(userDoc);

      expect(result).toBe(MemberType.Anonymous);
    });
  });
});
