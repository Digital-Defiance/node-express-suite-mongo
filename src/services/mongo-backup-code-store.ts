/**
 * @fileoverview Mongoose/MongoDB implementation of IBackupCodeStore.
 * Provides backward-compatible storage for the BackupCodeService using
 * Mongoose UserDocument and ModelRegistry.
 * @module services/mongo-backup-code-store
 */

import type { MemberType } from '@digitaldefiance/ecies-lib';
import type { ClientSession } from '@digitaldefiance/mongoose-types';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';
import type { ITokenRole } from '@digitaldefiance/suite-core-lib';
import { BaseModelName } from '../enumerations/base-model-name';
import type {
  IBackupCodeStore,
  IBackupCodeUserRecord,
  IBackupCodeUserUpdate,
} from '@digitaldefiance/node-express-suite';
import type { IMongoApplication } from '../interfaces/mongo-application';
import { ModelRegistry } from '../model-registry';
import type { UserDocument } from '../documents';
import { RoleService } from './role';

/**
 * Mongoose-backed implementation of IBackupCodeStore.
 *
 * Delegates all persistence to the Mongoose UserModel and uses
 * RoleService for member type resolution. This is the default store
 * used when no custom store is provided to BackupCodeService.
 *
 * @template TID - Platform ID type
 * @template TDate - Date type
 * @template TTokenRole - Token role interface type
 */
export class MongoBackupCodeStore<
  TID extends PlatformID = Buffer,
  TDate extends Date = Date,
  TTokenRole extends ITokenRole<TID, TDate> = ITokenRole<TID, TDate>,
> implements IBackupCodeStore<TID> {
  private readonly application: IMongoApplication<TID>;
  private readonly roleService: RoleService<TID, TDate, TTokenRole>;
  private readonly session?: ClientSession;

  constructor(
    application: IMongoApplication<TID>,
    roleService: RoleService<TID, TDate, TTokenRole>,
    session?: ClientSession,
  ) {
    this.application = application;
    this.roleService = roleService;
    this.session = session;
  }

  /**
   * Create a new MongoBackupCodeStore bound to a specific session.
   * Useful for transactional operations.
   */
  public withSession(
    session: ClientSession,
  ): MongoBackupCodeStore<TID, TDate, TTokenRole> {
    return new MongoBackupCodeStore(
      this.application,
      this.roleService,
      session,
    );
  }

  public async getUserRecord(
    userId: TID,
  ): Promise<IBackupCodeUserRecord<TID> | null> {
    const UserModel = ModelRegistry.instance.getTypedModel<
      UserDocument<string, TID>
    >(BaseModelName.User);
    const doc = await UserModel.findById(userId)
      .session(this.session ?? null)
      .exec();
    if (!doc) return null;

    return {
      _id: doc._id,
      username: doc.username,
      email: doc.email,
      publicKey: doc.publicKey,
      backupCodes: doc.backupCodes ?? [],
      passwordWrappedPrivateKey: doc.passwordWrappedPrivateKey,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  public async updateUserRecord(
    userId: TID,
    updates: IBackupCodeUserUpdate,
  ): Promise<void> {
    const UserModel = ModelRegistry.instance.getTypedModel<
      UserDocument<string, TID>
    >(BaseModelName.User);

    const $set: Record<string, unknown> = {};
    if (updates.backupCodes !== undefined) {
      $set['backupCodes'] = updates.backupCodes;
    }
    if (updates.passwordWrappedPrivateKey !== undefined) {
      $set['passwordWrappedPrivateKey'] = updates.passwordWrappedPrivateKey;
    }

    if (Object.keys($set).length > 0) {
      await UserModel.updateOne(
        { _id: userId } as any,
        { $set },
        { session: this.session },
      );
    }
  }

  public async getMemberType(userId: TID): Promise<MemberType> {
    const UserModel = ModelRegistry.instance.getTypedModel<
      UserDocument<string, TID>
    >(BaseModelName.User);
    const doc = await UserModel.findById(userId)
      .session(this.session ?? null)
      .exec();
    if (!doc) {
      throw new Error(`User not found: ${userId}`);
    }
    return await this.roleService.getMemberType(doc, this.session);
  }

  public async fetchBatch(
    afterId?: string,
    limit = 500,
  ): Promise<Array<IBackupCodeUserRecord<TID>>> {
    const UserModel = ModelRegistry.instance.getTypedModel<
      UserDocument<string, TID>
    >(BaseModelName.User);

    const query: Record<string, unknown> = {};
    if (afterId) {
      query['_id'] = { $gt: afterId };
    }

    const docs = await UserModel.find(query as any)
      .sort({ _id: 1 } as any)
      .limit(limit)
      .session(this.session ?? null)
      .exec();

    return docs.map((doc) => ({
      _id: doc._id,
      username: doc.username,
      email: doc.email,
      publicKey: doc.publicKey,
      backupCodes: doc.backupCodes ?? [],
      passwordWrappedPrivateKey: doc.passwordWrappedPrivateKey,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }));
  }
}
