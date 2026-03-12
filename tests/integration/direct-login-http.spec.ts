/**
 * @fileoverview HTTP-level integration test for the direct login challenge flow.
 * Boots a BaseApplication with MongoDatabasePlugin and in-memory MongoDB, wires up Express + ApiRouter,
 * and exercises the actual HTTP endpoints for request-direct-login and direct-challenge.
 *
 * This test catches regressions that only manifest at the controller/HTTP layer,
 * such as transaction handling, error serialization, and middleware wiring.
 */

import { randomBytes } from 'crypto';
import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import request from 'supertest';
import {
  CoreLanguageCode,
  GlobalActiveContext,
  IActiveContext,
} from '@digitaldefiance/i18n-lib';
import { ECIESService } from '@digitaldefiance/node-ecies-lib';
import { IECIESConfig, SecureString } from '@digitaldefiance/ecies-lib';
import { createExpressConstants, ECIES } from '@digitaldefiance/node-express-suite';
import { Environment } from '@digitaldefiance/node-express-suite';
import { getSchemaMap } from '../../src/schemas';
import { DatabaseInitializationService } from '../../src/services';
import { MongooseDocumentStore } from '../../src/services/mongoose-document-store';
import { BaseApplication } from '@digitaldefiance/node-express-suite';
import { MongoDatabasePlugin } from '../../src/plugins/mongo-database-plugin';
import { ApiRouter } from '../../src/routers/api';
import type { IConstants } from '@digitaldefiance/node-express-suite';
import type { IServerInitResult } from '../../src/interfaces/server-init-result';
import { IMongoApplication } from '../../src/interfaces/mongo-application';
import { DummyEmailService } from '@digitaldefiance/node-express-suite';
import { emailServiceRegistry } from '@digitaldefiance/node-express-suite';
import type { BaseModelDocs } from '../../src/schemas/schema';

const TestConstants: IConstants = createExpressConstants();

jest.unmock('argon2');

const hex64 = () => randomBytes(32).toString('hex');

const eciesConfig: IECIESConfig = {
  curveName: ECIES.CURVE_NAME,
  primaryKeyDerivationPath: ECIES.PRIMARY_KEY_DERIVATION_PATH,
  mnemonicStrength: ECIES.MNEMONIC_STRENGTH,
  symmetricAlgorithm: ECIES.SYMMETRIC_ALGORITHM_CONFIGURATION,
  symmetricKeyBits: ECIES.SYMMETRIC.KEY_BITS,
  symmetricKeyMode: ECIES.SYMMETRIC.MODE,
};

