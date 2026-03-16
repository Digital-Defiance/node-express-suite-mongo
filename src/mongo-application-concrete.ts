/**
 * @fileoverview Concrete implementation of the Application class for testing and development.
 * Uses the new plugin-based architecture with MongoDatabasePlugin.
 * @module mongo-application-concrete
 */

import type { PlatformID } from '@digitaldefiance/node-ecies-lib';
import {
  Application,
  Environment,
  LocalhostConstants,
  AppRouter,
  BaseRouter,
  ServiceKeys,
  DummyEmailService,
} from '@digitaldefiance/node-express-suite';
import type { IConstants } from '@digitaldefiance/node-express-suite';
import type { IMongoApplication } from './interfaces/mongo-application';
import { ApiRouter } from './routers/api';
import { getSchemaMap } from './schemas';
import { DatabaseInitializationService } from './services';
import { MongoDatabasePlugin } from './plugins/mongo-database-plugin';

/**
 * Concrete implementation of the Application class for testing and development purposes.
 * Provides a ready-to-use application instance with default configuration,
 * MongoDatabasePlugin, and dummy email service.
 *
 * @template TID - Platform ID type (Buffer, ObjectId, etc.)
 */
export class MongoApplicationConcrete<
  TID extends PlatformID = Buffer,
> extends Application<TID, Environment<TID>, IConstants, AppRouter<TID>> {
  /**
   * The Mongo database plugin for accessing Mongoose-specific features.
   */
  public readonly mongoPlugin: MongoDatabasePlugin<
    TID,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any,
    IConstants
  >;

  /**
   * Creates a new concrete application instance.
   *
   * @param environment - Application environment configuration
   * @param constants - Application constants (defaults to LocalhostConstants)
   */
  constructor(
    environment: Environment<TID>,
    constants: IConstants = LocalhostConstants,
  ) {
    super(
      environment,
      (app) =>
        new ApiRouter(
          app as unknown as IMongoApplication<TID>,
        ) as unknown as BaseRouter<TID>,
      undefined,
      constants,
      (apiRouter) => new AppRouter(apiRouter) as AppRouter<TID>,
      undefined,
    );

    this.mongoPlugin = new MongoDatabasePlugin({
      schemaMapFactory: getSchemaMap,
      databaseInitFunction: DatabaseInitializationService.initUserDb.bind(
        DatabaseInitializationService,
      ),
      initResultHashFunction:
        DatabaseInitializationService.serverInitResultHash.bind(
          DatabaseInitializationService,
        ),
      environment,
      constants,
    });

    this.useDatabasePlugin(this.mongoPlugin);

    const emailService = new DummyEmailService<TID, typeof this>(this);
    this.services.register(ServiceKeys.EMAIL, () => emailService);
  }
}
