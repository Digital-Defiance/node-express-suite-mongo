/**
 * @fileoverview Service for initializing the database with default users, roles, and relationships.
 * Handles creation of system, admin, and member users with encrypted credentials and backup codes.
 * @module services/database-initialization
 */

import {
  ECIES,
  EmailString,
  IECIESConfig,
  MemberType,
  SecureBuffer,
  SecureString,
  stringToUint8Array,
} from '@digitaldefiance/ecies-lib';
import {
  TranslatableGenericError,
  TranslatableHandleableGenericError,
} from '@digitaldefiance/i18n-lib';
import { Connection } from '@digitaldefiance/mongoose-types';
import {
  Member as BackendMember,
  ECIESService,
  getEnhancedNodeIdProvider,
  PlatformID,
} from '@digitaldefiance/node-ecies-lib';
import {
  AccountStatus,
  getSuiteCoreI18nEngine,
  IFailableResult,
  SuiteCoreStringKey,
  TranslatableSuiteError,
  TranslatableSuiteHandleableError,
} from '@digitaldefiance/suite-core-lib';
import { crc32 } from 'crc';
import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  BackupCode,
  Environment,
  KeyWrappingService,
  SystemUserService,
  debugLog,
  directLog,
} from '@digitaldefiance/node-express-suite';
import { withMongoTransaction } from '../utils/mongo-transaction';
import { ModelRegistry } from '../model-registry';
import { MnemonicService } from './mnemonic';
import { IServerInitResult } from '../interfaces/server-init-result';
import { MnemonicDocument } from '../documents/mnemonic';
import { RoleDocument } from '../documents/role';
import { UserDocument } from '../documents/user';
import { UserRoleDocument } from '../documents/user-role';
import { BaseModelName } from '../enumerations/base-model-name';
import {
  DatabaseInitailizationResultTransaction,
  IDBInitResult,
} from '../interfaces';
import { IMongoApplication } from '../interfaces/mongo-application';
import { BackupCodeService } from './backup-code';
import { RoleService } from './role';

/**
 * Service for initializing the database with default users, roles, and relationships.
 * Manages creation of system, admin, and member accounts with encrypted credentials.
 */
export abstract class DatabaseInitializationService {
  /**
   * Static initialization state management to prevent concurrent initialization.
   * @private
   */
  protected static initializationPromises = new Map<
    string,
    Promise<IFailableResult<IServerInitResult>>
  >();
  /** Initialization lock to prevent race conditions */
  protected static initializationLock = new Map<string, boolean>();

  /**
   * Default i18n translation function for database initialization messages.
   * @param str String key to translate
   * @param variables Template variables
   * @param language Target language
   * @param application Application instance
   * @returns Translated string
   */
  protected static defaultI18nTFunc(
    str: string,
    variables?: Record<string, unknown>,
    language?: string,
    application?: IMongoApplication,
  ): string {
    // Handles template strings with {{component.key}} syntax
    return getSuiteCoreI18nEngine(
      application ? { constants: application.constants } : undefined,
    ).t(str, variables, language);
  }

  /**
   * Gets the mnemonic or generates a new one if not present.
   * @template TID Platform-specific ID type
   * @param mnemonic Existing mnemonic or undefined
   * @param eciesService ECIES service to generate a new mnemonic
   * @returns Existing or new mnemonic
   */
  public static mnemonicOrNew<TID extends PlatformID = Buffer>(
    mnemonic: SecureString | undefined,
    eciesService: ECIESService<TID>,
  ): SecureString {
    return mnemonic && mnemonic.hasValue
      ? mnemonic
      : eciesService.generateNewMnemonic();
  }
  /**
   * Generates a cache key for a user based on their details.
   * @template TID Platform-specific ID type
   * @param username Username
   * @param email Email address
   * @param mnemonic Mnemonic
   * @param id User ID
   * @returns Generated cache key as hex string
   */
  public static cacheKey<TID extends PlatformID = Buffer>(
    username: string,
    email: EmailString,
    mnemonic: SecureString,
    id: TID,
  ): string {
    const idProvider = getEnhancedNodeIdProvider<TID>();
    const combined = `${username}|${email.email}|${mnemonic.value}|${idProvider.idToString(
      id,
    )}`;
    const buffer = stringToUint8Array(combined);
    const crcHash = crc32(Buffer.from(buffer));
    return crcHash.toString(16).padStart(8, '0');
  }
  /**
   * Gets a cached BackendMember or creates a new one if not cached.
   * @template TID Platform-specific ID type
   * @param username Username
   * @param email Email address
   * @param mnemonic Mnemonic or undefined to generate a new one
   * @param memberType Type of member (Admin, Member, System)
   * @param eciesService ECIES service to handle key generation
   * @param memberId Optional specific member ID to use
   * @param createdBy Optional ID of the user who created this member
   * @returns Cached or newly created BackendMember and the mnemonic used
   */
  public static cacheOrNew<TID extends PlatformID = Buffer>(
    username: string,
    email: EmailString,
    mnemonic: SecureString | undefined,
    memberType: MemberType,
    eciesService: ECIESService<TID>,
    memberId?: TID,
    createdBy?: TID,
  ): {
    member: BackendMember<TID>;
    mnemonic: SecureString;
  } {
    const idProvider = getEnhancedNodeIdProvider<TID>();
    const m = this.mnemonicOrNew(mnemonic, eciesService);

    const newId: TID = memberId ? memberId : idProvider.generateTyped();
    const key = DatabaseInitializationService.cacheKey(
      username,
      email,
      m,
      newId,
    );
    if (!global.__MEMBER_CACHE__) {
      global.__MEMBER_CACHE__ = new Map<
        string,
        {
          member: BackendMember<TID>;
          mnemonic: SecureString;
        }
      >();
    }
    if (!global.__MEMBER_CACHE__.has(key)) {
      const { wallet } = eciesService.walletAndSeedFromMnemonic(m);

      // Get private key from wallet
      const privateKey = wallet.getPrivateKey();
      // Get compressed public key (already includes prefix)
      const publicKeyWithPrefix = eciesService.getPublicKey(
        Buffer.from(privateKey),
      );

      const user: BackendMember<TID> = new BackendMember<TID>(
        eciesService,
        memberType,
        username,
        email,
        publicKeyWithPrefix,
        new SecureBuffer(privateKey),
        wallet,
        newId,
        undefined,
        undefined,
        createdBy,
      );
      global.__MEMBER_CACHE__.set(key, {
        mnemonic: m,
        member: user as unknown as BackendMember<TID>,
      });
      return { mnemonic: m, member: user };
    } else {
      return global.__MEMBER_CACHE__.get(key)! as {
        mnemonic: SecureString;
        member: BackendMember<TID>;
      };
    }
  }

