/**
 * @fileoverview Used direct login token model interfaces for frontend and backend.
 * Defines type aliases for tracking consumed direct login tokens.
 * @module interfaces/models/used-direct-login-token
 */

import type { PlatformID } from '@digitaldefiance/node-ecies-lib';
import { IUsedDirectLoginTokenBase } from '@digitaldefiance/suite-core-lib';

/**
 * Front-end interface for used direct login token documents.
 * Uses string IDs for browser compatibility.
 */
export type IFrontendUsedDirectLoginToken = IUsedDirectLoginTokenBase<string>;
/**
 * Back-end interface for used direct login token documents.
 * Uses platform-specific IDs (Buffer, ObjectId, etc.).
 * @template TID - Platform ID type (defaults to Buffer)
 */
export type IBackendUsedDirectLoginToken<TID extends PlatformID = Buffer> =
  IUsedDirectLoginTokenBase<TID>;
