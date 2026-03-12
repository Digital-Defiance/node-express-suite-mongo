/**
 * @fileoverview Server initialization result interface.
 * Defines structure for test server initialization with admin, member, and system users.
 * @module interfaces/server-init-result
 */

import { Member, PlatformID } from '@digitaldefiance/node-ecies-lib';
import { RoleDocument } from '../documents/role';
import { UserDocument } from '../documents/user';
import { UserRoleDocument } from '../documents/user-role';

// Re-export essential document types
export type { RoleDocument, UserDocument, UserRoleDocument };

/**
 * Result of server initialization for testing.
 * Contains admin, member, and system user accounts with credentials and roles.
 * @template TID - Platform ID type (defaults to Buffer)
 */
export interface IServerInitResult<TID extends PlatformID = Buffer> {
  adminRole: RoleDocument<TID>;
  adminUser: UserDocument<string, TID>;
  adminUsername: string;
  adminEmail: string;
  adminMnemonic: string;
  adminPassword: string;
  adminBackupCodes: Array<string>;
  adminMember: Member<TID>;
  adminUserRole: UserRoleDocument<TID>;
  memberRole: RoleDocument<TID>;
  memberUser: UserDocument<string, TID>;
  memberUsername: string;
  memberEmail: string;
  memberMnemonic: string;
  memberPassword: string;
  memberBackupCodes: Array<string>;
  memberMember: Member<TID>;
  memberUserRole: UserRoleDocument<TID>;
  systemRole: RoleDocument<TID>;
  systemUser: UserDocument<string, TID>;
  systemUsername: string;
  systemEmail: string;
  systemMnemonic: string;
  systemPassword: string;
  systemBackupCodes: Array<string>;
  systemMember: Member<TID>;
  systemUserRole: UserRoleDocument<TID>;
}
