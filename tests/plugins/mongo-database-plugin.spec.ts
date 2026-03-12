/**
 * Unit tests for MongoDatabasePlugin lifecycle.
 * Tests connect(), disconnect(), init(), isConnected(), fromDocumentStore(), getModel(),
 * dev store setup/teardown, and createMongoAppAdapter.
 *
 * @module tests/plugins/mongo-database-plugin
 */

import type { IDocumentStore } from '../../src/interfaces/mongoose-document-store';
import type { IApplication } from '@digitaldefiance/node-express-suite';
import type { IAuthenticationProvider } from '@digitaldefiance/node-express-suite';
import type { Environment } from '@digitaldefiance/node-express-suite';
import type { PluginManager } from '@digitaldefiance/node-express-suite';
import type { ServiceContainer } from '@digitaldefiance/node-express-suite';
import { MongoDatabasePlugin } from '../../src/plugins/mongo-database-plugin';

// Mock MongoAuthenticationProvider so init() doesn't need real Mongoose
jest.mock('../../src/services/mongo-authentication-provider', () => ({
  MongoAuthenticationProvider: jest.fn().mockImplementation(() => ({
    findUserById: jest.fn(),
    verifyToken: jest.fn(),
  })),
}));

// Mock MongooseDocumentStore so the constructor path doesn't need real deps
jest.mock('../../src/services/mongoose-document-store', () => ({
  MongooseDocumentStore: jest
    .fn()
    .mockImplementation(() => createMockDocumentStore()),
}));

// Mock DatabaseInitializationService
jest.mock('../../src/services/database-initialization', () => ({
  DatabaseInitializationService: {
    printServerInitResults: jest.fn(),
  },
}));

/**
 * Creates a mock IDocumentStore with jest.fn() stubs for all methods/properties.
 */
function createMockDocumentStore(): jest.Mocked<IDocumentStore> {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(false),
    getModel: jest.fn().mockReturnValue({}),
    schemaMap: undefined,
    devDatabase: undefined,
    setupDevStore: jest.fn().mockResolvedValue('mongodb://dev:27017/test'),
    initializeDevStore: jest.fn().mockResolvedValue({ seeded: true }),
  };
}

/**
 * Creates a mock Environment with the minimum shape needed by MongoDatabasePlugin.
 */
function createMockEnvironment(
  overrides: Partial<{
    devDatabase: string | undefined;
    mongo: { uri?: string };
  }> = {},
): Environment {
  return {
    devDatabase: overrides.devDatabase ?? undefined,
    mongo: overrides.mongo ?? { uri: 'mongodb://localhost:27017/testdb' },
  } as unknown as Environment;
}

/**
 * Creates a mock IApplication with the minimum shape needed by MongoDatabasePlugin.init().
 */
