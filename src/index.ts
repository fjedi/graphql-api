/* eslint-disable lines-between-class-members  */
import isValidPort from 'validator/lib/isPort';
import http from 'http';
import { createHttpTerminator } from 'http-terminator';
import Koa, {
  // @ts-ignore
  App,
  Middleware,
  Next,
  ParameterizedContext,
  DefaultState,
  DefaultContext,
} from 'koa';
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
import { get, pick, flattenDeep } from 'lodash';
//
import { Sequelize, ValidationError, OptimisticLockError } from 'sequelize';
import { GraphQLSchema } from 'graphql';
import { applyMiddleware, IMiddlewareGenerator } from 'graphql-middleware';
import { TFunction, i18n } from 'i18next';
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

// @ts-ignore
import { ApolloServer, ApolloError, Config } from 'apollo-server-koa';
// @ts-ignore
import { PossibleTypesExtension } from 'apollo-progressive-fragment-matcher';
// @ts-ignore
import { FormatErrorWithContextExtension } from 'graphql-format-error-context-extension';
import { RedisCache } from 'apollo-server-cache-redis';
// @ts-ignore
import ResponseCachePlugin from 'apollo-server-plugin-response-cache';
//
import { logServerStarted } from './helpers/console';
import { initExceptionHandler } from './helpers/exception-handler';
import Sentry, { graphQLSentryMiddleware } from './helpers/sentry';

export type RouteMethod = 'get' | 'post' | 'delete' | 'update' | 'put' | 'patch';
export type { Middleware, Next, ParameterizedContext, DefaultState, DefaultContext } from 'koa';

// @ts-ignore
type TodoAny = any;

export type RouteContext<
  TAppContext,
  TDatabaseModels extends DatabaseModels
> = ParameterizedContext<DefaultState, DefaultContext> & {
  db: DatabaseConnection<TDatabaseModels>;
  redis: RedisClient;
  t: TFunction;
  i18next: i18n;
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

export type ServerParams<
  TAppContext extends ParameterizedContext<DefaultState, ParameterizedContext>,
  TDatabaseModels extends DatabaseModels
> = {
  dbOptions: DatabaseConnectionOptions;
  graphqlOptions: GraphQLServerOptions;
  bodyParserOptions?: bodyParser.Options;
  corsOptions?: CORSOptions;
  wsServerOptions?: Partial<WSServerOptions>;
  routes?: Array<(server: Server<TAppContext, TDatabaseModels>) => void>;
};

export type GraphQLServerOptions = {
  url: string;
  graphiQL?: boolean;
  schema: GraphQLSchema;
  permissions?: IMiddlewareGenerator<TodoAny, TodoAny, TodoAny>;
  subscriptions?: Config['subscriptions'];
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
  TAppContext extends ParameterizedContext<DefaultState, ParameterizedContext>,
  TDatabaseModels extends DatabaseModels
> {
  environment: 'production' | 'development';
  host: string;
  port: number;
  sslPort: number;
  koaApp: Koa;
  router: KoaRouter;
  routes: Set<Route<TAppContext, TDatabaseModels>>;
  routeParams: Set<RouteParam>;
  middleware: Set<Middleware>;
  beforeMiddleware: Set<Middleware>;
  koaAppFunc?: (app: Koa) => Promise<void>;
  handler404?: (ctx: RouteContext<TAppContext, TDatabaseModels>) => Promise<any>;
  errorHandler?: ErrorHandler<TAppContext, TDatabaseModels>;

  // Middlewares
  // Enable body parsing by default.  Leave `koa-bodyparser` opts as default
  bodyParserOptions: bodyParser.Options;
  // CORS options for `koa-cors`
  corsOptions: CORSOptions;

  // Database
  dbConnection: Sequelize;
  db?: DatabaseConnection<TDatabaseModels>;
  //
  logger: Logger;
  redis: RedisClient;

  // Graphql-related staff
  // graphQLServer: boolean;
  graphqlOptions: GraphQLServerOptions;

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
    //
    this.redis = redis;
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
      });
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

  static formatError(
    graphQLError: ApolloError,
    context: RouteContext<TodoAny, TodoAny>,
  ): ApolloError {
    const {
      extensions: { exception, code },
    } = graphQLError;
    const { t: translate, i18next } = context;

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
      const message = i18next.exists(graphQLError.message)
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
    // eslint-disable-next-line no-param-reassign
    this.koaApp.context.logger = this.logger;
    // eslint-disable-next-line no-param-reassign
    this.koaApp.context.sentry = Sentry;

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
    this.startWSServer(httpServer, this.wsServerOptions);

    // GraphQL Server
    const {
      schema,
      permissions,
      graphiQL = process.env.NODE_ENV !== 'production',
      subscriptions,
    } = this.graphqlOptions;
    let schemaWithMiddlewares = schema;

    if (graphQLSentryMiddleware) {
      schemaWithMiddlewares = applyMiddleware(schema, graphQLSentryMiddleware);
    }
    //
    if (permissions) {
      schemaWithMiddlewares = applyMiddleware(schema, permissions);
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
      schema: schemaWithMiddlewares,
      playground: graphiQL,
      debug: process.env.NODE_ENV !== 'production',
      tracing: process.env.NODE_ENV !== 'production',
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
      path: this.graphqlOptions.url,
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
  addBeforeMiddleware(middlewareFunc: Middleware): void {
    this.beforeMiddleware.add(middlewareFunc);
  }

  addMiddleware(middlewareFunc: Middleware): void {
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
