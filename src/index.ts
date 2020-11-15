/* eslint-disable lines-between-class-members  */
import isValidPort from 'validator/lib/isPort';
import http from 'http';
import { createHttpTerminator } from 'http-terminator';
import Koa, { Middleware, Next, ParameterizedContext, DefaultContext, DefaultState } from 'koa';
// Koa Router, for handling REST API requests
import KoaRouter, { IParamMiddleware } from 'koa-router';
// Enable cross-origin requests
import koaCors, { Options as CORSOptions } from 'kcors';
//
import bodyParser from 'koa-bodyparser';
// HTTP header hardening
import koaHelmet from 'koa-helmet';
// Parse userAgent
import UserAgent from 'useragent';
// Cookies
import Cookie from 'cookie';
// @ts-ignore
import cookiesMiddleware from 'universal-cookie-koa';
// High-precision timing, so we can debug response time to serve a request
// @ts-ignore
import ms from 'microseconds';
import { get, pick, flattenDeep, merge, compact } from 'lodash';
//
import {
  Sequelize,
  ValidationError,
  OptimisticLockError,
  DatabaseError,
  UniqueConstraintError,
} from 'sequelize';
import { applyMiddleware } from 'graphql-middleware';
// Sentry
import * as Sentry from '@sentry/node';
import * as Integrations from '@sentry/integrations';
import { sentry as graphQLSentry } from 'graphql-middleware-sentry';
import git from 'git-rev-sync';
// Database
import {
  createConnection,
  initDatabase,
  InitDatabaseOptions,
  DatabaseConnection,
  DatabaseConnectionOptions,
  DatabaseModels,
} from '@fjedi/database-client';
import { redis, RedisClient } from '@fjedi/redis-client';
import { DefaultError } from '@fjedi/errors';
import { logger, Logger } from '@fjedi/logger';
import { decodeJWT } from '@fjedi/jwt';
// Socket.io
import WebsocketHandler, { Socket, Server as WebsocketServer, ServerOptions } from 'socket.io';
import wsRedis from 'socket.io-redis';
import initWSEventEmitter from 'socket.io-emitter';

//
import { ApolloServer, ApolloError, Config, makeExecutableSchema } from 'apollo-server-koa';
import { rule, shield, and, not, or, allow, chain, inputRule } from 'graphql-shield';
import {
  IRules as PermissionRules,
  IOptions as PermissionRulesOptions,
} from 'graphql-shield/dist/types';
// @ts-ignore
import { PossibleTypesExtension } from 'apollo-progressive-fragment-matcher';
// @ts-ignore
import { FormatErrorWithContextExtension } from 'graphql-format-error-context-extension';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import { RedisCache } from 'apollo-server-cache-redis';
// @ts-ignore
import ResponseCachePlugin from 'apollo-server-plugin-response-cache';
// Multi-lang support
import i18next, {
  TFunction,
  i18n,
  InitOptions as I18NextInitOptions,
  Resource as I18NextResource,
} from 'i18next';
// @ts-ignore
import i18nextBackend from 'i18next-sync-fs-backend';
//
import { uuid } from './helpers/uuid';
import { logServerStarted } from './helpers/console';
import time from './helpers/time';
import BigNumber from './helpers/numbers';
import * as transliterator from './helpers/transliterator';
import {
  setContextLang,
  detectContextLang,
  LANG_DETECTION_DEFAULT_OPTIONS,
  LANG_DETECTION_DEFAULT_ORDER,
} from './helpers/i18n';

export type RouteMethod = 'get' | 'post' | 'delete' | 'update' | 'put' | 'patch';
export type { Middleware, Next, ParameterizedContext, DefaultContext, DefaultState } from 'koa';
//
export * as shield from 'graphql-shield';
export * from './functions';

// @ts-ignore
type TodoAny = any;

export type KoaApp<TAppContext, TDatabaseModels extends DatabaseModels> = Koa & {
  context: RouteContext<TAppContext, TDatabaseModels>;
};

export type ContextHelpers = {
  time: typeof time;
  uuid: typeof uuid;
  transliterator: typeof transliterator;
  BigNumber: typeof BigNumber;
  [k: string]: unknown;
};

export type ContextState = DefaultState & {
  ip: string;
  language: string;
  languageCode: string;
  countryCode?: string;
  userAgent?: string;
  authToken?: string;
  decodedAuthToken?: { sub: string; [k: string]: unknown };
};

export type RouteContext<
  TAppContext,
  TDatabaseModels extends DatabaseModels
