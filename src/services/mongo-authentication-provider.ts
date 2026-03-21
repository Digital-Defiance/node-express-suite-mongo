/**
 * @fileoverview Mongoose-backed implementation of IAuthenticationProvider.
 * Delegates user lookup, role resolution, and credential verification
 * to the existing Mongoose models and services.
 * @module services/mongo-authentication-provider
 */

import type { SecureString } from '@digitaldefiance/ecies-lib';
import { ClientSession } from '@digitaldefiance/mongoose-types';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';
import { AccountStatus, ITokenUser } from '@digitaldefiance/suite-core-lib';
import type { UserDocument } from '../documents/user';
import { BaseModelName } from '../enumerations/base-model-name';
import type {
  IAuthenticatedUser,
  IAuthenticationProvider,
  ICryptoAuthResult,
} from '@digitaldefiance/node-express-suite';
import type { IMongoApplication } from '../interfaces/mongo-application';
import { ModelRegistry } from '../model-registry';
import { JwtService } from './jwt';
import { RequestUserService } from './request-user';
import { RoleService } from './role';
import { withMongoTransaction } from '../utils/mongo-transaction';
import type { IRequestUserDTO } from '@digitaldefiance/suite-core-lib';
import { ServiceKeys } from '@digitaldefiance/node-express-suite';

/**
 * Mongoose-backed authentication provider.
 * Uses ModelRegistry, JwtService, RoleService, and UserService
 * to implement the storage-agnostic IAuthenticationProvider interface.
 */
export class MongoAuthenticationProvider<
  TID extends PlatformID = Buffer,
  TLanguage extends string = string,
> implements IAuthenticationProvider<TID, TLanguage> {
  constructor(private readonly application: IMongoApplication<TID>) {}

  async findUserById(
    userId: string,
  ): Promise<IAuthenticatedUser<TLanguage, TID> | null> {
    const UserModel = ModelRegistry.instance.getTypedModel<
      UserDocument<TLanguage, TID>
    >(BaseModelName.User);

    const userDoc = await UserModel.findById(userId).select('-password').exec();

    if (!userDoc) return null;

    return {
      id: String(userDoc._id),
      accountStatus: userDoc.accountStatus,
      email: userDoc.email,
      siteLanguage: userDoc.siteLanguage,
      timezone: userDoc.timezone,
      lastLogin: userDoc.lastLogin?.toString(),
    };
  }

  async buildRequestUserDTO(userId: string): Promise<IRequestUserDTO | null> {
    const UserModel = ModelRegistry.instance.getTypedModel<
      UserDocument<TLanguage, TID>
    >(BaseModelName.User);

    return await withMongoTransaction<IRequestUserDTO | null>(
      this.application.db.connection,
      this.application.environment.mongo.useTransactions as boolean,
      undefined,
      async (_sess: ClientSession | undefined) => {
        const sess = _sess;
        const userDoc = await UserModel.findById(userId)
          .select('-password')
          .session(sess ?? null)
          .exec();

        if (!userDoc || userDoc.accountStatus !== AccountStatus.Active) {
          return null;
        }

        const roleService = new RoleService<TID>(
          this
            .application as unknown as import('@digitaldefiance/node-express-suite').IApplication<TID>,
        );
        const roles = await roleService.getUserRoles(userDoc._id as TID, sess);
        const tokenRoles = roleService.rolesToTokenRoles(roles);
        return RequestUserService.makeRequestUserDTO(
          userDoc,
          tokenRoles as import('@digitaldefiance/suite-core-lib').ITokenRole<
            TID,
            Date
          >[],
        );
      },
      {
        timeoutMs: this.application.environment.mongo
          .transactionTimeout as number,
      },
    );
  }

  async verifyToken<TTokenUser extends ITokenUser = ITokenUser>(
    token: string,
  ): Promise<TTokenUser | null> {
    const jwtService = new JwtService<TID>(this.application);
    return (await jwtService.verifyToken(token)) as TTokenUser | null;
  }

  async authenticateWithMnemonic(
    email: string,
    mnemonic: SecureString,
  ): Promise<ICryptoAuthResult<TID>> {
    const userService = this.application.services.get(ServiceKeys.USER) as {
      loginWithMnemonic: (
        email: string,
        mnemonic: SecureString,
        session?: ClientSession,
      ) => Promise<{
        userDoc: UserDocument;
        userMember: import('@digitaldefiance/node-ecies-lib').Member<TID>;
      }>;
    };

    const result = await withMongoTransaction(
      this.application.db.connection,
      this.application.environment.mongo.useTransactions as boolean,
      undefined,
      async (_sess: ClientSession | undefined) => {
        const sess = _sess;
        return await userService.loginWithMnemonic(email, mnemonic, sess);
      },
      {
        timeoutMs: this.application.environment.mongo
          .transactionTimeout as number,
      },
    );

    return {
      userId: String(result.userDoc._id),
      userMember: result.userMember,
    };
  }

  async authenticateWithPassword(
    email: string,
    password: string,
  ): Promise<ICryptoAuthResult<TID>> {
    const userService = this.application.services.get(ServiceKeys.USER) as {
      loginWithPassword: (
        email: string,
        password: string,
        session?: ClientSession,
      ) => Promise<{
        userDoc: UserDocument;
        userMember: import('@digitaldefiance/node-ecies-lib').Member<TID>;
      }>;
    };

    const result = await withMongoTransaction(
      this.application.db.connection,
      this.application.environment.mongo.useTransactions as boolean,
      undefined,
      async (_sess: ClientSession | undefined) => {
        const sess = _sess;
        return await userService.loginWithPassword(email, password, sess);
      },
      {
        timeoutMs: this.application.environment.mongo
          .transactionTimeout as number,
      },
    );

    return {
      userId: String(result.userDoc._id),
      userMember: result.userMember,
    };
  }
}
