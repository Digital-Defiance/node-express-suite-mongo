// ModelRegistry pattern: use string model names
import {
  MemberType,
  SecureBuffer,
  SecureString,
} from '@digitaldefiance/ecies-lib';
import { Document, Model } from '@digitaldefiance/mongoose-types';
import {
  Member as BackendMember,
  ECIESService,
} from '@digitaldefiance/node-ecies-lib';
import {
  AccountLockedError,
  AccountStatus,
  InvalidCredentialsError,
  PasswordLoginNotEnabledError,
} from '@digitaldefiance/suite-core-lib';
import { BaseModelName } from '../../src/enumerations/base-model-name';
import { ModelRegistry } from '../../src/model-registry';
import { BackupCodeService } from '../../src/services/backup-code';
import { DummyEmailService } from '@digitaldefiance/node-express-suite';
import { KeyWrappingService } from '@digitaldefiance/node-express-suite';
import { RoleService } from '../../src/services/role';
import { SystemUserService } from '@digitaldefiance/node-express-suite';
import { UserService } from '../../src/services/user';
import { createApplicationMock } from '../__tests__/helpers/application.mock';
import {
  makeRoleModel,
  makeUserModel,
  makeUserRoleModel,
} from '../__tests__/helpers/model-mocks.mock';

beforeAll(() => {
  // This will be overridden by makeService, just set up a default
});

function makeService(
  userDoc: unknown | null,
  userRoleDocs: unknown[] | null = [{ roleId: { name: MemberType.User } }],
  roleDoc: unknown | null = { name: MemberType.User },
) {
  const userModel = makeUserModel(userDoc);
  const userRoleModel = makeUserRoleModel(userRoleDocs);
  const roleModel = makeRoleModel(roleDoc);

  // Mock ModelRegistry
  jest
    .spyOn(ModelRegistry.instance, 'getTypedModel')
    .mockImplementation((modelName: string) => {
      if (modelName.includes('User') && !modelName.includes('Role'))
        return userModel as any;
      if (modelName.includes('UserRole')) return userRoleModel as any;
      if (modelName.includes('Role') && !modelName.includes('User'))
        return roleModel as any;
      if (modelName.includes('Mnemonic'))
        return {
          findOne: jest.fn().mockReturnValue({
            session: jest.fn().mockResolvedValue(null),
          }),
          findById: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnThis(),
            session: jest.fn().mockReturnThis(),
            lean: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue(null),
          }),
        } as any;
      return {
        findOne: jest.fn().mockReturnValue({
          session: jest.fn().mockResolvedValue(null),
        }),
      } as any;
    });
  jest
    .spyOn(ModelRegistry.instance, 'get')
    .mockImplementation((modelName: string) => {
      let model: any;
      if (modelName.includes('User') && !modelName.includes('Role'))
        model = userModel;
      else if (modelName.includes('UserRole')) model = userRoleModel;
      else if (modelName.includes('Role') && !modelName.includes('User'))
        model = roleModel;
      else model = { findOne: jest.fn() };
      return { model, schema: {} as any } as any;
    });

  const getModelFn = <T extends Document>(modelName: BaseModelName) => {
    switch (modelName) {
      case BaseModelName.User:
        return userModel as unknown as Model<T>;
      case BaseModelName.UserRole:
        return userRoleModel as unknown as Model<T>;
      case BaseModelName.Role:
        return roleModel as unknown as Model<T>;
      default:
        return {
          find: jest.fn().mockReturnThis(),
          findOne: jest.fn().mockReturnValue({
            session: jest.fn().mockResolvedValue(null),
          }),
          populate: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          session: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(null),
        } as unknown as Model<T>;
    }
  };

  const application = createApplicationMock(
    {
      getModel: getModelFn,
    },
    {
      mnemonicHmacSecret: new SecureBuffer(Buffer.alloc(32, 1)),
      mnemonicEncryptionKey: new SecureBuffer(Buffer.alloc(32, 2)),
      mongo: {
        uri: 'mongodb://localhost:27017',
        dbName: 'test',
        maxPoolSize: 10,
        minPoolSize: 2,
        maxIdleTimeMS: 30000,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 30000,
        retryWrites: true,
        retryReads: true,
        readConcern: 'majority',
        writeConcern: { w: 'majority', j: true },
        setParameterSupported: false,
        transactionLifetimeLimitSecondsSupported: false,
        maxTransactionLockRequestTimeoutMillisSupported: false,
        transactionTimeout: 60000,
        transactionLockRequestTimeout: 5000,
        useTransactions: false,
        transactionRetryBaseDelay: 100,
      },
    },
  );
  const roleService = new RoleService(application);
  const emailService = new DummyEmailService(application);
  const keyWrap = new KeyWrappingService();
  const eciesService = new ECIESService();
  const backupCodeService = new BackupCodeService(
    application,
    eciesService,
    keyWrap,
    roleService,
  );
  const svc = new UserService(
    application,
    roleService,
    emailService,
    keyWrap,
    backupCodeService,
  );
  return svc;
}

