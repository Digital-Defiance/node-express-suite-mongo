import {
  CoreLanguageCode,
  GlobalActiveContext,
  IActiveContext,
} from '@digitaldefiance/i18n-lib';
import { Connection } from '@digitaldefiance/mongoose-types';
import { IFailableResult } from '@digitaldefiance/suite-core-lib';
import { HelmetOptions } from 'helmet';
import {
  Application,
  Environment,
  AppRouter,
  BaseRouter,
  initMiddleware,
} from '@digitaldefiance/node-express-suite';
import type {
  IApplication,
  IConstants,
  ICSPConfig,
  IFlexibleCSP,
} from '@digitaldefiance/node-express-suite';
import { IServerInitResult } from '../../interfaces/server-init-result';
import { BaseDocument } from '../../documents';
import { IMongoApplication } from '../../interfaces/mongo-application';
import { ITestEnvironment } from '../../interfaces/test-environment';
import { DatabaseInitializationService } from '../../services';
import { MongoDatabasePlugin } from '../../plugins/mongo-database-plugin';
import { SchemaMap } from '../../types';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

export async function setupTestEnvironment<
  TID extends PlatformID = Buffer,
  TModelDocs extends Record<string, BaseDocument<never, TID>> = Record<
    string,
    BaseDocument<never, TID>
  >,
  TConstants extends IConstants = IConstants,
  TAppRouter extends AppRouter<TID> = AppRouter<TID>,
