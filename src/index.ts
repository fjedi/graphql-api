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
// Cookies
import Cookie from 'cookie';
// @ts-ignore
import cookiesMiddleware from 'universal-cookie-koa';
// High-precision timing, so we can debug response time to serve a request
// @ts-ignore
import ms from 'microseconds';
import { get, pick, flattenDeep, merge } from 'lodash';
//
import { Sequelize, ValidationError, OptimisticLockError } from 'sequelize';
import { applyMiddleware } from 'graphql-middleware';
import {
  createConnection,
  initDatabase,
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
import { logServerStarted } from './helpers/console';
import { initExceptionHandler } from './helpers/exception-handler';
import Sentry, { graphQLSentryMiddleware } from './helpers/sentry';
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

// @ts-ignore
type TodoAny = any;

export type KoaApp<TAppContext, TDatabaseModels extends DatabaseModels> = Koa & {
  context: RouteContext<TAppContext, TDatabaseModels>;
};

export type ContextHelpers = { [k: string]: unknown };

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
  t: TFunction;
  i18next: i18n;
  language: string;
  logger: Logger;
  sentry: typeof Sentry;
  helpers?: ContextHelpers;
} & TAppContext;

export type RouteHandler<TAppContext, TDatabaseModels extends DatabaseModels> = (
  ctx: RouteContext<TAppContext, TDatabaseModels>,
  next?: Next,
) => TodoAny;

export type ErrorHandler<TAppContext, TDatabaseModels extends DatabaseModels> = (
  err: DefaultError | ValidationError | OptimisticLockError,
  ctx: RouteContext<TAppContext, TDatabaseModels>,
) => void;

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
  contextHelpers?: ContextHelpers;
};

export type GraphQLServerOptions<
  TAppContext extends ParameterizedContext<ContextState, ParameterizedContext>,
  TDatabaseModels extends DatabaseModels
> = Config & {
  path: string;
  resolvers: (s: Server<TAppContext, TDatabaseModels>) => Config['resolvers'];
  permissions?: {
    rules: PermissionRules;
    options?: PermissionRulesOptions;
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
  sslPort: number;
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

  //
  koaHelmetOptions: { [k: string]: TodoAny };

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
    } = params;
    this.dbConnection = createConnection(dbOptions);
    this.graphqlOptions = graphqlOptions;
    if (bodyParserOptions) {
      this.bodyParserOptions = bodyParserOptions;
    }
    if (corsOptions) {
      this.corsOptions = corsOptions;
    }
    if (wsServerOptions) {
      this.wsServerOptions = wsServerOptions;
    }
    if (multiLangOptions?.translations) {
      this.multiLangOptions = multiLangOptions;
      const { backend, fallbackLng, translations } = multiLangOptions;
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
    if (typeof process.env.SSL_PORT !== 'undefined') {
      const { SSL_PORT } = process.env;
      if (!isValidPort(`${SSL_PORT}`)) {
        throw new TypeError(`${SSL_PORT} is not a valid port`);
      }
      this.sslPort = parseInt(SSL_PORT, 10);
    } else {
      this.sslPort = 5001;
    }

    // Init all API routes
    this.routes = new Set();
    //
    routes?.forEach((r: TodoAny) => this.initRoute(r));

    // Custom middleware
    this.beforeMiddleware = new Set();
    this.middleware = new Set();
    this.routeParams = new Set();

    //
    this.koaHelmetOptions = {};

    // Enable body parsing by default.
    this.bodyParserOptions = {};

    // CORS options for `koa-cors`
    this.corsOptions = {};

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
    this.koaApp.context.sentry = Sentry;
    //
    this.koaApp.context.helpers = {};
    if (contextHelpers) {
      this.koaApp.context.helpers = contextHelpers;
    }
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
    context: RouteContext<TodoAny, TodoAny>,
  ): ApolloError {
    const {
      extensions: { exception, code },
    } = graphQLError;
    const { t: translate } = context;

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
      const message = context.i18next.exists(graphQLError.message)
        ? graphQLError.message
        : 'The request failed, please try again later or contact technical support';

      return Object.assign(graphQLError, {
        message: translate(message),
      });
    }
    //
    const message = `Errors.${graphQLError.message}`;
    return Object.assign(graphQLError, {
      message: i18next.exists(message) ? translate(message) : graphQLError.message,
    });
  }

  async bindModelsToDBConnection(p: {
    sync?: boolean;
    models: TDatabaseModels;
    migrationsPath?: string;
  }): Promise<void> {
    const { sync, models, migrationsPath } = p;
    //
    // @ts-ignore
    this.db = await initDatabase<DatabaseModels>(this.dbConnection, {
      sync: sync || false,
      models,
      migrationsPath,
    });
  }

  /* GRAPHQL */
  // Enables internal GraphQL server.  Default GraphQL and GraphiQL endpoints
  // can be overridden
  async startServer(): Promise<http.Server> {
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
    this.koaApp.use(koaHelmet(this.koaHelmetOptions));

    // Attach custom middleware
    this.middleware.forEach((middlewareFunc) => this.koaApp.use(middlewareFunc));

    // Attach any custom routes we may have set in userland
    // Handle both added by initRoute function
    // and server.add*X*Route method
    this.routes.forEach((route) => {
      // @ts-ignore
      this.router[route.method](`${this.graphqlOptions.url}${route.route}`, ...route.handlers);
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

    const httpServer = http.createServer(this.koaApp.callback());
    //
    const httpTerminator = createHttpTerminator({
      server: httpServer,
    });
    // @ts-ignore
    this.wsEventEmitter = initWSEventEmitter(redis);

    // Gracefully shutdown our process
    await initExceptionHandler({
      async cleanupFn() {
        //
        httpTerminator
          .terminate()
          .catch(logger.error)
          .then(() => process.exit(1));
      },
    });

    //
    await this.startWSServer(httpServer, this.wsServerOptions);

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

    if (graphQLSentryMiddleware) {
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

    // Connect the REST API routes to the server
    this.koaApp.use(this.router.routes()).use(this.router.allowedMethods());

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

  setKoaHelmetOptions(opt: TodoAny): void {
    if (opt) {
      this.koaHelmetOptions = opt;
    }
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

  // CORS options, for `koa-cors` instantiation
  setCORSOptions(opt: CORSOptions): void {
    this.corsOptions = opt;
  }
}

export default Server;
