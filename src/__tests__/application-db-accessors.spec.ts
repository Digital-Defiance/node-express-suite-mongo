/**
 * Unit tests for Application.db and Application.getModel accessors.
 *
 * These accessors delegate to MongoDatabasePlugin when one is registered,
 * allowing Application to satisfy IMongoApplication without a separate adapter.
 *
 * @module __tests__/application-db-accessors.spec
 */

import { mkdtempSync, rmdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  Application,
  Environment,
  AppRouter,
} from '@digitaldefiance/node-express-suite';
import type {
  BaseRouter,
  IApplication,
} from '@digitaldefiance/node-express-suite';
import { MongoDatabasePlugin } from '../plugins/mongo-database-plugin';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeBaseEnv(
  tmpApiDir: string,
  tmpReactDir: string,
): Record<string, string> {
  return {
    HOST: '0.0.0.0',
    PORT: String(Math.floor(Math.random() * 10000) + 50000),
    JWT_SECRET: 'a'.repeat(64),
    EMAIL_SENDER: 'test@example.com',
    BASE_PATH: '/',
    API_DIST_DIR: tmpApiDir,
    REACT_DIST_DIR: tmpReactDir,
    MNEMONIC_HMAC_SECRET: 'ab'.repeat(32),
    MNEMONIC_ENCRYPTION_KEY: 'cd'.repeat(32),
    DEV_DATABASE: 'test',
    NODE_ENV: 'test',
    MONGO_URI: 'mongodb://localhost:27017/test',
    LANGUAGE: 'English (US)',
  };
}

function createTestApplication(env: Environment): Application {
  const noopRouterFactory = (_app: IApplication) =>
    ({ init: jest.fn() }) as unknown as BaseRouter<Buffer>;

  const mockAppRouterFactory = () =>
    ({ init: jest.fn() }) as unknown as AppRouter<Buffer>;

  return new Application(
    env,
    noopRouterFactory,
    undefined,
    undefined,
    mockAppRouterFactory,
  );
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('Application db and getModel accessors', () => {
  let savedEnv: NodeJS.ProcessEnv;
  let tmpApiDir: string;
  let tmpReactDir: string;

  beforeAll(() => {
    tmpApiDir = mkdtempSync(join(tmpdir(), 'api-dist-'));
    tmpReactDir = mkdtempSync(join(tmpdir(), 'react-dist-'));
  });

  afterAll(() => {
    rmdirSync(tmpApiDir);
    rmdirSync(tmpReactDir);
  });

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  function makeEnv(): Environment {
    process.env = { ...makeBaseEnv(tmpApiDir, tmpReactDir) };
    return new Environment(undefined, true);
  }

  describe('db getter', () => {
    it('should return undefined when no database plugin is registered', () => {
      const env = makeEnv();
      const app = createTestApplication(env);

      expect(app.db).toBeUndefined();
    });

    it('should delegate to MongoDatabasePlugin.db when plugin is registered', () => {
      const env = makeEnv();
      const app = createTestApplication(env);

      // Create a mock MongoDatabasePlugin
      const mockDb = { connection: {} };
      const mockPlugin = Object.create(MongoDatabasePlugin.prototype);
      Object.defineProperty(mockPlugin, 'db', {
        get: () => mockDb,
      });
      Object.defineProperty(mockPlugin, 'name', { value: 'mongo-database' });
      Object.defineProperty(mockPlugin, 'version', { value: '1.0.0' });
      mockPlugin.init = jest.fn();
      mockPlugin.stop = jest.fn();

      app.useDatabasePlugin(mockPlugin);

      expect(app.db).toBe(mockDb);
    });
  });

  describe('getModel', () => {
    it('should return undefined when no database plugin is registered', () => {
      const env = makeEnv();
      const app = createTestApplication(env);

      expect(app.getModel('User')).toBeUndefined();
    });

    it('should delegate to MongoDatabasePlugin.getModel when plugin is registered', () => {
      const env = makeEnv();
      const app = createTestApplication(env);

      const mockModel = { modelName: 'User' };
      const mockPlugin = Object.create(MongoDatabasePlugin.prototype);
      mockPlugin.getModel = jest.fn().mockReturnValue(mockModel);
      Object.defineProperty(mockPlugin, 'name', { value: 'mongo-database' });
      Object.defineProperty(mockPlugin, 'version', { value: '1.0.0' });
      mockPlugin.init = jest.fn();
      mockPlugin.stop = jest.fn();

      app.useDatabasePlugin(mockPlugin);

      const result = app.getModel('User');
      expect(result).toBe(mockModel);
      expect(mockPlugin.getModel).toHaveBeenCalledWith('User');
    });

    it('should pass the model name through to the plugin', () => {
      const env = makeEnv();
      const app = createTestApplication(env);

      const mockPlugin = Object.create(MongoDatabasePlugin.prototype);
      mockPlugin.getModel = jest.fn().mockReturnValue({});
      Object.defineProperty(mockPlugin, 'name', { value: 'mongo-database' });
      Object.defineProperty(mockPlugin, 'version', { value: '1.0.0' });
      mockPlugin.init = jest.fn();
      mockPlugin.stop = jest.fn();

      app.useDatabasePlugin(mockPlugin);

      app.getModel('Role');
      app.getModel('EmailToken');

      expect(mockPlugin.getModel).toHaveBeenCalledWith('Role');
      expect(mockPlugin.getModel).toHaveBeenCalledWith('EmailToken');
    });
  });

  describe('databasePlugin getter', () => {
    it('should return null when no plugin is registered', () => {
      const env = makeEnv();
      const app = createTestApplication(env);

      expect(app.databasePlugin).toBeNull();
    });

    it('should return the registered plugin', () => {
      const env = makeEnv();
      const app = createTestApplication(env);

      const mockPlugin = Object.create(MongoDatabasePlugin.prototype);
      Object.defineProperty(mockPlugin, 'name', { value: 'mongo-database' });
      Object.defineProperty(mockPlugin, 'version', { value: '1.0.0' });
      mockPlugin.init = jest.fn();
      mockPlugin.stop = jest.fn();

      app.useDatabasePlugin(mockPlugin);

      expect(app.databasePlugin).toBe(mockPlugin);
    });
  });

  describe('useDatabasePlugin', () => {
    it('should return this for chaining', () => {
      const env = makeEnv();
      const app = createTestApplication(env);

      const mockPlugin = Object.create(MongoDatabasePlugin.prototype);
      Object.defineProperty(mockPlugin, 'name', { value: 'mongo-database' });
      Object.defineProperty(mockPlugin, 'version', { value: '1.0.0' });
      mockPlugin.init = jest.fn();
      mockPlugin.stop = jest.fn();

      const result = app.useDatabasePlugin(mockPlugin);
      expect(result).toBe(app);
    });
  });
});
