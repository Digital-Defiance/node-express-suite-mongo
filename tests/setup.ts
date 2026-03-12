/**
 * Global test setup - initializes i18n engine for all tests
 */
import { createCoreI18nEngine } from '@digitaldefiance/i18n-lib';
import {
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

// Initialize core i18n engine
const engine = createCoreI18nEngine(undefined, {
  constants: LocalhostConstants,
});

// Register suite-core component manually
engine.registerComponent({
  component: SuiteCoreComponent,
  strings: SuiteCoreComponentStrings,
});
