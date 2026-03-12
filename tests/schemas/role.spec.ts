import {
  SuiteCoreStringKey,
  TranslatableSuiteError,
} from '@digitaldefiance/suite-core-lib';
import { createRoleSchema, RoleSchema } from '../../src/schemas/role';

describe('RoleSchema', () => {
  describe('createRoleSchema', () => {
    it('should create schema with default options', () => {
      const schema = createRoleSchema();
      expect(schema).toBeDefined();
      expect(schema.path('name')).toBeDefined();
      expect(schema.path('admin')).toBeDefined();
      expect(schema.path('member')).toBeDefined();
    });

    it('should create schema with custom role enum', () => {
      const customRoles = ['CustomRole1', 'CustomRole2'];
      const schema = createRoleSchema({ roleEnum: customRoles });
      expect(schema).toBeDefined();
    });

    it('should create schema with custom user model name', () => {
      const schema = createRoleSchema({ userModelName: 'CustomUser' });
      expect(schema).toBeDefined();
    });
  });

  describe('RoleSchema', () => {
    it('should have required fields', () => {
      expect(RoleSchema.path('name')).toBeDefined();
      expect(RoleSchema.path('admin')).toBeDefined();
      expect(RoleSchema.path('member')).toBeDefined();
      expect(RoleSchema.path('child')).toBeDefined();
      expect(RoleSchema.path('system')).toBeDefined();
      expect(RoleSchema.path('createdBy')).toBeDefined();
      expect(RoleSchema.path('updatedBy')).toBeDefined();
    });

    it('should have unique index on name', () => {
      const indexes = RoleSchema.indexes();
      const nameIndex = indexes.find((idx) => idx[0].name === 1);
      expect(nameIndex).toBeDefined();
    });
  });

  describe('pre-save validation', () => {
    it('should reject admin + child combination', (done) => {
      const schema = createRoleSchema();
      const mockDoc = {
        admin: true,
        child: true,
        system: false,
        ownerDocument: () => mockDoc,
      } as any;

      // Get our custom validation hook (last one added)
      const hooks = Array.from(schema.s.hooks._pres.get('save') || []);
      const ourHook = hooks[hooks.length - 1].fn;

      ourHook.call(mockDoc, (err: any) => {
        expect(err).toBeInstanceOf(TranslatableSuiteError);
        expect(err.StringName).toBe(
          SuiteCoreStringKey.Error_ChildRoleCannotBeAnAdminRole,
        );
        done();
      });
    });

    it('should reject system + child combination', (done) => {
      const schema = createRoleSchema();
      const mockDoc = {
        admin: false,
        child: true,
        system: true,
        ownerDocument: () => mockDoc,
      } as any;

      const hooks = Array.from(schema.s.hooks._pres.get('save') || []);
      const ourHook = hooks[hooks.length - 1].fn;

      ourHook.call(mockDoc, (err: any) => {
        expect(err).toBeInstanceOf(TranslatableSuiteError);
        expect(err.StringName).toBe(
          SuiteCoreStringKey.Error_ChildRoleCannotBeASystemRole,
        );
        done();
      });
    });

    it('should allow admin without child', (done) => {
      const schema = createRoleSchema();
      const mockDoc = {
        admin: true,
        child: false,
        system: false,
        ownerDocument: () => mockDoc,
      } as any;

      const hooks = Array.from(schema.s.hooks._pres.get('save') || []);
      const ourHook = hooks[hooks.length - 1].fn;

      ourHook.call(mockDoc, (err: any) => {
        expect(err).toBeUndefined();
        done();
      });
    });

    it('should allow system without child', (done) => {
      const schema = createRoleSchema();
      const mockDoc = {
        admin: false,
        child: false,
        system: true,
        ownerDocument: () => mockDoc,
      } as any;

      const hooks = Array.from(schema.s.hooks._pres.get('save') || []);
      const ourHook = hooks[hooks.length - 1].fn;

      ourHook.call(mockDoc, (err: any) => {
        expect(err).toBeUndefined();
        done();
      });
    });

    it('should use custom validation when provided', (done) => {
      const customValidation = jest.fn((doc, next) => next());
      const schema = createRoleSchema({ customValidation });
      const mockDoc = {
        admin: true,
        child: true,
        ownerDocument: () => mockDoc,
      } as any;

      const hooks = Array.from(schema.s.hooks._pres.get('save') || []);
      const ourHook = hooks[hooks.length - 1].fn;

      ourHook.call(mockDoc, (err: any) => {
        expect(customValidation).toHaveBeenCalledWith(
          mockDoc,
          expect.any(Function),
        );
        expect(err).toBeUndefined();
        done();
      });
    });

    it('should pass custom validation errors through', (done) => {
      const customError = new Error('Custom validation failed');
      const customValidation = jest.fn((doc, next) => next(customError));
      const schema = createRoleSchema({ customValidation });
      const mockDoc = {
        ownerDocument: () => mockDoc,
      } as any;

      const hooks = Array.from(schema.s.hooks._pres.get('save') || []);
      const ourHook = hooks[hooks.length - 1].fn;

      ourHook.call(mockDoc, (err: any) => {
        expect(err).toBe(customError);
        done();
      });
    });
  });

  describe('deletedAt field', () => {
    it('should have getter that returns value unchanged', () => {
      const testDate = new Date('2024-01-01T12:00:00Z');
      const getter = RoleSchema.path('deletedAt').getters[0];
      const result = getter(testDate);
      expect(result).toBe(testDate);
    });

    it('should have setter that converts to UTC', () => {
      const testDate = new Date('2024-01-01T12:00:00Z');
      const setter = RoleSchema.path('deletedAt').setters[0];
      const result = setter(testDate);
      expect(result).toEqual(new Date(testDate.toUTCString()));
    });
  });
});
