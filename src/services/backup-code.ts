/**
 * @fileoverview Backup code service for secure account recovery.
 * Implements v1.0.0 backup code scheme with Argon2id KDF and HKDF-SHA256 checksums.
 *
 * Storage-agnostic: accepts an optional {@link IBackupCodeStore} for persistence.
 * When no store is provided, falls back to direct UserDocument manipulation
 * (backward-compatible Mongoose path).
 *
 * @module services/backup-code
 */

import {
  EmailString,
  MemberType,
  SecureBuffer,
  SecureString,
} from '@digitaldefiance/ecies-lib';
import { ClientSession } from '@digitaldefiance/mongoose-types';
import {
  Member as BackendMember,
  ECIESService,
  PlatformID,
} from '@digitaldefiance/node-ecies-lib';
import {
  IBackupCode,
  InvalidBackupCodeError,
  ITokenRole,
} from '@digitaldefiance/suite-core-lib';
import { timingSafeEqual } from 'crypto';
import {
  BackupCode,
  LocalhostConstants as AppConstants,
  BaseService,
  KeyWrappingService,
  SymmetricService,
  SystemUserService,
} from '@digitaldefiance/node-express-suite';
import type {
  IApplication,
  IBackupCodeStore,
  IBackupCodeUserRecord,
} from '@digitaldefiance/node-express-suite';
import { UserDocument } from '../documents';
import { InvalidBackupCodeVersionError } from '../errors/invalid-backup-code-version';
import { RoleService } from './role';

/**
 * Service for backup code generation, validation, and key recovery.
 * Implements secure backup code scheme with constant-time validation and key wrapping.
 *
 * Storage is abstracted via {@link IBackupCodeStore}. When a store is provided,
 * all persistence goes through the store interface. When omitted, the service
 * falls back to direct UserDocument manipulation for backward compatibility
 * with existing Mongoose-based consumers.
 *
 * @template TID - Platform ID type (defaults to Buffer)
 * @template TDate - Date type (defaults to Date)
 * @template TTokenRole - Token role interface type
 * @template TApplication - Application interface type
 * @extends {BaseService<TID>}
 */
export class BackupCodeService<
  TID extends PlatformID = Buffer,
  TDate extends Date = Date,
  TTokenRole extends ITokenRole<TID, TDate> = ITokenRole<TID, TDate>,
  TApplication extends IApplication<TID> = IApplication<TID>,
