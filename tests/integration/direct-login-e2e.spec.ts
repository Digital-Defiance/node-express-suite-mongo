/**
 * @fileoverview End-to-end integration test for the direct login challenge flow.
 * Boots a real BaseApplication with MongoDatabasePlugin and in-memory MongoDB, initializes users,
 * and exercises the full generate → sign → verify challenge lifecycle.
 *
 * This test exists to catch regressions from the BaseApplication / Application
 * refactor — specifically ensuring that the plugin-based architecture works
 * correctly for authentication, transactions, and model access.
 */

import { randomBytes } from 'crypto';
import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  CoreLanguageCode,
  GlobalActiveContext,
  IActiveContext,
} from '@digitaldefiance/i18n-lib';
import { ECIESService } from '@digitaldefiance/node-ecies-lib';
import { IECIESConfig, SecureString } from '@digitaldefiance/ecies-lib';
import { createExpressConstants, ECIES } from '@digitaldefiance/node-express-suite';
import { BaseModelName } from '../../src/enumerations';
import { Environment } from '@digitaldefiance/node-express-suite';
import { ModelRegistry } from '../../src/model-registry';
import { getSchemaMap } from '../../src/schemas';
import { DatabaseInitializationService } from '../../src/services';
import { MongooseDocumentStore } from '../../src/services/mongoose-document-store';
import { BaseApplication } from '@digitaldefiance/node-express-suite';
import { MongoDatabasePlugin } from '../../src/plugins/mongo-database-plugin';
import { UserService } from '../../src/services/user';
import { RoleService } from '../../src/services/role';
import { KeyWrappingService } from '@digitaldefiance/node-express-suite';
import { BackupCodeService } from '../../src/services/backup-code';
import { JwtService } from '../../src/services/jwt';
import { DummyEmailService } from '@digitaldefiance/node-express-suite';
import type { IConstants } from '@digitaldefiance/node-express-suite';
import type { IServerInitResult } from '../../src/interfaces/server-init-result';
import { IMongoApplication } from '../../src/interfaces/mongo-application';
import type { IUserDocument } from '../../src/documents/user';
import type { BaseModelDocs } from '../../src/schemas/schema';

// Use default constants — emails are derived from environment.emailDomain at runtime
const TestConstants: IConstants = createExpressConstants();

// Undo the global argon2 mock — this integration test needs real argon2
jest.unmock('argon2');

/** Generate a 64-char lowercase hex string (32 random bytes). */
const hex64 = () => randomBytes(32).toString('hex');

const eciesConfig: IECIESConfig = {
  curveName: ECIES.CURVE_NAME,
  primaryKeyDerivationPath: ECIES.PRIMARY_KEY_DERIVATION_PATH,
  mnemonicStrength: ECIES.MNEMONIC_STRENGTH,
  symmetricAlgorithm: ECIES.SYMMETRIC_ALGORITHM_CONFIGURATION,
  symmetricKeyBits: ECIES.SYMMETRIC.KEY_BITS,
  symmetricKeyMode: ECIES.SYMMETRIC.MODE,
};

