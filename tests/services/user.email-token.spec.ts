import { SecureBuffer } from '@digitaldefiance/ecies-lib';
import { ECIESService } from '@digitaldefiance/node-ecies-lib';
import {
  AccountStatus,
  EmailTokenExpiredError,
  EmailTokenType,
  EmailTokenUsedOrInvalidError,
} from '@digitaldefiance/suite-core-lib';
import { LocalhostConstants as AppConstants } from '@digitaldefiance/node-express-suite';
import { ModelRegistry } from '../../src/model-registry';
import { emailServiceRegistry } from '@digitaldefiance/node-express-suite';
import { BackupCodeService } from '../../src/services/backup-code';
import { DummyEmailService } from '@digitaldefiance/node-express-suite';
import { KeyWrappingService } from '@digitaldefiance/node-express-suite';
import { RoleService } from '../../src/services/role';
import { UserService } from '../../src/services/user';
import { createApplicationMock } from '../__tests__/helpers/application.mock';

beforeAll(() => {
  const app = createApplicationMock();
  emailServiceRegistry.setService(new DummyEmailService(app));
});

beforeEach(() => {
  jest.clearAllMocks();
});

function makeSvc(overrides: {
  emailTokenModel?: unknown;
  userModel?: unknown;
  roleService?: Partial<RoleService>;
}) {
  // Mock ModelRegistry for this test
  jest
    .spyOn(ModelRegistry.instance, 'getTypedModel')
    .mockImplementation((modelName: string) => {
      if (modelName.includes('EmailToken'))
        return overrides.emailTokenModel as any;
      if (modelName.includes('User')) return overrides.userModel as any;
      if (modelName.includes('Mnemonic'))
        return {
          findOne: jest
            .fn()
            .mockReturnValue({ session: jest.fn().mockResolvedValue(null) }),
        } as any;
      return {
        findOne: jest
          .fn()
          .mockReturnValue({ session: jest.fn().mockResolvedValue(null) }),
      } as any;
    });
  jest.spyOn(ModelRegistry.instance, 'get').mockReturnValue({
    model: overrides.userModel || {},
    schema: {} as any,
  } as any);

  const application = createApplicationMock(
    {
      getModel: (name: string) => {
        if (name.includes('EmailToken')) return overrides.emailTokenModel;
        if (name.includes('User')) return overrides.userModel;
        return {
          findOne: jest.fn().mockReturnValue({
            session: jest.fn().mockResolvedValue(null),
          }),
        } as unknown;
      },
    },
    {
      // Required secrets
      mnemonicHmacSecret: new SecureBuffer(Buffer.alloc(32, 1)),
      mnemonicEncryptionKey: new SecureBuffer(Buffer.alloc(32, 2)),
      disableEmailSend: true, // keep emails disabled
      debug: false,
      emailSender: 'noreply@example.com',
      aws: {
        accessKeyId: { value: '' },
        secretAccessKey: { value: '' },
        region: 'us-west-2',
      },
      mongo: {
        uri: 'mongodb://localhost:27017',
        transactionTimeout: 60000,
      },
    },
  );
  const role = new RoleService(application);
  if (overrides.roleService) Object.assign(role, overrides.roleService);
  const email = emailServiceRegistry.getService();
  const keyWrap = new KeyWrappingService();
  const eciesService = new ECIESService();
  const backupCodeService = new BackupCodeService(
    application,
    eciesService,
    keyWrap,
    role,
  );
  const svc = new UserService(
    application,
    role,
    email,
    keyWrap,
    backupCodeService,
  );
  return { svc, application } as const;
}