> = ParameterizedContext<ContextState, DefaultContext> & {
  db: DatabaseConnection<TDatabaseModels>;
  redis: RedisClient;
  t?: TFunction;
  i18next?: i18n;
  language: string;
  logger: Logger;
  sentry?: typeof Sentry;
  helpers: ContextHelpers;
} & TAppContext;

export type RouteHandler<TAppContext, TDatabaseModels extends DatabaseModels> = (
  ctx: RouteContext<TAppContext, TDatabaseModels>,
  next?: Next,
) => TodoAny;

export type ErrorHandler<TAppContext, TDatabaseModels extends DatabaseModels> = (
  err: DefaultError | ValidationError | OptimisticLockError,
  ctx: RouteContext<TAppContext, TDatabaseModels>,
) => void;

export type ExceptionHandlerProps = {
  cleanupFn: (exception?: Error) => Promise<void>;
  exit?: boolean;
  exitCode?: number;
};

export type RouteParam = {
  param: string;
  handler: IParamMiddleware;
};

export type Route<TAppContext, TDatabaseModels extends DatabaseModels> = {
  method: RouteMethod;
  route: string;
  handlers: RouteHandler<TAppContext, TDatabaseModels>[];
};

export type Translations = I18NextResource;

export type MultiLangOptions = I18NextInitOptions & {
  translations: Translations;
  backend: { addPath: string; loadPath: string };
  fallbackLng: string;
};

export type SentryOptions = Sentry.NodeOptions;
export type SentryError =
  | DefaultError
  | ValidationError
  | DatabaseError
  | UniqueConstraintError
  | Error;

export type SentryErrorProps = {
  messagePrefix?: string;
  request?: Request;
  response?: Response;
  path?: string;
  userId?: string | number;
  [k: string]: unknown;
};

export type ServerParams<
  TAppContext extends ParameterizedContext<ContextState, ParameterizedContext>,
  TDatabaseModels extends DatabaseModels
> = {
  dbOptions: DatabaseConnectionOptions;
  graphqlOptions: GraphQLServerOptions<TAppContext, TDatabaseModels>;
  bodyParserOptions?: bodyParser.Options;
  corsOptions?: CORSOptions;
  wsServerOptions?: Partial<WSServerOptions>;
  routes?: Array<(server: Server<TAppContext, TDatabaseModels>) => void>;
  multiLangOptions?: MultiLangOptions;
  sentryOptions?: SentryOptions;
  contextHelpers?: Partial<ContextHelpers>;
};

export type GraphQLServerOptions<
  TAppContext extends ParameterizedContext<ContextState, ParameterizedContext>,
  TDatabaseModels extends DatabaseModels
> = Config & {
  path: string;
  resolvers: (s: Server<TAppContext, TDatabaseModels>) => Config['resolvers'];
  permissions?: {
    rules: PermissionRules;
    options?: Partial<PermissionRulesOptions>;
  };
};

export type WSRequest = {
  headers: {
    cookie?: string;
    authorization?: string;
    ['user-agent']?: string;
  };
};

export type WSAuthCallback = (error: DefaultError | null, isAuthorized: boolean) => void;

export type WSSocket = Socket;
export type WSServerOptions = ServerOptions;

export class Server<
  TAppContext extends ParameterizedContext<ContextState, ParameterizedContext>,
  TDatabaseModels extends DatabaseModels