> extends BaseService<TID> {
  private readonly eciesService: ECIESService<TID>;
  private systemUser?: BackendMember<TID>;
  private readonly keyWrappingService: KeyWrappingService;
  private readonly roleService: RoleService<TID, TDate, TTokenRole>;
  private readonly store?: IBackupCodeStore<TID>;

  /**
   * Construct a BackupCodeService.
   * @param application - The application instance
   * @param eciesService - ECIES cryptographic service
   * @param keyWrappingService - Key wrapping service for password-based key protection
   * @param roleService - Role service for member type resolution
   * @param store - Optional storage adapter. When omitted, falls back to direct
   *   UserDocument manipulation (Mongoose). Provide an IBackupCodeStore implementation
   *   for non-Mongoose backends (e.g. BrightDB).
   */
  constructor(
    application: TApplication,
    eciesService: ECIESService<TID>,
    keyWrappingService: KeyWrappingService,
    roleService: RoleService<TID, TDate, TTokenRole>,
    store?: IBackupCodeStore<TID>,
  ) {
    super(application);
    this.eciesService = eciesService;
    this.keyWrappingService = keyWrappingService;
    this.roleService = roleService;
    this.store = store;
  }

  /**
   * Get the lazily-initialized system user for key wrapping/unwrapping.
   */
  private getSystemUser(): BackendMember<TID> {
    if (!this.systemUser) {
      this.systemUser = SystemUserService.getSystemUser(
        this.application.environment,
        this.application.constants,
      ) as unknown as BackendMember<TID>;
    }
    return this.systemUser;
  }

  /**
   * Forcibly set the system user (for database initialization)
   * @param user
   */
  public setSystemUser(user: BackendMember<TID>): void {
    this.systemUser = user;
  }

  // ── Pure crypto operations (no storage dependency) ─────────────────────

  /**
   * v1: Consume (validate and remove) a backup code via constant-time checksum match.
   */
  public useBackupCodeV1(
    encryptedBackupCodes: Array<IBackupCode>,
    backupCode: string,
  ): { newCodesArray: Array<IBackupCode>; code: IBackupCode } {
    const normalizedCode = BackupCode.normalizeCode(backupCode);
    if (!AppConstants.BACKUP_CODES.NormalizedHexRegex.test(normalizedCode)) {
      throw new InvalidBackupCodeError();
    }
    const codeBytes = Buffer.from(normalizedCode, 'utf8');
    try {
      for (const code of encryptedBackupCodes) {
        if (code.version !== BackupCode.BackupCodeVersion) continue;
        const checksumSalt = Buffer.from(code.checksumSalt, 'hex');
        const expected = BackupCode.hkdfSha256(
          codeBytes,
          checksumSalt,
          Buffer.from('backup-checksum'),
          32,
        );
        if (
          code.checksum.length === expected.length * 2 &&
          timingSafeEqual(Buffer.from(code.checksum, 'hex'), expected)
        ) {
          const checksumHex = expected.toString('hex');
          return {
            newCodesArray: encryptedBackupCodes.filter(
              (c) => c.checksum !== checksumHex,
            ),
            code,
          };
        }
      }
      throw new InvalidBackupCodeError();
    } finally {
      codeBytes.fill(0);
    }
  }

  /**
   * Consume a backup code by first detecting the version and then dispatching to the appropriate handler.
   */
  public useBackupCode(
    encryptedBackupCodes: Array<IBackupCode>,
    backupCode: string,
  ): { newCodesArray: Array<IBackupCode>; code: IBackupCode } {
    const version = BackupCode.detectBackupCodeVersion(
      encryptedBackupCodes,
      backupCode,
    );
    switch (version) {
      case BackupCode.BackupCodeVersion:
        return this.useBackupCodeV1(
          encryptedBackupCodes.filter(
            (c) => c.version === BackupCode.BackupCodeVersion,
          ),
          backupCode,
        );
      default:
        throw new InvalidBackupCodeVersionError(version);
    }
  }

  // ── Storage-agnostic recovery ──────────────────────────────────────────

  /**
   * Recover a user's private key using a backup code.
   * Storage-agnostic: uses IBackupCodeStore when available, otherwise
   * falls back to the legacy UserDocument path.
   *
   * @param userOrId - Either a UserDocument (legacy) or a user ID (store-based)
   * @param backupCode - The plaintext backup code
   * @param newPassword - Optional new password to re-wrap the private key
   * @param session - Optional database session for transactional consistency
   */
  public async recoverKeyWithBackupCodeV1(
    userOrId: UserDocument<string, TID> | TID,
    backupCode: string,
    newPassword?: SecureString,
    session?: ClientSession,
  ): Promise<{
    userDoc?: UserDocument<string, TID>;
    userRecord?: IBackupCodeUserRecord<TID>;
    user: BackendMember<TID>;
    codeCount: number;
  }> {
    // Store-based path
    if (this.store && !(userOrId as any).save) {
      return this._recoverViaStore(userOrId as TID, backupCode, newPassword);
    }

    // Legacy Mongoose path
    return this._recoverViaUserDoc(
      userOrId as UserDocument<string, TID>,
      backupCode,
      newPassword,
      session,
    );
  }

  /**
   * Recover a user's private key using a backup code (version-dispatched).
   * Accepts either a UserDocument (legacy) or a user ID (store-based).
   */
  public async recoverKeyWithBackupCode(
    userOrId: UserDocument<string, TID> | TID,
    backupCode: string,
    newPassword?: SecureString,
    session?: ClientSession,
  ): Promise<{
    userDoc?: UserDocument<string, TID>;
    userRecord?: IBackupCodeUserRecord<TID>;
    user: BackendMember<TID>;
    codeCount: number;
  }> {
    // Determine backup codes source
    let backupCodes: Array<IBackupCode>;
    if (this.store && !(userOrId as any).save) {
      const record = await this.store.getUserRecord(userOrId as TID);
      if (!record) throw new InvalidBackupCodeError();
      backupCodes = record.backupCodes;
    } else {
      backupCodes = (userOrId as UserDocument<string, TID>).backupCodes;
    }

    const version = BackupCode.detectBackupCodeVersion(backupCodes, backupCode);
    switch (version) {
      case BackupCode.BackupCodeVersion:
        return this.recoverKeyWithBackupCodeV1(
          userOrId,
          backupCode,
          newPassword,
          session,
        );
      default:
        throw new InvalidBackupCodeVersionError(version);
    }
  }

  // ── Rewrap (key rotation) ─────────────────────────────────────────────

  /**
   * Rewrap system-wrapped AEAD blobs from old system key to new one.
   *
   * When a store is provided, uses the store's fetchBatch/updateUserRecord.
   * Otherwise falls back to the legacy callback-based approach.
   */
  public async rewrapAllUsersBackupCodes(
    fetchBatchOrOldSystem:
      | ((
          afterId?: string,
          limit?: number,
        ) => Promise<UserDocument<string, TID>[]>)
      | BackendMember,
    saveUserOrNewSystem:
      | ((user: UserDocument<string, TID>) => Promise<void>)
      | BackendMember,
    oldSystemOrOptions?:
      | BackendMember
      | { batchSize?: number; onProgress?: (count: number) => void },
    newSystemOrUndefined?: BackendMember,
    options?: { batchSize?: number; onProgress?: (count: number) => void },
  ): Promise<number> {
    // Detect which overload is being used
    if (this.store && typeof fetchBatchOrOldSystem !== 'function') {
      // Store-based: rewrapAllUsersBackupCodes(oldSystem, newSystem, options?)
      return this._rewrapViaStore(
        fetchBatchOrOldSystem as BackendMember,
        saveUserOrNewSystem as BackendMember,
        oldSystemOrOptions as
          | { batchSize?: number; onProgress?: (count: number) => void }
          | undefined,
      );
    }

    // Legacy callback-based: rewrapAllUsersBackupCodes(fetchBatch, saveUser, oldSystem, newSystem, options?)
    return this._rewrapViaCallbacks(
      fetchBatchOrOldSystem as (
        afterId?: string,
        limit?: number,
      ) => Promise<UserDocument<string, TID>[]>,
      saveUserOrNewSystem as (user: UserDocument<string, TID>) => Promise<void>,
      oldSystemOrOptions as BackendMember,
      newSystemOrUndefined as BackendMember,
      options,
    );
  }

  // ── Private: store-based recovery ─────────────────────────────────────

  private async _recoverViaStore(
    userId: TID,
    backupCode: string,
    newPassword?: SecureString,
  ): Promise<{
    userRecord: IBackupCodeUserRecord<TID>;
    user: BackendMember<TID>;
    codeCount: number;
  }> {
    const store = this.store!;
    const record = await store.getUserRecord(userId);
    if (!record) throw new InvalidBackupCodeError();

    const normalizedCode = BackupCode.normalizeCode(backupCode);
    const { code, newCodesArray } = this.useBackupCodeV1(
      record.backupCodes,
      normalizedCode,
    );

    let decryptionKey: Buffer | undefined;
    try {
      const adminMember = this.getSystemUser();
      decryptionKey = await BackupCode.getBackupKeyV1(
        code.checksumSalt,
        normalizedCode,
        this.application.constants,
      );
      const privateKeyUnwrapped = await adminMember.decryptData(
        Buffer.from(code.encrypted, 'hex'),
      );
      const decryptedPrivateKey = new SecureBuffer(
        SymmetricService.decryptBuffer(privateKeyUnwrapped, decryptionKey),
      );

      const memberType: MemberType = await store.getMemberType(userId);
      const user = new BackendMember(
        this.eciesService,
        memberType,
        record.username,
        new EmailString(record.email),
        Buffer.from(record.publicKey, 'hex'),
        decryptedPrivateKey,
        undefined,
        record._id,
        new Date(record.createdAt as string),
        new Date(record.updatedAt as string),
      );

      const updates: {
        backupCodes: Array<IBackupCode>;
        passwordWrappedPrivateKey?: any;
      } = {
        backupCodes: newCodesArray,
      };

      if (newPassword) {
        updates.passwordWrappedPrivateKey = this.keyWrappingService.wrapSecret(
          decryptedPrivateKey,
          newPassword,
          this.application.constants,
        );
      }

      await store.updateUserRecord(userId, updates);

      // Update the record in-place for the caller
      record.backupCodes = newCodesArray;
      if (updates.passwordWrappedPrivateKey) {
        record.passwordWrappedPrivateKey = updates.passwordWrappedPrivateKey;
      }

      return { userRecord: record, user, codeCount: newCodesArray.length };
    } finally {
      if (decryptionKey) decryptionKey.fill(0);
    }
  }

  // ── Private: legacy Mongoose recovery ─────────────────────────────────

  private async _recoverViaUserDoc(
    userDoc: UserDocument<string, TID>,
    backupCode: string,
    newPassword?: SecureString,
    session?: ClientSession,
  ): Promise<{
    userDoc: UserDocument<string, TID>;
    user: BackendMember<TID>;
    codeCount: number;
  }> {
    const normalizedCode = BackupCode.normalizeCode(backupCode);
    return await this.withTransaction<{
      userDoc: UserDocument<string, TID>;
      user: BackendMember<TID>;
      codeCount: number;
    }>(
      async (_sess: unknown) => {
        const sess = _sess as ClientSession | undefined;
        const { code, newCodesArray } = this.useBackupCodeV1(
          userDoc.backupCodes,
          normalizedCode,
        );
        userDoc.backupCodes = newCodesArray;

        let decryptionKey: Buffer | undefined;
        try {
          const adminMember = this.getSystemUser();
          decryptionKey = await BackupCode.getBackupKeyV1(
            code.checksumSalt,
            normalizedCode,
            this.application.constants,
          );
          const privateKeyUnwrapped = await adminMember.decryptData(
            Buffer.from(code.encrypted, 'hex'),
          );
          const decryptedPrivateKey = new SecureBuffer(
            SymmetricService.decryptBuffer(privateKeyUnwrapped, decryptionKey),
          );

          const memberType: MemberType = await this.roleService.getMemberType(
            userDoc._id,
            session,
          );
          const user = new BackendMember(
            this.eciesService,
            memberType,
            userDoc.username,
            new EmailString(userDoc.email),
            Buffer.from(userDoc.publicKey, 'hex'),
            decryptedPrivateKey,
            undefined,
            userDoc._id,
            new Date(userDoc.createdAt),
            new Date(userDoc.updatedAt),
          );

          if (!newPassword) {
            await userDoc.save({ session: sess });
            return {
              userDoc,
              user,
              codeCount: newCodesArray.length,
            };
          }

          const wrapped = this.keyWrappingService.wrapSecret(
            decryptedPrivateKey,
            newPassword,
            this.application.constants,
          );
          userDoc.passwordWrappedPrivateKey = wrapped;
          await userDoc.save({ session: sess });
          return { userDoc, user, codeCount: newCodesArray.length };
        } finally {
          if (decryptionKey) decryptionKey.fill(0);
        }
      },
      session,
      {
        timeoutMs:
          (this.application.environment.mongo.transactionTimeout as number) * 5,
      },
    );
  }

  // ── Private: store-based rewrap ───────────────────────────────────────

  private async _rewrapViaStore(
    oldSystem: BackendMember,
    newSystem: BackendMember,
    options?: { batchSize?: number; onProgress?: (count: number) => void },
  ): Promise<number> {
    const store = this.store!;
    const batchSize = options?.batchSize ?? 500;
    let processed = 0;
    let afterId: string | undefined;

    for (;;) {
      const records = await store.fetchBatch(afterId, batchSize);
      if (!records.length) break;

      for (const record of records) {
        let modified = false;
        for (const bc of record.backupCodes ?? []) {
          try {
            const sealed = await oldSystem.decryptData(
              Buffer.from(bc.encrypted, 'hex'),
            );
            const rewrapped = (await newSystem.encryptData(sealed)).toString(
              'hex',
            );
            if (rewrapped !== bc.encrypted) {
              bc.encrypted = rewrapped;
              modified = true;
            }
          } catch (e) {
            throw new Error(
              `Failed to rewrap backup code for user ${record._id}: ${
                (e as Error).message
              }`,
            );
          }
        }
        if (modified) {
          await store.updateUserRecord(record._id, {
            backupCodes: record.backupCodes,
          });
          processed++;
          options?.onProgress?.(processed);
        }
      }

      afterId = records[records.length - 1]?._id?.toString() ?? undefined;
    }
    return processed;
  }

  // ── Private: legacy callback-based rewrap ─────────────────────────────

  private async _rewrapViaCallbacks(
    fetchBatch: (
      afterId?: string,
      limit?: number,
    ) => Promise<UserDocument<string, TID>[]>,
    saveUser: (user: UserDocument<string, TID>) => Promise<void>,
    oldSystem: BackendMember,
    newSystem: BackendMember,
    options?: { batchSize?: number; onProgress?: (count: number) => void },
  ): Promise<number> {
    const batchSize = options?.batchSize ?? 500;
    let processed = 0;
    let afterId: string | undefined;

    for (;;) {
      const users = await fetchBatch(afterId, batchSize);
      if (!users.length) break;

      for (const user of users) {
        let modified = false;
        for (const bc of user.backupCodes ?? []) {
          try {
            const sealed = await oldSystem.decryptData(
              Buffer.from(bc.encrypted, 'hex'),
            );
            const rewrapped = (await newSystem.encryptData(sealed)).toString(
              'hex',
            );
            if (rewrapped !== bc.encrypted) {
              bc.encrypted = rewrapped;
              modified = true;
            }
          } catch (e) {
            throw new Error(
              `Failed to rewrap backup code for user ${user._id}: ${
                (e as Error).message
              }`,
            );
          }
        }
        if (modified) {
          await saveUser(user);
          processed++;
          options?.onProgress?.(processed);
        }
      }

      afterId = users[users.length - 1]?._id?.toString() ?? undefined;
    }
    return processed;
  }
}
