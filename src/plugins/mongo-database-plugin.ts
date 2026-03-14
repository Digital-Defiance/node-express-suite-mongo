/**
 * @fileoverview Mongoose/MongoDB database plugin.
 * Extracts all Mongo-specific database lifecycle
 * into a plugin that can be registered on any Application instance.
 * @module plugins/mongo-database-plugin
 */

import { Model } from '@digitaldefiance/mongoose-types';
import mongoose from '@digitaldefiance/mongoose-types';
import {
  Constants,
  IFailableResult,
  SuiteCoreStringKey,
  TranslatableSuiteError,
} from '@digitaldefiance/suite-core-lib';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';
import type { IDatabase } from '@digitaldefiance/suite-core-lib';
import type { IAuthenticationProvider } from '@digitaldefiance/node-express-suite';
import type { IApplication } from '@digitaldefiance/node-express-suite';
import type { IConstants } from '@digitaldefiance/node-express-suite';
import type { IDatabasePlugin } from '@digitaldefiance/node-express-suite';
import {
  Environment,
  createNoOpDatabase,
} from '@digitaldefiance/node-express-suite';
import { MongooseDatabase } from '../services/mongoose-database';
import type { BaseDocument } from '../documents/base';
import type { IDocumentStore } from '../interfaces/mongoose-document-store';
import type {
  IMongoApplication,
  IMongoTypedEnvironment,
} from '../interfaces/mongo-application';
import type { SchemaMap } from '../types';
import { MongooseDocumentStore } from '../services/mongoose-document-store';
import { MongoAuthenticationProvider } from '../services/mongo-authentication-provider';
import { DatabaseInitializationService } from '../services/database-initialization';

/**
 * Options for constructing a MongoDatabasePlugin.
 */
export interface MongoDatabasePluginOptions<
  TID extends PlatformID,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TModelDocs extends Record<string, BaseDocument<any, TID>>,
  TInitResults,
  TConstants extends IConstants = IConstants,
> {
  schemaMapFactory: (
    connection: mongoose.Connection,
  ) => SchemaMap<TID, TModelDocs>;
  databaseInitFunction: (
    application: IMongoApplication<TID>,
  ) => Promise<IFailableResult<TInitResults>>;
  initResultHashFunction: (initResults: TInitResults) => string;
  environment: Environment<TID>;
  constants?: TConstants;
}

