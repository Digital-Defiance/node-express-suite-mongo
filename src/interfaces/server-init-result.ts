/**
 * @fileoverview Mongo-specific server initialization result interface.
 * Extends the base IServerInitResult with Mongoose document types.
 * @module interfaces/server-init-result
 */

import type { PlatformID } from '@digitaldefiance/node-ecies-lib';
import { IServerInitResult as IBaseServerInitResult } from '@digitaldefiance/node-express-suite';
import { RoleDocument } from '../documents/role';
import { UserDocument } from '../documents/user';
import { UserRoleDocument } from '../documents/user-role';

// Re-export essential document types
export type { RoleDocument, UserDocument, UserRoleDocument };

/**
 * Mongo-specific result of server initialization.
 * Extends the base interface with Mongoose document references for
 * roles, users, and user-role associations.
 * @template TID - Platform ID type (defaults to Buffer)
 */
export interface IServerInitResult<
  TID extends PlatformID = Buffer,
> extends IBaseServerInitResult<TID> {
  adminRole: RoleDocument<TID>;
  adminUser: UserDocument<string, TID>;
  adminUserRole: UserRoleDocument<TID>;
  memberRole: RoleDocument<TID>;
  memberUser: UserDocument<string, TID>;
  memberUserRole: UserRoleDocument<TID>;
  systemRole: RoleDocument<TID>;
  systemUser: UserDocument<string, TID>;
  systemUserRole: UserRoleDocument<TID>;
}
