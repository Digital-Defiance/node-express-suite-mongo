import { Connection } from '@digitaldefiance/mongoose-types';
import { registerNodeRuntimeConfiguration } from '@digitaldefiance/node-ecies-lib';
import {
  Application,
  BaseApplication,
  LocalhostConstants,
  Environment,
  AppRouter,
  BaseRouter,
} from '@digitaldefiance/node-express-suite';
import type { IConstants, IServerInitResult } from '@digitaldefiance/node-express-suite';
import { IMongoApplication } from '../src/interfaces/mongo-application';
import { DatabaseInitializationService } from '../src/services/database-initialization';
import { MongoDatabasePlugin } from '../src/plugins/mongo-database-plugin';
import { SchemaMap } from '../src/types';

// Mock dependencies
jest.mock('../src/services/database-initialization');

describe('Application', () => {
  let application: Application<Buffer, Environment, IConstants, AppRouter>;
  let env: Environment;
  let mockApiRouter: BaseRouter;
  let mockSchemaMap: SchemaMap<Buffer, Record<string, never>>;

  beforeAll(() => {
    registerNodeRuntimeConfiguration('default-config', {});
  });

  beforeEach(() => {
    // Set up required environment variables
    const fs = require('fs');
    process.env.JWT_SECRET = 'a'.repeat(64);
    process.env.MNEMONIC_HMAC_SECRET = 'a'.repeat(64);
    process.env.MNEMONIC_ENCRYPTION_KEY = 'b'.repeat(64);
    process.env.API_DIST_DIR = '/tmp/test-api-dist';
    process.env.REACT_DIST_DIR = '/tmp/test-react-dist';
    if (!fs.existsSync('/tmp/test-api-dist')) {
      fs.mkdirSync('/tmp/test-api-dist', { recursive: true });
    }
    if (!fs.existsSync('/tmp/test-react-dist')) {
      fs.mkdirSync('/tmp/test-react-dist', { recursive: true });
    }

    // Create environment without devDatabase
    env = new Environment(undefined, true);

    // Mock schema map
    mockSchemaMap = {} as SchemaMap<Buffer, Record<string, never>>;

    // Mock API router factory
    const apiRouterFactory = jest.fn((app) => {
      mockApiRouter = new BaseRouter(app);
      return mockApiRouter;
    });

    // Create application instance with appRouterFactory that mocks init
    const appRouterFactory = (apiRouter: BaseRouter) => {
      const router = new AppRouter(apiRouter);
      jest.spyOn(router, 'init').mockImplementation(() => {});
      return router;
    };

    application = new Application(
      env,
      apiRouterFactory,
      {
        corsWhitelist: [],
        csp: {
          defaultSrc: [],
          imgSrc: [],
          connectSrc: [],
          scriptSrc: [],
          styleSrc: [],
          fontSrc: [],
          frameSrc: [],
        },
      },
      LocalhostConstants,
      appRouterFactory,
    );

    // Register a MongoDatabasePlugin
    const mongoPlugin = new MongoDatabasePlugin({
      schemaMapFactory: (connection: Connection) => mockSchemaMap,
      databaseInitFunction: async (app: IMongoApplication) => ({
        success: true,
        data: {
          systemUser: {
            _id: 'system-id',
            username: 'system',
            email: 'system@example.com',
            password: 'password123',
          },
          adminUser: {
            _id: 'admin-id',
            username: 'admin',
            email: 'admin@example.com',
            password: 'password123',
          },
          memberUser: {
            _id: 'member-id',
            username: 'member',
            email: 'member@example.com',
            password: 'password123',
            mnemonic: 'test mnemonic phrase',
            publicKey: 'public-key-123',
            backupCodes: ['code1', 'code2'],
          },
        },
      }),
      initResultHashFunction: (initResults: IServerInitResult) => 'test-hash',
      environment: env,
      constants: LocalhostConstants,
    });

    application.useDatabasePlugin(mongoPlugin);

    // Mock the DatabaseInitializationService.printServerInitResults
    jest.clearAllMocks();
    jest
      .spyOn(DatabaseInitializationService, 'printServerInitResults')
      .mockImplementation(() => {});
  });

  afterEach(async () => {
    jest.clearAllMocks();
    if (application && application.ready) {
      try {
        // Set server to null to skip close logic
        (application as Record<string, unknown>).server = null;
        (application as Record<string, unknown>)._ready = false;
      } catch (err) {
        // Ignore errors during cleanup
      }
    }
  });

  describe('constructor', () => {
    it('should create application instance', () => {
      expect(application).toBeDefined();
      expect(application).toBeInstanceOf(Application);
      expect(application).toBeInstanceOf(BaseApplication);
    });

    it('should initialize with Express app', () => {
      expect(application.expressApp).toBeDefined();
    });

    it('should have environment', () => {
      expect(application.environment).toBe(env);
    });

    it('should not be ready initially', () => {
      expect(application.ready).toBe(false);
    });

    it('should have a database plugin registered', () => {
      expect(application.databasePlugin).toBeDefined();
      expect(application.databasePlugin!.name).toBe('mongo-database');
    });
  });

  describe('start() without devDatabase', () => {
    it('should start without calling initializeDevStore', async () => {
      jest.clearAllMocks();

      // Mock the database plugin's connect to avoid real DB connection
      const plugin = application.databasePlugin!;
      const connectSpy = jest
        .spyOn(plugin, 'connect')
        .mockResolvedValue(undefined);
      const initSpy = jest.spyOn(plugin, 'init').mockResolvedValue(undefined);

      // Mock express app listen
      const listenSpy = jest
        .spyOn(application.expressApp, 'listen')
        .mockImplementation(((
          port: number,
          host: string,
          callback: () => void,
        ) => {
          callback();
          return {
            close: jest.fn(),
            closeAllConnections: jest.fn(),
          };
        }) as never);

      await application.start();

      expect(connectSpy).toHaveBeenCalled();
      expect(application.ready).toBe(true);

      listenSpy.mockRestore();
      connectSpy.mockRestore();
      initSpy.mockRestore();
    }, 10000);
  });

  describe('start() with devDatabase', () => {
    beforeEach(() => {
      // Set up environment with devDatabase
      process.env.DEV_DATABASE = 'test-dev-db';
      env = new Environment(undefined, true);

      // Recreate application with devDatabase environment
      const apiRouterFactory = jest.fn((app) => {
        mockApiRouter = new BaseRouter(app);
        return mockApiRouter;
      });

      const appRouterFactory2 = (apiRouter: BaseRouter) => {
        const router = new AppRouter(apiRouter);
        jest.spyOn(router, 'init').mockImplementation(() => {});
        return router;
      };

      application = new Application(
        env,
        apiRouterFactory,
        {
          corsWhitelist: [],
          csp: {
            defaultSrc: [],
            imgSrc: [],
            connectSrc: [],
            scriptSrc: [],
            styleSrc: [],
            fontSrc: [],
            frameSrc: [],
          },
        },
        LocalhostConstants,
        appRouterFactory2,
      );

      const mongoPlugin = new MongoDatabasePlugin({
        schemaMapFactory: (connection: Connection) => mockSchemaMap,
        databaseInitFunction: async () => ({
          success: true,
          data: {
            systemUser: {
              _id: 'system-id',
              username: 'system',
              email: 'system@example.com',
              password: 'password123',
            },
            adminUser: {
              _id: 'admin-id',
              username: 'admin',
              email: 'admin@example.com',
              password: 'password123',
            },
            memberUser: {
              _id: 'member-id',
              username: 'member',
              email: 'member@example.com',
              password: 'password123',
              mnemonic: 'test mnemonic phrase',
              publicKey: 'public-key-123',
              backupCodes: ['code1', 'code2'],
            },
          },
        }),
        initResultHashFunction: () => 'test-hash',
        environment: env,
        constants: LocalhostConstants,
      });

      application.useDatabasePlugin(mongoPlugin);
    });

    afterEach(() => {
      delete process.env.DEV_DATABASE;
    });

    it('should call initializeDevStore when devDatabase is set', async () => {
      jest.clearAllMocks();

      const plugin = application.databasePlugin!;
      const connectSpy = jest
        .spyOn(plugin, 'connect')
        .mockResolvedValue(undefined);
      const initSpy = jest.spyOn(plugin, 'init').mockResolvedValue(undefined);
      const setupDevSpy = jest
        .spyOn(plugin, 'setupDevStore')
        .mockResolvedValue('mongodb://localhost/test');
      const initDevSpy = jest
        .spyOn(plugin, 'initializeDevStore')
        .mockResolvedValue(undefined);

      const listenSpy = jest
        .spyOn(application.expressApp, 'listen')
        .mockImplementation(((
          port: number,
          host: string,
          callback: () => void,
        ) => {
          callback();
          return {
            close: jest.fn(),
            closeAllConnections: jest.fn(),
          };
        }) as never);

      await application.start();

      expect(setupDevSpy).toHaveBeenCalled();
      expect(initDevSpy).toHaveBeenCalled();
      expect(application.ready).toBe(true);

      listenSpy.mockRestore();
      connectSpy.mockRestore();
      initSpy.mockRestore();
    }, 10000);

    it('should handle initializeDevStore errors', async () => {
      jest.clearAllMocks();

      const mockError = new Error('Database initialization failed');

      const plugin = application.databasePlugin!;
      jest.spyOn(plugin, 'connect').mockResolvedValue(undefined);
      jest.spyOn(plugin, 'init').mockResolvedValue(undefined);
      jest
        .spyOn(plugin, 'setupDevStore')
        .mockResolvedValue('mongodb://localhost/test');
      jest.spyOn(plugin, 'initializeDevStore').mockRejectedValue(mockError);

      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      await expect(application.start()).rejects.toThrow(
        'Database initialization failed',
      );

      process.env.NODE_ENV = originalEnv;
    }, 10000);
  });

  describe('stop()', () => {
    it('should stop the application', async () => {
      const plugin = application.databasePlugin!;
      jest.spyOn(plugin, 'connect').mockResolvedValue(undefined);
      jest.spyOn(plugin, 'init').mockResolvedValue(undefined);
      jest.spyOn(plugin, 'stop').mockResolvedValue(undefined);

      // Mock server
      const mockServer = {
        close: jest.fn((cb: (err?: Error) => void) => cb()),
        closeAllConnections: jest.fn(),
      };
      (application as Record<string, unknown>).server = mockServer;
      (application as Record<string, unknown>)._ready = true;

      await application.stop();

      expect(mockServer.closeAllConnections).toHaveBeenCalled();
      expect(mockServer.close).toHaveBeenCalled();
      expect(application.ready).toBe(false);
    });

    it('should handle missing server gracefully', async () => {
      const plugin = application.databasePlugin!;
      jest.spyOn(plugin, 'connect').mockResolvedValue(undefined);
      jest.spyOn(plugin, 'init').mockResolvedValue(undefined);
      jest.spyOn(plugin, 'stop').mockResolvedValue(undefined);

      (application as Record<string, unknown>).server = null;
      (application as Record<string, unknown>)._ready = true;

      await expect(application.stop()).resolves.not.toThrow();
      expect(application.ready).toBe(false);
    });
  });

  describe('registerServices()', () => {
    it('should call registerServices during construction', () => {
      const registerServicesSpy = jest.spyOn(
        Application.prototype as Record<string, unknown>,
        'registerServices',
      ) as jest.SpyInstance;

      const apiRouterFactory = jest.fn((app) => new BaseRouter(app));
      const testApp = new Application(
        env,
        apiRouterFactory,
        {
          corsWhitelist: [],
          csp: {
            defaultSrc: [],
            imgSrc: [],
            connectSrc: [],
            scriptSrc: [],
            styleSrc: [],
            fontSrc: [],
            frameSrc: [],
          },
        },
        LocalhostConstants,
      );

      expect(registerServicesSpy).toHaveBeenCalled();

      registerServicesSpy.mockRestore();
    });
  });
});
