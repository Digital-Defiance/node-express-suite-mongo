/**
 * @fileoverview Global type declarations for database initialization member caching.
 * @module services/db-init-cache
 */

import type { SecureString } from '@digitaldefiance/ecies-lib';
import type {
  Member as BackendMember,
  PlatformID,
} from '@digitaldefiance/node-ecies-lib';

/**
 * Global member cache for database initialization.
 * Stores Member instances and their associated mnemonics to avoid recreating them during tests.
 */
declare global {
  var __MEMBER_CACHE__:
    | Map<
        string,
        {
          member: BackendMember<PlatformID>;
          mnemonic: SecureString;
        }
      >
    | undefined;
}

export {};
