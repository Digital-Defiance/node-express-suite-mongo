/**
 * @fileoverview Mongoose implementation of the IDocumentStore interface.
 * Wraps existing mongoose logic previously embedded in BaseApplication.
 * @module services/mongoose-document-store
 */

import mongoose, { Model } from '@digitaldefiance/mongoose-types';
import {
  Constants,
  getSuiteCoreI18nEngine,
  getSuiteCoreTranslation,
  IFailableResult,
  SuiteCoreStringKey,
  TranslatableSuiteError,
} from '@digitaldefiance/suite-core-lib';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { BaseDocument } from '../documents/base';
import { Environment, debugLog } from '@digitaldefiance/node-express-suite';
import { ModelRegistry } from '../model-registry';
import type {
  IApplication,
  IConstants,
} from '@digitaldefiance/node-express-suite';
import { IDocumentStore } from '../interfaces/mongoose-document-store';
import { ISchema } from '../interfaces/schema';
import { SchemaMap } from '../types';
import { defaultMongoUriValidator } from '../utils/default-mongo-uri-validator';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';
import type { IMongoApplication } from '../interfaces/mongo-application';
import type { IMongoEnvironment } from '../interfaces/environment-mongo';

/**
 * Mongoose implementation of IDocumentStore.
 * Extracts and preserves the existing mongoose logic from BaseApplication.
 * @template TID - Platform-specific ID type extending PlatformID
 * @template TModelDocs - Record mapping model names to their document types
 * @template TInitResults - Type of database initialization results
 * @template TConstants - Application constants type
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class MongooseDocumentStore<
  TID extends PlatformID,
  TModelDocs extends Record<string, BaseDocument<any, TID>>,
  TInitResults,
  TConstants extends IConstants = IConstants,
> implements IDocumentStore<TID, TModelDocs> {
  /**
   * Mongoose database instance
   */
  private _db?: typeof mongoose;

  /**
   * Schema map for all models
   */
  private _schemaMap?: SchemaMap<TID, TModelDocs>;

  /**
   * In-memory MongoDB instance for development
   */
  private _devDatabase?: MongoMemoryReplSet;

  /**
   * Function to create the schema map given a Mongoose connection
   */
  private readonly _schemaMapFactory: (
    connection: mongoose.Connection,
  ) => SchemaMap<TID, TModelDocs>;

  /**
   * Function to initialize the database with default data
   */
  private readonly _databaseInitFunction: (
    application: IMongoApplication<TID>,
  ) => Promise<IFailableResult<TInitResults>>;

  /**
   * Function to create a hash from the database initialization results (for logging purposes)
   */
  private readonly _initResultHashFunction: (
    initResults: TInitResults,
  ) => string;

  /**
   * Application environment
   */
  private readonly _environment: Environment<TID>;

  /**
   * Application constants
   */
  private readonly _constants: TConstants;

  constructor(
    schemaMapFactory: (
      connection: mongoose.Connection,
    ) => SchemaMap<TID, TModelDocs>,
    databaseInitFunction: (
      application: IMongoApplication<TID>,
    ) => Promise<IFailableResult<TInitResults>>,
    initResultHashFunction: (initResults: TInitResults) => string,
    environment: Environment<TID>,
    constants: TConstants = Constants as TConstants,
  ) {
    this._schemaMapFactory = schemaMapFactory;
    this._databaseInitFunction = databaseInitFunction;
    this._initResultHashFunction = initResultHashFunction;
    this._environment = environment;
    this._constants = constants;
  }

  /**
   * Get the underlying mongoose instance (for backward compatibility).
   */
  public get db(): typeof mongoose {
    if (!this._db) {
      throw new TranslatableSuiteError(
        SuiteCoreStringKey.Admin_Error_DatabaseNotConnectedYet,
      );
    }
    return this._db;
  }

  /** @inheritdoc */
  public get schemaMap(): SchemaMap<TID, TModelDocs> | undefined {
    return this._schemaMap;
  }

  /** @inheritdoc */
  public get devDatabase(): MongoMemoryReplSet | undefined {
    return this._devDatabase;
  }

  /**
   * Validate MongoDB URI to prevent SSRF attacks.
   * Delegates to the standalone defaultMongoUriValidator for reuse
   * across both IDatabase and IDocumentStore paths.
   */
  private validateMongoUri(uri: string): void {
    defaultMongoUriValidator(uri, this._environment.production);
  }

  /**
   * Connect to MongoDB and initialize schemas.
   * Extracted from BaseApplication.connectDatabase.
   * @inheritdoc
   */
  public async connect(uri?: string): Promise<void> {
    const mongoUri = uri ?? this._environment.requireMongo.uri;
    const debug = this._environment.debug;

    this.validateMongoUri(mongoUri);

    debugLog(
      debug,
      'log',
      `[ ${getSuiteCoreTranslation(
        SuiteCoreStringKey.Common_Connecting,
        undefined,
        undefined,
        { constants: this._constants },
      )} ] ${getSuiteCoreTranslation(
        SuiteCoreStringKey.Common_MongoDB,
        undefined,
        undefined,
        { constants: this._constants },
      )}: ${mongoUri}`,
    );

    // Always disconnect first to ensure clean state
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }

    // amazonq-ignore-next-line solved above with validateMongoUri call
    const mongoConfig = this._environment.mongo as unknown as IMongoEnvironment;
    await mongoose.connect(mongoUri, {
      maxPoolSize: mongoConfig.maxPoolSize,
      minPoolSize: mongoConfig.minPoolSize,
      maxIdleTimeMS: mongoConfig.maxIdleTimeMS,
      serverSelectionTimeoutMS: mongoConfig.serverSelectionTimeoutMS,
      socketTimeoutMS: mongoConfig.socketTimeoutMS,
      retryWrites: mongoConfig.retryWrites,
      retryReads: mongoConfig.retryReads,
      readConcern: mongoConfig.readConcern,
      writeConcern: mongoConfig.writeConcern,
    });
    this._db = mongoose;

    await new Promise<void>((resolve) => {
      if (mongoose.connection.readyState === 1) {
        resolve();
      } else {
        mongoose.connection.once('connected', resolve);
      }
    });

    const engine = getSuiteCoreI18nEngine({ constants: this._constants });
    debugLog(
      debug,
      'log',
      engine.t(
        '[ {{SuiteCoreStringKey.Common_Connected}} ] {{SuiteCoreStringKey.Common_MongoDB}}',
      ),
    );

    debugLog(
      debug,
      'log',
      engine.t(
        '[ {{SuiteCoreStringKey.Common_Loading}} ] {{SuiteCoreStringKey.Common_Schemas}}',
      ),
    );
    this._schemaMap = this._schemaMapFactory(this.db.connection);
    // Register all base models in ModelRegistry for extensibility
    if (this._schemaMap) {
      Object.values(this._schemaMap).forEach((schema) => {
        ModelRegistry.instance.register({
          modelName: schema.modelName,
          schema: schema.schema,
          model: schema.model,
          collection: schema.collection,
          discriminators: schema.discriminators,
        });
      });
    }

    if (debug) {
      (
        Object.values(this._schemaMap) as ISchema<TID, BaseDocument<any, TID>>[]
      ).forEach((schema) => {
        console.log(
          engine.t(
            `[ {{SuiteCoreStringKey.Common_Loaded}} ] {{SuiteCoreStringKey.Common_Schema}} '${schema.modelName.replace(
              /[\r\n]/g,
              '',
            )}'`,
          ),
        );
      });
    }

    if (!this._db.connection.db) {
      console.error(
        engine.translateStringKey(
          SuiteCoreStringKey.Admin_Error_FailedToSetTransactionTimeout,
        ),
      );
    } else {
      const command = {
        ...(this._environment.mongo.setParameterSupported
          ? { setParameter: 1 }
          : {}),
        ...(this._environment.mongo.useTransactions &&
        this._environment.mongo.transactionLifetimeLimitSecondsSupported
          ? {
              transactionLifetimeLimitSeconds:
                this._environment.mongo.transactionTimeout,
            }
          : {}),
        ...(this._environment.mongo.useTransactions &&
        this._environment.mongo.maxTransactionLockRequestTimeoutMillisSupported
          ? {
              maxTransactionLockRequestTimeoutMillis:
                this._environment.mongo.transactionLockRequestTimeout,
            }
          : {}),
      };
      if (Object.keys(command).length > 0) {
        await this._db.connection.db
          .admin()
          .command(command)
          .catch(() => undefined);
      }
      debugLog(
        debug,
        'log',
        engine.translateStringKey(
          SuiteCoreStringKey.Admin_SetTransactionTimeoutSuccessfully,
        ),
      );
    }
  }

  /**
   * Disconnect from database.
   * Extracted from BaseApplication.disconnectDatabase.
   * @inheritdoc
   */
  public async disconnect(): Promise<void> {
    const debug = this._environment.debug;
    if (this._db && mongoose.connection.readyState !== 0) {
      await this._db.disconnect();
    }
    const engine = getSuiteCoreI18nEngine({ constants: this._constants });
    this._db = undefined;
    debugLog(
      debug,
      'log',
      `[ ${engine.translateStringKey(
        SuiteCoreStringKey.Common_Disconnected,
      )} ] ${engine.translateStringKey(SuiteCoreStringKey.Common_MongoDB)}`,
    );
  }

  /**
   * Whether the store is currently connected and ready for operations.
   * @inheritdoc
   */
  public isConnected(): boolean {
    return mongoose.connection.readyState === 1;
  }

  /**
   * Retrieve a model/collection handle by name.
   * Delegates to ModelRegistry.
   * @inheritdoc
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public getModel<T extends BaseDocument<any, TID>>(
    modelName: string,
  ): Model<T> {
    return ModelRegistry.instance.get<any, T>(modelName).model;
  }

  /**
   * Set up an in-memory MongoDB instance for development.
   * Extracted from BaseApplication.setupDevDatabase.
   * @inheritdoc
   */
  public async setupDevStore(): Promise<string> {
    this._devDatabase = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await this._devDatabase.waitUntilRunning();
    const mongoUri =
      this._devDatabase.getUri(this._environment.devDatabase) +
      '&maxPoolSize=20&minPoolSize=4';
    this._environment.setEnvironment('mongo.uri', mongoUri);
    debugLog(
      this._environment.debug,
      'log',
      `MongoDB Memory Server with transactions: ${mongoUri}`,
    );
    return mongoUri;
  }

  /**
   * Initialize the development database with default data.
   * Extracted from BaseApplication.initializeDevDatabase.
   * @inheritdoc
   */
  public async initializeDevStore<TResult = TInitResults>(
    app: IApplication<TID>,
  ): Promise<TResult> {
    const engine = getSuiteCoreI18nEngine({ constants: this._constants });
    debugLog(
      this._environment.debug,
      'log',
      `${engine.translateStringKey(
        SuiteCoreStringKey.Admin_StartingDatabaseInitialization,
      )}: ${engine.translateStringKey(
        SuiteCoreStringKey.Admin_TransactionsEnabledDisabledTemplate,
        {
          STATE: this._environment.mongo.useTransactions
            ? engine.translateStringKey(SuiteCoreStringKey.Common_Enabled)
            : engine.translateStringKey(SuiteCoreStringKey.Common_Disabled),
        },
      )}`,
    );
    let initTimeout: NodeJS.Timeout | undefined;
    const initTimeoutMs = 300000;

    const accountDataResult: IFailableResult<TInitResults> = await Promise.race(
      [
        this._databaseInitFunction(app as unknown as IMongoApplication<TID>),
        new Promise<never>((_, reject) => {
          initTimeout = setTimeout(() => {
            const logMsg = engine.translateStringKey(
              SuiteCoreStringKey.Admin_Error_FailedToInitializeUserDatabaseTimeoutTemplate,
              { timeMs: initTimeoutMs.toString() },
            );
            console.error(logMsg);
            reject(new Error(logMsg));
          }, initTimeoutMs);
        }),
      ],
    );
    if (initTimeout) clearTimeout(initTimeout);

    if (accountDataResult.success && accountDataResult.data) {
      if (this._environment.detailedDebug) {
        const initHash = this._initResultHashFunction(accountDataResult.data);
        debugLog(
          true,
          'log',
          engine.translateStringKey(
            SuiteCoreStringKey.Admin_DatabaseInitializedWithOptionsHashTemplate,
            { hash: initHash },
          ),
        );
      }
      return accountDataResult.data as unknown as TResult;
    } else {
      if (this._environment.detailedDebug && accountDataResult.error) {
        debugLog(true, 'log', accountDataResult.error);
      }
      throw new TranslatableSuiteError(
        SuiteCoreStringKey.Admin_Error_FailedToInitializeUserDatabase,
      );
    }
  }
}
