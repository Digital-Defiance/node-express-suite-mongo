import { BackupCode } from '@digitaldefiance/node-express-suite';
import { RoleDocument, UserDocument, UserRoleDocument } from '../documents';
import {
  Member as BackendMember,
  PlatformID,
} from '@digitaldefiance/node-ecies-lib';

export interface DatabaseInitailizationResultTransaction<
  TID extends PlatformID,
> {
  adminRole: RoleDocument<TID>;
  memberRole: RoleDocument<TID>;
  systemRole: RoleDocument<TID>;
  systemDoc: UserDocument<string, TID>;
  systemUserRoleDoc: UserRoleDocument<TID>;
  systemPassword: string;
  systemMnemonic: string;
  systemBackupCodes: BackupCode[];
  systemMember: BackendMember<TID>;
  adminDoc: UserDocument<string, TID>;
  adminUserRoleDoc: UserRoleDocument<TID>;
  adminPassword: string;
  adminMnemonic: string;
  adminBackupCodes: BackupCode[];
  adminMember: BackendMember<TID>;
  memberDoc: UserDocument<string, TID>;
  memberUserRoleDoc: UserRoleDocument<TID>;
  memberPassword: string;
  memberMnemonic: string;
  memberBackupCodes: BackupCode[];
  memberUser: BackendMember<TID>;
}
