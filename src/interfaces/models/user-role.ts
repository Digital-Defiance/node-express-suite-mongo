/**
 * @fileoverview User-role model interfaces for frontend and backend.
 * Defines type aliases for user-role relationship documents.
 * @module interfaces/models/user-role
 */

import type { PlatformID } from '@digitaldefiance/node-ecies-lib';
import { IUserRoleBase } from '@digitaldefiance/suite-core-lib';

/**
 * Front-end interface for user role collection documents.
 * Uses string IDs for browser compatibility.
 */
export type IFrontendUserRole = IUserRoleBase<string, Date>;
/**
 * Back-end interface for user role collection documents.
 * Uses platform-specific IDs (Buffer, ObjectId, etc.).
 * @template TID - Platform ID type (defaults to Buffer)
 */
export type IBackendUserRole<TID extends PlatformID = Buffer> = IUserRoleBase<
  TID,
  Date
>;
