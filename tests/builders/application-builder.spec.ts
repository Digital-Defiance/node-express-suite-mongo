import mongoose from '@digitaldefiance/mongoose-types';
import { TranslatableSuiteError } from '@digitaldefiance/suite-core-lib';
import { ApplicationBuilder } from '../../src/builders/application-builder';
import { Environment, AppRouter, BaseRouter } from '@digitaldefiance/node-express-suite';
import type { IConstants } from '@digitaldefiance/node-express-suite';

describe('ApplicationBuilder', () => {
  let builder: ApplicationBuilder<any, any>;
  let mockEnv: Environment;

  beforeEach(() => {
    const fs = require('fs');
    process.env.JWT_SECRET = 'a'.repeat(64);
    process.env.MNEMONIC_HMAC_SECRET = 'a'.repeat(64);
    process.env.MNEMONIC_ENCRYPTION_KEY = 'b'.repeat(64);
    process.env.API_DIST_DIR = '/tmp/test-api-dist';
    process.env.REACT_DIST_DIR = '/tmp/test-react-dist';
    if (!fs.existsSync('/tmp/test-api-dist'))
      fs.mkdirSync('/tmp/test-api-dist', { recursive: true });
    if (!fs.existsSync('/tmp/test-react-dist'))
      fs.mkdirSync('/tmp/test-react-dist', { recursive: true });

    mockEnv = new Environment(undefined, true);
    builder = new ApplicationBuilder();
  });

  describe('withEnvironment', () => {
    it('should set environment', () => {
      const result = builder.withEnvironment(mockEnv);
      expect(result).toBe(builder);
    });

    it('should chain method calls', () => {
      const result = builder.withEnvironment(mockEnv);
      expect(result).toBeInstanceOf(ApplicationBuilder);
    });
  });

  describe('withApiRouter', () => {
    it('should set API router factory', () => {
      const factory = (app: any) => new BaseRouter(app);
      const result = builder.withApiRouter(factory);
      expect(result).toBe(builder);
    });

    it('should chain method calls', () => {
      const factory = (app: any) => new BaseRouter(app);
      const result = builder.withApiRouter(factory);
      expect(result).toBeInstanceOf(ApplicationBuilder);
    });
  });

  describe('withAppRouter', () => {
    it('should set app router factory', () => {
      const factory = (apiRouter: BaseRouter) => new AppRouter(apiRouter);
      const result = builder.withAppRouter(factory);
      expect(result).toBe(builder);
    });

    it('should chain method calls', () => {
      const factory = (apiRouter: BaseRouter) => new AppRouter(apiRouter);
      const result = builder.withAppRouter(factory);
      expect(result).toBeInstanceOf(ApplicationBuilder);
    });
  });

  describe('withSchemaMap', () => {
    it('should set schema map factory', () => {
      const factory = (connection: mongoose.Connection) => ({});
      const result = builder.withSchemaMap(factory);
      expect(result).toBe(builder);
    });

    it('should chain method calls', () => {
      const factory = (connection: mongoose.Connection) => ({});
      const result = builder.withSchemaMap(factory);
      expect(result).toBeInstanceOf(ApplicationBuilder);
    });
  });

  describe('withDatabaseInit', () => {
    it('should set database init functions', () => {
      const initFn = async () => ({ success: true, data: {} });
      const hashFn = () => 'hash';
      const result = builder.withDatabaseInit(initFn, hashFn);
      expect(result).toBe(builder);
    });

    it('should chain method calls', () => {
      const initFn = async () => ({ success: true, data: {} });
      const hashFn = () => 'hash';
      const result = builder.withDatabaseInit(initFn, hashFn);
      expect(result).toBeInstanceOf(ApplicationBuilder);
    });
  });

  describe('withCSP', () => {
    it('should set CSP config', () => {
      const config = { directives: { defaultSrc: ["'self'"] } };
      const result = builder.withCSP(config);
      expect(result).toBe(builder);
    });

    it('should chain method calls', () => {
      const config = { directives: { defaultSrc: ["'self'"] } };
      const result = builder.withCSP(config);
      expect(result).toBeInstanceOf(ApplicationBuilder);
    });
  });

  describe('withConstants', () => {
    it('should set constants', () => {
      const constants: IConstants = {
        usernameRegex: /^[a-z]+$/,
        passwordRegex: /^.{8,}$/,
        emailRegex: /^.+@.+$/,
      };
      const result = builder.withConstants(constants);
      expect(result).toBe(builder);
    });

    it('should chain method calls', () => {
      const constants: IConstants = {
        usernameRegex: /^[a-z]+$/,
        passwordRegex: /^.{8,}$/,
        emailRegex: /^.+@.+$/,
      };
      const result = builder.withConstants(constants);
      expect(result).toBeInstanceOf(ApplicationBuilder);
    });
  });

  describe('withMiddleware', () => {
    it('should set custom middleware', () => {
      const middleware = jest.fn();
      const result = builder.withMiddleware(middleware as any);
      expect(result).toBe(builder);
    });

    it('should chain method calls', () => {
      const middleware = jest.fn();
      const result = builder.withMiddleware(middleware as any);
      expect(result).toBeInstanceOf(ApplicationBuilder);
    });
  });

  describe('build', () => {
    it('should throw error if environment not set', () => {
      expect(() => builder.build()).toThrow(TranslatableSuiteError);
    });

    it('should throw error if API router factory not set', () => {
      builder.withEnvironment(mockEnv);
      expect(() => builder.build()).toThrow(TranslatableSuiteError);
    });

    it('should throw error if schema map factory not set', () => {
      builder
        .withEnvironment(mockEnv)
        .withApiRouter((app) => new BaseRouter(app));
      expect(() => builder.build()).toThrow(TranslatableSuiteError);
    });

    it('should throw error if database init function not set', () => {
      builder
        .withEnvironment(mockEnv)
        .withApiRouter((app) => new BaseRouter(app))
        .withSchemaMap(() => ({}));
      expect(() => builder.build()).toThrow(TranslatableSuiteError);
    });

    it('should throw error if init result hash function not set', () => {
      builder
        .withEnvironment(mockEnv)
        .withApiRouter((app) => new BaseRouter(app))
        .withSchemaMap(() => ({}))
        .withDatabaseInit(
          async () => ({ success: true, data: {} }),
          undefined as any,
        );
      expect(() => builder.build()).toThrow(TranslatableSuiteError);
    });

    it('should build application with all required parameters', () => {
      const app = builder
        .withEnvironment(mockEnv)
        .withApiRouter((app) => new BaseRouter(app))
        .withSchemaMap(() => ({}))
        .withDatabaseInit(
          async () => ({ success: true, data: {} }),
          () => 'hash',
        )
        .build();

      expect(app).toBeDefined();
    });

    it('should build application with optional parameters', () => {
      const constants: IConstants = {
        usernameRegex: /^[a-z]+$/,
        passwordRegex: /^.{8,}$/,
        emailRegex: /^.+@.+$/,
      };

      const app = builder
        .withEnvironment(mockEnv)
        .withApiRouter((app) => new BaseRouter(app))
        .withAppRouter((apiRouter) => new AppRouter(apiRouter))
        .withSchemaMap(() => ({}))
        .withDatabaseInit(
          async () => ({ success: true, data: {} }),
          () => 'hash',
        )
        .withCSP({ directives: { defaultSrc: ["'self'"] } })
        .withConstants(constants)
        .build();

      expect(app).toBeDefined();
    });
  });

  describe('fluent API', () => {
    it('should support full fluent chain', () => {
      const constants: IConstants = {
        usernameRegex: /^[a-z]+$/,
        passwordRegex: /^.{8,}$/,
        emailRegex: /^.+@.+$/,
      };

      const app = new ApplicationBuilder()
        .withEnvironment(mockEnv)
        .withApiRouter((app) => new BaseRouter(app))
        .withAppRouter((apiRouter) => new AppRouter(apiRouter))
        .withSchemaMap(() => ({}))
        .withDatabaseInit(
          async () => ({ success: true, data: {} }),
          () => 'hash',
        )
        .withCSP({ directives: { defaultSrc: ["'self'"] } })
        .withConstants(constants)
        .withMiddleware(jest.fn() as any)
        .build();

      expect(app).toBeDefined();
    });

    it('should support minimal fluent chain', () => {
      const app = new ApplicationBuilder()
        .withEnvironment(mockEnv)
        .withApiRouter((app) => new BaseRouter(app))
        .withSchemaMap(() => ({}))
        .withDatabaseInit(
          async () => ({ success: true, data: {} }),
          () => 'hash',
        )
        .build();

      expect(app).toBeDefined();
    });
  });

  describe('real-world scenarios', () => {
    it('should build application for production', () => {
      const constants: IConstants = {
        usernameRegex: /^[a-z0-9_]{3,20}$/,
        passwordRegex: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/,
        emailRegex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      };

      const app = new ApplicationBuilder()
        .withEnvironment(mockEnv)
        .withApiRouter((app) => new BaseRouter(app))
        .withAppRouter((apiRouter) => new AppRouter(apiRouter))
        .withSchemaMap(() => ({}))
        .withDatabaseInit(
          async () => ({ success: true, data: { users: [], roles: [] } }),
          (results) => JSON.stringify(results),
        )
        .withCSP({
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
          },
        })
        .withConstants(constants)
        .build();

      expect(app).toBeDefined();
    });

    it('should build application for testing', () => {
      const app = new ApplicationBuilder()
        .withEnvironment(mockEnv)
        .withApiRouter((app) => new BaseRouter(app))
        .withSchemaMap(() => ({}))
        .withDatabaseInit(
          async () => ({ success: true, data: {} }),
          () => 'test-hash',
        )
        .build();

      expect(app).toBeDefined();
    });

    it('should build application with custom initialization', () => {
      const customInit = async (app: any) => {
        // Custom initialization logic
        return { success: true, data: { initialized: true } };
      };

      const customHash = (results: any) => {
        return `hash-${results.initialized}`;
      };

      const app = new ApplicationBuilder()
        .withEnvironment(mockEnv)
        .withApiRouter((app) => new BaseRouter(app))
        .withSchemaMap(() => ({}))
        .withDatabaseInit(customInit, customHash)
        .build();

      expect(app).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle empty schema map', () => {
      const app = builder
        .withEnvironment(mockEnv)
        .withApiRouter((app) => new BaseRouter(app))
        .withSchemaMap(() => ({}))
        .withDatabaseInit(
          async () => ({ success: true, data: {} }),
          () => 'hash',
        )
        .build();

      expect(app).toBeDefined();
    });

    it('should handle complex schema map', () => {
      const schemaMap = (connection: mongoose.Connection) => ({
        User: {} as any,
        Role: {} as any,
        File: {} as any,
        Session: {} as any,
      });

      const app = builder
        .withEnvironment(mockEnv)
        .withApiRouter((app) => new BaseRouter(app))
        .withSchemaMap(schemaMap)
        .withDatabaseInit(
          async () => ({ success: true, data: {} }),
          () => 'hash',
        )
        .build();

      expect(app).toBeDefined();
    });

    it('should handle async database init', () => {
      const asyncInit = async (app: any) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { success: true, data: {} };
      };

      const app = builder
        .withEnvironment(mockEnv)
        .withApiRouter((app) => new BaseRouter(app))
        .withSchemaMap(() => ({}))
        .withDatabaseInit(asyncInit, () => 'hash')
        .build();

      expect(app).toBeDefined();
    });

    it('should handle complex constants', () => {
      const constants: IConstants = {
        usernameRegex: /^[a-z0-9_]{3,20}$/,
        passwordRegex:
          /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
        emailRegex: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
      };

      const app = builder
        .withEnvironment(mockEnv)
        .withApiRouter((app) => new BaseRouter(app))
        .withSchemaMap(() => ({}))
        .withDatabaseInit(
          async () => ({ success: true, data: {} }),
          () => 'hash',
        )
        .withConstants(constants)
        .build();

      expect(app).toBeDefined();
    });
  });
});
