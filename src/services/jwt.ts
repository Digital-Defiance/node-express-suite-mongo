/**
 * @fileoverview JWT token service for authentication and authorization.
 * Handles JWT token generation, signing, and verification with role-based access control.
 * @module services/jwt
 */

import { ITokenRole, ITokenUser } from '@digitaldefiance/suite-core-lib';
import { sign } from 'jsonwebtoken';
import { UserDocument } from '../documents/user';
import {
  IApplication,
  IJwtSignResponse,
  AbstractJwtService,
} from '@digitaldefiance/node-express-suite';
import { RoleService } from './role';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Service for JWT token operations including generation, signing, and verification.
 * Integrates with role service to embed user roles in JWT tokens.
 */
export class JwtService<
  TID extends PlatformID = Buffer,
  TDate extends Date = Date,
  TTokenRole extends ITokenRole<TID, TDate> = ITokenRole<TID, TDate>,
  TTokenUser extends ITokenUser = ITokenUser,
  TApplication extends IApplication<TID> = IApplication<TID>,
> extends AbstractJwtService<TID, TTokenUser, TApplication> {
  private readonly roleService: RoleService<TID, TDate, TTokenRole>;

  constructor(application: TApplication) {
    super(application);
    this.roleService = new RoleService<TID, TDate, TTokenRole>(application);
  }

  public async signToken(
    userDoc: UserDocument<string, TID>,
    jwtSecret: string,
    overrideLanguage?: string,
  ): Promise<IJwtSignResponse<TID, TDate, TTokenRole>> {
    const roles = await this.roleService.getUserRoles(userDoc._id);
    const tokenRoles: Array<TTokenRole> = this.roleService.rolesToTokenRoles(
      roles,
      overrideLanguage,
    );
    const tokenRoleDTOs = tokenRoles.map((role) =>
      RoleService.roleToRoleDTO<TID, TDate>(role),
    );
    const roleTranslatedNames = tokenRoles.map((role) => role.translatedName);
    const roleNames = tokenRoles.map((role) => role.name);
    const tokenUser = {
      userId: userDoc._id.toString(),
      roles: tokenRoleDTOs,
    } as TTokenUser;
    // amazonq-ignore-next-line false positive
    const token = sign(tokenUser, jwtSecret, {
      algorithm: this.application.constants.JWT.ALGORITHM,
      allowInsecureKeySizes: false,
      expiresIn: this.application.constants.JWT.EXPIRATION_SEC,
    });
    return {
      token,
      tokenUser,
      roleNames,
      roleTranslatedNames,
      roles: tokenRoles,
      roleDTOs: tokenRoleDTOs,
    };
  }
}
