/**
 * @fileoverview Mongo-specific base controller extending the database-agnostic BaseController.
 * Restores Mongoose-specific functionality: isMongoApplication(), mongoApplication,
 * transactionManager, validateAndFetchRequestUser(), and Mongoose-specific withTransaction().
 * @module controllers/mongo-base
 */

import { ClientSession } from '@digitaldefiance/mongoose-types';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';
import {
  getSuiteCoreTranslation,
  SuiteCoreStringKey,
  UserNotFoundError,
} from '@digitaldefiance/suite-core-lib';
import { HandleableError } from '@digitaldefiance/i18n-lib';
import type { Request } from 'express';
import {
  BaseController,
  type ApiResponse,
  type TransactionCallback,
} from '@digitaldefiance/node-express-suite';
import type { IApplication } from '@digitaldefiance/node-express-suite';
import type { IMongoApplication } from '../interfaces/mongo-application';
import type { UserDocument } from '../documents/user';
import { BaseModelName } from '../enumerations/base-model-name';
import { ModelRegistry } from '../model-registry';
import { TransactionManager } from '../transactions';
import {
  withMongoTransaction,
  type MongoTransactionOptions,
} from '../utils/mongo-transaction';

/**
 * Abstract Mongo-specific base controller.
 * Extends the database-agnostic BaseController with Mongoose transaction management,
 * Mongo application type guards, and user validation via Mongoose models.
 *
 * @template T API response type
 * @template THandler Handler object type
 * @template TLanguage Language code type
 * @template TID Platform ID type
 * @template TApplication Application interface type
 */
export abstract class MongoBaseController<
  T extends ApiResponse,
  THandler extends object,
  TLanguage extends string,
  TID extends PlatformID = Buffer,
  TApplication extends IApplication<TID> = IApplication<TID>,
> extends BaseController<T, THandler, TLanguage, TID, TApplication> {
  protected transactionManager: TransactionManager | undefined;

  public constructor(application: TApplication) {
    super(application);
    // Only create TransactionManager when the app has a Mongoose connection
    const mongoApp = this.mongoApplication;
    if (mongoApp) {
      this.transactionManager = new TransactionManager(
        mongoApp.db.connection,
        mongoApp.environment.mongo.useTransactions,
      );
    }
  }

  /**
   * Type guard: does the application expose a Mongoose connection?
   * Uses try/catch to safely handle cases where the db getter throws
   * (e.g. when no MongoDatabasePlugin is registered).
   */
  protected isMongoApplication(): boolean {
    try {
      return (
        'db' in this.application &&
        (this.application as unknown as IMongoApplication<TID>).db !== undefined
      );
    } catch {
      return false;
    }
  }

  /**
   * Returns the application typed as IMongoApplication, or undefined if not Mongo-backed.
   */
  protected get mongoApplication(): IMongoApplication<TID> | undefined {
    if (this.isMongoApplication()) {
      return this.application as unknown as IMongoApplication<TID>;
    }
    return undefined;
  }

  /**
   * Validates the request has a user and fetches the full UserDocument from Mongoose.
   * @param req The Express request object
   * @returns The UserDocument for the authenticated user
   * @throws Error if the application is not Mongo-backed
   * @throws HandleableError if no user is on the request
   * @throws UserNotFoundError if the user is not found in the database
   */
  protected async validateAndFetchRequestUser(
    req: Request,
  ): Promise<UserDocument<TLanguage, TID>> {
    if (!this.isMongoApplication()) {
      throw new Error(
        'validateAndFetchRequestUser requires a Mongo-backed application. ' +
          'Override this method for non-Mongo storage backends.',
      );
    }
    const UserModel = ModelRegistry.instance.getTypedModel<
      UserDocument<TLanguage, TID>
    >(BaseModelName.User);
    if (!req.user) {
      throw new HandleableError(
        new Error(
          getSuiteCoreTranslation(
            SuiteCoreStringKey.Common_Unauthorized,
            undefined,
            undefined,
            { constants: this.application.constants },
          ),
        ),
        {
          statusCode: 401,
        },
      );
    }
    const user = await UserModel.findById(req.user.id);
    if (!user) {
      throw new UserNotFoundError();
    }
    return user;
  }

  /**
   * Wraps a callback in a Mongoose transaction with full retry/timeout support.
   * Falls back to IDatabase.withTransaction or direct execution when Mongoose is unavailable.
   */
  public async withTransaction<TResult>(
    callback: TransactionCallback<TResult>,
    session?: ClientSession,
    options?: MongoTransactionOptions<TID>,
    ...args: any
  ) {
    // Mongoose path — full retry/timeout support
    if (this.isMongoApplication()) {
      const mongoApp = this.mongoApplication!;
      return await withMongoTransaction<TResult, TID>(
        mongoApp.db.connection,
        mongoApp.environment.mongo.useTransactions,
        session,
        callback,
        { application: this.application, ...options },
        ...args,
      );
    }

    // IDatabase path — delegate to IDatabase.withTransaction
    const db = this.application.database;
    if (db) {
      return await db.withTransaction(async () => {
        return await callback(session, ...args);
      });
    }

    // No database — run callback directly without transaction
    return await callback(session, ...args);
  }
}
