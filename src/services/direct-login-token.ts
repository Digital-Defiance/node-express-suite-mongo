/**
 * @fileoverview Service for managing direct login token usage and preventing token reuse.
 * Tracks used tokens in the database to ensure one-time use security.
 * @module services/direct-login-token
 */

import { ClientSession } from '@digitaldefiance/mongoose-types';
import {
  DirectTokenUsedError,
  FailedToUseDirectTokenError,
  IUsedDirectLoginTokenBase,
} from '@digitaldefiance/suite-core-lib';
import { BaseModelName } from '../enumerations/base-model-name';
import { IMongoApplication } from '../interfaces/mongo-application';
import { ModelRegistry } from '../model-registry';
import { withMongoTransaction } from '../utils/mongo-transaction';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Service for managing direct login token usage.
 * Ensures tokens can only be used once by tracking them in the database.
 */
export abstract class DirectLoginTokenService {
  /**
   * Marks a direct login token as used in the database.
   * Prevents token reuse by checking for existing usage and creating a new record.
   * @template TID Platform-specific ID type
   * @param app Application instance with database connection
   * @param userId User ID associated with the token
   * @param token Direct login token to mark as used
   * @param session Optional MongoDB session for transaction support
   * @returns Promise that resolves when token is successfully marked as used
   * @throws {DirectTokenUsedError} If token has already been used
   * @throws {FailedToUseDirectTokenError} If token creation fails
   */
  public static async useToken<TID extends PlatformID = Buffer>(
    app: IMongoApplication<TID>,
    userId: TID,
    token: string,
    session?: ClientSession,
  ): Promise<void> {
    return withMongoTransaction(
      app.db.connection,
      app.environment.mongo.useTransactions,
      session,
      async (sess) => {
        const UsedDirectLoginTokenModel = ModelRegistry.instance.get<
          IUsedDirectLoginTokenBase<TID>,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          any
        >(BaseModelName.UsedDirectLoginToken).model;
        const tokenExists = await UsedDirectLoginTokenModel.exists({
          userId,
          token,
        }).session(sess ?? null);
        if (tokenExists) {
          throw new DirectTokenUsedError();
        }
        try {
          const newTokens = await UsedDirectLoginTokenModel.create(
            [{ userId, token }],
            {
              session: sess,
            },
          );
          if (newTokens.length !== 1) {
            throw new FailedToUseDirectTokenError();
          }
        } catch (err) {
          // re-throw FailedToUseDirectTokenError
          if (err instanceof FailedToUseDirectTokenError) {
            throw err;
          }
          // throw FailedToUseDirectTokenError on duplicate key error or other errors
          throw new FailedToUseDirectTokenError();
        }
      },
      {
        timeoutMs: app.environment.mongo.transactionTimeout,
      },
    );
  }
}
