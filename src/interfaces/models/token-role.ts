/**
 * @fileoverview Token role model interfaces for frontend and backend.
 * Defines type aliases for token role documents with platform-specific IDs.
 * @module interfaces/models/token-role
 */

import type { PlatformID } from '@digitaldefiance/node-ecies-lib';
import { ITokenRole } from '@digitaldefiance/suite-core-lib';

/**
 * Front-end interface for token role collection documents.
 * Uses string IDs for browser compatibility.
 */
export type IFrontendTokenRole = ITokenRole<string, Date>;
/**
 * Back-end interface for token role collection documents.
 * Uses platform-specific IDs (Buffer, ObjectId, etc.).
 * @template TID - Platform ID type (defaults to Buffer)
 */
export type IBackendTokenRole<TID extends PlatformID = Buffer> = ITokenRole<
  TID,
  Date
>;
