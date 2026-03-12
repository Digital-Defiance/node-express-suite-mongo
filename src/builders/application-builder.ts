/**
 * @fileoverview Application builder for fluent application construction.
 * Provides builder pattern for creating Application instances with MongoDatabasePlugin.
 * @module builders/application-builder
 */

import mongoose from '@digitaldefiance/mongoose-types';
import {
  IFailableResult,
  SuiteCoreStringKey,
  TranslatableSuiteError,
} from '@digitaldefiance/suite-core-lib';
import { HelmetOptions } from 'helmet';
import {
  Application,
  Environment,
  IApplication,
  ICSPConfig,
  IConstants,
  IFlexibleCSP,
  initMiddleware,
  AppRouter,
  BaseRouter,
} from '@digitaldefiance/node-express-suite';
import { BaseDocument } from '../documents';
import { IMongoApplication } from '../interfaces/mongo-application';
import { IServerInitResult } from '../interfaces/server-init-result';
import { MongoDatabasePlugin } from '../plugins/mongo-database-plugin';
import { SchemaMap } from '../types';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Builder for constructing Application instances with MongoDatabasePlugin using a fluent API.
 */
export class ApplicationBuilder<
  TID extends PlatformID,
  TModelDocs extends Record<string, BaseDocument<never, TID>>,
  TInitResults extends IServerInitResult<TID>,
  TConstants extends IConstants = IConstants,
> {
  private environment?: Environment<TID>;
  private apiRouterFactory?: (app: IApplication<TID>) => BaseRouter<TID>;
  private appRouterFactory?: (apiRouter: BaseRouter<TID>) => AppRouter<TID>;
  private schemaMapFactory?: (
    connection: mongoose.Connection,
  ) => SchemaMap<TID, TModelDocs>;
  private databaseInitFunction?: (
    app: IMongoApplication<TID>,
  ) => Promise<IFailableResult<TInitResults>>;
  private initResultHashFunction?: (results: TInitResults) => string;
  private cspConfig?: ICSPConfig | HelmetOptions | IFlexibleCSP;
  private constants?: TConstants;
  private customInitMiddleware?: typeof initMiddleware;

  withEnvironment(env: Environment<TID>): this {
    this.environment = env;
    return this;
  }

  withApiRouter(factory: (app: IApplication<TID>) => BaseRouter<TID>): this {
    this.apiRouterFactory = factory;
    return this;
  }

  withAppRouter(factory: (apiRouter: BaseRouter<TID>) => AppRouter<TID>): this {
    this.appRouterFactory = factory;
    return this;
  }

  withSchemaMap(
    factory: (connection: mongoose.Connection) => SchemaMap<TID, TModelDocs>,
  ): this {
    this.schemaMapFactory = factory;
    return this;
  }

  withDatabaseInit(
    initFn: (
      app: IMongoApplication<TID>,
    ) => Promise<IFailableResult<TInitResults>>,
    hashFn: (results: TInitResults) => string,
  ): this {
    this.databaseInitFunction = initFn;
    this.initResultHashFunction = hashFn;
    return this;
  }

  withCSP(config: ICSPConfig | HelmetOptions | IFlexibleCSP): this {
    this.cspConfig = config;
    return this;
  }

  withConstants(constants: TConstants): this {
    this.constants = constants;
    return this;
  }

  withMiddleware(middleware: typeof initMiddleware): this {
    this.customInitMiddleware = middleware;
    return this;
  }

  build(): Application<TID, Environment<TID>, TConstants, AppRouter<TID>> {
    if (!this.environment)
      throw new TranslatableSuiteError(
        SuiteCoreStringKey.Error_EnvironmentIsRequired,
      );
    if (!this.apiRouterFactory)
      throw new TranslatableSuiteError(
        SuiteCoreStringKey.Error_ApiRouterFactoryIsRequired,
      );
    if (!this.schemaMapFactory)
      throw new TranslatableSuiteError(
        SuiteCoreStringKey.Error_SchemaMapFactoryIsRequired,
      );
    if (!this.databaseInitFunction)
      throw new TranslatableSuiteError(
        SuiteCoreStringKey.Error_DatabaseInitFunctionIsRequired,
      );
    if (!this.initResultHashFunction)
      throw new TranslatableSuiteError(
        SuiteCoreStringKey.Error_InitResultHashFunctionIsRequired,
      );

    const app = new Application<
      TID,
      Environment<TID>,
      TConstants,
      AppRouter<TID>
    >(
      this.environment,
      this.apiRouterFactory,
      this.cspConfig,
      this.constants,
      this.appRouterFactory,
      this.customInitMiddleware,
    );

    const mongoPlugin = new MongoDatabasePlugin<
      TID,
      TModelDocs,
      TInitResults,
      TConstants
    >({
      schemaMapFactory: this.schemaMapFactory,
      databaseInitFunction: this.databaseInitFunction,
      initResultHashFunction: this.initResultHashFunction,
      environment: this.environment,
      constants: this.constants,
    });

    app.useDatabasePlugin(mongoPlugin);

    return app;
  }
}
