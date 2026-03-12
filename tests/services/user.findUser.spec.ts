import { ECIESService } from '@digitaldefiance/node-ecies-lib';
import {
  AccountLockedError,
  AccountStatus,
  AccountStatusError,
  InvalidEmailError,
  UserNotFoundError,
  UsernameOrEmailRequiredError,
} from '@digitaldefiance/suite-core-lib';
import { setupI18nForTests } from '@digitaldefiance/express-suite-test-utils';
import { ModelRegistry } from '../../src/model-registry';
import { BackupCodeService } from '../../src/services/backup-code';
import { DummyEmailService } from '@digitaldefiance/node-express-suite';
import { KeyWrappingService } from '@digitaldefiance/node-express-suite';
import { RoleService } from '../../src/services/role';
import { UserService } from '../../src/services/user';
import { createApplicationMock } from '../__tests__/helpers/application.mock';

let cleanupI18n: () => void;

beforeAll(() => {
  // Initialize all available i18n engines for error messages
  cleanupI18n = setupI18nForTests();

  const mockModel = {
    findOne: jest.fn().mockReturnValue({
      session: jest.fn().mockResolvedValue(null),
    }),
  };
  jest
    .spyOn(ModelRegistry.instance, 'getTypedModel')
    .mockReturnValue(mockModel as any);
  jest.spyOn(ModelRegistry.instance, 'get').mockReturnValue({
    model: mockModel,
    schema: {} as any,
  } as any);
});

afterAll(() => {
  cleanupI18n();
});

function makeService(userDoc: unknown | null) {
  // Mock UserModel.findOne().session().exec() and .collation().session().exec() chaining
  const execMock = jest.fn().mockResolvedValue(userDoc);
  const sessionMock = jest.fn().mockReturnValue({ exec: execMock });
  const chainable = {
    collation: jest.fn().mockReturnThis(),
    session: sessionMock,
    exec: execMock,
  };

  const mockUserModel = {
    findOne: jest.fn().mockReturnValue(chainable),
  };

  // Mock ModelRegistry to return our mock
  jest
    .spyOn(ModelRegistry.instance, 'getTypedModel')
    .mockReturnValue(mockUserModel as any);
  jest.spyOn(ModelRegistry.instance, 'get').mockReturnValue({
    model: mockUserModel,
    schema: {} as any,
  } as any);

  const application = createApplicationMock();
  // @ts-expect-error - Mock only implements methods under test, not full Model interface
  application.getModel = jest.fn((name: string) => {
    if (name.includes('User')) return mockUserModel;
    return {
      findOne: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      }),
    };
  });

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

describe('UserService.findUser', () => {
  it('throws when neither email nor username provided', async () => {
    const svc = makeService(null);
    await expect(svc.findUser(undefined, undefined)).rejects.toBeInstanceOf(
      UsernameOrEmailRequiredError,
    );
  });

  it('throws InvalidEmailError when user not found (email path)', async () => {
    const svc = makeService(null);
    await expect(svc.findUser('user@example.com')).rejects.toBeInstanceOf(
      InvalidEmailError,
    );
  });

  it('throws InvalidEmailError when user is deleted (email path)', async () => {
    const svc = makeService({ deletedAt: new Date() });
    await expect(svc.findUser('user@example.com')).rejects.toBeInstanceOf(
      InvalidEmailError,
    );
  });

  it('throws UserNotFoundError when user is deleted (username path)', async () => {
    const svc = makeService({ deletedAt: new Date() });
    await expect(svc.findUser(undefined, 'user')).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
  });

  it('returns doc when account is Active', async () => {
    const user = {
      _id: '507f1f77bcf86cd799439011',
      username: 'user',
      email: 'user@example.com',
      accountStatus: AccountStatus.Active,
    };
    const svc = makeService(user);
    const res = await svc.findUser(undefined, 'user');
    expect(res).toBe(user);
  });

  it('throws AccountLockedError when AdminLock', async () => {
    const svc = makeService({
      accountStatus: AccountStatus.AdminLock,
      _id: '507f1f77bcf86cd799439011',
      email: 'user@example.com',
    });
    await expect(svc.findUser('user@example.com')).rejects.toBeInstanceOf(
      AccountLockedError,
    );
  });

  it('throws a status error when PendingEmailVerification', async () => {
    const svc = makeService({
      accountStatus: AccountStatus.PendingEmailVerification,
      _id: '507f1f77bcf86cd799439011',
      email: 'user@example.com',
    });
    await expect(svc.findUser('user@example.com')).rejects.toMatchObject({
      name: expect.stringMatching(
        /PendingEmailVerificationError|AccountStatusError/,
      ),
    });
  });

  it('throws AccountStatusError for unknown status', async () => {
    const svc = makeService({
      accountStatus: 'Weird',
      _id: '507f1f77bcf86cd799439011',
      email: 'user@example.com',
    });
    await expect(svc.findUser('user@example.com')).rejects.toBeInstanceOf(
      AccountStatusError,
    );
  });
});
