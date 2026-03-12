import { SecureString } from '@digitaldefiance/ecies-lib';
import { Document, Model } from '@digitaldefiance/mongoose-types';
import { LocalhostConstants } from '@digitaldefiance/node-express-suite';
import { ServiceContainer } from '@digitaldefiance/node-express-suite';
import { Environment } from '@digitaldefiance/node-express-suite';
import { IApplication } from '@digitaldefiance/node-express-suite';
import { PluginManager } from '@digitaldefiance/node-express-suite';

export function createApplicationMock(
  overrides?: Partial<IApplication>,
  envOverrides?: Partial<Environment>,
): IApplication {
  const mockEnvironment = {
    jwtSecret: new SecureString('test-jwt-secret'),
    mnemonicHmacSecret: new SecureString('test-hmac-secret'),
    mnemonicEncryptionKey: new SecureString('test-encryption-key'),
    timezone: { value: 'UTC' },
    mongo: { useTransactions: false },
    ...overrides?.environment,
    ...envOverrides,
  } as Environment;

  const defaultGetModel = <T extends Document>(name: string): Model<T> =>
    ({}) as Model<T>;

  return {
    environment: mockEnvironment,
    constants: LocalhostConstants,
    db: overrides?.db || ({} as any),
    database: (overrides as any)?.database ?? undefined,
    authProvider: (overrides as any)?.authProvider ?? undefined,
    ready: true,
    start: jest.fn(),
    getModel: overrides?.getModel || defaultGetModel,
    services: new ServiceContainer(),
    plugins: new PluginManager(),
  } as IApplication;
}