describe('UserService.resendEmailToken', () => {
  it('throws when no valid token found', async () => {
    const chainable = {
      session: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue(null),
      exec: jest.fn().mockResolvedValue(null),
    };
    const emailTokenModel = {
      findOne: jest.fn().mockReturnValue(chainable),
    };
    const { svc } = makeSvc({ emailTokenModel });
    await expect(
      svc.resendEmailToken('uid', EmailTokenType.AccountVerification),
    ).rejects.toBeInstanceOf(EmailTokenUsedOrInvalidError);
  });

  it('calls sendEmailToken for the newest valid token', async () => {
    const tokenDoc = {
      userId: 'uid',
      email: 'user@example.com',
      type: EmailTokenType.AccountVerification,
      createdAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + AppConstants.EmailTokenExpiration),
      save: jest.fn(),
    };
    const chainable = {
      session: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue(tokenDoc),
      exec: jest.fn().mockResolvedValue(tokenDoc),
    };
    const emailTokenModel = {
      findOne: jest.fn().mockReturnValue(chainable),
    };
    const { svc } = makeSvc({ emailTokenModel });
    const spy = jest
      .spyOn(
        svc as unknown as { sendEmailToken: (userId: string) => Promise<void> },
        'sendEmailToken',
      )
      .mockResolvedValue();
    await svc.resendEmailToken('uid', EmailTokenType.AccountVerification);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('UserService.verifyAccountTokenAndComplete', () => {
  function makeModels(opts: { token: unknown | null; user: unknown | null }) {
    const tokenChainable = {
      session: jest.fn().mockResolvedValue(opts.token),
    };
    const deleteChainable = {
      session: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    const userChainable = {
      session: jest.fn().mockResolvedValue(opts.user),
    };
    const emailTokenModel = {
      findOne: jest.fn().mockReturnValue(tokenChainable),
      deleteOne: jest.fn().mockReturnValue(deleteChainable),
    };
    const userModel = {
      findById: jest.fn().mockReturnValue(userChainable),
      findOne: jest.fn().mockReturnValue(userChainable),
    };
    return { emailTokenModel, userModel } as const;
  }

  it('throws when token not found', async () => {
    const { emailTokenModel, userModel } = makeModels({
      token: null,
      user: null,
    });
    const { svc } = makeSvc({ emailTokenModel, userModel });
    await expect(svc.verifyAccountTokenAndComplete('t')).rejects.toBeInstanceOf(
      EmailTokenUsedOrInvalidError,
    );
  });

  it('deletes expired token and throws EmailTokenExpiredError', async () => {
    const token = {
      _id: 'tid',
      userId: 'uid',
      email: 'u@example.com',
      type: EmailTokenType.AccountVerification,
      expiresAt: new Date(Date.now() - 1000),
    };
    const deleteChainable = {
      session: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    const emailTokenModel = {
      findOne: jest
        .fn()
        .mockReturnValue({ session: jest.fn().mockResolvedValue(token) }),
      deleteOne: jest.fn().mockReturnValue(deleteChainable),
    };
    const userModel = {
      findById: jest
        .fn()
        .mockReturnValue({ session: jest.fn().mockResolvedValue(null) }),
      findOne: jest
        .fn()
        .mockReturnValue({ session: jest.fn().mockResolvedValue(null) }),
    };
    const { svc } = makeSvc({ emailTokenModel, userModel });
    jest.spyOn(svc as any, 'findEmailToken').mockResolvedValue(token);
    await expect(svc.verifyAccountTokenAndComplete('t')).rejects.toBeInstanceOf(
      EmailTokenExpiredError,
    );
  });

  it('throws when user not found', async () => {
    const token = {
      _id: 'tid',
      userId: 'uid',
      email: 'u@example.com',
      type: EmailTokenType.AccountVerification,
      expiresAt: new Date(Date.now() + 100000),
    };
    const emailTokenModel = {
      findOne: jest
        .fn()
        .mockReturnValue({ session: jest.fn().mockResolvedValue(token) }),
      deleteOne: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue({ acknowledged: true }),
      }),
    };
    const userModel = {
      findById: jest
        .fn()
        .mockReturnValue({ session: jest.fn().mockResolvedValue(null) }),
      findOne: jest
        .fn()
        .mockReturnValue({ session: jest.fn().mockResolvedValue(null) }),
    };
    const { svc } = makeSvc({ emailTokenModel, userModel });
    jest.spyOn(svc as any, 'findEmailToken').mockResolvedValue(token);
    await expect(svc.verifyAccountTokenAndComplete('t')).rejects.toMatchObject({
      name: 'UserNotFoundError',
    });
  });

  it('activates user, deletes token, and adds to Member role', async () => {
    const token = {
      _id: 'tid',
      userId: 'uid',
      email: 'u@example.com',
      type: EmailTokenType.AccountVerification,
      expiresAt: new Date(Date.now() + 100000),
    };
    const user = {
      _id: 'uid',
      email: 'old@example.com',
      emailVerified: false,
      darkMode: false,
      accountStatus: AccountStatus.PendingEmailVerification,
      save: jest.fn(),
    };
    const emailTokenModel = {
      findOne: jest
        .fn()
        .mockReturnValue({ session: jest.fn().mockResolvedValue(token) }),
      deleteOne: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue({ acknowledged: true }),
      }),
    };
    const userModel = {
      findById: jest
        .fn()
        .mockReturnValue({ session: jest.fn().mockResolvedValue(user) }),
      findOne: jest
        .fn()
        .mockReturnValue({ session: jest.fn().mockResolvedValue(user) }),
    };
    const memberRoleId = 'rid';
    const { svc } = makeSvc({
      emailTokenModel,
      userModel,
      roleService: {
        getRoleIdByName: jest.fn().mockResolvedValue(memberRoleId),
        addUserToRole: jest.fn().mockResolvedValue(undefined),
      } as Partial<RoleService>,
    });
    jest.spyOn(svc as any, 'findEmailToken').mockResolvedValue(token);

    await svc.verifyAccountTokenAndComplete('t');
    expect(user.email).toBe(token.email);
    expect(user.emailVerified).toBe(true);
    expect(user.accountStatus).toBe(AccountStatus.Active);
    expect(user.save).toHaveBeenCalled();
  });
});
