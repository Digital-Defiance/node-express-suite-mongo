/**
 * @fileoverview Mongoose-specific base service extending the database-agnostic BaseService.
 * Constrains TApplication to IMongoApplication so subclasses get type-safe
 * access to .db, .getModel(), and .environment.mongo.
 * @module services/mongo-base
 */

import { IMongoApplication } from '../interfaces/mongo-application';
import {
  BaseService,
  type TransactionCallback,
} from '@digitaldefiance/node-express-suite';
import {
  unwrapNativeSession,
  withNativeSession,
} from './mongoose-session-adapter';
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

  /**
   * Same session rules as BaseService.withTransaction, but callbacks (and a
   * caller-supplied session) are unwrapped to the native mongodb session that
   * mongoose operations require.
   */
  public override async withTransaction<TResult>(
    callback: TransactionCallback<TResult>,
    session?: unknown,
    options?: { timeoutMs?: number },
    ...args: unknown[]
  ): Promise<TResult> {
    return await super.withTransaction(
      withNativeSession(callback),
      unwrapNativeSession(session),
      options,
      ...args,
    );
  }
}