describe('Direct login HTTP endpoints (real MongoDB + Express)', () => {
  let app: BaseApplication<Buffer>;
  let mongoPlugin: MongoDatabasePlugin<
    Buffer,
    BaseModelDocs,
    IServerInitResult<Buffer>
  >;
  let expressApp: ReturnType<typeof express>;
  let initResult: IServerInitResult<Buffer>;
  let eciesService: ECIESService<Buffer>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env['DEV_DATABASE'] = `dl_http_e2e_${Date.now()}`;
    process.env['MONGO_USE_TRANSACTIONS'] = 'false';
    process.env['PORT'] = String(Math.floor(Math.random() * 10000) + 40000);
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
      const dir = join(tmpdir(), `dl-http-api-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      process.env['API_DIST_DIR'] = dir;
    }
    if (!process.env['REACT_DIST_DIR']) {
      const dir = join(tmpdir(), `dl-http-react-${Date.now()}`);
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

    // Connect to in-memory MongoDB
    await mongoPlugin.connect();
    await mongoPlugin.init(app as never);

    // Set the auth provider from the plugin
    app.authProvider = mongoPlugin.authenticationProvider;

    // Initialize the database — creates admin, member, system users
    initResult =
      (await mongoPlugin.initializeDevStore()) as IServerInitResult<Buffer>;

    // Wire up Express + ApiRouter — same as Application.start() does
    expressApp = express();
    expressApp.use(express.json());
    emailServiceRegistry.setService(new DummyEmailService(app as never));
    const apiRouter = new ApiRouter(mongoPlugin.mongoApplication!);
    expressApp.use('/api', apiRouter.router);

    eciesService = new ECIESService<Buffer>(eciesConfig);
  }, 120_000);

  afterAll(async () => {
    if (mongoPlugin) {
      await mongoPlugin.disconnect();
    }
  }, 30_000);

  // ── HTTP endpoint tests ────────────────────────────────────────────

  it('POST /api/user/request-direct-login should return a challenge', async () => {
    const res = await request(expressApp)
      .post('/api/user/request-direct-login')
      .expect(200);

    expect(res.body.challenge).toBeDefined();
    expect(typeof res.body.challenge).toBe('string');
    expect(/^[a-f0-9]+$/.test(res.body.challenge)).toBe(true);
    expect(res.body.message).toBeDefined();
  });

  it('POST /api/user/direct-challenge should authenticate with valid signature', async () => {
    // 1. Request a challenge via HTTP
    const challengeRes = await request(expressApp)
      .post('/api/user/request-direct-login')
      .expect(200);

    const challenge: string = challengeRes.body.challenge;

    // 2. Sign the challenge with the admin user's wallet
    const adminMnemonic = new SecureString(initResult.adminMnemonic);
    const { wallet } = eciesService.walletAndSeedFromMnemonic(adminMnemonic);
    const challengeBuffer = Buffer.from(challenge, 'hex');
    const privateKeyBuffer = Buffer.from(wallet.getPrivateKey());
    const signature = eciesService.signMessage(
      privateKeyBuffer,
      challengeBuffer,
    );
    const signatureHex = Buffer.from(signature).toString('hex');

    // 3. Submit the signed challenge via HTTP
    const loginRes = await request(expressApp)
      .post('/api/user/direct-challenge')
      .send({
        challenge,
        signature: signatureHex,
        username: TestConstants.AdministratorUser,
      })
      .expect(200);

    expect(loginRes.body.token).toBeDefined();
    expect(typeof loginRes.body.token).toBe('string');
    expect(loginRes.body.token.split('.')).toHaveLength(3); // JWT
    expect(loginRes.body.user).toBeDefined();
    expect(loginRes.body.user.username).toBe(TestConstants.AdministratorUser);
  });

  it('POST /api/user/direct-challenge should authenticate member user', async () => {
    const challengeRes = await request(expressApp)
      .post('/api/user/request-direct-login')
      .expect(200);

    const challenge: string = challengeRes.body.challenge;
    const memberMnemonic = new SecureString(initResult.memberMnemonic);
    const { wallet } = eciesService.walletAndSeedFromMnemonic(memberMnemonic);
    const challengeBuffer = Buffer.from(challenge, 'hex');
    const privateKeyBuffer = Buffer.from(wallet.getPrivateKey());
    const signature = eciesService.signMessage(
      privateKeyBuffer,
      challengeBuffer,
    );
    const signatureHex = Buffer.from(signature).toString('hex');

    const loginRes = await request(expressApp)
      .post('/api/user/direct-challenge')
      .send({
        challenge,
        signature: signatureHex,
        username: TestConstants.MemberUser,
      })
      .expect(200);

    expect(loginRes.body.token).toBeDefined();
    expect(loginRes.body.user.username).toBe(TestConstants.MemberUser);
  });

  it('POST /api/user/direct-challenge should authenticate by email', async () => {
    const challengeRes = await request(expressApp)
      .post('/api/user/request-direct-login')
      .expect(200);

    const challenge: string = challengeRes.body.challenge;
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
    const loginRes = await request(expressApp)
      .post('/api/user/direct-challenge')
      .send({
        challenge,
        signature: signatureHex,
        email: adminEmail,
      })
      .expect(200);

    expect(loginRes.body.token).toBeDefined();
    expect(loginRes.body.user.email).toBe(adminEmail);
  });

  it('POST /api/user/direct-challenge should reject wrong signature', async () => {
    const challengeRes = await request(expressApp)
      .post('/api/user/request-direct-login')
      .expect(200);

    const challenge: string = challengeRes.body.challenge;

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

    const loginRes = await request(expressApp)
      .post('/api/user/direct-challenge')
      .send({
        challenge,
        signature: signatureHex,
        username: TestConstants.AdministratorUser,
      });

    // Should NOT be 200
    expect(loginRes.status).toBeGreaterThanOrEqual(400);
  });

  it('POST /api/user/direct-challenge should reject tampered challenge', async () => {
    const challengeRes = await request(expressApp)
      .post('/api/user/request-direct-login')
      .expect(200);

    const challenge: string = challengeRes.body.challenge;

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

    // Tamper with the challenge
    const tampered = Buffer.from(challenge, 'hex');
    tampered[10] ^= 0xff;
    const tamperedHex = tampered.toString('hex');

    const loginRes = await request(expressApp)
      .post('/api/user/direct-challenge')
      .send({
        challenge: tamperedHex,
        signature: signatureHex,
        username: TestConstants.AdministratorUser,
      });

    expect(loginRes.status).toBeGreaterThanOrEqual(400);
  });

  it('POST /api/user/direct-challenge should return proper error shape (not [object Object])', async () => {
    const challengeRes = await request(expressApp)
      .post('/api/user/request-direct-login')
      .expect(200);

    const challenge: string = challengeRes.body.challenge;

    // Use a random key to trigger InvalidChallengeResponseError
    const randomMnemonic = eciesService.generateNewMnemonic();
    const { wallet } = eciesService.walletAndSeedFromMnemonic(randomMnemonic);
    const challengeBuffer = Buffer.from(challenge, 'hex');
    const privateKeyBuffer = Buffer.from(wallet.getPrivateKey());
    const signature = eciesService.signMessage(
      privateKeyBuffer,
      challengeBuffer,
    );
    const signatureHex = Buffer.from(signature).toString('hex');

    const loginRes = await request(expressApp)
      .post('/api/user/direct-challenge')
      .send({
        challenge,
        signature: signatureHex,
        username: TestConstants.AdministratorUser,
      });

    expect(loginRes.status).toBeGreaterThanOrEqual(400);

    // Verify the error response shape — the `error` field should be an object
    // with a `message` string, NOT a plain string "[object Object]"
    expect(loginRes.body.message).toBeDefined();
    expect(typeof loginRes.body.message).toBe('string');
    if (loginRes.body.error) {
      expect(typeof loginRes.body.error).toBe('object');
      expect(typeof loginRes.body.error.message).toBe('string');
      expect(loginRes.body.error.message).not.toBe('[object Object]');
    }
  });

  it('POST /api/user/direct-challenge should reject missing username and email', async () => {
    const challengeRes = await request(expressApp)
      .post('/api/user/request-direct-login')
      .expect(200);

    const challenge: string = challengeRes.body.challenge;
    const adminMnemonic = new SecureString(initResult.adminMnemonic);
    const { wallet } = eciesService.walletAndSeedFromMnemonic(adminMnemonic);
    const challengeBuffer = Buffer.from(challenge, 'hex');
    const privateKeyBuffer = Buffer.from(wallet.getPrivateKey());
    const signature = eciesService.signMessage(
      privateKeyBuffer,
      challengeBuffer,
    );
    const signatureHex = Buffer.from(signature).toString('hex');

    // Send without username or email
    const loginRes = await request(expressApp)
      .post('/api/user/direct-challenge')
      .send({
        challenge,
        signature: signatureHex,
      });

    expect(loginRes.status).toBeGreaterThanOrEqual(400);
  });

  // ── Token verification after login ─────────────────────────────────

  it('GET /api/user/verify should validate a JWT from direct login', async () => {
    // First, do a successful login
    const challengeRes = await request(expressApp)
      .post('/api/user/request-direct-login')
      .expect(200);

    const challenge: string = challengeRes.body.challenge;
    const adminMnemonic = new SecureString(initResult.adminMnemonic);
    const { wallet } = eciesService.walletAndSeedFromMnemonic(adminMnemonic);
    const challengeBuffer = Buffer.from(challenge, 'hex');
    const privateKeyBuffer = Buffer.from(wallet.getPrivateKey());
    const signature = eciesService.signMessage(
      privateKeyBuffer,
      challengeBuffer,
    );
    const signatureHex = Buffer.from(signature).toString('hex');

    const loginRes = await request(expressApp)
      .post('/api/user/direct-challenge')
      .send({
        challenge,
        signature: signatureHex,
        username: TestConstants.AdministratorUser,
      })
      .expect(200);

    const token: string = loginRes.body.token;

    // Now verify the token
    const verifyRes = await request(expressApp)
      .get('/api/user/verify')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(verifyRes.body.user).toBeDefined();
    expect(verifyRes.body.user.username).toBe(TestConstants.AdministratorUser);
  });
});
