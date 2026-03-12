/**
 * Property-based tests for MongoDatabasePlugin.
 *
 * Feature: plugin-migration-cleanup
 * - Property 3: MongoDatabasePlugin lifecycle delegation
 * - Property 4: MongoDatabasePlugin accessor delegation
 * - Property 5: MongoDatabasePlugin.init wires authentication provider
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.6
 *
 * @module tests/plugins/mongo-database-plugin.property
 */

import * as fc from 'fast-check';
import type { IDocumentStore } from '../../src/interfaces/mongoose-document-store';
import type { IApplication } from '@digitaldefiance/node-express-suite';
import type { IAuthenticationProvider } from '@digitaldefiance/node-express-suite';
import type { PluginManager } from '@digitaldefiance/node-express-suite';
import type { ServiceContainer } from '@digitaldefiance/node-express-suite';
import type { Environment } from '@digitaldefiance/node-express-suite';
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

// ─── Property 3: MongoDatabasePlugin lifecycle delegation ───

describe('Feature: plugin-migration-cleanup, Property 3: MongoDatabasePlugin lifecycle delegation', () => {
  /**
   * **Validates: Requirements 6.1, 6.2**
   *
   * For any MongoDatabasePlugin instance wrapping a document store,
   * calling connect(uri) should invoke the document store's connect
   * with the same or resolved URI, and calling disconnect() should
   * invoke the document store's disconnect and stop any dev database.
   */

  it('connect(uri) delegates to document store connect with the provided URI', () => {
    fc.assert(
      fc.asyncProperty(fc.webUrl(), async (uri: string) => {
        const mockDocStore = createMockDocumentStore();
        const mockEnv = createMockEnvironment();
        const plugin = MongoDatabasePlugin.fromDocumentStore(
          mockDocStore,
          mockEnv,
        );

        await plugin.connect(uri);

        expect(mockDocStore.connect).toHaveBeenCalledTimes(1);
        expect(mockDocStore.connect).toHaveBeenCalledWith(uri);
      }),
      { numRuns: 100 },
    );
  });

  it('connect() without URI falls back to environment mongo URI', () => {
    fc.assert(
      fc.asyncProperty(fc.webUrl(), async (envUri: string) => {
        const mockDocStore = createMockDocumentStore();
        const mockEnv = createMockEnvironment({ mongo: { uri: envUri } });
        const plugin = MongoDatabasePlugin.fromDocumentStore(
          mockDocStore,
          mockEnv,
        );

        await plugin.connect();

        expect(mockDocStore.connect).toHaveBeenCalledTimes(1);
        expect(mockDocStore.connect).toHaveBeenCalledWith(envUri);
      }),
      { numRuns: 100 },
    );
  });

  it('disconnect() delegates to document store disconnect', () => {
    fc.assert(
      fc.asyncProperty(fc.boolean(), async (hasDevDb: boolean) => {
        const mockDocStore = createMockDocumentStore();
        const mockStop = jest.fn().mockResolvedValue(undefined);

        if (hasDevDb) {
          Object.defineProperty(mockDocStore, 'devDatabase', {
            value: { stop: mockStop },
            writable: true,
            configurable: true,
          });
        }

        const mockEnv = createMockEnvironment();
        const plugin = MongoDatabasePlugin.fromDocumentStore(
          mockDocStore,
          mockEnv,
        );

        await plugin.disconnect();

        expect(mockDocStore.disconnect).toHaveBeenCalledTimes(1);

        if (hasDevDb) {
          expect(mockStop).toHaveBeenCalledTimes(1);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4: MongoDatabasePlugin accessor delegation ───

describe('Feature: plugin-migration-cleanup, Property 4: MongoDatabasePlugin accessor delegation', () => {
  /**
   * **Validates: Requirements 6.4, 6.6**
   *
   * For any MongoDatabasePlugin instance, isConnected() should return
   * the same value as the underlying document store's isConnected(),
   * and getModel(name) should return the same model as the document
   * store's getModel(name).
   */

  it('isConnected() returns the same value as the document store', () => {
    fc.assert(
      fc.property(fc.boolean(), (connectedState: boolean) => {
        const mockDocStore = createMockDocumentStore();
        mockDocStore.isConnected.mockReturnValue(connectedState);
        const mockEnv = createMockEnvironment();
        const plugin = MongoDatabasePlugin.fromDocumentStore(
          mockDocStore,
          mockEnv,
        );

        const result = plugin.isConnected();

        expect(result).toBe(connectedState);
        expect(mockDocStore.isConnected).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 },
    );
  });

  it('getModel(name) returns the same model as the document store', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 50 })
          .filter((s) => s.trim().length > 0),
        (modelName: string) => {
          const mockDocStore = createMockDocumentStore();
          const sentinel = { modelName };
          mockDocStore.getModel.mockReturnValue(sentinel as never);
          const mockEnv = createMockEnvironment();
          const plugin = MongoDatabasePlugin.fromDocumentStore(
            mockDocStore,
            mockEnv,
          );

          const result = plugin.getModel(modelName);

          expect(result).toBe(sentinel);
          expect(mockDocStore.getModel).toHaveBeenCalledWith(modelName);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 5: MongoDatabasePlugin.init wires authentication provider ───

describe('Feature: plugin-migration-cleanup, Property 5: MongoDatabasePlugin.init wires authentication provider', () => {
  /**
   * **Validates: Requirements 6.3**
   *
   * For any IApplication passed to MongoDatabasePlugin.init(), after init
   * completes, the plugin's authenticationProvider property should be defined
   * and the application's authProvider should be set to the plugin's
   * authentication provider (when the app had no prior auth provider).
   */

  it('after init(), authenticationProvider is defined and wired to the app', () => {
    fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const mockDocStore = createMockDocumentStore();
        const mockEnv = createMockEnvironment();
        const plugin = MongoDatabasePlugin.fromDocumentStore(
          mockDocStore,
          mockEnv,
        );
        const mockApp = createMockApplication();

        // Ensure app has no prior auth provider
        (mockApp as { authProvider: undefined }).authProvider = undefined;

        await plugin.init(mockApp);

        // Plugin's authenticationProvider should be defined
        expect(plugin.authenticationProvider).toBeDefined();

        // App's authProvider should be set to the plugin's auth provider
        expect(mockApp.authProvider).toBe(plugin.authenticationProvider);
      }),
      { numRuns: 100 },
    );
  });

  it('after init(), app with existing authProvider is not overwritten', () => {
    fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const mockDocStore = createMockDocumentStore();
        const mockEnv = createMockEnvironment();
        const plugin = MongoDatabasePlugin.fromDocumentStore(
          mockDocStore,
          mockEnv,
        );
        const mockApp = createMockApplication();

        // Set an existing auth provider on the app
        const existingProvider = {
          findUserById: jest.fn(),
          verifyToken: jest.fn(),
          buildRequestUserDTO: jest.fn(),
        };
        (
          mockApp as { authProvider: IAuthenticationProvider | undefined }
        ).authProvider = existingProvider;

        await plugin.init(mockApp);

        // Plugin's authenticationProvider should still be defined
        expect(plugin.authenticationProvider).toBeDefined();

        // App's authProvider should remain the existing one
        expect(mockApp.authProvider).toBe(existingProvider);
      }),
      { numRuns: 100 },
    );
  });
});