> {
  environment: 'production' | 'development';
  host: string;
  port: number;
  koaApp: KoaApp<TAppContext, TDatabaseModels>;
  router: KoaRouter;
  routes: Set<Route<TAppContext, TDatabaseModels>>;
  routeParams: Set<RouteParam>;
  middleware: Set<Middleware<ContextState, RouteContext<TAppContext, TDatabaseModels>>>;
  beforeMiddleware: Set<Middleware<ContextState, RouteContext<TAppContext, TDatabaseModels>>>;
  koaAppFunc?: (app: Koa) => Promise<void>;
  handler404?: (ctx: RouteContext<TAppContext, TDatabaseModels>) => Promise<any>;
  errorHandler?: ErrorHandler<TAppContext, TDatabaseModels>;

  // Middlewares
  // Enable body parsing by default.  Leave `koa-bodyparser` opts as default
  bodyParserOptions: bodyParser.Options;
  // CORS options for `koa-cors`
  corsOptions: CORSOptions;

  // Multi-lang support
  static LANG_DETECTION_DEFAULT_OPTIONS = LANG_DETECTION_DEFAULT_OPTIONS;
  static LANG_DETECTION_DEFAULT_ORDER = LANG_DETECTION_DEFAULT_ORDER;
  static DEFAULT_LANGUAGE = 'en';
  static detectContextLang = detectContextLang;
  static setContextLang = setContextLang;
  multiLangOptions?: MultiLangOptions;

  // Sentry
  sentryOptions?: SentryOptions;
  sentry?: typeof Sentry;

  // Database
  dbConnection: Sequelize;
  db?: DatabaseConnection<TDatabaseModels>;
  //
  logger: Logger;
  redis: RedisClient;
  pubsub: RedisPubSub;

  // Graphql-related staff
  graphqlOptions: GraphQLServerOptions<TAppContext, TDatabaseModels>;

  // Websockets
  ws?: WebsocketServer;
  wsEventEmitter?: initWSEventEmitter.SocketIOEmitter;
  wsServerOptions?: Partial<WSServerOptions>;

  constructor(params: ServerParams<TAppContext, TDatabaseModels>) {
    const {
      dbOptions,
      graphqlOptions,
      bodyParserOptions,
      corsOptions,
      wsServerOptions,
      routes,
      multiLangOptions,
      contextHelpers,
      sentryOptions,
    } = params;
    //
    this.environment = process.env.NODE_ENV === 'production' ? 'production' : 'development';

    this.host = process.env.HOST || 'localhost';
    //
    if (typeof process.env.PORT !== 'undefined') {
      const { PORT } = process.env;
      if (!isValidPort(`${PORT}`)) {
        throw new TypeError(`${PORT} is not a valid port`);
      }
      this.port = parseInt(PORT, 10);
    } else {
      this.port = 5000;
    }
    //
    this.dbConnection = createConnection(dbOptions);
    this.graphqlOptions = graphqlOptions;
    //
    this.bodyParserOptions = merge(
      { jsonLimit: '50mb', textLimit: '10mb' },
      bodyParserOptions || {},
    );
    this.corsOptions = merge({ cors: true }, corsOptions || {});
    //
    if (wsServerOptions) {
      this.wsServerOptions = wsServerOptions;
    }
    //
    if (sentryOptions) {
      if (!sentryOptions.dsn) {
        const e = `"dsn" is a required option to init Sentry middleware`;
        throw new DefaultError(e, {
          meta: sentryOptions,
        });
      }
      this.sentryOptions = merge(
        {
          debug: this.environment !== 'production',
          // None = 0, // No logs will be generated
          // Error = 1, // Only SDK internal errors will be logged
          // Debug = 2, // Information useful for debugging the SDK will be logged
          // Verbose = 3 // All SDK actions will be logged
          logLevel: this.environment === 'production' ? 1 : 3,
          release: git.long(),
          environment: this.environment,
          serverName: this.host,
          sendDefaultPii: true,
          attachStacktrace: true,
          maxBreadcrumbs: 5,
          /*
            Configures the sample rate as a percentage of events
            to be sent in the range of 0.0 to 1.0. The default is
            1.0 which means that 100% of events are sent. If set
            to 0.1 only 10% of events will be sent. Events are
            picked randomly.
          */
          // sampleRate: 1,
          // ...
          integrations: [
            new Integrations.Dedupe(),
            new Integrations.Transaction(),
            new Integrations.ExtraErrorData({
              depth: 3,
            }),
          ],
        },
        sentryOptions,
      );
      //
      Sentry.init(this.sentryOptions);
      //
      Sentry.configureScope((scope) => {
        scope.setTag('git_commit', git.message());
        scope.setTag('git_branch', git.branch());
      });
      //
      this.sentry = Sentry;
    }
    //
    if (multiLangOptions?.translations) {
      this.multiLangOptions = multiLangOptions;
      const { backend, translations } = multiLangOptions;
      ['backend.loadPath', 'backend.addPath', 'fallbackLng', 'translations'].forEach(
        (optionKey) => {
          const optionValue = get(multiLangOptions, optionKey);
          if (!optionValue) {
            const e = `"${optionKey}" is a required option to init multi-lang support`;
            throw new DefaultError(e, {
              meta: multiLangOptions,
            });
          }
        },
      );
      //
      const { loadPath, addPath } = multiLangOptions.backend;
      // Init multi-lang support
      i18next.use(i18nextBackend).init({
        // debug: true,
        // This is necessary for this sync version
        // of the backend to work:
        initImmediate: false,

        // preload: ['zh', 'en', 'ru', 'es'], // must know what languages to use
        preload: Object.keys(translations), // must know what languages to use
        load: 'languageOnly', // we only provide en, de -> no region specific locals like en-US, de-DE

        detection: {
          // order and from where user language should be detected
          order: ['path', 'querystring', 'cookie', 'session', 'header'],

          // keys or params to lookup language from
          lookupQuerystring: 'lang',
          lookupCookie: 'lang',
          lookupSession: 'lang',

          // cache user language on
          caches: ['cookie'],
        },
        ...multiLangOptions,
        backend: {
          ...backend,
          // translation resources
          loadPath: `${loadPath}/{{lng}}.json`,
          addPath: `${addPath}/{{lng}}.missing.json`,
        },
      });
    }
    //
    this.redis = redis;
    this.pubsub = new RedisPubSub({
      connection: {
        host: redis.options.host,
        port: redis.options.port,
      },
    });
    this.logger = logger;

    // Init all API routes
    this.routes = new Set();
    //
    routes?.forEach((r: TodoAny) => this.initRoute(r));

    // Custom middleware
    this.beforeMiddleware = new Set();
    this.middleware = new Set();
    this.routeParams = new Set();

    // Build the router, based on our app's settings.  This will define which
    // Koa route handlers
    this.router = new KoaRouter()
      // Set-up a general purpose /ping route to check the server is alive
      .get('/ping', async (ctx) => {
        ctx.body = 'pong';
      })

      // Favicon.ico.  By default, we'll serve this as a 204 No Content.
      // If /favicon.ico is available as a static file, it'll try that first
      .get('/favicon.ico', async (ctx) => {
        ctx.status = 204;
      });

    // Build the app instance, which we'll use to define middleware for Koa
    // as a precursor to handling routes
    this.koaApp = new Koa()
      // Adds CORS config
      .use(koaCors(this.corsOptions))

      // Error wrapper.  If an error manages to slip through the middleware
      // chain, it will be caught and logged back here
      .use(async (ctx, next) => {
        const context = ctx as RouteContext<TAppContext, TDatabaseModels>;
        try {
          await next();
        } catch (e) {
          const isSystemError = !e.status || e.status >= 500;
          if (isSystemError) {
            this.logger.error(e);
          }
          //
          if (Sentry && typeof Sentry.captureException === 'function' && isSystemError) {
            Sentry.captureException(e);
          }
          // If we have a custom error handler, use that - else simply log a
          // message and return one to the user
          if (typeof this.errorHandler === 'function') {
            this.errorHandler(e, context);
          } else {
            ctx.body = 'There was an error. Please try again later.';
          }
        }
      }) as KoaApp<TAppContext, TDatabaseModels>;

    // eslint-disable-next-line no-param-reassign
    this.koaApp.context.logger = this.logger;
    // eslint-disable-next-line no-param-reassign
    this.koaApp.context.sentry = this.sentry;
    //
    this.koaApp.context.helpers = merge(
      {
        time,
        uuid,
        transliterator,
        BigNumber,
      },
      contextHelpers || {},
    );
  }

  processExitHandler(opts: ExceptionHandlerProps): (e?: Error) => void {
    const { cleanupFn, exit = false, exitCode = 1 } = opts;
    //
    return (e?: Error) => {
      //
      if (e) {
        this.logger?.error(e);
        //
        this.sentry?.captureException(e);
      }
      if (typeof cleanupFn === 'function') {
        cleanupFn(e)
          .catch(this.logger.error)
          .then(() => {
            if (!exit) {
              process.exit(exitCode);
            }
          });
      } else if (!exit) {
        setTimeout(() => process.exit(exitCode), 3000);
      }
    };
  }

  async initExceptionHandler(opts: ExceptionHandlerProps): Promise<void> {
    // Catch all exceptions
    process.on('exit', this.processExitHandler({ exit: true, ...opts }));
    process.on('SIGINT', this.processExitHandler(opts));
    process.on('SIGHUP', this.processExitHandler(opts));
    process.on('SIGTERM', this.processExitHandler(opts));
    process.on('SIGUSR1', this.processExitHandler(opts));
    process.on('SIGUSR2', this.processExitHandler(opts));
    process.on('uncaughtException', this.processExitHandler(opts));
    process.on('unhandledRejection', this.processExitHandler(opts));
  }

  // Init all API routes recursively
  initRoute(r: TodoAny | TodoAny[]): void {
    if (Array.isArray(r)) {
      flattenDeep(r).forEach((route) => this.initRoute(route));
      return;
    }
    if (typeof r === 'function') {
      r(this);
      return;
    }
    this.logger.error('Failed to init route', r);
  }

  initMultiLangMiddleware(): void {
    if (!this.multiLangOptions?.fallbackLng) {
      throw new DefaultError(
        'You must set "fallbackLng" inside "multiLangOptions" to enable multi-lang middleware',
        {
          meta: this.multiLangOptions,
        },
      );
    }
    const { fallbackLng } = this.multiLangOptions;
    //
    this.addMiddleware(
      async (ctx, next): Promise<void> => {
        //
        const i18nextInstance = i18next.cloneInstance();
        //
        ctx.i18next = i18nextInstance;
        // Saving language to the current koaContext
        const lng = detectContextLang(ctx, Server.LANG_DETECTION_DEFAULT_OPTIONS);
        await i18nextInstance.changeLanguage(lng || fallbackLng);
        Server.setContextLang(ctx, lng, Server.LANG_DETECTION_DEFAULT_OPTIONS);
        //
        ctx.t = function translate(...args: any) {
          // @ts-ignore
          return ctx.i18next.t.apply(ctx.i18next, [...args]);
        };
        //
        await next();
      },
    );
  }

  initAuthMiddleware(
    authHandler: (ctx: RouteContext<TAppContext, TDatabaseModels>) => Promise<void>,
  ): void {
    this.addMiddleware(async (ctx, next) => {
      // Check the Authorization cookie
      const token = ctx.cookies.get('token', { signed: true }) || ctx.get('authorization');
      if (!token) {
        await next();
        return;
      }
      try {
        const decodedAuthToken = decodeJWT(token) as { sub: string };
        ctx.state.authToken = token;
        ctx.state.decodedAuthToken = decodedAuthToken;
        //
        if (decodedAuthToken.sub) {
          //
          await authHandler(ctx as RouteContext<TAppContext, TDatabaseModels>);
        }
      } catch (exception) {
        this.logger.error(`[authMiddleware] ${exception.message}`);
        this.logger.error(exception);
      }
      //
      await next();
    });
  }

  static setAuthCookie(context: ParameterizedContext, token: string, cookieName = 'token'): void {
    // Saving user's token to cookies
    context.cookies.set(cookieName, token, {
      signed: true,
      httpOnly: true,
      overwrite: true,
    });
  }

  static formatError(
    graphQLError: ApolloError,
    context: RouteContext<DefaultContext, DefaultState>,
  ): ApolloError {
    const {
      extensions: { exception, code },
    } = graphQLError;
    const { t: translate = (message: string) => message } = context;

    if (
      !['SequelizeValidationError', 'ValidationError'].includes(get(exception, 'name')) &&
      !get(exception, 'status')
    ) {
      if (get(exception, 'name') === 'SequelizeDatabaseError') {
        logger.error('SequelizeDatabaseError', exception.parent);
      } else {
        logger.error('formatError', graphQLError);
      }
      //
      const message = context.i18next?.exists(graphQLError.message)
        ? graphQLError.message
        : 'The request failed, please try again later or contact technical support';

      return Object.assign(graphQLError, {
        message: translate(message),
      });
    }
    //
    const message = `Errors.${graphQLError.message}`;
    return Object.assign(graphQLError, {
      message: i18next?.exists(message) ? translate(message) : graphQLError.message,
    });
  }

  async bindModelsToDBConnection(p: InitDatabaseOptions<TDatabaseModels>): Promise<void> {
    // @ts-ignore
    this.db = await initDatabase<DatabaseModels>(this.dbConnection, p);
  }

  /* GRAPHQL */
  // Enables internal GraphQL server.  Default GraphQL and GraphiQL endpoints
  // can be overridden
  async startServer(): Promise<http.Server> {
    const httpServer = http.createServer(this.koaApp.callback());
    //
    const httpTerminator = createHttpTerminator({
      server: httpServer,
    });
    // Gracefully shutdown our process in case of any uncaught exception
    await this.initExceptionHandler({
      async cleanupFn() {
        //
        httpTerminator
          .terminate()
          .catch(logger.error)
          .then(() => process.exit(1));
      },
    });

    /* CUSTOM APP INSTANTIATION */
    // Pass the `app` to do anything we need with it in userland. Useful for
    // custom instantiation that doesn't fit into the middleware/route functions
    if (typeof this.koaAppFunc === 'function') {
      await this.koaAppFunc(this.koaApp);
    }

    // It's useful to see how long a request takes to respond.  Add the
    // timing to a HTTP Response header
    this.koaApp.use(async (ctx, next) => {
      const start = ms.now();
      await next();
      const end = ms.parse(ms.since(start));
      const total = end.microseconds + end.milliseconds * 1e3 + end.seconds * 1e6;
      ctx.set('X-Response-Time', `${total / 1e3}ms`);
    });

    // Save client's ip to the context
    this.koaApp.use(async (ctx, next) => {
      ctx.state.countryCode = ctx.get('cf-ipcountry');
      ctx.state.userAgent = ctx.get('user-agent');
      ctx.state.ip =
        process.env.HOST === 'localhost'
          ? '127.0.0.1'
          : ctx.get('Cf-Connecting-Ip') ||
            ctx.get('X-Real-Ip') ||
            ctx.get('X-Forwarded-For') ||
            ctx.request.ip;
      //
      await next();
    });

    // Add 'before' middleware that needs to be invoked before the per-request store has instantiated
    this.beforeMiddleware.forEach((middlewareFunc) => this.koaApp.use(middlewareFunc));

    // Connect universalCookies middleware
    this.koaApp.use(cookiesMiddleware());

    this.koaApp.use(bodyParser(this.bodyParserOptions));

    /* Enable working behind nginx */
    this.koaApp.proxy = true;

    // Middleware to add preliminary security for HTTP headers via Koa Helmet
    this.koaApp.use(koaHelmet());

    // Attach custom middleware
    this.middleware.forEach((middlewareFunc) => this.koaApp.use(middlewareFunc));

    // Attach any custom routes we may have set in userland
    // Handle both added by initRoute function
    // and server.add*X*Route method
    this.routes.forEach((route) => {
      // @ts-ignore
      this.router[route.method](`${this.graphqlOptions.path}${route.route}`, ...route.handlers);
    });

    // We'll also add a generic error handler, that prints out to the stdout.
    // Note: This is a 'lower-level' than `config.setErrorHandler()` because
    // it's not middleware -- it's for errors that happen at the server level
    this.koaApp.on('error', (error) => {
      // This function should never show up, because `server.setErrorHandler()`
      // is already catching errors -- but just an FYI for what you might do.
      if (logger && typeof logger.error === 'function') {
        logger.error(error);
      }
      //
      if (Sentry && typeof Sentry.captureException === 'function') {
        Sentry.captureException(error);
      }
    });

    // @ts-ignore
    this.wsEventEmitter = initWSEventEmitter(redis);

    //
    await this.startWSServer(httpServer, this.wsServerOptions);

    // Connect the REST API routes to the server
    this.koaApp.use(this.router.routes()).use(this.router.allowedMethods());

    // GraphQL Server
    const {
      typeDefs,
      resolvers,
      permissions,
      subscriptions,
      playground,
      schemaDirectives,
    } = this.graphqlOptions;
    if (!typeDefs) {
      throw new Error('Please provide "typeDefs" value inside "graphqlOptions" object');
    }
    let schema = makeExecutableSchema({
      typeDefs,
      resolvers: resolvers(this),
      schemaDirectives,
    });

    //
    if (this.sentry) {
      const graphQLSentryMiddleware = graphQLSentry({
        forwardErrors: true,
        config: this.sentryOptions,
        withScope: (
          scope,
          error,
          context: ParameterizedContext<DefaultState, RouteContext<TAppContext, TDatabaseModels>>,
        ) => {
          const { viewer } = context.state;
          //
          if (viewer) {
            const { id, email } = viewer;
            //
            const ipFromHeaders =
              typeof get(context, 'get') === 'function'
                ? context.get('Cf-Connecting-Ip') ||
                  context.get('X-Forwarded-For') ||
                  context.get('X-Real-Ip') ||
                  context.request.ip
                : undefined;
            //
            scope.setUser({
              id,
              email: email || undefined,
              ip_address: ipFromHeaders,
            });
          }
          //
          scope.setTag('git_commit', git.message());
          scope.setTag('git_branch', git.branch());
          if (context?.request?.body) {
            scope.setExtra('body', context?.request?.body);
          }
          //
          if (context?.request?.headers) {
            const { origin, 'user-agent': ua } = context?.request?.headers;
            scope.setExtra('origin', origin);
            scope.setExtra('user-agent', ua);
            //
            const userAgent = ua && UserAgent.parse(ua);
            if (userAgent) {
              scope.setTag('os', userAgent && userAgent.os.toString());
              scope.setTag('device', userAgent && userAgent.device.toString());
              scope.setTag('browser', userAgent && userAgent.toAgent());
            }
          }
          //
          if (context?.request?.url) {
            scope.setTag('url', context.request.url);
          }
        },
      });
      schema = applyMiddleware(schema, graphQLSentryMiddleware);
    }
    //
    if (permissions?.rules) {
      const { rules } = permissions;
      const options = merge(
        {
          debug: process.env.NODE_ENV === 'development',
          allowExternalErrors: true,
          fallbackRule: allow,
          fallbackError: new DefaultError('Access is denied', {
            status: 403,
          }),
        },
        permissions.options,
      );
      schema = applyMiddleware(schema, shield(rules, options));
    }
    // Attach the GraphQL schema to the server, and hook it up to the endpoint
    // to listen to POST requests
    const engineOptions = {
      apiKey: process.env.APOLLO_KEY || undefined,
      graphVariant: process.env.NODE_ENV || undefined,
      //
      // experimental_schemaReporting: true,
    };
    const apolloServer = new ApolloServer({
      // Attach the GraphQL schema
      schema,
      playground,
      debug: process.env.NODE_ENV !== 'production',
      tracing: process.env.NODE_ENV !== 'production',
      logger: this.logger,
      introspection: true,
      engine: engineOptions,
      subscriptions,
      extensions: [
        () => new PossibleTypesExtension(),
        () => new FormatErrorWithContextExtension(Server.formatError),
      ],
      plugins: [
        ResponseCachePlugin({
          sessionId: (requestContext) => {
            // @ts-ignore
            let authToken = requestContext.request.http.headers.get('authorization');
            if (!authToken) {
              // @ts-ignore
              const cookies = requestContext.request.http.headers.get('cookie');
              if (cookies) {
                authToken = get(Cookie.parse(cookies), 'token');
              }
            }
            // @ts-ignore
            const sessionId = authToken ? this.db?.models.User.getIdFromToken(authToken) : null;
            //
            return sessionId;
          },
        }),
      ],
      // Bind the current request context, so it's accessible within GraphQL
      context: ({ ctx, connection }) => {
        //
        const context = get(connection, 'context', ctx);
        context.db = this.db;
        context.helpers = this.koaApp.context.helpers;
        // Create facebook dataloader context for better performance
        // @ts-ignore
        // eslint-disable-next-line no-param-reassign
        context.state.dataloaderContext = this.db?.helpers.createDatabaseContext();
        //
        return context;
      },
      persistedQueries: {
        cache: new RedisCache(pick(redis.options, ['host', 'port'])),
      },
      cache: new RedisCache(pick(redis.options, ['host', 'port'])),
      cacheControl: {
        defaultMaxAge: 0,
      },
    });
    apolloServer.applyMiddleware({
      app: this.koaApp,
      // server: apolloServer,
      path: this.graphqlOptions.path,
      //
      bodyParserConfig: this.bodyParserOptions,
      cors: this.corsOptions,
    });
    // Add subscription support
    if (subscriptions) {
      apolloServer.installSubscriptionHandlers(httpServer);
    }

    //
    httpServer.listen(this.port);

    // Log to the terminal that we're ready for action
    logServerStarted({
      type: 'server',
    });

    return httpServer;
  }

  async startWSServer(
    httpServer: http.Server,
    o?: Partial<WSServerOptions>,
  ): Promise<WebsocketServer> {
    const { adapter, path, wsEngine, ...opts } = o || {};
    // @ts-ignore
    const ws = WebsocketHandler(httpServer, {
      ...opts,
      path: path || '/socket.io',
      wsEngine: wsEngine || 'ws',
      adapter: adapter || wsRedis(redis.options),
    });

    if (!ws) {
      throw new Error('Failed to start websocket-server');
    }
    this.ws = ws;

    return ws;
  }

  async joinWSRoom(socket: Socket, roomId: string): Promise<void> {
    // @ts-ignore
    this.ws?.of('/').adapter.remoteJoin(socket.client.id, `${roomId}`, (err: Error) => {
      if (err) {
        this.logger.error(err);
      }
    });
  }

  async sendWSEvent(roomId: string, event: string, data?: { [k: string]: TodoAny }): Promise<void> {
    // if (process.env.NODE_ENV !== 'production') {
    logger.info(`Send event "${event}" to the room "${roomId}"`, data);
    // }
    if (roomId === 'any') {
      this.wsEventEmitter?.emit(event, data);
      return;
    }
    this.wsEventEmitter?.to(roomId).emit(event, data);
  }

  // Get access to Koa's `app` instance, for adding custom instantiation
  // or doing something that's not covered by other functions
  getKoaApp(func: (app: Koa) => Promise<void>): void {
    this.koaAppFunc = func;
  }

  // 404 handler for the server.  By default, `kit/entry/server.js` will
  // simply return a 404 status code without modifying the HTML render.  By
  // setting a handler here, this will be returned instead
  set404Handler(func: RouteHandler<TAppContext, TDatabaseModels>): void {
    if (typeof func !== 'function') {
      throw new Error('404 handler must be a function');
    }
    this.handler404 = func;
  }

  // Error handler.  If this isn't defined, the server will simply return a
  // 'There was an error. Please try again later.' message, and log the output
  // to the console.  Override that behaviour by passing a (e, ctx, next) -> {} func
  setErrorHandler(func: ErrorHandler<TAppContext, TDatabaseModels>): void {
    if (typeof func !== 'function') {
      throw new Error('Error handler must be a function');
    }
    this.errorHandler = func;
  }

  // Add custom middleware.  This should be an async func, for use with Koa.
  // There are two entry points - 'before' and 'after'
  addBeforeMiddleware(
    middlewareFunc: Middleware<ContextState, RouteContext<TAppContext, TDatabaseModels>>,
  ): void {
    this.beforeMiddleware.add(middlewareFunc);
  }

  addMiddleware(
    middlewareFunc: Middleware<ContextState, RouteContext<TAppContext, TDatabaseModels>>,
  ): void {
    this.middleware.add(middlewareFunc);
  }

  //
  addRouteParam(param: string, handler: IParamMiddleware): void {
    this.routeParams.add({
      param,
      handler,
    });
  }

  // Adds a custom server route to attach to our Koa router
  addRoute(
    method: RouteMethod,
    route: string,
    ...handlers: RouteHandler<TAppContext, TDatabaseModels>[]
  ): void {
    this.routes.add({
      method,
      route,
      handlers,
    });
  }

  // Adds custom GET route
  addGetRoute(route: string, ...handlers: RouteHandler<TAppContext, TDatabaseModels>[]): void {
    this.addRoute('get', route, ...handlers);
  }

  // Adds custom POST route
  addPostRoute(route: string, ...handlers: RouteHandler<TAppContext, TDatabaseModels>[]): void {
    this.addRoute('post', route, ...handlers);
  }

  // Adds custom PUT route
  addPutRoute(route: string, ...handlers: RouteHandler<TAppContext, TDatabaseModels>[]): void {
    this.addRoute('put', route, ...handlers);
  }

  // Adds custom PATCH route
  addPatchRoute(route: string, ...handlers: RouteHandler<TAppContext, TDatabaseModels>[]): void {
    this.addRoute('patch', route, ...handlers);
  }

  // Adds custom DELETE route
  addDeleteRoute(route: string, ...handlers: RouteHandler<TAppContext, TDatabaseModels>[]): void {
    this.addRoute('delete', route, ...handlers);
  }

  async sendErrorToSentry(error: SentryError, args: SentryErrorProps): Promise<void> {
    if (!this.sentry) {
      const e =
        'Sentry instance has not been initialized. Failed to send error to the Sentry cloud';
      this.logger.error(e);
      this.logger.error(error);
      return;
    }
    // @ts-ignore
    let meta: any = error.data || {};
    //
    if (error instanceof DefaultError && error.originalError instanceof DefaultError) {
      meta = { ...error.originalError.data, ...meta };
    }
    // Converting string error to Error instance
    if (
      error instanceof ValidationError ||
      error instanceof DatabaseError ||
      error instanceof UniqueConstraintError
    ) {
      // If we've got a Sequelize validationError,
      // than we should get the first error from array of errors
      // eslint-disable-next-line prefer-destructuring
      meta.instance = pick(get(error, 'errors[0].instance', {}), [
        'dataValues',
        '_changed',
        '_previousDataValues',
      ]);
      meta.origin = get(error, 'errors[0].origin');
    }
    //
    const { request } = args;
    let { messagePrefix = '' } = args;
    const messagePrefixChunks = [];
    //
    const method =
      // get http-request-method from koa request
      get(request, 'method') ||
      // get it from request config
      meta.method;
    if (method) {
      messagePrefixChunks.push(method);
    }
    //
    const path =
      // get path from koa request
      get(request, 'path') ||
      // get method/path from request config (for example, bitcoin-request's params.method)
      get(meta, 'url');
    if (path) {
      messagePrefixChunks.push(path);
    }
    if (messagePrefixChunks.length > 0) {
      //
      messagePrefix = `${messagePrefix}[${compact(messagePrefixChunks).join(' ')}] `;
    }
    // Try to get meta data from the args if error has been emitted not from koa web-server (doesn't have any context.request)
    if (!request) {
      Object.keys(args).forEach((argKey) => {
        // @ts-ignore
        const v = args[argKey];
        if (messagePrefix === v) {
          return;
        }
        if (typeof v !== 'string' && typeof v !== 'number') {
          return;
        }
        meta[argKey] = v;
      });
    }
    //
    this.sentry.withScope((scope) => {
      if (request) {
        scope.addEventProcessor((event) => Sentry.Handlers.parseRequest(event, request));
      }
      //
      const exception = typeof error === 'string' ? new Error(error) : error;
      exception.message = `${messagePrefix}${exception.message}`;
      // @ts-ignore
      exception.data = meta;
      // Group errors together based on their message
      const fingerprint = ['{{ default }}'];
      if (messagePrefix) {
        fingerprint.push(messagePrefix);
      }
      if (exception.message) {
        fingerprint.push(exception.message);
      }
      scope.setFingerprint(fingerprint);
      //
      Sentry.captureException(exception);
    });
  }
}

export default Server;
