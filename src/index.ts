// @digitaldefiance/node-express-suite-mongo
// MongoDB/Mongoose extensions for @digitaldefiance/node-express-suite

export * from './documents';
export * from './enumerations';
export * from './errors';
export * from './interfaces';
export * from './models';
export * from './schemas';
export * from './services';
export * from './types';
export * from './plugins';
export * from './transactions';
export * from './controllers';
export * from './model-registry';
export * from './mongo-application-concrete';
export * from './utils';
export * from './routers';
export * from './builders';

// Re-export key Base Package symbols for convenience (Req 15)
export {
  Application,
  BaseController,
  DecoratorBaseController,
  BaseService,
  AppRouter,
  BaseRouter,
} from '@digitaldefiance/node-express-suite';

export type {
  IApplication,
  IConstants,
  IAuthenticationProvider,
  IDatabasePlugin,
  IEnvironment,
} from '@digitaldefiance/node-express-suite';