describe('UserService.loginWithPassword', () => {
  const email = 'user@example.com';
  // test fixture values - not real credentials
  // amazonq-ignore-next-line
  const pwd = 'A1!aaaaa';

  it('throws InvalidCredentialsError when user not found', async () => {
    const svc = makeService(null);
    await expect(svc.loginWithPassword(email, pwd)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('throws InvalidCredentialsError when user is deleted', async () => {
    const svc = makeService({ deletedAt: new Date() });
    await expect(svc.loginWithPassword(email, pwd)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('throws AccountLockedError when AdminLock', async () => {
    const svc = makeService({ accountStatus: AccountStatus.AdminLock });
    await expect(svc.loginWithPassword(email, pwd)).rejects.toBeInstanceOf(
      AccountLockedError,
    );
  });

  it('throws PasswordLoginNotEnabledError when passwordWrappedPrivateKey or mnemonicId missing', async () => {
    const svc = makeService({ accountStatus: AccountStatus.Active });
    await expect(svc.loginWithPassword(email, pwd)).rejects.toBeInstanceOf(
      PasswordLoginNotEnabledError,
    );
  });

  it('throws when unwrap fails', async () => {
    const user = {
      _id: '507f1f77bcf86cd799439011',
      email,
      username: 'user',
      accountStatus: AccountStatus.Active,
      passwordWrappedPrivateKey: {
        salt: '00',
        iv: '00',
        authTag: '00',
        ciphertext: '00',
        iterations: 1,
      },
      mnemonicId: '507f1f77bcf86cd799439012',
    };
    const svc = makeService(user);
    const unwrapSpy = jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn((svc as any).keyWrappingService, 'unwrapSecretAsync')
      .mockRejectedValueOnce(new Error('bad password'));
    await expect(svc.loginWithPassword(email, pwd)).rejects.toBeInstanceOf(
      Error,
    );
    unwrapSpy.mockRestore();
  });

  it('returns user info when password and unwrap succeed (challenge mocked)', async () => {
    const user = {
      _id: '507f1f77bcf86cd799439011',
      email,
      username: 'user',
      accountStatus: AccountStatus.Active,
      publicKey: '00',
      passwordWrappedPrivateKey: {
        salt: '00',
        iv: '00',
        authTag: '00',
        ciphertext: '00',
        iterations: 1,
      },
      mnemonicId: '507f1f77bcf86cd799439012',
    };
    const roleId = '507f1f77bcf86cd799439013';
    const userRoleDocs = [{ roleId }];
    const roleDoc = { _id: roleId, name: MemberType.User, system: false };
    const svc = makeService(user, userRoleDocs, roleDoc);
    const loadWalletSpy = jest
      .spyOn(BackendMember.prototype, 'loadWallet')
      .mockImplementation(() => {
        // do nothing, prevent mnemonic validation
      });
    const recoverMnemonicSpy = jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(svc as any, 'recoverMnemonic')
      .mockReturnValue(new SecureString('mock mnemonic'));
    const unwrap = jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn((svc as any).keyWrappingService, 'unwrapSecretAsync')
      .mockResolvedValueOnce(new SecureBuffer(Buffer.alloc(32, 1)));
    const enc = jest
      .spyOn(BackendMember.prototype as any, 'encryptData')
      .mockImplementation((...args: unknown[]) => args[0] as Buffer);
    const dec = jest
      .spyOn(BackendMember.prototype as any, 'decryptData')
      .mockImplementation((...args: unknown[]) => args[0] as Buffer);
    const sys = jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(SystemUserService as any, 'getSystemUser')
      .mockReturnValue({ sign: () => Buffer.alloc(64, 0), verify: () => true });

    const res = await svc.loginWithPassword(email, pwd);
    expect(res.userDoc).toBe(user);
    expect(res.userMember).toBeDefined();
    expect(res.adminMember).toBeDefined();
    loadWalletSpy.mockRestore();
    recoverMnemonicSpy.mockRestore();
    unwrap.mockRestore();
    enc.mockRestore();
    dec.mockRestore();
    sys.mockRestore();
  });
});

describe('UserService.loginWithMnemonic', () => {
  const mnemonic = new SecureString(
    'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu',
  );

  it('throws InvalidCredentialsError when user not found', async () => {
    const svc = makeService(null);
    await expect(
      svc.loginWithMnemonic('user', mnemonic),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('throws status error when PendingEmailVerification', async () => {
    const svc = makeService({
      accountStatus: AccountStatus.PendingEmailVerification,
    });
    await expect(svc.loginWithMnemonic('user', mnemonic)).rejects.toMatchObject(
      {
        name: expect.stringMatching(
          /PendingEmailVerificationError|AccountStatusError/,
        ),
      },
    );
  });

  it('returns user info when mnemonic flow succeeds (challenge mocked)', async () => {
    const user = {
      _id: '507f1f77bcf86cd799439011',
      email: 'user@example.com',
      username: 'user',
      accountStatus: AccountStatus.Active,
      mnemonicId: '507f1f77bcf86cd799439012',
      publicKey: '00',
      deletedAt: undefined,
    };
    const svc = makeService(user);
    const challenge = jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(svc as any, 'challengeUserWithMnemonic')
      .mockResolvedValueOnce({
        userMember: { id: 'u' },
        adminMember: { id: 'a' },
      });
    const res = await svc.loginWithMnemonic('user', mnemonic);
    expect(res.userDoc).toBe(user);
    expect(res.userMember).toEqual({ id: 'u' });
    expect(res.adminMember).toEqual({ id: 'a' });
    challenge.mockRestore();
  });
});
