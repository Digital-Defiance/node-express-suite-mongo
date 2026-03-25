/**
 * @fileoverview User controller handling authentication, registration, and user management endpoints.
 * Provides comprehensive user operations including login, password management, and settings.
 * @module controllers/user
 */

import { ECIES, SecureString, UINT64_SIZE } from '@digitaldefiance/ecies-lib';
import {
  CoreLanguageCode,
  HandleableError,
  isValidTimezone,
  LanguageCodes,
} from '@digitaldefiance/i18n-lib';
import {
  Member as BackendMember,
  ECIESService,
  getEnhancedNodeIdProvider,
  PlatformID,
} from '@digitaldefiance/node-ecies-lib';
import {
  Constants,
  AccountStatus,
  EmailTokenType,
  GenericValidationError,
  getSuiteCoreTranslation,
  ITokenRole,
  ITokenUser,
  IUserBase,
  SuiteCoreStringKey,
  UsernameOrEmailRequiredError,
} from '@digitaldefiance/suite-core-lib';
import type { NextFunction, Request, Response } from 'express';
import { body, ValidationChain } from 'express-validator';
import { z } from 'zod';
import {
  BackupCode,
  DecoratorBaseController,
  Controller,
  Get,
  Post,
  Environment,
  MnemonicOrPasswordRequiredError,
  IApiChallengeResponse,
  IApiCodeCountResponse,
  IApiLoginResponse,
  IApiMessageResponse,
  IApiMnemonicResponse,
  IApiRegistrationResponse,
  IApiRequestUserResponse,
  IApiUserSettingsResponse,
  IApiBackupCodesResponse,
  IConstants,
  IStatusCodeResponse,
  findAuthToken,
  SystemUserService,
  requireValidatedFieldsAsync,
} from '@digitaldefiance/node-express-suite';
import type { ApiErrorResponse } from '@digitaldefiance/node-express-suite';
import { JwtService } from '../services/jwt';
import { RequestUserService } from '../services/request-user';
import { BaseDocument } from '../documents';
import { UserDocument } from '../documents/user';
import { BaseModelName } from '../enumerations/base-model-name';
import type { IMongoApplication } from '../interfaces/mongo-application';
import { BackupCodeService } from '../services/backup-code';
import { RoleService } from '../services/role';
import { UserService } from '../services/user';
import { withMongoTransaction } from '../utils/mongo-transaction';
import { getSuiteCoreI18nEngine } from '@digitaldefiance/suite-core-lib';

const isString = (v: unknown): v is string => typeof v === 'string';
const i18nEngine = getSuiteCoreI18nEngine();

const RegisterSchema = z
  .object({
    username: z.string({
      required_error: i18nEngine.translateStringKey(
        SuiteCoreStringKey.Validation_Required,
      ),
    }),
    email: z.string({
      required_error: i18nEngine.translateStringKey(
        SuiteCoreStringKey.Validation_Required,
      ),
    }),
    timezone: z.string({
      required_error: i18nEngine.translateStringKey(
        SuiteCoreStringKey.Validation_Required,
      ),
    }),
    password: z
      .string()
      .min(
        8,
        i18nEngine.translateStringKey(
          SuiteCoreStringKey.Validation_PasswordMinLengthTemplate,
        ),
      )
      .optional(),
    mnemonic: z
      .string()
      .min(
        1,
        i18nEngine.translateStringKey(
          SuiteCoreStringKey.Validation_MnemonicRegex,
        ),
      )
      .optional(),
    ...(Constants.EnableDisplayName
      ? {
          displayName: z
            .string()
            .min(Constants.DisplayNameMinLength)
            .max(Constants.DisplayNameMaxLength)
            .regex(
              Constants.DisplayNameRegex,
              i18nEngine.translateStringKey(
                SuiteCoreStringKey.Validation_DisplayNameRegexErrorTemplate,
              ),
            ),
        }
      : {}),
  })
  .refine((data) => data.password || data.mnemonic, {
    message: i18nEngine.translateStringKey(
      SuiteCoreStringKey.Validation_MnemonicOrPasswordRequired,
    ),
    path: ['password'],
  });

const EmailLoginChallengeSchema = z.object({
  token: z.string({
    required_error: i18nEngine.translateStringKey(
      SuiteCoreStringKey.Validation_TokenRequired,
    ),
  }),
  signature: z.string({
    required_error: i18nEngine.translateStringKey(
      SuiteCoreStringKey.Validation_Required,
    ),
  }),
  email: z
    .string()
    .regex(
      Constants.EmailRegex,
      i18nEngine.translateStringKey(SuiteCoreStringKey.Validation_InvalidEmail),
    )
    .optional(),
  username: z
    .string()
    .regex(
      Constants.UsernameRegex,
      i18nEngine.translateStringKey(
        SuiteCoreStringKey.Validation_UsernameRegexErrorTemplate,
      ),
    )
    .optional(),
});

const DirectLoginChallengeSchema = z.object({
  challenge: z.string({
    required_error: i18nEngine.translateStringKey(
      SuiteCoreStringKey.Validation_Required,
    ),
  }),
  signature: z.string({
    required_error: i18nEngine.translateStringKey(
      SuiteCoreStringKey.Validation_Required,
    ),
  }),
  email: z
    .string()
    .regex(
      Constants.EmailRegex,
      i18nEngine.translateStringKey(SuiteCoreStringKey.Validation_InvalidEmail),
    )
    .optional(),
  username: z
    .string()
    .regex(
      Constants.UsernameRegex,
      i18nEngine.translateStringKey(
        SuiteCoreStringKey.Validation_UsernameRegexErrorTemplate,
      ),
    )
    .optional(),
});

