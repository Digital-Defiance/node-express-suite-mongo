/**
 * @fileoverview Mongoose-specific base service extending the database-agnostic BaseService.
 * Constrains TApplication to IMongoApplication so subclasses get type-safe
 * access to .db, .getModel(), and .environment.mongo.
 * @module services/mongo-base
 */

import { IMongoApplication } from '../interfaces/mongo-application';
import { BaseService } from '@digitaldefiance/node-express-suite';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Mongoose-specific base service.
 * Extends BaseService with TApplication constrained to IMongoApplication.
 *
 * Use this for services that need Mongoose-specific access (application.db,
 * application.getModel, application.environment.mongo). Services that are
 * database-agnostic should extend BaseService directly.
 *
 * @template TID - Platform ID type (defaults to Buffer)
 * @template TApplication - Must extend IMongoApplication
 */
export class MongoBaseService<
  TID extends PlatformID = Buffer,
  TApplication extends IMongoApplication<TID> = IMongoApplication<TID>,
> extends BaseService<TID, TApplication> {
  constructor(application: TApplication) {
    super(application);
  }
}
