/**
 * @fileoverview Service for transforming user documents into request user DTOs and backend objects.
 * Handles serialization and deserialization of user data for API requests and JWT tokens.
 * @module services/request-user
 */

import {
  IRequestUserDTO,
  IRoleDTO,
  ITokenRole,
} from '@digitaldefiance/suite-core-lib';
import { UserDocument } from '../documents';
import type { IRequestUserBackendObject } from '@digitaldefiance/node-express-suite';
import { RoleService } from './role';
import {
  getEnhancedNodeIdProvider,
  PlatformID,
} from '@digitaldefiance/node-ecies-lib';

/**
 * Service for converting between user documents, DTOs, and backend objects.
 * Provides transformation methods for user data in different contexts (API, JWT, database).
 */
export class RequestUserService<
  TID extends PlatformID,
  _TTokenRole extends ITokenRole<TID>,
> {
  public static makeRequestUserDTO<
    TID extends PlatformID,
    TLanguage extends string,
    TTokenRole extends ITokenRole<TID>,
    TRequestUserDTO extends IRequestUserDTO,
  >(
    userDoc:
      | UserDocument<TLanguage, TID>
      | (Pick<
          UserDocument<TLanguage, TID>,
          keyof UserDocument<TLanguage, TID>
        > & {
          _id: PlatformID;
        }),
    roles: TTokenRole[],
  ): TRequestUserDTO {
    if (!userDoc._id) {
      throw new Error('User document is missing _id');
    }

    const rolePrivileges = {
      admin: roles.some((r) => r.admin),
      member: roles.some((r) => r.member),
      child: roles.some((r) => r.child),
      system: roles.some((r) => r.system),
    };

    const provider = getEnhancedNodeIdProvider<TID>();
    return {
      id: provider.idToString(userDoc._id),
      email: userDoc.email,
      roles: roles.map((r) => RoleService.roleToRoleDTO(r)),
      rolePrivileges,
      username: userDoc.username,
      timezone: userDoc.timezone,
      currency: userDoc.currency,
      directChallenge: userDoc.directChallenge,
      emailVerified: userDoc.emailVerified,
      darkMode: userDoc.darkMode,
      siteLanguage: userDoc.siteLanguage as string,
      ...(userDoc.lastLogin && { lastLogin: userDoc.lastLogin.toString() }),
      ...(userDoc.displayName && { displayName: userDoc.displayName }),
    } as TRequestUserDTO;
  }

  public static hydrateRequestUser<
    TID extends PlatformID,
    TLanguage extends string,
    TRequestUserDTO extends IRequestUserDTO & { siteLanguage: TLanguage },
  >(requestUser: TRequestUserDTO): IRequestUserBackendObject<TLanguage, TID> {
    const provider = getEnhancedNodeIdProvider<TID>();
    const convert = (id: string) => provider.idFromString(id);
    const hydratedRoles = requestUser.roles.map((role: IRoleDTO) =>
      RoleService.hydrateRoleDTOToBackend<TID>(role),
    );

    const hydratedUser: IRequestUserBackendObject<TLanguage, TID> = {
      id: convert(requestUser.id),
      email: requestUser.email,
      roles: hydratedRoles,
      rolePrivileges: requestUser.rolePrivileges,
      username: requestUser.username,
      timezone: requestUser.timezone,
      currency: requestUser.currency,
      directChallenge: requestUser.directChallenge,
      emailVerified: requestUser.emailVerified,
      darkMode: requestUser.darkMode,
      siteLanguage: requestUser.siteLanguage,
    };

    if (requestUser.lastLogin) {
      hydratedUser.lastLogin = new Date(requestUser.lastLogin);
    }

    if (requestUser.displayName) {
      hydratedUser.displayName = requestUser.displayName;
    }

    return hydratedUser;
  }
}