describe('Direct login challenge E2E (real MongoDB)', () => {
  let app: BaseApplication<Buffer>;
  let mongoPlugin: MongoDatabasePlugin<
    Buffer,
    BaseModelDocs,
    IServerInitResult<Buffer>
  >;
  let mongoApp: IMongoApplication<Buffer>;
  let initResult: IServerInitResult<Buffer>;
  let userService: UserService<unknown, Buffer, Date, string, string>;
  let eciesService: ECIESService<Buffer>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env['DEV_DATABASE'] = `direct_login_e2e_${Date.now()}`;
    process.env['MONGO_USE_TRANSACTIONS'] = 'false';
    process.env['PORT'] = String(Math.floor(Math.random() * 10000) + 50000);
    process.env.LANGUAGE = 'English (US)';
    if (!process.env['JWT_SECRET']) {
      process.env['JWT_SECRET'] = hex64();
    }
    if (!process.env['MNEMONIC_HMAC_SECRET']) {
      process.env['MNEMONIC_HMAC_SECRET'] = hex64();
    }
    if (!process.env['MNEMONIC_ENCRYPTION_KEY']) {
      process.env['MNEMONIC_ENCRYPTION_KEY'] = hex64();
    }
    if (!process.env['API_DIST_DIR']) {
      const dir = join(tmpdir(), `dl-e2e-api-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      process.env['API_DIST_DIR'] = dir;
    }
    if (!process.env['REACT_DIST_DIR']) {
      const dir = join(tmpdir(), `dl-e2e-react-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      process.env['REACT_DIST_DIR'] = dir;
    }

    const context = GlobalActiveContext.getInstance<
      CoreLanguageCode,
      IActiveContext<CoreLanguageCode>
    >();
    context.setAdminLanguage('en-US');

    const env = new Environment(undefined, true, true, TestConstants);

    mongoPlugin = new MongoDatabasePlugin<
      Buffer,
      BaseModelDocs,
      IServerInitResult<Buffer>
    >({
      schemaMapFactory: getSchemaMap,
      databaseInitFunction: (application: IMongoApplication<Buffer>) =>
        DatabaseInitializationService.initUserDb(application),
      initResultHashFunction: (r: IServerInitResult<Buffer>) =>
        DatabaseInitializationService.serverInitResultHash(r),
      environment: env,
      constants: TestConstants,
    });

    const noOpDb = {
      collection() {
        throw new Error('Use MongoDatabasePlugin');
      },
      startSession() {
        throw new Error('Use MongoDatabasePlugin');
      },
      async withTransaction(callback: () => Promise<any>) {
        return await callback();
      },
      listCollections() {
        return [];
      },
      async dropCollection() {
        return false;
      },
      async connect() {
        /* no-op */
      },
      async disconnect() {
        /* no-op */
      },
      isConnected() {
        return false;
      },
    };

    app = new BaseApplication(env, noOpDb as never, TestConstants);

    // Connect the plugin manually (simulating what Application.start() does)
    await mongoPlugin.connect();
    await mongoPlugin.init(app as never);

    // Set the auth provider from the plugin
    app.authProvider = mongoPlugin.authenticationProvider;

    // Get the IMongoApplication adapter from the plugin (has db, getModel, etc.)
    mongoApp = mongoPlugin.mongoApplication!;

    // Initialize the database — creates admin, member, system users
    initResult =
      (await mongoPlugin.initializeDevStore()) as IServerInitResult<Buffer>;

    // Build services the same way ApiRouter does
    eciesService = new ECIESService<Buffer>(eciesConfig);
    const roleService = new RoleService<Buffer>(mongoApp);
    const emailService = new DummyEmailService<Buffer>(app as never);
    const keyWrappingService = new KeyWrappingService();
    const backupCodeService = new BackupCodeService<Buffer>(
      mongoApp,
      eciesService,
      keyWrappingService,
      roleService,
    );

    userService = new UserService(
      mongoApp,
      roleService,
      emailService,
      keyWrappingService,
      backupCodeService,
    );
  }, 120_000);

  afterAll(async () => {
    if (mongoPlugin) {
      await mongoPlugin.disconnect();
    }
  }, 30_000);

  // ── Sanity checks ──────────────────────────────────────────────────

  it('should have created the admin user in the database', async () => {
    const UserModel = ModelRegistry.instance.getTypedModel<
      IUserDocument<string, Buffer>
    >(BaseModelName.User);
    const admin = await UserModel.findOne({
      username: TestConstants.AdministratorUser,
    });
    expect(admin).not.toBeNull();
    expect(admin!.directChallenge).toBe(true);
  });

  it('should have wired up the MongoAuthenticationProvider', () => {
    expect(app.authProvider).toBeDefined();
    expect(app.authProvider).not.toBeNull();
  });

  it('should expose a working db getter (not the no-op)', () => {
    // The MongoDatabasePlugin manages the real mongoose instance
    const db = mongoPlugin.db;
    expect(db).toBeDefined();
    expect(db.connection).toBeDefined();
    expect(db.connection.readyState).toBe(1); // connected
  });

  it('should have database property as the no-op (not connected)', () => {
    // BaseApplication._database is the no-op IDatabase
    const database = app.database;
    expect(database).toBeDefined();
    expect(database.isConnected()).toBe(false); // no-op always returns false
  });

  // ── Direct login challenge flow ────────────────────────────────────

  it('should generate a valid challenge', () => {
    const challenge = userService.generateDirectLoginChallenge();
    expect(typeof challenge).toBe('string');
    // Challenge = time(8) + nonce(32) + serverSignature(SIGNATURE_SIZE) in hex
    const expectedLength = (8 + 32 + TestConstants.ECIES.SIGNATURE_SIZE) * 2;
    expect(challenge.length).toBe(expectedLength);
    expect(/^[a-f0-9]+$/.test(challenge)).toBe(true);
  });

  it('should verify a correctly signed challenge for the admin user', async () => {
    // 1. Generate challenge (server side)
    const challenge = userService.generateDirectLoginChallenge();

    // 2. Sign it with the admin user's wallet (client side)
    const adminMnemonic = new SecureString(initResult.adminMnemonic);
    const { wallet } = eciesService.walletAndSeedFromMnemonic(adminMnemonic);
    const challengeBuffer = Buffer.from(challenge, 'hex');
    const privateKeyBuffer = Buffer.from(wallet.getPrivateKey());
    const signature = eciesService.signMessage(
      privateKeyBuffer,
      challengeBuffer,
    );
    const signatureHex = Buffer.from(signature).toString('hex');

    // 3. Verify (server side)
    const result = await userService.verifyDirectLoginChallenge(
      challenge,
      signatureHex,
      TestConstants.AdministratorUser,
      undefined,
    );

    expect(result).toBeDefined();
    expect(result.userDoc).toBeDefined();
    expect(result.userDoc.username).toBe(TestConstants.AdministratorUser);
    expect(result.userMember).toBeDefined();
  });

  it('should verify a correctly signed challenge for the member user', async () => {
    const challenge = userService.generateDirectLoginChallenge();

    const memberMnemonic = new SecureString(initResult.memberMnemonic);
    const { wallet } = eciesService.walletAndSeedFromMnemonic(memberMnemonic);
    const challengeBuffer = Buffer.from(challenge, 'hex');
    const privateKeyBuffer = Buffer.from(wallet.getPrivateKey());
    const signature = eciesService.signMessage(
      privateKeyBuffer,
      challengeBuffer,
    );
    const signatureHex = Buffer.from(signature).toString('hex');

    const result = await userService.verifyDirectLoginChallenge(
      challenge,
      signatureHex,
      TestConstants.MemberUser,
      undefined,
    );

    expect(result.userDoc.username).toBe(TestConstants.MemberUser);
  });

  it('should reject a challenge signed with the wrong key', async () => {
    const challenge = userService.generateDirectLoginChallenge();

    // Sign with a random key, not the admin's
    const randomMnemonic = eciesService.generateNewMnemonic();
    const { wallet } = eciesService.walletAndSeedFromMnemonic(randomMnemonic);
    const challengeBuffer = Buffer.from(challenge, 'hex');
    const privateKeyBuffer = Buffer.from(wallet.getPrivateKey());
    const signature = eciesService.signMessage(
      privateKeyBuffer,
      challengeBuffer,
    );
    const signatureHex = Buffer.from(signature).toString('hex');

    await expect(
      userService.verifyDirectLoginChallenge(
        challenge,
        signatureHex,
        TestConstants.AdministratorUser,
        undefined,
      ),
    ).rejects.toThrow();
  });

  it('should reject a tampered challenge', async () => {
    const challenge = userService.generateDirectLoginChallenge();

    // Sign the real challenge
    const adminMnemonic = new SecureString(initResult.adminMnemonic);
    const { wallet } = eciesService.walletAndSeedFromMnemonic(adminMnemonic);
    const challengeBuffer = Buffer.from(challenge, 'hex');
    const privateKeyBuffer = Buffer.from(wallet.getPrivateKey());
    const signature = eciesService.signMessage(
      privateKeyBuffer,
      challengeBuffer,
    );
    const signatureHex = Buffer.from(signature).toString('hex');

    // Tamper with the challenge (flip a byte in the nonce region)
    const tampered = Buffer.from(challenge, 'hex');
    tampered[10] ^= 0xff;
    const tamperedHex = tampered.toString('hex');

    await expect(
      userService.verifyDirectLoginChallenge(
        tamperedHex,
        signatureHex,
        TestConstants.AdministratorUser,
        undefined,
      ),
    ).rejects.toThrow();
  });

  it('should find user by email for challenge verification', async () => {
    const challenge = userService.generateDirectLoginChallenge();

    const adminMnemonic = new SecureString(initResult.adminMnemonic);
    const { wallet } = eciesService.walletAndSeedFromMnemonic(adminMnemonic);
    const challengeBuffer = Buffer.from(challenge, 'hex');
    const privateKeyBuffer = Buffer.from(wallet.getPrivateKey());
    const signature = eciesService.signMessage(
      privateKeyBuffer,
      challengeBuffer,
    );
    const signatureHex = Buffer.from(signature).toString('hex');

    const adminEmail = `${TestConstants.AdministratorUser}@example.com`;
    const result = await userService.verifyDirectLoginChallenge(
      challenge,
      signatureHex,
      undefined,
      adminEmail,
    );

    expect(result.userDoc.email).toBe(adminEmail);
  });

  // ── JWT token generation after successful login ────────────────────

  it('should generate a valid JWT after successful challenge verification', async () => {
    const challenge = userService.generateDirectLoginChallenge();

    const adminMnemonic = new SecureString(initResult.adminMnemonic);
    const { wallet } = eciesService.walletAndSeedFromMnemonic(adminMnemonic);
    const challengeBuffer = Buffer.from(challenge, 'hex');
    const privateKeyBuffer = Buffer.from(wallet.getPrivateKey());
    const signature = eciesService.signMessage(
      privateKeyBuffer,
      challengeBuffer,
    );
    const signatureHex = Buffer.from(signature).toString('hex');

    const { userDoc } = await userService.verifyDirectLoginChallenge(
      challenge,
      signatureHex,
      TestConstants.AdministratorUser,
      undefined,
    );

    // Now sign a JWT — this is what the controller does after verification
    const jwtService = new JwtService<Buffer>(mongoApp);
    const { token, roles } = await jwtService.signToken(
      userDoc,
      app.environment.jwtSecret,
      'en-US',
    );

    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    expect(roles).toBeDefined();
    expect(Array.isArray(roles)).toBe(true);
  });

  // ── MongoAuthenticationProvider integration ────────────────────────

  it('should find user by ID via the auth provider', async () => {
    const UserModel = ModelRegistry.instance.getTypedModel<
      IUserDocument<string, Buffer>
    >(BaseModelName.User);
    const admin = await UserModel.findOne({
      username: TestConstants.AdministratorUser,
    });
    expect(admin).not.toBeNull();

    const authUser = await app.authProvider!.findUserById(String(admin!._id));
    expect(authUser).not.toBeNull();
    expect(authUser!.email).toBe(
      `${TestConstants.AdministratorUser}@example.com`,
    );
  });

  it('should build a RequestUserDTO via the auth provider', async () => {
    const UserModel = ModelRegistry.instance.getTypedModel<
      IUserDocument<string, Buffer>
    >(BaseModelName.User);
    const admin = await UserModel.findOne({
      username: TestConstants.AdministratorUser,
    });
    expect(admin).not.toBeNull();

    const dto = await app.authProvider!.buildRequestUserDTO(String(admin!._id));
    expect(dto).not.toBeNull();
    expect(dto!.username).toBe(TestConstants.AdministratorUser);
    expect(dto!.roles).toBeDefined();
    expect(Array.isArray(dto!.roles)).toBe(true);
  });

  it('should verify a JWT via the auth provider', async () => {
    // First generate a valid JWT
    const UserModel = ModelRegistry.instance.getTypedModel<
      IUserDocument<string, Buffer>
    >(BaseModelName.User);
    const admin = await UserModel.findOne({
      username: TestConstants.AdministratorUser,
    });
    const jwtService = new JwtService<Buffer>(mongoApp);
    const { token } = await jwtService.signToken(
      admin!,
      app.environment.jwtSecret,
      'en-US',
    );

    const tokenUser = await app.authProvider!.verifyToken(token);
    expect(tokenUser).not.toBeNull();
    expect(tokenUser!.userId).toBeDefined();
  });
});