/**
 * User controller handling all user-related API endpoints.
 * Manages authentication, registration, password operations, settings, and backup codes.
 * @template TID Platform ID type
 * @template TDate Date type
 * @template TLanguage Site language string type
 * @template TAccountStatus Account status string type
 * @template TUser User base type
 * @template TTokenRole Token role type
 * @template TTokenUser Token user type
 * @template TApplication Application type
 */
@Controller()
export class UserController<
  TID extends PlatformID = Buffer,
  TDate extends Date = Date,
  TLanguage extends CoreLanguageCode = CoreLanguageCode,
  TAccountStatus extends string = string,
  TUser extends IUserBase<TID, TDate, TLanguage, TAccountStatus> = IUserBase<
    TID,
    TDate,
    TLanguage,
    TAccountStatus
  >,
  TTokenRole extends ITokenRole<TID, TDate> = ITokenRole<TID, TDate>,
  TTokenUser extends ITokenUser = ITokenUser,
  TApplication extends IMongoApplication<TID> = IMongoApplication<TID>,
> extends DecoratorBaseController<TLanguage, TID, TApplication> {
  protected readonly userService: UserService<
    UserDocument,
    TID,
    TDate,
    TLanguage,
    TAccountStatus,
    Environment<TID>,
    IConstants,
    BaseDocument<UserDocument, TID>,
    TUser,
    TTokenRole,
    TApplication
  >;
  protected readonly jwtService: JwtService<
    TID,
    TDate,
    TTokenRole,
    TTokenUser,
    TApplication
  >;
  protected readonly backupCodeService: BackupCodeService<
    TID,
    TDate,
    TTokenRole,
    TApplication
  >;
  protected readonly roleService: RoleService<TID, TDate, TTokenRole>;
  protected readonly eciesService: ECIESService<TID>;
  protected readonly systemUser: BackendMember<TID>;

  constructor(
    application: TApplication,
    jwtService: JwtService<TID, TDate, TTokenRole, TTokenUser, TApplication>,
    userService: UserService<
      any,
      TID,
      TDate,
      TLanguage,
      TAccountStatus,
      any,
      any,
      any,
      TUser,
      TTokenRole,
      TApplication
    >,
    backupCodeService: BackupCodeService<TID, TDate, TTokenRole, TApplication>,
    roleService: RoleService<TID, TDate, TTokenRole>,
    eciesService: ECIESService<TID>,
  ) {
    super(application);
    this.jwtService = jwtService;
    this.userService = userService;
    this.backupCodeService = backupCodeService;
    this.roleService = roleService;
    this.eciesService = eciesService;
    this.systemUser = SystemUserService.getSystemUser<TID>(
      application.environment,
      application.constants,
    );
  }

  @Get('/verify', { auth: true })
  async tokenVerifiedResponse(
    req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiRequestUserResponse | ApiErrorResponse>> {
    if (!req.user) {
      throw new HandleableError(
        new Error(
          getSuiteCoreTranslation(SuiteCoreStringKey.Common_NoUserOnRequest),
        ),
        {
          statusCode: 401,
        },
      );
    }
    const user = {
      id: req.user.id,
      email: req.user.email,
      username: req.user.username,
      roles: req.user.roles || [],
      rolePrivileges: req.user.rolePrivileges,
      timezone: req.user.timezone,
      currency: req.user.currency,
      emailVerified: req.user.emailVerified,
      darkMode: req.user.darkMode,
      siteLanguage: req.user.siteLanguage,
      directChallenge: req.user.directChallenge,
      ...(req.user.displayName && { displayName: req.user.displayName }),
      ...(req.user.lastLogin && { lastLogin: req.user.lastLogin }),
    };
    return {
      statusCode: 200,
      response: {
        message: getSuiteCoreTranslation(
          SuiteCoreStringKey.Validation_TokenValid,
        ),
        user,
      },
    };
  }

  @Get('/refresh-token', { auth: true })
  async refreshToken(
    req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiLoginResponse | ApiErrorResponse>> {
    const token = findAuthToken(req.headers);
    if (!token) {
      throw new GenericValidationError(
        getSuiteCoreTranslation(SuiteCoreStringKey.Validation_TokenMissing),
      );
    }

    const tokenUser = await this.jwtService.verifyToken(token);
    if (!tokenUser) {
      throw new GenericValidationError(
        getSuiteCoreTranslation(SuiteCoreStringKey.Validation_TokenInvalid),
      );
    }

    const UserModel = this.application.getModel<UserDocument<string, TID>>(
      BaseModelName.User,
    );
    const userDoc = await UserModel.findById(tokenUser.userId).select(
      '-password',
    );
    if (!userDoc || userDoc.accountStatus !== AccountStatus.Active) {
      throw new GenericValidationError(
        getSuiteCoreTranslation(SuiteCoreStringKey.Validation_UserNotFound),
      );
    }
    const { token: newToken, roles } = await this.jwtService.signToken(
      userDoc,
      this.application.environment.jwtSecret,
      (req.user?.siteLanguage as string) ?? LanguageCodes.EN_US,
    );

    return {
      statusCode: 200,
      response: {
        message: getSuiteCoreTranslation(SuiteCoreStringKey.TokenRefreshed),
        user: RequestUserService.makeRequestUserDTO(userDoc, roles),
        token: newToken,
        serverPublicKey: this.application.environment.systemPublicKeyHex ?? '',
      },
      headers: {
        Authorization: `Bearer ${newToken}`,
      },
    };
  }

  @Post('/register', {
    schema: RegisterSchema,
    validation: function (validationLanguage: TLanguage) {
      const constants = this.constants;
      const validationChain: ValidationChain[] = [
        body('username')
          .matches(constants.UsernameRegex)
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_UsernameRegexErrorTemplate,
              undefined,
              validationLanguage,
            ),
          ),
        body('email')
          .isEmail()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_InvalidEmail,
              undefined,
              validationLanguage,
            ),
          ),
        body('timezone')
          .isString()
          .custom((value) => isValidTimezone(value))
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_TimezoneInvalid,
              undefined,
              validationLanguage,
            ),
          ),
        body('password')
          .optional()
          .matches(constants.PasswordRegex)
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_PasswordRegexErrorTemplate,
            ),
          ),
        body('mnemonic')
          .optional()
          .isString()
          .trim()
          .matches(constants.MnemonicRegex)
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_MnemonicRegex,
              undefined,
              validationLanguage,
            ),
          ),
      ];

      if (constants.EnableDisplayName) {
        validationChain.push(
          body('displayName')
            .isString()
            .notEmpty()
            .withMessage(
              getSuiteCoreTranslation(
                SuiteCoreStringKey.Validation_Required,
                undefined,
                validationLanguage,
              ),
            )
            .matches(constants.DisplayNameRegex)
            .withMessage(
              getSuiteCoreTranslation(
                SuiteCoreStringKey.Validation_DisplayNameRegexErrorTemplate,
                undefined,
                validationLanguage,
              ),
            ),
        );
      }

      return validationChain;
    },
  })
  async register(
    req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiRegistrationResponse | ApiErrorResponse>> {
    return await withMongoTransaction(
      this.application.db.connection,
      this.application.environment.mongo.useTransactions,
      undefined,
      async (sess) => {
        return await requireValidatedFieldsAsync(
          req,
          RegisterSchema,
          async ({
            username,
            email,
            timezone,
            password,
            mnemonic,
            displayName,
          }) => {
            if (
              !isString(username) ||
              !isString(email) ||
              !isString(timezone)
            ) {
              throw new GenericValidationError(
                getSuiteCoreTranslation(
                  SuiteCoreStringKey.Validation_MissingValidatedData,
                ),
              );
            }

            const {
              user,
              mnemonic: resultMnemonic,
              backupCodes,
            } = await this.userService.newUser(
              this.systemUser,
              {
                username: username.trim(),
                email: email.trim(),
                timezone: timezone,
                ...(displayName
                  ? { displayName: (displayName as string).trim() }
                  : {}),
              },
              undefined,
              undefined,
              sess,
              this.application.environment.debug,
              password as string | undefined,
              mnemonic as string | undefined,
            );

            await this.userService.createAndSendEmailToken(
              user,
              EmailTokenType.AccountVerification,
              sess,
              this.application.environment.debug,
            );

            return {
              statusCode: 201,
              response: {
                message: getSuiteCoreTranslation(
                  SuiteCoreStringKey.Registration_Success,
                  { MNEMONIC: resultMnemonic },
                ),
                mnemonic: resultMnemonic,
                backupCodes,
              },
            };
          },
        );
      },
      {
        timeoutMs: this.application.environment.mongo.transactionTimeout * 30,
      },
    );
  }

  @Post('/account-verification', {
    validation: function (validationLanguage: TLanguage) {
      const constants = this.constants;
      return [
        body('token')
          .not()
          .isEmpty()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_TokenRequired,
              undefined,
              validationLanguage,
            ),
          )
          .matches(new RegExp(`^[a-f0-9]{${constants.EmailTokenLength * 2}}$`))
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_InvalidToken,
              undefined,
              validationLanguage,
            ),
          ),
      ];
    },
  })
  async completeAccountVerification(
    _req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiMessageResponse | ApiErrorResponse>> {
    const { token } = this.validatedBody as { token?: unknown };

    return await withMongoTransaction(
      this.application.db.connection,
      this.application.environment.mongo.useTransactions,
      undefined,
      async (sess) => {
        await this.userService.verifyAccountTokenAndComplete(
          token as string,
          sess,
        );
        return {
          statusCode: 200,
          response: {
            message: getSuiteCoreTranslation(
              SuiteCoreStringKey.EmailVerification_Success,
            ),
          },
        };
      },
    );
  }

  @Post('/language', {
    auth: true,
    validation: function (validationLanguage: TLanguage) {
      return [
        body('language')
          .isString()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_InvalidLanguage,
              undefined,
              validationLanguage,
            ),
          )
          .isIn(Object.values(LanguageCodes))
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_InvalidLanguage,
              undefined,
              validationLanguage,
            ),
          ),
      ];
    },
  })
  async setLanguage(
    req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiRequestUserResponse | ApiErrorResponse>> {
    return await withMongoTransaction(
      this.application.db.connection,
      this.application.environment.mongo.useTransactions,
      undefined,
      async (sess) => {
        const { language } = this.validatedBody as { language?: unknown };
        if (!req.user) {
          throw new HandleableError(
            new Error(
              getSuiteCoreTranslation(
                SuiteCoreStringKey.Common_NoUserOnRequest,
              ),
            ),
            { statusCode: 401 },
          );
        }

        const user = await this.userService.updateSiteLanguage(
          req.user.id,
          language as string,
          sess,
        );

        return {
          statusCode: 200,
          response: {
            message: getSuiteCoreTranslation(
              SuiteCoreStringKey.LanguageUpdate_Success,
            ),
            user,
          },
        };
      },
    );
  }

  @Post('/dark-mode', {
    auth: true,
    validation: function (validationLanguage: TLanguage) {
      return [
        body('darkMode')
          .isBoolean()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_Required,
              undefined,
              validationLanguage,
            ),
          ),
      ];
    },
  })
  async setDarkMode(
    req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiRequestUserResponse | ApiErrorResponse>> {
    return await withMongoTransaction(
      this.application.db.connection,
      this.application.environment.mongo.useTransactions,
      undefined,
      async (sess) => {
        const { darkMode } = this.validatedBody as { darkMode?: unknown };
        if (!req.user) {
          throw new HandleableError(
            new Error(
              getSuiteCoreTranslation(
                SuiteCoreStringKey.Common_NoUserOnRequest,
              ),
            ),
            { statusCode: 401 },
          );
        }

        const user = await this.userService.updateDarkMode(
          req.user.id,
          darkMode as boolean,
          sess,
        );

        return {
          statusCode: 200,
          response: {
            message: getSuiteCoreTranslation(
              SuiteCoreStringKey.Settings_DarkModeSuccess,
            ),
            user,
          },
        };
      },
    );
  }

  @Get('/settings', { auth: true })
  async getSettings(
    req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiUserSettingsResponse | ApiErrorResponse>> {
    if (!req.user) {
      throw new HandleableError(
        new Error(
          getSuiteCoreTranslation(SuiteCoreStringKey.Common_NoUserOnRequest),
        ),
        { statusCode: 401 },
      );
    }

    const UserModel = this.application.getModel<UserDocument<string, TID>>(
      BaseModelName.User,
    );
    const userDoc = await UserModel.findById(req.user.id);

    return {
      statusCode: 200,
      response: {
        message: getSuiteCoreTranslation(
          SuiteCoreStringKey.Settings_RetrievedSuccess,
        ),
        settings: {
          email: userDoc?.email || '',
          timezone: userDoc?.timezone || '',
          currency: userDoc?.currency || '',
          siteLanguage: userDoc?.siteLanguage || '',
          darkMode: userDoc?.darkMode || false,
          directChallenge: userDoc?.directChallenge || false,
          ...(userDoc?.displayName ? { displayName: userDoc.displayName } : {}),
        },
      },
    };
  }

  @Post('/settings', {
    auth: true,
    validation: function (validationLanguage: TLanguage) {
      return [
        body('email')
          .optional()
          .isEmail()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_InvalidEmail,
              undefined,
              validationLanguage,
            ),
          ),
        body('timezone')
          .optional()
          .isString()
          .custom((value) => isValidTimezone(value))
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_TimezoneInvalid,
              undefined,
              validationLanguage,
            ),
          ),
        body('siteLanguage')
          .optional()
          .isString()
          .isIn(Object.values(LanguageCodes))
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_InvalidLanguage,
              undefined,
              validationLanguage,
            ),
          ),
        body('currency')
          .optional()
          .isString()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_CurrencyCodeRequired,
              undefined,
              validationLanguage,
            ),
          ),
        body('darkMode')
          .optional()
          .isBoolean()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_Required,
              undefined,
              validationLanguage,
            ),
          ),
        body('directChallenge')
          .optional()
          .isBoolean()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_Required,
              undefined,
              validationLanguage,
            ),
          ),
        ...(Constants.EnableDisplayName
          ? [
              body('displayName')
                .optional()
                .isString()
                .isLength({
                  min: Constants.DisplayNameMinLength,
                  max: Constants.DisplayNameMaxLength,
                })
                .matches(Constants.DisplayNameRegex)
                .withMessage(
                  getSuiteCoreTranslation(
                    SuiteCoreStringKey.Validation_DisplayNameRegexErrorTemplate,
                    undefined,
                    validationLanguage,
                  ),
                ),
            ]
          : []),
      ];
    },
  })
  async updateSettings(
    req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiRequestUserResponse | ApiErrorResponse>> {
    return await withMongoTransaction(
      this.application.db.connection,
      this.application.environment.mongo.useTransactions,
      undefined,
      async (sess) => {
        const {
          email,
          timezone,
          siteLanguage,
          currency,
          darkMode,
          directChallenge,
          displayName,
        } = this.validatedBody;
        if (!req.user) {
          throw new HandleableError(
            new Error(
              getSuiteCoreTranslation(
                SuiteCoreStringKey.Common_NoUserOnRequest,
              ),
            ),
            { statusCode: 401 },
          );
        }

        const user = await this.userService.updateUserSettings(
          req.user.id,
          {
            ...(email !== undefined && { email: email as string }),
            ...(timezone !== undefined && { timezone: timezone as string }),
            ...(siteLanguage !== undefined && {
              siteLanguage: siteLanguage as TLanguage,
            }),
            ...(currency !== undefined && { currency: currency as string }),
            ...(darkMode !== undefined && { darkMode: darkMode as boolean }),
            ...(directChallenge !== undefined && {
              directChallenge: directChallenge as boolean,
            }),
            ...(displayName !== undefined && {
              displayName: displayName as string,
            }),
          },
          sess,
        );

        return {
          statusCode: 200,
          response: {
            message: getSuiteCoreTranslation(
              SuiteCoreStringKey.Settings_SaveSuccess,
            ),
            user,
          },
        };
      },
    );
  }

  @Get('/backup-codes', { auth: true })
  async getBackupCodeCount(
    req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiCodeCountResponse | ApiErrorResponse>> {
    if (!req.user) {
      throw new HandleableError(
        new Error(
          getSuiteCoreTranslation(SuiteCoreStringKey.Common_NoUserOnRequest),
        ),
        { statusCode: 401 },
      );
    }

    const UserModel = this.application.getModel<UserDocument<string, TID>>(
      BaseModelName.User,
    );
    const user = await UserModel.findById(req.user.id);

    return {
      statusCode: 200,
      response: {
        message: getSuiteCoreTranslation(
          SuiteCoreStringKey.BackupCodes_RetrievedSuccess,
        ),
        codeCount: user?.backupCodes?.length || 0,
      } as IApiCodeCountResponse,
    };
  }

  @Post('/backup-codes', {
    auth: true,
    cryptoAuth: true,
    validation: function (validationLanguage: TLanguage) {
      const constants = this.constants;
      return [
        body().custom((value, { req }) => {
          if (!req.body?.password && !req.body?.mnemonic) {
            throw new MnemonicOrPasswordRequiredError();
          }
          return true;
        }),
        body('password')
          .optional()
          .notEmpty()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_CurrentPasswordRequired,
              undefined,
              validationLanguage,
            ),
          ),
        body('mnemonic')
          .optional()
          .notEmpty()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_MnemonicRequired,
              undefined,
              validationLanguage,
            ),
          )
          .matches(constants.MnemonicRegex)
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_MnemonicRegex,
              undefined,
              validationLanguage,
            ),
          ),
      ];
    },
  })
  async resetBackupCodes(
    req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiBackupCodesResponse | ApiErrorResponse>> {
    if (!req.user || !req.eciesUser || !req.eciesUser.hasPrivateKey) {
      throw new HandleableError(
        new Error(
          getSuiteCoreTranslation(SuiteCoreStringKey.Common_NoUserOnRequest),
        ),
        { statusCode: 401 },
      );
    }

    const newBackupCodes = await this.userService.resetUserBackupCodes(
      req.eciesUser as BackendMember<TID>,
      this.systemUser,
    );
    const codes = newBackupCodes.map((c) => c.notNullValue);
    newBackupCodes.forEach((c) => c.dispose());

    return {
      statusCode: 200,
      response: {
        message: getSuiteCoreTranslation(
          SuiteCoreStringKey.BackupCodeRecovery_YourNewCodes,
        ),
        backupCodes: codes,
      },
    };
  }

  @Post('/recover-mnemonic', {
    auth: true,
    cryptoAuth: true,
    validation: function (validationLanguage: TLanguage) {
      return [
        body('password')
          .isString()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_CurrentPasswordRequired,
              undefined,
              validationLanguage,
            ),
          ),
      ];
    },
  })
  async recoverMnemonic(
    req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiMnemonicResponse | ApiErrorResponse>> {
    return await withMongoTransaction(
      this.application.db.connection,
      this.application.environment.mongo.useTransactions,
      undefined,
      async (sess) => {
        if (!req.user) {
          throw new HandleableError(
            new Error(
              getSuiteCoreTranslation(
                SuiteCoreStringKey.Validation_InvalidCredentials,
              ),
            ),
            { statusCode: 401 },
          );
        } else if (!req.eciesUser) {
          throw new HandleableError(
            new Error(
              getSuiteCoreTranslation(
                SuiteCoreStringKey.Validation_MnemonicOrPasswordRequired,
              ),
            ),
            { statusCode: 401 },
          );
        }

        const { password } = this.validatedBody as { password?: unknown };
        if (!isString(password)) {
          throw new GenericValidationError(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_MissingValidatedData,
            ),
          );
        }
        const provider = getEnhancedNodeIdProvider<TID>();
        const userDoc = await this.userService.findUserById(
          provider.idFromString(req.user.id),
          true,
          sess,
        );

        const mnemonic = await this.userService.recoverMnemonic(
          req.eciesUser,
          userDoc.mnemonicRecovery,
        );

        return {
          statusCode: 200,
          response: {
            message: getSuiteCoreTranslation(
              SuiteCoreStringKey.MnemonicRecovery_Success,
            ),
            mnemonic: mnemonic.notNullValue,
          },
        };
      },
    );
  }

  @Post('/change-password', {
    auth: true,
    validation: function (validationLanguage: TLanguage) {
      const constants = this.constants;
      return [
        body('currentPassword')
          .notEmpty()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_Required,
              undefined,
              validationLanguage,
            ),
          ),
        body('newPassword')
          .matches(constants.PasswordRegex)
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_PasswordRegexErrorTemplate,
            ),
          )
          .notEmpty()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_Required,
              undefined,
              validationLanguage,
            ),
          ),
      ];
    },
  })
  async changePassword(
    req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiMessageResponse | ApiErrorResponse>> {
    return await withMongoTransaction(
      this.application.db.connection,
      this.application.environment.mongo.useTransactions,
      undefined,
      async (sess) => {
        const { currentPassword, newPassword } = this.validatedBody as {
          currentPassword?: unknown;
          newPassword?: unknown;
        };
        if (!req.user) {
          throw new HandleableError(
            new Error(
              getSuiteCoreTranslation(
                SuiteCoreStringKey.Common_NoUserOnRequest,
              ),
            ),
            { statusCode: 401 },
          );
        }

        if (!isString(currentPassword) || !isString(newPassword)) {
          throw new GenericValidationError(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_MissingValidatedData,
            ),
          );
        }

        await this.userService.changePassword(
          req.user.id,
          currentPassword,
          newPassword,
          sess,
        );

        return {
          statusCode: 200,
          response: {
            message: getSuiteCoreTranslation(
              SuiteCoreStringKey.PasswordChange_Success,
            ),
          },
        };
      },
    );
  }

  @Post('/request-direct-login')
  async requestDirectLogin(
    _req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiChallengeResponse | ApiErrorResponse>> {
    const challenge = this.userService.generateDirectLoginChallenge();
    return {
      statusCode: 200,
      response: {
        challenge: challenge,
        message: getSuiteCoreTranslation(
          SuiteCoreStringKey.Login_ChallengeGenerated,
        ),
        serverPublicKey: this.application.environment.systemPublicKeyHex ?? '',
      },
    };
  }

  @Post('/direct-challenge', {
    schema: DirectLoginChallengeSchema,
    validation: function (validationLanguage: TLanguage) {
      const constants = this.constants;
      return [
        body('challenge')
          .not()
          .isEmpty()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_InvalidChallenge,
              undefined,
              validationLanguage,
            ),
          )
          .matches(
            new RegExp(
              `^[a-f0-9]{${(UINT64_SIZE + 32 + ECIES.SIGNATURE_SIZE) * 2}}$`,
            ),
          )
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_InvalidChallenge,
              undefined,
              validationLanguage,
            ),
          ),
        body('signature')
          .not()
          .isEmpty()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_InvalidSignature,
            ),
          )
          .matches(new RegExp(`^[a-f0-9]{${ECIES.SIGNATURE_SIZE * 2}}$`))
          .withMessage(SuiteCoreStringKey.Validation_InvalidSignature),
        body().custom((value, { req }) => {
          if (!req.body.username && !req.body.email) {
            throw new UsernameOrEmailRequiredError();
          }
          return true;
        }),
        body('username')
          .optional()
          .matches(constants.UsernameRegex)
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_UsernameRegexErrorTemplate,
              undefined,
              validationLanguage,
            ),
          ),
        body('email')
          .optional()
          .isEmail()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_InvalidEmail,
              undefined,
              validationLanguage,
            ),
          ),
      ];
    },
  })
  async directLoginChallenge(
    req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiLoginResponse | ApiErrorResponse>> {
    return await withMongoTransaction(
      this.application.db.connection,
      this.application.environment.mongo.useTransactions,
      undefined,
      async (sess) => {
        const { username, email, challenge, signature } = this
          .validatedBody as {
          username?: unknown;
          email?: unknown;
          challenge?: unknown;
          signature?: unknown;
        };

        const { userDoc } = await this.userService.verifyDirectLoginChallenge(
          String(challenge),
          String(signature),
          username ? String(username) : undefined,
          email ? String(email) : undefined,
          sess,
        );

        const { token: jwtToken, roles } = await this.jwtService.signToken(
          userDoc,
          this.application.environment.jwtSecret,
          (req.user?.siteLanguage as string) ?? LanguageCodes.EN_US,
        );

        return {
          statusCode: 200,
          response: {
            user: RequestUserService.makeRequestUserDTO(userDoc, roles),
            token: jwtToken,
            serverPublicKey:
              this.application.environment.systemPublicKeyHex ?? '',
            message: getSuiteCoreTranslation(
              SuiteCoreStringKey.LoggedIn_Success,
            ),
          },
        };
      },
    );
  }

  @Post('/request-email-login', {
    validation: function (validationLanguage: TLanguage) {
      const constants = this.constants;
      return [
        body().custom((value, { req }) => {
          if (!req.body.username && !req.body.email) {
            throw new UsernameOrEmailRequiredError();
          }
          return true;
        }),
        body('username')
          .optional()
          .matches(constants.UsernameRegex)
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_UsernameRegexErrorTemplate,
              undefined,
              validationLanguage,
            ),
          ),
        body('email')
          .optional()
          .isEmail()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_InvalidEmail,
              undefined,
              validationLanguage,
            ),
          ),
      ];
    },
  })
  async requestEmailLogin(
    _req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiMessageResponse | ApiErrorResponse>> {
    const { username, email } = this.validatedBody as {
      username?: unknown;
      email?: unknown;
    };

    try {
      await withMongoTransaction(
        this.application.db.connection,
        this.application.environment.mongo.useTransactions,
        undefined,
        async (sess) => {
          const userDoc = await this.userService.findUser(
            email as string,
            username as string,
            sess,
          );
          await this.userService.createAndSendEmailToken(
            userDoc,
            EmailTokenType.LoginRequest,
            sess,
            this.application.environment.debug,
          );
        },
      );
    } catch {
      // Suppress user-related errors for security
    }

    return {
      statusCode: 200,
      response: {
        message: getSuiteCoreTranslation(SuiteCoreStringKey.Email_TokenSent),
      },
    };
  }

  @Post('/email-challenge', {
    schema: EmailLoginChallengeSchema,
    validation: function (validationLanguage: TLanguage) {
      const constants = this.constants;
      return [
        body('token')
          .not()
          .isEmpty()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_TokenRequired,
              undefined,
              validationLanguage,
            ),
          )
          .matches(new RegExp(`^[a-f0-9]{${constants.EmailTokenLength * 2}}$`))
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_InvalidToken,
              undefined,
              validationLanguage,
            ),
          ),
        body('signature')
          .not()
          .isEmpty()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_InvalidSignature,
            ),
          )
          .matches(new RegExp(`^[a-f0-9]{${ECIES.SIGNATURE_SIZE * 2}}$`))
          .withMessage(SuiteCoreStringKey.Validation_InvalidSignature),
        body().custom((value, { req }) => {
          if (!req.body.username && !req.body.email) {
            throw new UsernameOrEmailRequiredError();
          }
          return true;
        }),
        body('username')
          .optional()
          .matches(constants.UsernameRegex)
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_UsernameRegexErrorTemplate,
              undefined,
              validationLanguage,
            ),
          ),
        body('email')
          .optional()
          .isEmail()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_InvalidEmail,
              undefined,
              validationLanguage,
            ),
          ),
      ];
    },
  })
  async emailLoginChallenge(
    req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiLoginResponse | ApiErrorResponse>> {
    return await withMongoTransaction(
      this.application.db.connection,
      this.application.environment.mongo.useTransactions,
      undefined,
      async (sess) => {
        const { token, signature } = this.validatedBody as {
          token?: unknown;
          signature?: unknown;
        };

        const userDoc = await this.userService.validateEmailLoginTokenChallenge(
          String(token),
          String(signature),
          sess,
        );

        const { token: jwtToken, roles } = await this.jwtService.signToken(
          userDoc,
          this.application.environment.jwtSecret,
          (req.user?.siteLanguage as string) ?? LanguageCodes.EN_US,
        );

        return {
          statusCode: 200,
          response: {
            user: RequestUserService.makeRequestUserDTO(userDoc, roles),
            token: jwtToken,
            serverPublicKey:
              this.application.environment.systemPublicKeyHex ?? '',
            message: getSuiteCoreTranslation(
              SuiteCoreStringKey.LoggedIn_Success,
            ),
          },
        };
      },
    );
  }

  @Post('/resend-verification', {
    validation: function (validationLanguage: TLanguage) {
      const constants = this.constants;
      return [
        body().custom((value, { req }) => {
          if (!req.body.username && !req.body.email) {
            throw new UsernameOrEmailRequiredError();
          }
          return true;
        }),
        body('username')
          .optional()
          .isString()
          .matches(constants.UsernameRegex)
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_UsernameRegexErrorTemplate,
              undefined,
              validationLanguage,
            ),
          ),
        body('email').optional().isEmail(),
      ];
    },
  })
  async resendVerification(
    _req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiMessageResponse | ApiErrorResponse>> {
    return await withMongoTransaction(
      this.application.db.connection,
      this.application.environment.mongo.useTransactions,
      undefined,
      async (sess) => {
        const { username, email } = this.validatedBody as {
          username?: unknown;
          email?: unknown;
        };

        const UserModel = this.application.getModel<UserDocument<string, TID>>(
          BaseModelName.User,
        );
        const query: { username?: string; email?: string } = {};
        if (isString(username)) query.username = username;
        else if (isString(email)) query.email = email;
        else {
          throw new GenericValidationError(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_MissingValidatedData,
            ),
          );
        }

        const user = await UserModel.findOne(query).session(sess ?? null);
        if (!user) {
          throw new GenericValidationError(
            getSuiteCoreTranslation(SuiteCoreStringKey.Validation_UserNotFound),
            { statusCode: 404 },
          );
        }

        await this.userService.resendEmailToken(
          user._id.toString(),
          EmailTokenType.AccountVerification,
          sess,
          this.application.environment.debug,
        );

        return {
          statusCode: 200,
          response: {
            message: getSuiteCoreTranslation(
              SuiteCoreStringKey.EmailVerification_Resent,
            ),
          },
        };
      },
    );
  }

  @Post('/backup-code', {
    validation: function (validationLanguage: TLanguage) {
      const constants = this.constants;
      return [
        body('email').optional().isEmail(),
        body('username')
          .optional()
          .matches(constants.UsernameRegex)
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_UsernameRegexErrorTemplate,
              undefined,
              validationLanguage,
            ),
          ),
        body('code')
          .custom((value) => {
            const normalized = BackupCode.normalizeCode(value);
            return (
              constants.BACKUP_CODES.DisplayRegex.test(value) ||
              constants.BACKUP_CODES.NormalizedHexRegex.test(normalized)
            );
          })
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_InvalidBackupCode,
              undefined,
              validationLanguage,
            ),
          ),
        body('recoverMnemonic').isBoolean().optional(),
        body('newPassword')
          .optional()
          .matches(constants.PasswordRegex)
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_PasswordRegexErrorTemplate,
              undefined,
              validationLanguage,
            ),
          ),
      ];
    },
  })
  async useBackupCodeLogin(
    _req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiLoginResponse | ApiErrorResponse>> {
    return await withMongoTransaction(
      this.application.db.connection,
      this.application.environment.mongo.useTransactions,
      undefined,
      async (sess) => {
        const { code, newPassword, email, username } = this.validatedBody as {
          code?: unknown;
          newPassword?: unknown;
          email?: unknown;
          username?: unknown;
        };

        if (!code) {
          throw new GenericValidationError(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_MissingValidatedData,
            ),
          );
        }

        const recoverMnemonic =
          this.validatedBody?.['recoverMnemonic'] === 'true' ||
          this.validatedBody?.['recoverMnemonic'] === true;

        const userDoc = await this.userService.findUser(
          email as string,
          username as string,
          sess,
        );

        const {
          user,
          userDoc: updatedUserDoc,
          codeCount,
        } = await this.backupCodeService.recoverKeyWithBackupCode(
          userDoc,
          code as string,
          newPassword ? new SecureString(newPassword as string) : undefined,
          sess,
        );

        let mnemonic: SecureString | undefined;
        if (recoverMnemonic) {
          if (!updatedUserDoc) {
            throw new Error(
              'User document not found after backup code recovery',
            );
          }
          mnemonic = await this.userService.recoverMnemonic(
            user,
            updatedUserDoc.mnemonicRecovery,
          );
        }

        const { token, roles } = await this.jwtService.signToken(
          userDoc,
          this.application.environment.jwtSecret,
          LanguageCodes.EN_US,
        );

        if (!updatedUserDoc) {
          throw new Error('User document not found after backup code recovery');
        }
        this.userService.updateLastLogin(updatedUserDoc._id).catch(() => {});

        return {
          statusCode: 200,
          response: {
            user: RequestUserService.makeRequestUserDTO(userDoc, roles),
            token: token,
            message: getSuiteCoreTranslation(
              SuiteCoreStringKey.BackupCodeRecovery_Success,
            ),
            codeCount,
            ...(recoverMnemonic && mnemonic
              ? { mnemonic: mnemonic.value }
              : {}),
            serverPublicKey:
              this.application.environment.systemPublicKeyHex ?? '',
          },
        };
      },
    );
  }

  @Post('/forgot-password', {
    validation: function (validationLanguage: TLanguage) {
      return [
        body('email')
          .isEmail()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_InvalidEmail,
              undefined,
              validationLanguage,
            ),
          ),
      ];
    },
  })
  async forgotPassword(
    _req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiMessageResponse | ApiErrorResponse>> {
    return await withMongoTransaction(
      this.application.db.connection,
      this.application.environment.mongo.useTransactions,
      undefined,
      async (sess) => {
        const { email } = this.validatedBody as { email?: unknown };

        const UserModel = this.application.getModel<UserDocument<string, TID>>(
          BaseModelName.User,
        );
        if (!isString(email)) {
          throw new GenericValidationError(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_MissingValidatedData,
            ),
          );
        }

        const user = await UserModel.findOne({
          email: email.toLowerCase(),
        }).session(sess ?? null);

        if (!user || !user.passwordWrappedPrivateKey) {
          return {
            statusCode: 200,
            response: {
              message: getSuiteCoreTranslation(
                SuiteCoreStringKey.PasswordReset_Success,
              ),
            },
          };
        }

        // Mongoose document type doesn't exactly match UserDocument generic signature
        // but the document has all required properties
        await this.userService.createAndSendEmailToken(
          user as unknown as UserDocument<TLanguage, TID>,
          EmailTokenType.PasswordReset,
          sess,
          this.application.environment.debug,
        );

        return {
          statusCode: 200,
          response: {
            message: getSuiteCoreTranslation(
              SuiteCoreStringKey.PasswordReset_Success,
            ),
          },
        };
      },
    );
  }

  @Get('/verify-reset-token')
  async verifyResetToken(
    req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiMessageResponse | ApiErrorResponse>> {
    const token = req.query['token'] as string;
    if (!token) {
      throw new GenericValidationError(
        getSuiteCoreTranslation(SuiteCoreStringKey.Validation_TokenMissing),
      );
    }

    return await withMongoTransaction(
      this.application.db.connection,
      this.application.environment.mongo.useTransactions,
      undefined,
      async (sess) => {
        await this.userService.verifyEmailToken(
          token,
          EmailTokenType.PasswordReset,
          sess,
        );
        return {
          statusCode: 200,
          response: {
            message: getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_TokenValid,
            ),
          },
        };
      },
    );
  }

  @Post('/reset-password', {
    validation: function (validationLanguage: TLanguage) {
      const constants = this.constants;
      return [
        body('token')
          .not()
          .isEmpty()
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_TokenRequired,
              undefined,
              validationLanguage,
            ),
          )
          .matches(new RegExp(`^[a-f0-9]{${constants.EmailTokenLength * 2}}$`))
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_InvalidToken,
              undefined,
              validationLanguage,
            ),
          ),
        body('newPassword')
          .optional()
          .isLength({ min: 8 })
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_PasswordMinLengthTemplate,
              undefined,
              validationLanguage,
            ),
          )
          .matches(constants.PasswordRegex)
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_PasswordRegexErrorTemplate,
              undefined,
              validationLanguage,
            ),
          ),
        body('password')
          .optional()
          .isLength({ min: 8 })
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_PasswordMinLengthTemplate,
              undefined,
              validationLanguage,
            ),
          )
          .matches(constants.PasswordRegex)
          .withMessage(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_PasswordRegexErrorTemplate,
              undefined,
              validationLanguage,
            ),
          ),
        body('currentPassword').optional().isString(),
        body('mnemonic').optional().isString(),
      ];
    },
  })
  async resetPassword(
    _req: Request,
    _res: Response,
    _next: NextFunction,
  ): Promise<IStatusCodeResponse<IApiMessageResponse | ApiErrorResponse>> {
    return await withMongoTransaction(
      this.application.db.connection,
      this.application.environment.mongo.useTransactions,
      undefined,
      async (sess) => {
        const { token, newPassword, password, currentPassword, mnemonic } =
          this.validatedBody;
        const selectedNewPassword = (newPassword ?? password) as
          | string
          | undefined;

        if (!isString(token) || !isString(selectedNewPassword)) {
          throw new GenericValidationError(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_MissingValidatedData,
            ),
          );
        }

        const credential =
          (mnemonic as string | undefined) ??
          (currentPassword as string | undefined);
        if (!isString(credential)) {
          throw new GenericValidationError(
            getSuiteCoreTranslation(
              SuiteCoreStringKey.Validation_MissingValidatedData,
            ),
          );
        }

        await this.userService.resetPasswordWithToken(
          token as string,
          selectedNewPassword,
          credential,
          sess,
        );

        return {
          statusCode: 200,
          response: {
            message: getSuiteCoreTranslation(
              SuiteCoreStringKey.PasswordChange_Success,
            ),
          },
        };
      },
    );
  }
}