>(
  constants: TConstants,
  apiRouterFactory: (app: IApplication<TID>) => BaseRouter<TID>,
  schemaMapFactory: (connection: Connection) => SchemaMap<TID, TModelDocs>,
  appRouterFactory: (apiRouter: BaseRouter<TID>) => TAppRouter = (apiRouter) =>
    new AppRouter(apiRouter) as TAppRouter,
  customInitMiddleware: typeof initMiddleware = initMiddleware,
  envLocation?: string,
  databaseInitFunction?: (
    application: IMongoApplication<TID>,
  ) => Promise<IFailableResult<IServerInitResult<TID>>>,
  initResultHashFunction?: (initResults: IServerInitResult<TID>) => string,
  cspConfig: ICSPConfig | HelmetOptions | IFlexibleCSP = {
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
): Promise<ITestEnvironment<TID>> {
  // Make runtime deterministic for tests
  process.env.NODE_ENV = 'test';
  process.env['DEV_DATABASE'] = 'test';
  // Increase libuv threadpool for concurrent pbkdf2 work
  if (!process.env['UV_THREADPOOL_SIZE']) {
    process.env['UV_THREADPOOL_SIZE'] = '16';
  }

  // Optimize MongoDB settings for test performance while maintaining reliability
  if (!process.env['MONGO_MAX_POOL_SIZE']) {
    process.env['MONGO_MAX_POOL_SIZE'] = '5';
  }
  if (!process.env['MONGO_MIN_POOL_SIZE']) {
    process.env['MONGO_MIN_POOL_SIZE'] = '2';
  }
  if (!process.env['MONGO_SERVER_SELECTION_TIMEOUT_MS']) {
    process.env['MONGO_SERVER_SELECTION_TIMEOUT_MS'] = '5000';
  }
  if (!process.env['MONGO_SOCKET_TIMEOUT_MS']) {
    process.env['MONGO_SOCKET_TIMEOUT_MS'] = '15000';
  }
  if (!process.env['MONGO_TRANSACTION_TIMEOUT']) {
    process.env['MONGO_TRANSACTION_TIMEOUT'] = '15000';
  }
  if (!process.env['MONGO_TRANSACTION_LOCK_REQUEST_TIMEOUT']) {
    process.env['MONGO_TRANSACTION_LOCK_REQUEST_TIMEOUT'] = '8000';
  }
  if (!process.env['MONGO_TRANSACTION_RETRY_BASE_DELAY']) {
    process.env['MONGO_TRANSACTION_RETRY_BASE_DELAY'] = '100';
  }
  // Disable transactions in test environment for better reliability
  if (!process.env['MONGO_USE_TRANSACTIONS']) {
    process.env['MONGO_USE_TRANSACTIONS'] = 'false';
  }

  // Ensure language is set to English for consistent test behavior
  process.env.LANGUAGE = 'English (US)';

  // Use a random high port to avoid conflicts
  process.env['PORT'] = String(Math.floor(Math.random() * 10000) + 50000);

  // Use unique database name for each test to avoid conflicts
  const uniqueDbName = `test_${Date.now()}_${Math.floor(
    Math.random() * 10000,
  )}`;
  process.env['DEV_DATABASE'] = uniqueDbName;

  // Reset global language context to English
  const setAdminLanguage = (language: CoreLanguageCode) => {
    const context = GlobalActiveContext.getInstance<
      CoreLanguageCode,
      IActiveContext<CoreLanguageCode>
    >();
    context.setAdminLanguage(language);
  };
  setAdminLanguage('en-US');

  const env = new Environment<TID>(envLocation, true);

  // Create the Application with MongoDatabasePlugin
  const application = new Application<
    TID,
    Environment<TID>,
    TConstants,
    TAppRouter
  >(
    env,
    apiRouterFactory,
    cspConfig,
    constants,
    appRouterFactory,
    customInitMiddleware,
  );

  const mongoPlugin = new MongoDatabasePlugin<
    TID,
    TModelDocs,
    IServerInitResult<TID>,
    TConstants
  >({
    schemaMapFactory,
    databaseInitFunction:
      databaseInitFunction ??
      (DatabaseInitializationService.initUserDb.bind(
        DatabaseInitializationService,
      ) as (
        app: IMongoApplication<TID>,
      ) => Promise<IFailableResult<IServerInitResult<TID>>>),
    initResultHashFunction:
      initResultHashFunction ??
      (DatabaseInitializationService.serverInitResultHash.bind(
        DatabaseInitializationService,
      ) as (initResults: IServerInitResult<TID>) => string),
    environment: env,
    constants,
  });

  application.useDatabasePlugin(mongoPlugin);

  // Create and start your app — this connects the DB, inits plugins,
  // and runs initializeDevStore (which calls initUserDb) via the plugin.
  try {
    await application.start();

    if (mongoPlugin.db.connection.db) {
      const command = {
        ...(application.environment.mongo.setParameterSupported
          ? { setParameter: 1 }
          : {}),
        ...(application.environment.mongo.useTransactions &&
        application.environment.mongo.transactionLifetimeLimitSecondsSupported
          ? {
              transactionLifetimeLimitSeconds:
                application.environment.mongo.transactionTimeout,
            }
          : {}),
        ...(application.environment.mongo.useTransactions &&
        application.environment.mongo
          .maxTransactionLockRequestTimeoutMillisSupported
          ? {
              maxTransactionLockRequestTimeoutMillis:
                application.environment.mongo.transactionLockRequestTimeout,
            }
          : {}),
      };

      if (Object.keys(command).length > 0) {
        await mongoPlugin.db.connection.db
          .admin()
          .command(command)
          .catch(() => undefined);
      }
    }
  } catch (error) {
    console.error(
      'Failed to start application with MongoDB URI:',
      application.environment.mongo.uri,
    );
    console.error('Connection error:', error);
    throw error;
  }

  // Ensure the test process uses the same JWT secret as the application
  process.env.JWT_SECRET = application.environment.jwtSecret;

  // Get the init result from the plugin (populated during start() → initializeDevStore)
  const accountData = mongoPlugin.lastInitResult as
    | IServerInitResult<TID>
    | undefined;
  if (!accountData) {
    throw new Error(
      'Failed to initialize database for tests — no init result from plugin',
    );
  }

  return {
    application: application as unknown as ITestEnvironment<TID>['application'],
    mongoServer: mongoPlugin.devDatabase!,
    mongoUri: (application.environment.mongo as Record<string, unknown>)
      .uri as string,
    accountData,
    dbName: application.environment.devDatabase!,
  };
}
