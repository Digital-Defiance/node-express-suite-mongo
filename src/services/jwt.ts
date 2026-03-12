/**
 * @fileoverview JWT token service for authentication and authorization.
 * Handles JWT token generation, signing, and verification with role-based access control.
 * @module services/jwt
 */

import {
  ITokenRole,
  ITokenRoleDTO,
  ITokenUser,
} from '@digitaldefiance/suite-core-lib';
import {
  JsonWebTokenError,
  JwtPayload,
  TokenExpiredError as JwtTokenExpiredError,
  sign,
  verify,
  VerifyOptions,
} from 'jsonwebtoken';
import { promisify } from 'util';
import { UserDocument } from '../documents/user';
import {
  InvalidJwtTokenError,
  TokenExpiredError,
  IApplication,
  IJwtSignResponse,
  BaseService,
} from '@digitaldefiance/node-express-suite';
import { RoleService } from './role';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

const verifyAsync = promisify<
  string,
  string | Buffer,
  VerifyOptions,
  JwtPayload | string
>(verify);

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
> extends BaseService<TID, TApplication> {
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

  public async verifyToken(token: string): Promise<TTokenUser | null> {
    try {
      const decoded = (await verifyAsync(
        token,
        this.application.environment.jwtSecret,
        {
          algorithms: [this.application.constants.JWT.ALGORITHM],
        },
      )) as JwtPayload;

      if (
        typeof decoded === 'object' &&
        decoded !== null &&
        'userId' in decoded &&
        'roles' in decoded
      ) {
        return {
          userId: decoded['userId'] as string,
          roles: decoded['roles'] as ITokenRoleDTO[],
        } as TTokenUser;
      } else {
        return null;
      }
    } catch (err) {
      if (err instanceof JwtTokenExpiredError) {
        throw new TokenExpiredError();
      } else if (err instanceof JsonWebTokenError) {
        throw err;
      }
      throw new InvalidJwtTokenError();
    }
  }
}
