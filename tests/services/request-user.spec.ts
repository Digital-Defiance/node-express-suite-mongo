import { Types } from '@digitaldefiance/mongoose-types';
import { Role } from '@digitaldefiance/suite-core-lib';
import { registerNodeRuntimeConfiguration } from '@digitaldefiance/node-ecies-lib';
import { RequestUserService } from '../../src/services/request-user';

const { ObjectId } = Types;

describe('RequestUserService', () => {
  beforeAll(() => {
    registerNodeRuntimeConfiguration('default-config', {});
  });

  describe('makeRequestUserDTO', () => {
    it('should create DTO from user document', () => {
      const userDoc = {
        _id: new ObjectId(),
        email: 'test@example.com',
        username: 'testuser',
        timezone: 'UTC',
        emailVerified: true,
        darkMode: false,
        siteLanguage: 'en',
      } as any;

      const roles = [
        {
          _id: new ObjectId(),
          name: Role.Member,
          admin: false,
          member: true,
          child: false,
          system: false,
          createdAt: new Date(),
          createdBy: new ObjectId(),
          updatedAt: new Date(),
          updatedBy: new ObjectId(),
        },
      ] as any;

      const result = RequestUserService.makeRequestUserDTO(userDoc, roles);
      expect(result.email).toBe('test@example.com');
      expect(result.username).toBe('testuser');
      expect(result.roles).toHaveLength(1);
      expect(result.rolePrivileges).toEqual({
        admin: false,
        member: true,
        child: false,
        system: false,
      });
    });

    it('should throw if user document missing _id', () => {
      const userDoc = { email: 'test@example.com' } as any;
      expect(() =>
        RequestUserService.makeRequestUserDTO(userDoc, []),
      ).toThrow();
    });

    it('should combine role privileges across multiple roles', () => {
      const userDoc = {
        _id: new ObjectId(),
        email: 'test@example.com',
        username: 'testuser',
        timezone: 'UTC',
        emailVerified: true,
        darkMode: false,
        siteLanguage: 'en',
      } as any;

      const roles = [
        {
          _id: new ObjectId(),
          name: Role.Member,
          admin: false,
          member: true,
          child: false,
          system: false,
          createdAt: new Date(),
          createdBy: new ObjectId(),
          updatedAt: new Date(),
          updatedBy: new ObjectId(),
        },
        {
          _id: new ObjectId(),
          name: Role.Admin,
          admin: true,
          member: false,
          child: false,
          system: false,
          createdAt: new Date(),
          createdBy: new ObjectId(),
          updatedAt: new Date(),
          updatedBy: new ObjectId(),
        },
      ] as any;

      const result = RequestUserService.makeRequestUserDTO(userDoc, roles);
      expect(result.roles).toHaveLength(2);
      // Should combine privileges: admin OR member should both be true
      expect(result.rolePrivileges).toEqual({
        admin: true,
        member: true,
        child: false,
        system: false,
      });
    });
  });

  describe('hydrateRequestUser', () => {
    it('should hydrate DTO to backend object', () => {
      const dto = {
        id: new ObjectId().toString(),
        email: 'test@example.com',
        username: 'testuser',
        timezone: 'UTC',
        currency: 'USD',
        directChallenge: false,
        emailVerified: true,
        darkMode: false,
        siteLanguage: 'en',
        roles: [],
        rolePrivileges: {
          admin: false,
          member: true,
          child: false,
          system: false,
        },
      } as any;

      const result = RequestUserService.hydrateRequestUser(dto);
      expect(ObjectId.isValid(result.id)).toBe(true);
      expect(result.email).toBe('test@example.com');
      expect(result.rolePrivileges).toEqual({
        admin: false,
        member: true,
        child: false,
        system: false,
      });
    });

    it('should handle optional lastLogin', () => {
      const dto = {
        id: new ObjectId().toString(),
        email: 'test@example.com',
        username: 'testuser',
        timezone: 'UTC',
        currency: 'USD',
        directChallenge: false,
        emailVerified: true,
        darkMode: false,
        siteLanguage: 'en',
        roles: [],
        rolePrivileges: {
          admin: false,
          member: true,
          child: false,
          system: false,
        },
        lastLogin: new Date().toISOString(),
      } as any;

      const result = RequestUserService.hydrateRequestUser(dto);
      expect(result.lastLogin).toBeInstanceOf(Date);
    });
  });
});