  /**
   * Generates a random password meeting security requirements.
   * @param length Length of the password
   * @returns Generated password string
   */
  public static generatePassword(length: number): string {
    const specialCharacters = "!@#$%^&*()_+-=[]{};':|,.<>/?";
    const numbers = '0123456789';
    const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

    // Get a random character from a string
    const getRandomChar = (chars: string): string => {
      // amazonq-ignore-next-line false positive
      const randomIndex = randomBytes(1)[0] % chars.length;
      return chars[randomIndex];
    };

    // Start with one of each required character type
    // amazonq-ignore-next-line false positive
    let password = '';
    password += getRandomChar(letters);
    password += getRandomChar(numbers);
    password += getRandomChar(specialCharacters);

    // Fill the rest with random characters from all types
    const allCharacters = specialCharacters + numbers + letters;
    for (let i = password.length; i < length; i++) {
      password += getRandomChar(allCharacters);
    }

    // Shuffle the password characters to avoid predictable pattern
    const chars = password.split('');
    for (let i = chars.length - 1; i > 0; i--) {
      // amazonq-ignore-next-line already fixed
      const j = randomBytes(1)[0] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  /**
   * Drops the database.
   * @param connection Database connection
   * @returns True if the database was dropped, false if not connected
   */
  public static async dropDatabase(connection: Connection): Promise<boolean> {
    if (!connection.db) return false;
    debugLog(
      true,
      'warn',
      this.defaultI18nTFunc('{{SuiteCoreStringKey.Admin_DroppingDatabase}}'),
    );
    return connection.db.dropDatabase();
  }

  public static getInitOptions<TID extends PlatformID = Buffer>(
    application: IMongoApplication<TID>,
  ): {
    adminId?: TID;
    adminMnemonic?: SecureString;
    adminPassword?: SecureString;
    adminRoleId?: TID;
    adminUserRoleId?: TID;
    adminBackupCodes?: BackupCode[];
    memberId?: TID;
    memberMnemonic?: SecureString;
    memberPassword?: SecureString;
    memberRoleId?: TID;
    memberUserRoleId?: TID;
    memberBackupCodes?: BackupCode[];
    systemId?: TID;
    systemMnemonic?: SecureString;
    systemPassword?: SecureString;
    systemRoleId?: TID;
    systemUserRoleId?: TID;
    systemBackupCodes?: BackupCode[];
  } {
    const env = application.environment as Environment<TID>;
    return {
      adminId: env.adminId,
      adminMnemonic: env.adminMnemonic?.hasValue
        ? env.adminMnemonic
        : undefined,
      adminPassword: env.adminPassword?.hasValue
        ? env.adminPassword
        : undefined,
      adminRoleId: env.adminRoleId as TID,
      adminUserRoleId: env.adminUserRoleId,
      adminBackupCodes: env.adminBackupCodes,
      memberId: env.memberId,
      memberMnemonic: env.memberMnemonic?.hasValue
        ? env.memberMnemonic
        : undefined,
      memberPassword: env.memberPassword?.hasValue
        ? env.memberPassword
        : undefined,
      memberRoleId: env.memberRoleId as TID,
      memberUserRoleId: env.memberUserRoleId,
      memberBackupCodes: env.memberBackupCodes,
      systemId: env.systemId,
      systemMnemonic: env.systemMnemonic?.hasValue
        ? env.systemMnemonic
        : undefined,
      systemPassword: env.systemPassword?.hasValue
        ? env.systemPassword
        : undefined,
      systemRoleId: env.systemRoleId as TID,
      systemUserRoleId: env.systemUserRoleId,
      systemBackupCodes: env.systemBackupCodes,
    };
  }

  public static serverInitResultHash<TID extends PlatformID = Buffer>(
    serverInitResult: IServerInitResult<TID>,
  ): string {
    const h = createHash('sha256');
    const idProvider = getEnhancedNodeIdProvider<TID>();
    h.update(idProvider.idToString(serverInitResult.adminUser._id as TID));
    h.update(idProvider.idToString(serverInitResult.adminRole._id as TID));
    h.update(idProvider.idToString(serverInitResult.adminUserRole._id as TID));
    h.update(serverInitResult.adminUsername);
    h.update(serverInitResult.adminEmail);
    h.update(serverInitResult.adminMnemonic);
    h.update(serverInitResult.adminPassword);
    h.update(serverInitResult.adminUser.publicKey);
    serverInitResult.adminBackupCodes.map((bc) => h.update(bc));
    h.update(idProvider.idToString(serverInitResult.memberUser._id as TID));
    h.update(idProvider.idToString(serverInitResult.memberRole._id as TID));
    h.update(idProvider.idToString(serverInitResult.memberUserRole._id as TID));
    h.update(serverInitResult.memberUsername);
    h.update(serverInitResult.memberEmail);
    h.update(serverInitResult.memberMnemonic);
    h.update(serverInitResult.memberPassword);
    h.update(serverInitResult.memberUser.publicKey);
    serverInitResult.memberBackupCodes.map((bc) => h.update(bc));
    h.update(idProvider.idToString(serverInitResult.systemUser._id as TID));
    h.update(idProvider.idToString(serverInitResult.systemRole._id as TID));
    h.update(idProvider.idToString(serverInitResult.systemUserRole._id as TID));
    h.update(serverInitResult.systemUsername);
    h.update(serverInitResult.systemEmail);
    h.update(serverInitResult.systemMnemonic);
    h.update(serverInitResult.systemPassword);
    h.update(serverInitResult.systemUser.publicKey);
    serverInitResult.systemBackupCodes.map((bc) => h.update(bc));
    return h.digest('hex');
  }

  /**
   * Initializes the user database with default users and roles using dependency injection.
   * @template TID Platform-specific ID type
   * @param application Application instance
   * @param keyWrappingService Key wrapping service
   * @param mnemonicService Mnemonic service
   * @param eciesService ECIES service
   * @param roleService Role service
   * @param backupCodeService Backup code service
   * @returns Result of the initialization
   */
  public static async initUserDbWithServices<TID extends PlatformID = Buffer>(
    application: IMongoApplication<TID>,
    keyWrappingService: KeyWrappingService,
    mnemonicService: MnemonicService<TID>,
    eciesService: ECIESService<TID>,
    roleService: RoleService<TID>,
    backupCodeService: BackupCodeService<TID>,
  ): Promise<IDBInitResult<IServerInitResult<TID>>> {
    const engine = getSuiteCoreI18nEngine({ constants: application.constants });
    const isTestEnvironment = process.env['NODE_ENV'] === 'test';
    const options =
      DatabaseInitializationService.getInitOptions<TID>(application);
    const effectiveIdGenerator: () => TID = (() =>
      application.constants.idProvider.fromBytes(
        application.constants.idProvider.generate(),
      ) as TID) as () => TID;
    const UserModel = ModelRegistry.instance.getTypedModel<
      UserDocument<string, TID>
    >(BaseModelName.User);
    const RoleModel = ModelRegistry.instance.getTypedModel<RoleDocument<TID>>(
      BaseModelName.Role,
    );
    const adminUserId: TID = options.adminId ?? effectiveIdGenerator();
    const adminRoleId: TID = options.adminRoleId ?? effectiveIdGenerator();
    const adminUserRoleId: TID =
      options.adminUserRoleId ?? effectiveIdGenerator();
    const memberUserId: TID = options.memberId ?? effectiveIdGenerator();
    const memberRoleId: TID = options.memberRoleId ?? effectiveIdGenerator();
    const memberUserRoleId: TID =
      options.memberUserRoleId ?? effectiveIdGenerator();
    const systemUserId: TID = options.systemId ?? effectiveIdGenerator();
    const systemRoleId: TID = options.systemRoleId ?? effectiveIdGenerator();
    const systemUserRoleId: TID =
      options.systemUserRoleId ?? effectiveIdGenerator();

    // Check for existing users and roles with optimized queries
    // Use lean() for better performance on read-only operations
    const [existingUsers, existingRoles] = await Promise.all([
      UserModel.find({
        username: {
          $in: [
            application.constants.SystemUser,
            application.constants.AdministratorUser,
            application.constants.MemberUser,
          ],
        },
      }).lean(),
      RoleModel.find({
        name: {
          $in: [
            application.constants.AdministratorRole,
            application.constants.MemberRole,
            application.constants.SystemRole,
          ],
        },
      }).lean(),
    ]);

    if (existingUsers.length > 0 || existingRoles.length > 0) {
      // Database is already initialized, return the existing data
      const existingAdminUser = existingUsers.find(
        (u) => u.username === application.constants.AdministratorUser,
      );
      const existingMemberUser = existingUsers.find(
        (u) => u.username === application.constants.MemberUser,
      );
      const existingSystemUser = existingUsers.find(
        (u) => u.username === application.constants.SystemUser,
      );

      if (existingAdminUser && existingMemberUser && existingSystemUser) {
        const adminUserDoc = UserModel.hydrate(existingAdminUser);
        const memberUserDoc = UserModel.hydrate(existingMemberUser);
        const systemUserDoc = UserModel.hydrate(existingSystemUser);

        // Try to construct a minimal result from existing data
        // Note: This is a fallback case and some data may not be available
        const UserRoleModel = ModelRegistry.instance.getTypedModel<
          UserRoleDocument<TID>
        >(BaseModelName.UserRole);
        const [
          adminRole,
          memberRole,
          systemRole,
          adminUserRole,
          memberUserRole,
          systemUserRole,
        ] = await Promise.all([
          RoleModel.findOne({ name: application.constants.AdministratorRole }),
          RoleModel.findOne({ name: application.constants.MemberRole }),
          RoleModel.findOne({ name: application.constants.SystemRole }),
          UserRoleModel.findOne({ userId: adminUserDoc._id }),
          UserRoleModel.findOne({ userId: memberUserDoc._id }),
          UserRoleModel.findOne({ userId: systemUserDoc._id }),
        ]);

        // detailed case
        if (
          adminRole &&
          memberRole &&
          systemRole &&
          adminUserRole &&
          memberUserRole &&
          systemUserRole
        ) {
          return {
            alreadyInitialized: true,
            success: false,
            data: {
              adminRole,
              adminUserRole,
              adminUser: adminUserDoc,
              adminUsername: adminUserDoc.username,
              adminEmail: adminUserDoc.email,
              adminMnemonic: '', // Not available in fallback
              adminPassword: '', // Not available in fallback
              adminBackupCodes: [], // Not available in fallback
              adminMember: {} as BackendMember<TID>, // Not available in fallback
              memberRole,
              memberUserRole,
              memberUser: memberUserDoc,
              memberUsername: memberUserDoc.username,
              memberEmail: memberUserDoc.email,
              memberMnemonic: '', // Not available in fallback
              memberPassword: '', // Not available in fallback
              memberBackupCodes: [], // Not available in fallback
              memberMember: {} as BackendMember<TID>, // Not available in fallback
              systemRole,
              systemUserRole,
              systemUser: systemUserDoc,
              systemUsername: systemUserDoc.username,
              systemEmail: systemUserDoc.email,
              systemMnemonic: '', // Not available in fallback
              systemPassword: '', // Not available in fallback
              systemBackupCodes: [], // Not available in fallback
              systemMember: {} as BackendMember<TID>, // Not available in fallback
            },
            message: engine.translateStringKey(
              SuiteCoreStringKey.Admin_DatabaseAlreadyInitialized,
            ),
            error: new Error(
              engine.translateStringKey(
                SuiteCoreStringKey.Admin_DatabaseAlreadyInitialized,
              ),
            ),
          };
        }
      }

      // basic case
      return {
        alreadyInitialized: true,
        success: false,
        message: engine.translateStringKey(
          SuiteCoreStringKey.Admin_DatabaseAlreadyInitialized,
        ),
        error: new Error(
          engine.translateStringKey(
            SuiteCoreStringKey.Admin_DatabaseAlreadyInitialized,
          ),
        ),
      };
    }

    debugLog(
      application.environment.detailedDebug,
      'log',
      engine.translateStringKey(
        SuiteCoreStringKey.Admin_SettingUpUsersAndRoles,
      ),
    );
    const now = new Date();

    // Add a small random delay in test environments to reduce collision probability
    if (isTestEnvironment) {
      const delay = (randomBytes(1)[0] % 50) + 10; // 10-60ms random delay (reduced)
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      // Use test-optimized settings for better performance
      const transactionOptions = isTestEnvironment
        ? { timeoutMs: 15000, retryAttempts: 2 } // Reduced timeout and retries for tests
        : { timeoutMs: 120000 }; // Keep original production timeout

      const result = await withMongoTransaction<
        DatabaseInitailizationResultTransaction<TID>,
        TID
      >(
        application.db.connection,
        application.environment.mongo.useTransactions,
        undefined,
        async (sess) => {
          // Check if admin role already exists
          let adminRole = await RoleModel.findOne({
            name: application.constants.AdministratorRole,
          }).session(sess ?? null);
          if (!adminRole) {
            const adminRoleDocs = await RoleModel.create(
              [
                {
                  _id: adminRoleId as TID,
                  name: application.constants.AdministratorRole,
                  admin: true,
                  member: true,
                  system: false,
                  child: false,
                  createdAt: now,
                  updatedAt: now,
                  createdBy: systemUserId as TID,
                  updatedBy: systemUserId as TID,
                },
              ],
              { session: sess },
            );
            if (adminRoleDocs.length !== 1) {
              throw new TranslatableSuiteError(
                SuiteCoreStringKey.Error_FailedToCreateRoleTemplate,
                {
                  NAME: application.constants.AdministratorRole,
                },
              );
            }
            adminRole = adminRoleDocs[0];
          }

          // Check if member role already exists
          let memberRole = await RoleModel.findOne({
            name: application.constants.MemberRole,
          }).session(sess ?? null);
          if (!memberRole) {
            const memberRoleDocs = await RoleModel.create(
              [
                {
                  _id: memberRoleId as TID,
                  name: application.constants.MemberRole,
                  admin: false,
                  member: true,
                  child: false,
                  system: false,
                  createdAt: now,
                  updatedAt: now,
                  createdBy: systemUserId as TID,
                  updatedBy: systemUserId as TID,
                },
              ],
              { session: sess },
            );
            if (memberRoleDocs.length !== 1) {
              throw new TranslatableSuiteError(
                SuiteCoreStringKey.Error_FailedToCreateRoleTemplate,
                {
                  NAME: engine.translateStringKey(
                    SuiteCoreStringKey.Common_Member,
                  ),
                },
              );
            }
            memberRole = memberRoleDocs[0];
          }

          // Check if system role already exists
          let systemRole = await RoleModel.findOne({
            name: application.constants.SystemRole,
          }).session(sess ?? null);
          if (!systemRole) {
            const systemRoleDocs = await RoleModel.create(
              [
                {
                  _id: systemRoleId as TID,
                  name: application.constants.SystemRole,
                  admin: true,
                  member: true,
                  system: true,
                  child: false,
                  createdAt: now,
                  updatedAt: now,
                  createdBy: systemUserId as TID,
                  updatedBy: systemUserId as TID,
                },
              ],
              { session: sess },
            );
            if (systemRoleDocs.length !== 1) {
              throw new TranslatableSuiteError(
                SuiteCoreStringKey.Error_FailedToCreateRoleTemplate,
              );
            }
            systemRole = systemRoleDocs[0];
          }

          const systemUser = DatabaseInitializationService.cacheOrNew<TID>(
            application.constants.SystemUser,
            application.environment.systemEmail,
            options.systemMnemonic!,
            MemberType.System,
            eciesService,
            systemUserId as TID,
            systemUserId as TID,
          );
          backupCodeService.setSystemUser(systemUser.member);
          SystemUserService.setSystemUser(
            systemUser.member,
            application.constants,
          );
          // Encrypt mnemonic for recovery
          const systemEncryptedMnemonic = systemUser.member
            .encryptData(Buffer.from(systemUser.mnemonic.value ?? '', 'utf-8'))
            .toString('hex');
          const systemMnemonicDoc = await mnemonicService.addMnemonic(
            systemUser.mnemonic,
            sess,
          );
          if (!systemMnemonicDoc) {
            throw new Error(
              engine.translateStringKey(
                SuiteCoreStringKey.Error_FailedToStoreUserMnemonicTemplate,
                {
                  NAME: engine.translateStringKey(
                    SuiteCoreStringKey.Common_System,
                  ),
                },
              ),
            );
          }
          const systemPasswordSecure = options.systemPassword
            ? options.systemPassword
            : new SecureString(this.generatePassword(16));

          const systemWrapped = keyWrappingService.wrapSecret(
            systemUser.member.privateKey!,
            systemPasswordSecure,
            application.constants,
          );
          const systemBackupCodes =
            options.systemBackupCodes ?? BackupCode.generateBackupCodes();
          const encryptedSystemBackupCodes =
            await BackupCode.encryptBackupCodes(
              systemUser.member,
              systemUser.member,
              systemBackupCodes,
            );
          const systemDocs = await UserModel.create(
            [
              {
                _id: systemUserId as TID,
                username: application.constants.SystemUser,
                email: application.environment.systemEmail.toString(),
                publicKey: systemUser.member.publicKey.toString('hex'),
                duressPasswords: [],
                mnemonicRecovery: systemEncryptedMnemonic,
                mnemonicId: systemMnemonicDoc._id,
                passwordWrappedPrivateKey: systemWrapped,
                backupCodes: encryptedSystemBackupCodes,
                timezone: application.environment.timezone,
                siteLanguage: 'en-US',
                emailVerified: true,
                darkMode: false,
                accountStatus: AccountStatus.Active,
                directChallenge: true, // allow direct challenge login by default
                ...(application.constants.EnableDisplayName
                  ? { displayName: application.constants.SystemUser }
                  : {}),
                createdAt: now,
                updatedAt: now,
                createdBy: systemUserId as TID,
                updatedBy: systemUserId as TID,
              },
            ],
            { session: sess },
          );
          if (systemDocs.length !== 1) {
            throw new Error(
              engine.translateStringKey(
                SuiteCoreStringKey.Error_FailedToCreateUserTemplate,
                {
                  NAME: engine.translateStringKey(
                    SuiteCoreStringKey.Common_System,
                  ),
                },
              ),
            );
          }

          const systemDoc = systemDocs[0];

          // Create admin user-role relationship
          const systemUserRoleDoc = await roleService.addUserToRole(
            systemRoleId as TID,
            systemUserId as TID,
            systemUserId as TID,
            sess,
            systemUserRoleId,
          );

          if (!systemUser.mnemonic.value) {
            throw new Error(
              engine.translateStringKey(
                SuiteCoreStringKey.Error_MnemonicIsNullTemplate,
                {
                  NAME: SuiteCoreStringKey.Common_System,
                },
              ),
            );
          }

          const adminUser = DatabaseInitializationService.cacheOrNew<TID>(
            application.constants.AdministratorUser,
            application.environment.adminEmail,
            options.adminMnemonic,
            MemberType.User,
            eciesService,
            adminUserId as TID,
            systemDoc._id,
          );
          // Encrypt mnemonic for recovery
          const adminEncryptedMnemonic = adminUser.member
            .encryptData(Buffer.from(adminUser.mnemonic.value ?? '', 'utf-8'))
            .toString('hex');
          const adminMnemonicDoc = await mnemonicService.addMnemonic(
            adminUser.mnemonic,
            sess,
          );
          if (!adminMnemonicDoc) {
            throw new Error(
              engine.translateStringKey(
                SuiteCoreStringKey.Error_FailedToStoreUserMnemonicTemplate,
                {
                  NAME: engine.translateStringKey(
                    SuiteCoreStringKey.Common_Admin,
                  ),
                },
              ),
            );
          }
          const adminPasswordSecure = options.adminPassword
            ? options.adminPassword
            : new SecureString(this.generatePassword(16));

          const adminWrapped = keyWrappingService.wrapSecret(
            adminUser.member.privateKey!,
            adminPasswordSecure,
          );
          const adminBackupCodes =
            options.adminBackupCodes ?? BackupCode.generateBackupCodes();
          const encryptedAdminBackupCodes = await BackupCode.encryptBackupCodes(
            adminUser.member,
            systemUser.member,
            adminBackupCodes,
          );
          const adminDocs = await UserModel.create(
            [
              {
                _id: adminUserId as TID,
                username: application.constants.AdministratorUser,
                email: application.environment.adminEmail.toString(),
                publicKey: adminUser.member.publicKey.toString('hex'),
                duressPasswords: [],
                mnemonicRecovery: adminEncryptedMnemonic,
                mnemonicId: adminMnemonicDoc._id,
                passwordWrappedPrivateKey: adminWrapped,
                backupCodes: encryptedAdminBackupCodes,
                timezone: application.environment.timezone,
                siteLanguage: 'en-US',
                emailVerified: true,
                accountStatus: AccountStatus.Active,
                directChallenge: true,
                ...(application.constants.EnableDisplayName
                  ? { displayName: application.constants.AdministratorUser }
                  : {}),
                createdAt: now,
                updatedAt: now,
                createdBy: systemUserId as TID,
                updatedBy: systemUserId as TID,
              },
            ],
            { session: sess },
          );
          if (adminDocs.length !== 1) {
            throw new Error(
              engine.translateStringKey(
                SuiteCoreStringKey.Error_FailedToCreateUserTemplate,
                {
                  NAME: engine.translateStringKey(
                    SuiteCoreStringKey.Common_Admin,
                  ),
                },
              ),
            );
          }

          const adminDoc = adminDocs[0];

          // Create admin user-role relationship
          const adminUserRoleDoc = await roleService.addUserToRole(
            adminRoleId as TID,
            adminUserId as TID,
            systemUserId as TID,
            sess,
            adminUserRoleId,
          );

          if (!adminUser.mnemonic.value) {
            throw new Error(
              engine.translateStringKey(
                SuiteCoreStringKey.Error_MnemonicIsNullTemplate,
                {
                  NAME: engine.translateStringKey(
                    SuiteCoreStringKey.Common_Admin,
                  ),
                },
              ),
            );
          }

          const memberUser = DatabaseInitializationService.cacheOrNew<TID>(
            application.constants.MemberUser,
            application.environment.memberEmail,
            options.memberMnemonic,
            MemberType.User,
            eciesService,
            memberUserId as TID,
            systemDoc._id,
          );
          const memberPasswordSecure = options.memberPassword
            ? options.memberPassword
            : new SecureString(this.generatePassword(16));

          const memberMnemonicDoc = await mnemonicService.addMnemonic(
            memberUser.mnemonic,
            sess,
          );
          if (!memberMnemonicDoc) {
            throw new Error(
              engine.translateStringKey(
                SuiteCoreStringKey.Error_FailedToStoreUserMnemonicTemplate,
                {
                  NAME: engine.translateStringKey(
                    SuiteCoreStringKey.Common_Member,
                  ),
                },
              ),
            );
          }

          // Encrypt mnemonic for recovery
          const encryptedMemberMnemonic = memberUser.member
            .encryptData(Buffer.from(memberUser.mnemonic.value ?? '', 'utf-8'))
            .toString('hex');
          const memberWrapped = keyWrappingService.wrapSecret(
            memberUser.member.privateKey!,
            memberPasswordSecure,
          );
          const memberBackupCodes =
            options.memberBackupCodes ?? BackupCode.generateBackupCodes();
          const encryptedMemberBackupCodes =
            await BackupCode.encryptBackupCodes(
              memberUser.member,
              systemUser.member,
              memberBackupCodes,
            );
          const memberDocs = await UserModel.create(
            [
              {
                _id: memberUserId as TID,
                username: application.constants.MemberUser,
                email: application.environment.memberEmail.toString(),
                publicKey: memberUser.member.publicKey.toString('hex'),
                mnemonicId: memberMnemonicDoc._id,
                mnemonicRecovery: encryptedMemberMnemonic,
                passwordWrappedPrivateKey: memberWrapped,
                backupCodes: encryptedMemberBackupCodes,
                duressPasswords: [],
                timezone: application.environment.timezone,
                siteLanguage: 'en-US',
                emailVerified: true,
                accountStatus: AccountStatus.Active,
                directChallenge: true,
                ...(application.constants.EnableDisplayName
                  ? { displayName: application.constants.MemberUser }
                  : {}),
                createdAt: now,
                updatedAt: now,
                createdBy: systemUserId as TID,
                updatedBy: systemUserId as TID,
              },
            ],
            { session: sess },
          );
          if (memberDocs.length !== 1) {
            throw new Error(
              engine.translateStringKey(
                SuiteCoreStringKey.Error_FailedToCreateUserTemplate,
                {
                  NAME: engine.translateStringKey(
                    SuiteCoreStringKey.Common_Member,
                  ),
                },
              ),
            );
          }

          const memberDoc = memberDocs[0];

          // Create member user-role relationship
          const memberUserRoleDoc = await roleService.addUserToRole(
            memberRoleId as TID,
            memberUserId as TID,
            systemUserId as TID,
            sess,
            memberUserRoleId,
          );

          if (!memberUser.mnemonic.value) {
            throw new Error(
              engine.translateStringKey(
                SuiteCoreStringKey.Error_MnemonicIsNullTemplate,
                {
                  NAME: engine.translateStringKey(
                    SuiteCoreStringKey.Common_Member,
                  ),
                },
              ),
            );
          }

          return {
            adminRole,
            memberRole,
            systemRole,
            systemDoc,
            systemUserRoleDoc,
            systemPassword: systemPasswordSecure.notNullValue,
            systemMnemonic: systemUser.mnemonic.notNullValue,
            systemBackupCodes: systemBackupCodes,
            systemMember: systemUser.member,
            adminDoc,
            adminUserRoleDoc,
            adminPassword: adminPasswordSecure.notNullValue,
            adminMnemonic: adminUser.mnemonic.notNullValue,
            adminBackupCodes: adminBackupCodes,
            adminMember: adminUser.member,
            memberDoc,
            memberUserRoleDoc,
            memberPassword: memberPasswordSecure.notNullValue,
            memberMnemonic: memberUser.mnemonic.notNullValue,
            memberBackupCodes: memberBackupCodes,
            memberUser: memberUser.member,
          };
        },
        transactionOptions,
      );

      return {
        alreadyInitialized: false,
        success: true,
        data: {
          adminRole: result.adminRole,
          adminUserRole: result.adminUserRoleDoc,
          adminUser: result.adminDoc,
          adminUsername: result.adminDoc.username,
          adminEmail: result.adminDoc.email,
          adminMnemonic: result.adminMnemonic,
          adminPassword: result.adminPassword,
          adminBackupCodes: result.adminBackupCodes.map((bc) => bc.value ?? ''),
          adminMember: result.adminMember,
          memberRole: result.memberRole,
          memberUserRole: result.memberUserRoleDoc,
          memberUser: result.memberDoc,
          memberUsername: result.memberDoc.username,
          memberEmail: result.memberDoc.email,
          memberMnemonic: result.memberMnemonic,
          memberPassword: result.memberPassword,
          memberBackupCodes: result.memberBackupCodes.map(
            (bc) => bc.value ?? '',
          ),
          memberMember: result.memberUser,
          systemRole: result.systemRole,
          systemUserRole: result.systemUserRoleDoc,
          systemUser: result.systemDoc,
          systemUsername: result.systemDoc.username,
          systemEmail: result.systemDoc.email,
          systemMnemonic: result.systemMnemonic,
          systemPassword: result.systemPassword,
          systemBackupCodes: result.systemBackupCodes.map(
            (bc) => bc.value ?? '',
          ),
          systemMember: result.systemMember,
        },
      };
    } catch (error) {
      // Check if it's a translatable error and display cleanly
      if (
        error instanceof TranslatableGenericError ||
        error instanceof TranslatableHandleableGenericError ||
        error instanceof TranslatableSuiteError ||
        error instanceof TranslatableSuiteHandleableError
      ) {
        return {
          alreadyInitialized: false,
          success: false,
          message: (error as Error).message,
          error: error as Error,
        };
      }

      return {
        alreadyInitialized: false,
        success: false,
        message: engine.translateStringKey(
          SuiteCoreStringKey.Admin_Error_FailedToInitializeUserDatabase,
        ),
        error:
          error instanceof Error
            ? error
            : new Error(
                engine.translateStringKey(
                  SuiteCoreStringKey.Admin_Error_FailedToInitializeUserDatabase,
                ),
              ),
      };
    }
  }

  public static serverInitResultsToDotEnv<TID extends PlatformID = Buffer>(
    serverInitResult: IServerInitResult<TID>,
  ): string {
    const idProvider = getEnhancedNodeIdProvider<TID>();
    return `ADMIN_ID="${idProvider.idToString(serverInitResult.adminUser._id as TID)}"
ADMIN_EMAIL="${serverInitResult.adminEmail}"
ADMIN_MNEMONIC="${serverInitResult.adminMnemonic}"
ADMIN_ROLE_ID="${idProvider.idToString(serverInitResult.adminRole._id as TID)}"
ADMIN_USER_ROLE_ID="${idProvider.idToString(serverInitResult.adminUserRole._id as TID)}"
ADMIN_PASSWORD="${serverInitResult.adminPassword}"
MEMBER_ID="${idProvider.idToString(serverInitResult.memberUser._id as TID)}"
MEMBER_EMAIL="${serverInitResult.memberEmail}"
MEMBER_MNEMONIC="${serverInitResult.memberMnemonic}"
MEMBER_ROLE_ID="${idProvider.idToString(serverInitResult.memberRole._id as TID)}"
MEMBER_USER_ROLE_ID="${idProvider.idToString(serverInitResult.memberUserRole._id as TID)}"
MEMBER_PASSWORD="${serverInitResult.memberPassword}"
SYSTEM_ID="${idProvider.idToString(serverInitResult.systemUser._id as TID)}"
SYSTEM_EMAIL="${serverInitResult.systemEmail}"
SYSTEM_MNEMONIC="${serverInitResult.systemMnemonic}"
SYSTEM_PUBLIC_KEY="${serverInitResult.systemUser.publicKey}"
SYSTEM_ROLE_ID="${idProvider.idToString(serverInitResult.systemRole._id as TID)}"
SYSTEM_USER_ROLE_ID="${idProvider.idToString(serverInitResult.systemUserRole._id as TID)}"
SYSTEM_PASSWORD="${serverInitResult.systemPassword}"
`;
  }

  public static printServerInitResults<TID extends PlatformID = Buffer>(
    result: IServerInitResult<TID>,
    printDotEnv: boolean = true,
  ): void {
    const idProvider = getEnhancedNodeIdProvider<TID>();
    debugLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '\n=== {{SuiteCoreStringKey.Admin_AccountCredentials}} ===',
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_System}} {{SuiteCoreStringKey.Common_ID}}: {id}',
        {
          id: idProvider.idToString(result.systemUser._id as TID),
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_System}} {{SuiteCoreStringKey.Common_Role}}: {roleName}',
        {
          roleName: result.systemRole.name,
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_System}} {{SuiteCoreStringKey.Common_Role}} {{SuiteCoreStringKey.Common_ID}}: {roleId}',
        {
          roleId: idProvider.idToString(result.systemRole._id as TID),
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_System}} {{SuiteCoreStringKey.Common_User}} {{SuiteCoreStringKey.Common_Role}} {{SuiteCoreStringKey.Common_ID}}: {userRoleId}',
        {
          userRoleId: idProvider.idToString(result.systemUserRole._id as TID),
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_System}} {{SuiteCoreStringKey.Common_Username}}: {username}',
        {
          username: result.systemUsername,
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_System}} {{SuiteCoreStringKey.Common_Email}}: {email}',
        {
          email: result.systemEmail,
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_System}} {{SuiteCoreStringKey.Common_Password}}: {password}',
        {
          password: result.systemPassword,
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_System}} {{SuiteCoreStringKey.Common_Mnemonic}}: {mnemonic}',
        {
          mnemonic: result.systemMnemonic,
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_System}} {{SuiteCoreStringKey.Common_PublicKey}}: {publicKey}',
        {
          publicKey: result.systemUser.publicKey,
        },
      ),
    );
    directLog(
      true,
      'log',
      `${this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_System}} {{SuiteCoreStringKey.Common_BackupCodes}}',
      )}: ${result.systemBackupCodes.join(', ')}`,
    );
    directLog(true, 'log', '');
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Admin}} {{SuiteCoreStringKey.Common_ID}}: {id}',
        {
          id: idProvider.idToString(result.adminUser._id as TID),
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Admin}} {{SuiteCoreStringKey.Common_Role}}: {roleName}',
        {
          roleName: result.adminRole.name,
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Admin}} {{SuiteCoreStringKey.Common_Role}} {{SuiteCoreStringKey.Common_ID}}: {roleId}',
        {
          roleId: idProvider.idToString(result.adminRole._id as TID),
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Admin}} {{SuiteCoreStringKey.Common_User}} {{SuiteCoreStringKey.Common_Role}} {{SuiteCoreStringKey.Common_ID}}: {userRoleId}',
        {
          userRoleId: idProvider.idToString(result.adminUserRole._id as TID),
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Admin}} {{SuiteCoreStringKey.Common_Username}}: {username}',
        {
          username: result.adminUsername,
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Admin}} {{SuiteCoreStringKey.Common_Email}}: {email}',
        {
          email: result.adminEmail,
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Admin}} {{SuiteCoreStringKey.Common_Password}}: {password}',
        {
          password: result.adminPassword,
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Admin}} {{SuiteCoreStringKey.Common_Mnemonic}}: {mnemonic}',
        {
          mnemonic: result.adminMnemonic,
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Admin}} {{SuiteCoreStringKey.Common_PublicKey}}: {publicKey}',
        {
          publicKey: result.adminUser.publicKey,
        },
      ),
    );
    directLog(
      true,
      'log',
      `${this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Admin}} {{SuiteCoreStringKey.Common_BackupCodes}}',
      )}: ${result.adminBackupCodes.join(', ')}`,
    );
    directLog(true, 'log', '');
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Member}} {{SuiteCoreStringKey.Common_ID}}: {id}',
        {
          id: idProvider.idToString(result.memberUser._id as TID),
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Member}} {{SuiteCoreStringKey.Common_Role}}: {roleName}',
        {
          roleName: result.memberRole.name,
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Member}} {{SuiteCoreStringKey.Common_Role}} {{SuiteCoreStringKey.Common_ID}}: {roleId}',
        {
          roleId: idProvider.idToString(result.memberRole._id as TID),
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Member}} {{SuiteCoreStringKey.Common_User}} {{SuiteCoreStringKey.Common_Role}} {{SuiteCoreStringKey.Common_ID}}: {userRoleId}',
        {
          userRoleId: idProvider.idToString(result.memberUserRole._id as TID),
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Member}} {{SuiteCoreStringKey.Common_Username}}: {username}',
        {
          username: result.memberUsername,
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Member}} {{SuiteCoreStringKey.Common_Email}}: {email}',
        {
          email: result.memberEmail,
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Member}} {{SuiteCoreStringKey.Common_Password}}: {password}',
        {
          password: result.memberPassword,
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Member}} {{SuiteCoreStringKey.Common_Mnemonic}}: {mnemonic}',
        {
          mnemonic: result.memberMnemonic,
        },
      ),
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Member}} {{SuiteCoreStringKey.Common_PublicKey}}: {publicKey}',
        {
          publicKey: result.memberUser.publicKey,
        },
      ),
    );
    directLog(
      true,
      'log',
      `${this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Common_Member}} {{SuiteCoreStringKey.Common_BackupCodes}}',
      )}: ${result.memberBackupCodes.join(', ')}`,
    );
    directLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '\n=== {{SuiteCoreStringKey.Admin_EndCredentials}} ===',
      ),
    );

    if (printDotEnv) {
      directLog(true, 'log', '');
      debugLog(
        true,
        'log',
        this.defaultI18nTFunc(
          '=== {{SuiteCoreStringKey.Admin_DotEnvFormat}} ===',
        ),
      );
      debugLog(
        true,
        'log',
        this.defaultI18nTFunc(
          '=== {{SuiteCoreStringKey.Admin_EndDotEnvFormat}} ===',
        ),
      );
    }
  }

  public static setEnvFromInitResults<TID extends PlatformID = Buffer>(
    result: IServerInitResult<TID>,
  ): void {
    const idProvider = getEnhancedNodeIdProvider<TID>();
    process.env['ADMIN_ID'] = idProvider.idToString(
      result.adminUser._id as TID,
    );
    process.env['ADMIN_PUBLIC_KEY'] = result.adminUser.publicKey;
    process.env['ADMIN_EMAIL'] = result.adminEmail;
    process.env['ADMIN_MNEMONIC'] = result.adminMnemonic;
    process.env['ADMIN_PASSWORD'] = result.adminPassword;
    process.env['ADMIN_ROLE_ID'] = idProvider.idToString(
      result.adminRole._id as TID,
    );
    process.env['ADMIN_USER_ROLE_ID'] = idProvider.idToString(
      result.adminUserRole._id as TID,
    );
    //
    process.env['MEMBER_ID'] = idProvider.idToString(
      result.memberUser._id as TID,
    );
    process.env['MEMBER_PUBLIC_KEY'] = result.memberUser.publicKey;
    process.env['MEMBER_EMAIL'] = result.memberEmail;
    process.env['MEMBER_MNEMONIC'] = result.memberMnemonic;
    process.env['MEMBER_PASSWORD'] = result.memberPassword;
    process.env['MEMBER_ROLE_ID'] = idProvider.idToString(
      result.memberRole._id as TID,
    );
    process.env['MEMBER_USER_ROLE_ID'] = idProvider.idToString(
      result.memberUserRole._id as TID,
    );
    //
    process.env['SYSTEM_ID'] = idProvider.idToString(
      result.systemUser._id as TID,
    );
    process.env['SYSTEM_PUBLIC_KEY'] = result.systemUser.publicKey;
    process.env['SYSTEM_EMAIL'] = result.systemEmail;
    process.env['SYSTEM_MNEMONIC'] = result.systemMnemonic;
    process.env['SYSTEM_PASSWORD'] = result.systemPassword;
    process.env['SYSTEM_ROLE_ID'] = idProvider.idToString(
      result.systemRole._id as TID,
    );
    process.env['SYSTEM_USER_ROLE_ID'] = idProvider.idToString(
      result.systemUserRole._id as TID,
    );
  }

  /**
   * Write initialization results to a .env file
   * Updates or adds the credential variables in the specified .env file
   * @param envFilePath Path to the .env file to update
   * @param result The initialization results containing credentials
   * @param idToString Function to convert IDs to strings
   */
  public static writeEnvFile<TID extends PlatformID = Buffer>(
    envFilePath: string,
    result: IServerInitResult<TID>,
  ): void {
    const idProvider = getEnhancedNodeIdProvider<TID>();
    // Ensure the directory exists
    const dir = path.dirname(envFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Read existing .env file or create empty content
    let envContent = '';
    if (fs.existsSync(envFilePath)) {
      envContent = fs.readFileSync(envFilePath, 'utf-8');
    }

    // Define the credentials to update
    const credentials = {
      ADMIN_ID: idProvider.idToString(result.adminUser._id as TID),
      ADMIN_EMAIL: result.adminEmail,
      ADMIN_MNEMONIC: result.adminMnemonic,
      ADMIN_ROLE_ID: idProvider.idToString(result.adminRole._id as TID),
      ADMIN_USER_ROLE_ID: idProvider.idToString(
        result.adminUserRole._id as TID,
      ),
      ADMIN_PASSWORD: result.adminPassword,
      MEMBER_ID: idProvider.idToString(result.memberUser._id as TID),
      MEMBER_EMAIL: result.memberEmail,
      MEMBER_MNEMONIC: result.memberMnemonic,
      MEMBER_ROLE_ID: idProvider.idToString(result.memberRole._id as TID),
      MEMBER_USER_ROLE_ID: idProvider.idToString(
        result.memberUserRole._id as TID,
      ),
      MEMBER_PASSWORD: result.memberPassword,
      SYSTEM_ID: idProvider.idToString(result.systemUser._id as TID),
      SYSTEM_EMAIL: result.systemEmail,
      SYSTEM_MNEMONIC: result.systemMnemonic,
      SYSTEM_PUBLIC_KEY: result.systemUser.publicKey,
      SYSTEM_ROLE_ID: idProvider.idToString(result.systemRole._id as TID),
      SYSTEM_USER_ROLE_ID: idProvider.idToString(
        result.systemUserRole._id as TID,
      ),
      SYSTEM_PASSWORD: result.systemPassword,
    };

    // Update or add each credential
    for (const [key, value] of Object.entries(credentials)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const newLine = `${key}="${value}"`;

      if (regex.test(envContent)) {
        // Update existing line
        envContent = envContent.replace(regex, newLine);
      } else {
        // Add new line (append to end)
        if (envContent && !envContent.endsWith('\n')) {
          envContent += '\n';
        }
        envContent += newLine + '\n';
      }
    }

    // Write back to file
    fs.writeFileSync(envFilePath, envContent, 'utf-8');
    debugLog(
      true,
      'log',
      this.defaultI18nTFunc(
        '{{SuiteCoreStringKey.Admin_CredentialsWrittenToEnv}}',
        {
          path: envFilePath,
        },
      ),
    );
  }

  /**
   * Initializes the user database with default users and roles (convenience method).
   * Creates necessary services and calls initUserDbWithServices.
   * @template TID Platform-specific ID type
   * @param application Application instance
   * @returns Result of the initialization
   */
  public static async initUserDb<TID extends PlatformID = Buffer>(
    application: IMongoApplication<TID>,
  ): Promise<IFailableResult<IServerInitResult<TID>>> {
    const mnemonicModel = ModelRegistry.instance.getTypedModel<
      MnemonicDocument<TID>
    >(BaseModelName.Mnemonic);
    const mnemonicService = new MnemonicService(
      mnemonicModel,
      application.environment.mnemonicHmacSecret,
      application.constants,
    );
    const config: IECIESConfig = {
      curveName: ECIES.CURVE_NAME,
      primaryKeyDerivationPath: ECIES.PRIMARY_KEY_DERIVATION_PATH,
      mnemonicStrength: ECIES.MNEMONIC_STRENGTH,
      symmetricAlgorithm: ECIES.SYMMETRIC_ALGORITHM_CONFIGURATION,
      symmetricKeyBits: ECIES.SYMMETRIC.KEY_BITS,
      symmetricKeyMode: ECIES.SYMMETRIC.MODE,
    };
    const eciesService = new ECIESService<TID>(config);
    const roleService = new RoleService<TID>(
      application as unknown as import('@digitaldefiance/node-express-suite').IApplication<TID>,
    );
    const keyWrappingService = new KeyWrappingService();
    const backupCodeService = new BackupCodeService<TID>(
      application as unknown as import('@digitaldefiance/node-express-suite').IApplication<TID>,
      eciesService,
      keyWrappingService,
      roleService,
    );

    return this.initUserDbWithServices<TID>(
      application,
      keyWrappingService,
      mnemonicService,
      eciesService,
      roleService as RoleService<TID>,
      backupCodeService as BackupCodeService<TID>,
    );
  }
}
