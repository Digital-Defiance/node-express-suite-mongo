/**
 * @fileoverview Integration test verifying that custom constants (Site, SiteTagline, etc.)
 * propagate correctly through the refactored application hierarchy:
 *   BaseApplication → Application (with MongoDatabasePlugin) → Express (via ApiRouter)
 *
 * Boots a BaseApplication with MongoDatabasePlugin and in-memory MongoDB and custom constants,
 * wires up Express + ApiRouter, and verifies the constants are accessible
 * at every layer — including from an HTTP endpoint that reads them.
 */

import { randomBytes } from 'crypto';
import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express, { Request, Response } from 'express';
import request from 'supertest';
import {
  CoreLanguageCode,
  GlobalActiveContext,
  IActiveContext,
} from '@digitaldefiance/i18n-lib';
import {
  createExpressConstants,
  Environment,
  BaseApplication,
  DummyEmailService,
  emailServiceRegistry,
} from '@digitaldefiance/node-express-suite';
import type { IConstants } from '@digitaldefiance/node-express-suite';
import type { IServerInitResult } from '../../src/interfaces/server-init-result';
import { getSchemaMap } from '../../src/schemas';
import { DatabaseInitializationService } from '../../src/services';
import { MongoDatabasePlugin } from '../../src/plugins/mongo-database-plugin';
import { ApiRouter } from '../../src/routers/api';
import { IMongoApplication } from '../../src/interfaces/mongo-application';
import type { BaseModelDocs } from '../../src/schemas/schema';

// ── Custom constants with non-default Site and SiteTagline ─────────────

const CUSTOM_SITE = 'Acme Corp Portal';
const CUSTOM_TAGLINE = 'Building the future, one commit at a time';
const CUSTOM_DESCRIPTION = 'The Acme Corp developer portal';

const CustomConstants: IConstants = createExpressConstants({
  Site: CUSTOM_SITE,
  SiteTagline: CUSTOM_TAGLINE,
  SiteDescription: CUSTOM_DESCRIPTION,
});

jest.unmock('argon2');

const hex64 = () => randomBytes(32).toString('hex');

// ── Pure constants tests (no MongoDB needed) ──────────────────────────

describe('createExpressConstants overrides', () => {
  it('overrides parameter should set Site, SiteTagline, SiteDescription', () => {
    const c = createExpressConstants({
      Site: 'Override Via Param',
      SiteTagline: 'Override Tagline Via Param',
      SiteDescription: 'Override Description Via Param',
    });

    expect(c.Site).toBe('Override Via Param');
    expect(c.SiteTagline).toBe('Override Tagline Via Param');
    expect(c.SiteDescription).toBe('Override Description Via Param');
  });

  it('spread-then-override pattern (example site style) should work', () => {
    const c: IConstants = {
      ...createExpressConstants(),
      Site: 'Spread Override Site',
      SiteTagline: 'Spread Override Tagline',
      SiteDescription: 'Spread Override Description',
    } as IConstants;

    expect(c.Site).toBe('Spread Override Site');
    expect(c.SiteTagline).toBe('Spread Override Tagline');
    expect(c.SiteDescription).toBe('Spread Override Description');
  });

  it('without overrides should have suite-core defaults', () => {
    const c = createExpressConstants();
    expect(c.Site).toBe('New Site');
    expect(c.SiteTagline).toBe('New Site Tagline');
  });
});

// ── Full integration test with MongoDB + Express ───────────────────────

describe('Constants propagation through application hierarchy', () => {
  let app: BaseApplication<Buffer>;
  let mongoPlugin: MongoDatabasePlugin<
    Buffer,
    BaseModelDocs,
    IServerInitResult<Buffer>
  >;
  let expressApp: ReturnType<typeof express>;
  let apiRouter: ApiRouter<Buffer, Date, CoreLanguageCode, string>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env['DEV_DATABASE'] = `const_prop_e2e_${Date.now()}`;
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
      const dir = join(tmpdir(), `const-prop-api-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      process.env['API_DIST_DIR'] = dir;
    }
    if (!process.env['REACT_DIST_DIR']) {
      const dir = join(tmpdir(), `const-prop-react-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      process.env['REACT_DIST_DIR'] = dir;
    }

    const context = GlobalActiveContext.getInstance<
      CoreLanguageCode,
      IActiveContext<CoreLanguageCode>
    >();
    context.setAdminLanguage('en-US');

    const env = new Environment(undefined, true, true, CustomConstants);

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
      constants: CustomConstants,
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

    app = new BaseApplication(env, noOpDb as never, CustomConstants);

    // Connect to in-memory MongoDB
    await mongoPlugin.connect();
    await mongoPlugin.init(app as never);

    // Set the auth provider from the plugin
    app.authProvider = mongoPlugin.authenticationProvider;

    // Initialize the database — creates admin, member, system users
    // This MUST happen before ApiRouter because UserController.constructor
    // calls SystemUserService.getSystemUser() which needs the system mnemonic.
    await mongoPlugin.initializeDevStore();

    // Wire up Express + ApiRouter
    expressApp = express();
    expressApp.use(express.json());
    emailServiceRegistry.setService(new DummyEmailService(app as never));
    apiRouter = new ApiRouter(mongoPlugin.mongoApplication!);
    expressApp.use('/api', apiRouter.router);

    // Add a test endpoint that returns the constants as seen from the app
    expressApp.get('/test/constants', (_req: Request, res: Response) => {
      res.json({
        site: app.constants.Site,
        siteTagline: app.constants.SiteTagline,
        siteDescription: app.constants.SiteDescription,
      });
    });
  }, 120_000);

  afterAll(async () => {
    if (mongoPlugin) {
      await mongoPlugin.disconnect();
    }
  }, 30_000);

  // ── In-memory constants checks ───────────────────────────────────────

  it('BaseApplication.constants.Site should be the custom value', () => {
    expect(app.constants.Site).toBe(CUSTOM_SITE);
  });

  it('BaseApplication.constants.SiteTagline should be the custom value', () => {
    expect(app.constants.SiteTagline).toBe(CUSTOM_TAGLINE);
  });

  it('BaseApplication.constants.SiteDescription should be the custom value', () => {
    expect(app.constants.SiteDescription).toBe(CUSTOM_DESCRIPTION);
  });

  it('constants should NOT be the suite-core defaults', () => {
    expect(app.constants.Site).not.toBe('New Site');
    expect(app.constants.SiteTagline).not.toBe('New Site Tagline');
    expect(app.constants.SiteDescription).not.toBe(
      'Description of the new site',
    );
  });

  it('domain-derived emails should come from environment.emailDomain', () => {
    // SystemEmail and SiteHostname are no longer on IConstants.
    // Emails are now derived from environment.emailDomain at runtime.
    expect(app.environment.emailDomain).toBeDefined();
  });

  // ── ApiRouter layer checks ───────────────────────────────────────────

  it('ApiRouter.application.constants should have the custom Site', () => {
    expect(apiRouter.application.constants.Site).toBe(CUSTOM_SITE);
  });

  it('ApiRouter.application.constants should have the custom SiteTagline', () => {
    expect(apiRouter.application.constants.SiteTagline).toBe(CUSTOM_TAGLINE);
  });

  // ── HTTP endpoint check ──────────────────────────────────────────────

  it('GET /test/constants should return custom constants via HTTP', async () => {
    const res = await request(expressApp).get('/test/constants').expect(200);

    expect(res.body.site).toBe(CUSTOM_SITE);
    expect(res.body.siteTagline).toBe(CUSTOM_TAGLINE);
    expect(res.body.siteDescription).toBe(CUSTOM_DESCRIPTION);
  });
});
