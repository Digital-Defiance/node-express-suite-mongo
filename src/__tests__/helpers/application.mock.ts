import { SecureString } from '@digitaldefiance/ecies-lib';
import mongoose, { Document, Model } from '@digitaldefiance/mongoose-types';
import {
  LocalhostConstants,
  ServiceContainer,
  Environment,
  PluginManager,
} from '@digitaldefiance/node-express-suite';
import { IMongoApplication } from '../../interfaces/mongo-application';

export function createApplicationMock(
  overrides?: Partial<IMongoApplication>,
  envOverrides?: Partial<Environment>,
): IMongoApplication {
  const mockEnvironment = {
    jwtSecret: new SecureString('test-jwt-secret'),
    mnemonicHmacSecret: new SecureString('test-hmac-secret'),
    mnemonicEncryptionKey: new SecureString('test-encryption-key'),
    timezone: { value: 'UTC' },
    mongo: { useTransactions: false },
    disableEmailSend: true,
    devDatabase: true,
    ...overrides?.environment,
    ...envOverrides,
  } as Environment;

  const defaultGetModel = <T extends Document>(name: string): Model<T> =>
    ({}) as Model<T>;

  return {
    environment: mockEnvironment,
    constants: LocalhostConstants,
    disableEmailSend: true,
    db: overrides?.db || ({} as typeof mongoose),
    database: (overrides as any)?.database ?? undefined,
    authProvider: (overrides as any)?.authProvider ?? undefined,
    ready: true,
    async start() {
      /* noop */
    },
    getModel: overrides?.getModel || defaultGetModel,
    services: new ServiceContainer(),
    plugins: new PluginManager(),
  } as unknown as IMongoApplication;
}
