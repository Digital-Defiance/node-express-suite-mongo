/**
 * Global test setup - initializes i18n engine for all tests
 */
import { createCoreI18nEngine } from '@digitaldefiance/i18n-lib';
import {
  initSuiteCoreI18nEngine,
  SuiteCoreComponent,
  SuiteCoreComponentStrings,
} from '@digitaldefiance/suite-core-lib';
import { LocalhostConstants } from '@digitaldefiance/node-express-suite';

// Mock argon2 for tests (native module that can fail in some environments)
// When raw: true is passed, argon2.hash returns a Buffer, not a string.
// The BackupCode class uses raw: true, so we must return a Buffer here.
jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue(Buffer.alloc(32, 0x42)),
  verify: jest.fn().mockResolvedValue(true),
  argon2id: 2,
}));

// Initialize suite-core i18n engine (registers SuiteCoreStringKey enum
// so that getCoreI18nEngine().translateStringKey() works at module load time)
// Also initializes the ecies i18n engine to prevent registerIfNotExists errors
// when ecies-lib code paths are triggered during tests
import { getEciesI18nEngine } from '@digitaldefiance/ecies-lib';
initSuiteCoreI18nEngine();
getEciesI18nEngine();

// Initialize core i18n engine
const engine = createCoreI18nEngine(undefined, {
  constants: LocalhostConstants,
});

// Register suite-core component manually
engine.registerComponent({
  component: SuiteCoreComponent,
  strings: SuiteCoreComponentStrings,
});