function createMockApplication(): jest.Mocked<IApplication> {
  return {
    environment: createMockEnvironment(),
    constants: {} as IApplication['constants'],
    ready: true,
    services: {
      get: jest.fn(),
      has: jest.fn(),
      register: jest.fn(),
      clear: jest.fn(),
    } as unknown as ServiceContainer,
    plugins: {
      register: jest.fn(),
      has: jest.fn(),
      get: jest.fn(),
    } as unknown as PluginManager,
    database: undefined,
    authProvider: undefined,
    start: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<IApplication>;
}

describe('MongoDatabasePlugin', () => {
  let mockDocStore: jest.Mocked<IDocumentStore>;
  let mockEnv: Environment;
  let plugin: MongoDatabasePlugin<Buffer, Record<string, never>, unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDocStore = createMockDocumentStore();
    mockEnv = createMockEnvironment();
    plugin = MongoDatabasePlugin.fromDocumentStore(mockDocStore, mockEnv);
  });

  describe('name and version', () => {
    it('should have name "mongo-database"', () => {
      expect(plugin.name).toBe('mongo-database');
    });

    it('should have version "1.0.0"', () => {
      expect(plugin.version).toBe('1.0.0');
    });
  });

  describe('connect()', () => {
    it('should invoke document store connect with the provided URI', async () => {
      await plugin.connect('mongodb://custom:27017/mydb');

      expect(mockDocStore.connect).toHaveBeenCalledWith(
        'mongodb://custom:27017/mydb',
      );
    });

    it('should fall back to environment mongo URI when no URI is provided', async () => {
      await plugin.connect();

      expect(mockDocStore.connect).toHaveBeenCalledWith(
        'mongodb://localhost:27017/testdb',
      );
    });

    it('should fall back to undefined when no URI and no environment mongo URI', async () => {
      const envNoMongo = createMockEnvironment({ mongo: {} });
      const pluginNoMongo = MongoDatabasePlugin.fromDocumentStore(
        mockDocStore,
        envNoMongo,
      );

      await pluginNoMongo.connect();

      expect(mockDocStore.connect).toHaveBeenCalledWith(undefined);
    });

    it('should setup dev store and use its URI when devDatabase is enabled', async () => {
      const devEnv = createMockEnvironment({
        devDatabase: 'true',
        mongo: { uri: 'mongodb://localhost:27017/testdb' },
      });
      const devPlugin = MongoDatabasePlugin.fromDocumentStore(
        mockDocStore,
        devEnv,
      );

      await devPlugin.connect();

      expect(mockDocStore.setupDevStore).toHaveBeenCalled();
      expect(mockDocStore.connect).toHaveBeenCalledWith(
        'mongodb://dev:27017/test',
      );
    });

    it('should not setup dev store when devDatabase is disabled', async () => {
      await plugin.connect('mongodb://prod:27017/db');

      expect(mockDocStore.setupDevStore).not.toHaveBeenCalled();
    });

    it('should not setup dev store when devDatabase already exists', async () => {
      const devEnv = createMockEnvironment({ devDatabase: 'true' });
      const storeWithDevDb = createMockDocumentStore();
      Object.defineProperty(storeWithDevDb, 'devDatabase', {
        value: { stop: jest.fn() },
        writable: true,
      });
      const devPlugin = MongoDatabasePlugin.fromDocumentStore(
        storeWithDevDb,
        devEnv,
      );

      await devPlugin.connect('mongodb://existing:27017/db');

      expect(storeWithDevDb.setupDevStore).not.toHaveBeenCalled();
    });

    it('should propagate errors from document store connect', async () => {
      mockDocStore.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(plugin.connect('mongodb://bad:27017')).rejects.toThrow(
        'Connection failed',
      );
    });
  });

  describe('disconnect()', () => {
    it('should invoke document store disconnect', async () => {
      await plugin.disconnect();

      expect(mockDocStore.disconnect).toHaveBeenCalled();
    });

    it('should stop dev database if it exists', async () => {
      const mockStop = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(mockDocStore, 'devDatabase', {
        value: { stop: mockStop },
        writable: true,
        configurable: true,
      });

      await plugin.disconnect();

      expect(mockDocStore.disconnect).toHaveBeenCalled();
      expect(mockStop).toHaveBeenCalled();
    });

    it('should not throw when no dev database exists', async () => {
      await expect(plugin.disconnect()).resolves.not.toThrow();
    });

    it('should propagate errors from document store disconnect', async () => {
      mockDocStore.disconnect.mockRejectedValue(new Error('Disconnect failed'));

      await expect(plugin.disconnect()).rejects.toThrow('Disconnect failed');
    });
  });

  describe('isConnected()', () => {
    it('should return false when document store is not connected', () => {
      mockDocStore.isConnected.mockReturnValue(false);

      expect(plugin.isConnected()).toBe(false);
    });

    it('should return true when document store is connected', () => {
      mockDocStore.isConnected.mockReturnValue(true);

      expect(plugin.isConnected()).toBe(true);
    });

    it('should delegate to the underlying document store', () => {
      plugin.isConnected();

      expect(mockDocStore.isConnected).toHaveBeenCalled();
    });
  });

  describe('getModel()', () => {
    it('should delegate to document store getModel', () => {
      const mockModel = { modelName: 'User' };
      mockDocStore.getModel.mockReturnValue(mockModel as never);

      const result = plugin.getModel('User');

      expect(mockDocStore.getModel).toHaveBeenCalledWith('User');
      expect(result).toBe(mockModel);
    });

    it('should propagate errors when model is not found', () => {
      mockDocStore.getModel.mockImplementation(() => {
        throw new Error('Model not found: Unknown');
      });

      expect(() => plugin.getModel('Unknown')).toThrow('Model not found');
    });
  });

  describe('fromDocumentStore()', () => {
    it('should create a plugin that delegates to the provided document store', () => {
      const customStore = createMockDocumentStore();
      customStore.isConnected.mockReturnValue(true);

      const customPlugin = MongoDatabasePlugin.fromDocumentStore(
        customStore,
        mockEnv,
      );

      expect(customPlugin.isConnected()).toBe(true);
      expect(customStore.isConnected).toHaveBeenCalled();
    });

    it('should set name to "mongo-database"', () => {
      const customPlugin = MongoDatabasePlugin.fromDocumentStore(
        createMockDocumentStore(),
        mockEnv,
      );

      expect(customPlugin.name).toBe('mongo-database');
    });

    it('should set version to "1.0.0"', () => {
      const customPlugin = MongoDatabasePlugin.fromDocumentStore(
        createMockDocumentStore(),
        mockEnv,
      );

      expect(customPlugin.version).toBe('1.0.0');
    });

    it('should use the provided document store for connect', async () => {
      const customStore = createMockDocumentStore();
      const customPlugin = MongoDatabasePlugin.fromDocumentStore(
        customStore,
        mockEnv,
      );

      await customPlugin.connect('mongodb://custom:27017/db');

      expect(customStore.connect).toHaveBeenCalledWith(
        'mongodb://custom:27017/db',
      );
    });

    it('should expose the document store via documentStore getter', () => {
      const customStore = createMockDocumentStore();
      const customPlugin = MongoDatabasePlugin.fromDocumentStore(
        customStore,
        mockEnv,
      );

      expect(customPlugin.documentStore).toBe(customStore);
    });
  });

  describe('database getter', () => {
    it('should return a no-op IDatabase instance', () => {
      const db = plugin.database;

      expect(db).toBeDefined();
      expect(db.isConnected()).toBe(false);
    });

    it('should return a database where connect/disconnect are no-ops', async () => {
      const db = plugin.database;

      await expect(db.connect()).resolves.not.toThrow();
      await expect(db.disconnect()).resolves.not.toThrow();
    });
  });

  describe('init()', () => {
    it('should create an authentication provider', async () => {
      const mockApp = createMockApplication();

      await plugin.init(mockApp);

      expect(plugin.authenticationProvider).toBeDefined();
    });

    it('should set authProvider on the application when app has no prior auth provider', async () => {
      const mockApp = createMockApplication();

      await plugin.init(mockApp);

      expect(mockApp.authProvider).toBe(plugin.authenticationProvider);
    });

    it('should not overwrite existing authProvider on the application', async () => {
      const existingProvider = {
        findUserById: jest.fn(),
        verifyToken: jest.fn(),
      } as unknown as IAuthenticationProvider;
      const mockApp = createMockApplication();
      (
        mockApp as { authProvider: IAuthenticationProvider | undefined }
      ).authProvider = existingProvider;

      await plugin.init(mockApp);

      // The existing provider should remain since it was already set
      expect(mockApp.authProvider).toBe(existingProvider);
    });

    it('should store the application reference for later use', async () => {
      const mockApp = createMockApplication();

      await plugin.init(mockApp);

      // mongoApplication should be defined after init
      expect(plugin.mongoApplication).toBeDefined();
    });
  });

  describe('stop()', () => {
    it('should call disconnect', async () => {
      await plugin.stop();

      expect(mockDocStore.disconnect).toHaveBeenCalled();
    });

    it('should stop dev database during stop', async () => {
      const mockStop = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(mockDocStore, 'devDatabase', {
        value: { stop: mockStop },
        writable: true,
        configurable: true,
      });

      await plugin.stop();

      expect(mockDocStore.disconnect).toHaveBeenCalled();
      expect(mockStop).toHaveBeenCalled();
    });
  });

  describe('setupDevStore()', () => {
    it('should delegate to document store setupDevStore', async () => {
      const uri = await plugin.setupDevStore();

      expect(mockDocStore.setupDevStore).toHaveBeenCalled();
      expect(uri).toBe('mongodb://dev:27017/test');
    });

    it('should return empty string when setupDevStore is not available', async () => {
      const storeNoSetup = createMockDocumentStore();
      delete (storeNoSetup as Partial<typeof storeNoSetup>).setupDevStore;
      const pluginNoSetup = MongoDatabasePlugin.fromDocumentStore(
        storeNoSetup,
        mockEnv,
      );

      const uri = await pluginNoSetup.setupDevStore();

      expect(uri).toBe('');
    });
  });

  describe('teardownDevStore()', () => {
    it('should stop dev database if it exists', async () => {
      const mockStop = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(mockDocStore, 'devDatabase', {
        value: { stop: mockStop },
        writable: true,
        configurable: true,
      });

      await plugin.teardownDevStore();

      expect(mockStop).toHaveBeenCalled();
    });

    it('should do nothing when no dev database exists', async () => {
      await expect(plugin.teardownDevStore()).resolves.not.toThrow();
    });
  });

  describe('initializeDevStore()', () => {
    it('should return undefined when no application is set', async () => {
      const result = await plugin.initializeDevStore();

      expect(result).toBeUndefined();
    });

    it('should delegate to document store initializeDevStore after init', async () => {
      const mockApp = createMockApplication();
      await plugin.init(mockApp);

      const result = await plugin.initializeDevStore();

      expect(mockDocStore.initializeDevStore).toHaveBeenCalled();
      expect(result).toEqual({ seeded: true });
    });

    it('should store the init result in lastInitResult', async () => {
      const mockApp = createMockApplication();
      await plugin.init(mockApp);

      await plugin.initializeDevStore();

      expect(plugin.lastInitResult).toEqual({ seeded: true });
    });

    it('should return undefined when initializeDevStore is not available on store', async () => {
      const storeNoInit = createMockDocumentStore();
      delete (storeNoInit as Partial<typeof storeNoInit>).initializeDevStore;
      const pluginNoInit = MongoDatabasePlugin.fromDocumentStore(
        storeNoInit,
        mockEnv,
      );
      const mockApp = createMockApplication();
      await pluginNoInit.init(mockApp);

      const result = await pluginNoInit.initializeDevStore();

      expect(result).toBeUndefined();
    });
  });

  describe('createMongoAppAdapter (via mongoApplication)', () => {
    it('should create an adapter that delegates environment to the app', async () => {
      const mockApp = createMockApplication();
      await plugin.init(mockApp);

      const adapter = plugin.mongoApplication;

      expect(adapter).toBeDefined();
      expect(adapter?.environment).toBe(mockApp.environment);
    });

    it('should create an adapter that delegates constants to the app', async () => {
      const mockApp = createMockApplication();
      await plugin.init(mockApp);

      const adapter = plugin.mongoApplication;

      expect(adapter?.constants).toBe(mockApp.constants);
    });

    it('should create an adapter that delegates ready to the app', async () => {
      const mockApp = createMockApplication();
      await plugin.init(mockApp);

      const adapter = plugin.mongoApplication;

      expect(adapter?.ready).toBe(mockApp.ready);
    });

    it('should create an adapter that delegates services to the app', async () => {
      const mockApp = createMockApplication();
      await plugin.init(mockApp);

      const adapter = plugin.mongoApplication;

      expect(adapter?.services).toBe(mockApp.services);
    });

    it('should create an adapter that delegates getModel to the plugin', async () => {
      const mockApp = createMockApplication();
      const mockModel = { modelName: 'TestModel' };
      mockDocStore.getModel.mockReturnValue(mockModel as never);
      await plugin.init(mockApp);

      const adapter = plugin.mongoApplication;
      const model = adapter?.getModel('TestModel');

      expect(mockDocStore.getModel).toHaveBeenCalledWith('TestModel');
      expect(model).toBe(mockModel);
    });

    it('should create an adapter that delegates start to the app', async () => {
      const mockApp = createMockApplication();
      await plugin.init(mockApp);

      const adapter = plugin.mongoApplication;
      await adapter?.start();

      expect(mockApp.start).toHaveBeenCalled();
    });
  });

  describe('schemaMap getter', () => {
    it('should throw when schema map is not loaded', () => {
      expect(() => plugin.schemaMap).toThrow();
    });

    it('should return schema map when available', () => {
      const mockSchemaMap = { User: {} };
      Object.defineProperty(mockDocStore, 'schemaMap', {
        value: mockSchemaMap,
        writable: true,
        configurable: true,
      });

      expect(plugin.schemaMap).toBe(mockSchemaMap);
    });
  });

  describe('devDatabase getter', () => {
    it('should return undefined when no dev database exists', () => {
      expect(plugin.devDatabase).toBeUndefined();
    });

    it('should return the dev database when it exists', () => {
      const mockDevDb = { stop: jest.fn() };
      Object.defineProperty(mockDocStore, 'devDatabase', {
        value: mockDevDb,
        writable: true,
        configurable: true,
      });

      expect(plugin.devDatabase).toBe(mockDevDb);
    });
  });

  describe('authenticationProvider getter', () => {
    it('should return undefined before init', () => {
      expect(plugin.authenticationProvider).toBeUndefined();
    });

    it('should return the auth provider after init', async () => {
      const mockApp = createMockApplication();
      await plugin.init(mockApp);

      expect(plugin.authenticationProvider).toBeDefined();
    });
  });

  describe('lastInitResult getter', () => {
    it('should return undefined before initializeDevStore', () => {
      expect(plugin.lastInitResult).toBeUndefined();
    });
  });
});