/**
 * Mongoose/MongoDB database plugin.
 *
 * Wraps a MongooseDocumentStore and exposes Mongoose-specific accessors
 * (db, getModel, schemaMap, devDatabase) while conforming to the
 * IDatabasePlugin contract for pluggable database backends.
 *
 * @template TID - Platform ID type
 * @template TModelDocs - Record mapping model names to document types
 * @template TInitResults - Database initialization result type
 * @template TConstants - Application constants type
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class MongoDatabasePlugin<
  TID extends PlatformID,
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  TModelDocs extends Record<string, BaseDocument<any, TID>>,
  TInitResults,
  TConstants extends IConstants = IConstants,
> implements IDatabasePlugin<TID> {
  public readonly name = 'mongo-database';
  public readonly version = '1.0.0';

  private readonly _documentStore: IDocumentStore<TID, TModelDocs>;
  private readonly _environment: Environment<TID>;
  private _authProvider: MongoAuthenticationProvider<TID> | undefined;
  private _application: IApplication<TID> | undefined;
  private _lastInitResult: TInitResults | undefined;

  constructor(
    options: MongoDatabasePluginOptions<
      TID,
      TModelDocs,
      TInitResults,
      TConstants
    >,
  ) {
    const constants = options.constants ?? (Constants as TConstants);
    this._documentStore = new MongooseDocumentStore<
      TID,
      TModelDocs,
      TInitResults,
      TConstants
    >(
      options.schemaMapFactory,
      options.databaseInitFunction,
      options.initResultHashFunction,
      options.environment,
      constants,
    );
    this._environment = options.environment;
  }

  /**
   * Construct from an existing IDocumentStore instance.
   */
  static fromDocumentStore<
    TID extends PlatformID,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TModelDocs extends Record<string, BaseDocument<any, TID>>,
    TInitResults,
    TConstants extends IConstants = IConstants,
  >(
    documentStore: IDocumentStore<TID, TModelDocs>,
    environment: Environment<TID>,
  ): MongoDatabasePlugin<TID, TModelDocs, TInitResults, TConstants> {
    const plugin = Object.create(
      MongoDatabasePlugin.prototype,
    ) as MongoDatabasePlugin<TID, TModelDocs, TInitResults, TConstants>;
    Object.defineProperty(plugin, '_documentStore', {
      value: documentStore,
      writable: false,
    });
    Object.defineProperty(plugin, '_environment', {
      value: environment,
      writable: false,
    });
    Object.defineProperty(plugin, 'name', {
      value: 'mongo-database',
      writable: false,
    });
    Object.defineProperty(plugin, 'version', {
      value: '1.0.0',
      writable: false,
    });
    return plugin;
  }

  // ── IDatabasePlugin contract ──

  /**
   * The IDatabase instance backed by the Mongoose connection.
   * Returns a MongooseDatabase adapter that delegates to the real
   * Mongoose connection, enabling BaseService.withTransaction and
   * other IDatabase consumers to work correctly.
   */
  get database(): IDatabase {
    if (this._documentStore.isConnected()) {
      return new MongooseDatabase();
    }
    return createNoOpDatabase();
  }

  get authenticationProvider(): IAuthenticationProvider<TID> | undefined {
    return this._authProvider;
  }

  async connect(uri?: string): Promise<void> {
    // Handle dev database setup
    if (this._environment.devDatabase && !this._documentStore.devDatabase) {
      if (this._documentStore.setupDevStore) {
        const devUri = await this._documentStore.setupDevStore();
        if (devUri) {
          uri = devUri;
        }
      }
    }

    const resolvedUri =
      uri ?? (this._environment.mongo?.['uri'] as string | undefined);
    await this._documentStore.connect(resolvedUri);
  }

  async disconnect(): Promise<void> {
    await this._documentStore.disconnect();
    if (this._documentStore.devDatabase) {
      await this._documentStore.devDatabase.stop();
    }
  }

  isConnected(): boolean {
    return this._documentStore.isConnected();
  }

  async setupDevStore(): Promise<string> {
    if (this._documentStore.setupDevStore) {
      const uri = await this._documentStore.setupDevStore();
      return uri ?? '';
    }
    return '';
  }

  async teardownDevStore(): Promise<void> {
    if (this._documentStore.devDatabase) {
      await this._documentStore.devDatabase.stop();
    }
  }

  async initializeDevStore(): Promise<TInitResults | undefined> {
    if (this._documentStore.initializeDevStore && this._application) {
      const result = await this._documentStore.initializeDevStore<TInitResults>(
        this._application,
      );
      DatabaseInitializationService.printServerInitResults(
        result as Parameters<
          typeof DatabaseInitializationService.printServerInitResults
        >[0],
        false,
      );
      this._lastInitResult = result;
      return result;
    }
    return undefined;
  }

  /**
   * Get the result of the last initializeDevStore call.
   * Available after start() completes in dev mode.
   */
  get lastInitResult(): TInitResults | undefined {
    return this._lastInitResult;
  }

  /**
   * Get the IMongoApplication adapter created during init().
   * This adapter delegates Mongo-specific accessors (db, getModel) to the plugin
   * and everything else to the real application. Use this when constructing
   * services that need IMongoApplication (e.g. UserService, RoleService).
   * Available after init() has been called.
   */
  get mongoApplication(): IMongoApplication<TID> | undefined {
    return this._application as IMongoApplication<TID> | undefined;
  }

  /**
   * Called by PluginManager during Application.start().
   * Wires up the Mongoose-backed authentication provider.
   */
  async init(app: IApplication<TID>): Promise<void> {
    // Wire up auth provider if the app exposes IMongoApplication-compatible interface
    // We create a lightweight adapter that satisfies IMongoApplication
    const mongoAppAdapter = this.createMongoAppAdapter(app);

    // Store the adapter (not the raw app) so that initializeDevStore
    // passes an IMongoApplication with getModel/db to the init function.
    this._application = mongoAppAdapter as unknown as IApplication<TID>;

    this._authProvider = new MongoAuthenticationProvider<TID>(mongoAppAdapter);

    // Set the auth provider on the application
    if ('authProvider' in app && app.authProvider === undefined) {
      (
        app as { authProvider: IAuthenticationProvider<TID> | undefined }
      ).authProvider = this._authProvider;
    }
  }

  async stop(): Promise<void> {
    await this.disconnect();
  }

  // ── Mongo-specific accessors ──

  /**
   * Get the Mongoose database instance.
   */
  get db(): typeof mongoose {
    if (this._documentStore instanceof MongooseDocumentStore) {
      return this._documentStore.db;
    }
    throw new TranslatableSuiteError(
      SuiteCoreStringKey.Admin_Error_DatabaseNotConnectedYet,
    );
  }

  /**
   * Get the schema map for all models.
   */
  get schemaMap(): SchemaMap<TID, TModelDocs> {
    const map = this._documentStore.schemaMap;
    if (!map) {
      throw new TranslatableSuiteError(
        SuiteCoreStringKey.Admin_Error_SchemaMapIsNotLoadedYet,
      );
    }
    return map as SchemaMap<TID, TModelDocs>;
  }

  /**
   * Get the in-memory MongoDB instance (if any).
   */
  get devDatabase(): MongoMemoryReplSet | undefined {
    return this._documentStore.devDatabase;
  }

  /**
   * Get the underlying document store.
   */
  get documentStore(): IDocumentStore<TID, TModelDocs> {
    return this._documentStore;
  }

  /**
   * Get a Mongoose model by name.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getModel<T extends BaseDocument<any, TID>>(modelName: string): Model<T>;
  getModel<U>(modelName: string): U | undefined;
  getModel<T>(modelName: string): T | undefined {
    return this._documentStore.getModel(modelName) as T | undefined;
  }

  /**
   * Creates a lightweight adapter that satisfies IMongoApplication
   * by delegating to the plugin for Mongo-specific accessors and
   * to the real app for everything else.
   */
  private createMongoAppAdapter(
    app: IApplication<TID>,
  ): IMongoApplication<TID> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const plugin = this;
    return {
      get environment() {
        return app.environment as IMongoTypedEnvironment<TID>;
      },
      get constants() {
        return app.constants;
      },
      get ready() {
        return app.ready;
      },
      get services() {
        return app.services;
      },
      get plugins() {
        return app.plugins;
      },
      get database() {
        return app.database;
      },
      get authProvider() {
        return app.authProvider;
      },
      start: () => app.start(),
      get db() {
        return plugin.db;
      },
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      getModel: <U extends BaseDocument<any, TID>>(modelName: string) =>
        plugin.getModel<U>(modelName),
    };
  }
}
