/* eslint-disable lines-between-class-members  */
import {
  Server as APIServer,
  ServerParams as APIServerParams,
  ContextState,
  WSServerOptions,
  ParameterizedContext,
  DefaultContext,
  DefaultState,
  RouteContext,
} from '@fjedi/rest-api';
import http from 'http';
// Parse userAgent
import UserAgent from 'useragent';
// Cookies
import Cookie from 'cookie';
import { get, pick, merge } from 'lodash';
//
import { applyMiddleware } from 'graphql-middleware';
// Sentry
import { sentry as graphQLSentry } from 'graphql-middleware-sentry';
import git from 'git-rev-sync';
// Database
import { DatabaseModels } from '@fjedi/database-client';
import { redis } from '@fjedi/redis-client';
import { DefaultError } from '@fjedi/errors';
//
import { ApolloServer, ApolloError, Config, makeExecutableSchema } from 'apollo-server-koa';
import { shield, allow } from 'graphql-shield';
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
import i18next from 'i18next';

export type {
  RouteMethod,
  RouteContext,
  CORSOrigin,
  CORSOptions,
  KoaApp,
  ContextHelpers,
  ContextState,
  RouteHandler,
  ErrorHandler,
  Translations,
  MultiLangOptions,
  SentryOptions,
  SentryError,
  SentryErrorProps,
  WSRequest,
  WSServerOptions,
  Middleware,
  Next,
  ParameterizedContext,
  DefaultContext,
  DefaultState,
} from '@fjedi/rest-api';
export * from '@fjedi/rest-api';
//
export * as shield from 'graphql-shield';

export interface ServerParams<
  TAppContext extends ParameterizedContext<ContextState, ParameterizedContext>,
  TDatabaseModels extends DatabaseModels
> extends APIServerParams<TAppContext, TDatabaseModels> {
  graphqlOptions: GraphQLServerOptions<TAppContext, TDatabaseModels>;
}

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

export class Server<
  TAppContext extends ParameterizedContext<ContextState, ParameterizedContext>,
  TDatabaseModels extends DatabaseModels
> extends APIServer<TAppContext, TDatabaseModels> {
  pubsub: RedisPubSub;
  // Graphql-related staff
  graphqlOptions: GraphQLServerOptions<TAppContext, TDatabaseModels>;

  constructor(params: ServerParams<TAppContext, TDatabaseModels>) {
    const { graphqlOptions, ...superParams } = params;
    super(superParams);
    this.graphqlOptions = graphqlOptions;

    this.pubsub = new RedisPubSub({
      connection: {
        host: redis.options.host,
        port: redis.options.port,
      },
    });
    //
    this.formatError = this.formatError.bind(this);
    this.startServer = this.startServer.bind(this);
    this.startWSServer = this.startWSServer.bind(this);
  }

  formatError(graphQLError: ApolloError): ApolloError {
    const {
      extensions: { exception },
    } = graphQLError;
    //
    if (this.environment === 'development') {
      return graphQLError;
    }
    if (typeof exception?.status === 'number' && exception.status < 500) {
      return graphQLError;
    }
    if (!Server.SYSTEM_ERROR_REGEXP.test(exception?.message)) {
      return graphQLError;
    }
    // eslint-disable-next-line no-param-reassign
    graphQLError.message = Server.DEFAULT_ERROR_MESSAGE;
    //
    return graphQLError;
  }

  /* GRAPHQL */
  // Enables internal GraphQL server.  Default GraphQL and GraphiQL endpoints
  // can be overridden
  async startServer(): Promise<http.Server> {
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
    return super.startServer({
      beforeListen: async () => {
        //
        if (this.sentry) {
          const graphQLSentryMiddleware = graphQLSentry({
            forwardErrors: true,
            // @ts-ignore
            config: this.sentryOptions,
            // @ts-ignore
            withScope: (
              scope,
              error,
              context: ParameterizedContext<
                DefaultState,
                RouteContext<TAppContext, TDatabaseModels>
              >,
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
              try {
                scope.setTag('git_commit', git.message());
                scope.setTag('git_branch', git.branch());
              } catch (e) {
                context.logger.warn('Failed to attach git info to the error sent to Sentry', e);
              }
              // @ts-ignore
              if (context?.request?.body) {
                // @ts-ignore
                scope.setExtra('body', context?.request?.body);
              }
              //
              if (context?.request?.headers) {
                const { origin, 'user-agent': ua } = context.request.headers;
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
            () => new FormatErrorWithContextExtension(this.formatError),
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
          // @ts-ignore
          app: this.koaApp,
          // server: apolloServer,
          path: this.graphqlOptions.path,
          //
          bodyParserConfig: this.bodyParserOptions,
          cors: this.corsOptions,
        });
        // Add subscription support
        if (subscriptions) {
          apolloServer.installSubscriptionHandlers(this.httpServer);
        }
      },
    });
  }

  async startWSServer(httpServerOrPort: number | http.Server, o?: Partial<WSServerOptions>) {
    const ws = await super.startWSServer(httpServerOrPort, o);
    if (this.graphqlOptions?.subscriptions) {
      if (httpServerOrPort === this.httpServer || this.port === httpServerOrPort) {
        const e = `To avoid conflicts with graphQL's subscriptions, please provide different http instance for socket.io WS-server or set port-number that differs from httpServer's "port" value instead to start standalone WS-server`;
        throw new Error(e);
      }
    }
    //
    return ws;
  }
}

export default Server;
