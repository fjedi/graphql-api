/* eslint-disable lines-between-class-members  */
import {
  Server as APIServer,
  ServerParams as APIServerParams,
  ContextState,
  WSServerOptions,
  ParameterizedContext,
} from '@fjedi/rest-api';
import http from 'http';
// Parse userAgent
// import UserAgent from 'useragent';
// Cookies
// import Cookie from 'cookie';
import { get, pick } from 'lodash';
// import git from 'git-rev-sync';
// Database
import { DatabaseModels } from '@fjedi/database-client';
import { redis } from '@fjedi/redis-client';
import { DefaultError } from '@fjedi/errors';
//
import { GraphQLError } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { ApolloServer, ServerRegistration, Config } from 'apollo-server-koa';
import { ApolloServerPluginDrainHttpServer } from 'apollo-server-core';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import { RedisCache } from 'apollo-server-cache-redis';
import { WebSocketServer, ServerOptions as WsServerOptions } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';

export { withFilter } from 'graphql-subscriptions';

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
export interface ServerParams<
  TAppContext extends ParameterizedContext<ContextState, ParameterizedContext>,
  TDatabaseModels extends DatabaseModels,
> extends APIServerParams<TAppContext, TDatabaseModels> {
  graphqlOptions: GraphQLServerOptions<TAppContext, TDatabaseModels>;
}

export type GraphQLServerOptions<
  TAppContext extends ParameterizedContext<ContextState, ParameterizedContext>,
  TDatabaseModels extends DatabaseModels,
> = Config &
  Omit<ServerRegistration, 'app'> & {
    // formatError: (e: GraphQLServerError) => GraphQLFormattedError<Record<string, unknown>>;
    path: string;
    resolvers: (s: Server<TAppContext, TDatabaseModels>) => Config['resolvers'];
    subscriptions?: WsServerOptions;
  };

export interface GraphQLServerError extends GraphQLError {
  originalError: DefaultError;
}

export class Server<
  TAppContext extends ParameterizedContext<ContextState, ParameterizedContext>,
  TDatabaseModels extends DatabaseModels,
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
    // this.formatError = this.formatError.bind(this);
    this.startServer = this.startServer.bind(this);
    this.startWSServer = this.startWSServer.bind(this);
  }

  // formatError(graphQLError: GraphQLServerError) {
  //   const { originalError, extensions } = graphQLError;
  //   //
  //   if (extensions?.code === 'PERSISTED_QUERY_NOT_FOUND') {
  //     return graphQLError;
  //   }
  //   //
  //   if (this.environment === 'development') {
  //     this.logger.error(graphQLError);
  //     return graphQLError;
  //   }
  //   const errorCode = extensions?.exception?.status || originalError?.status;
  //   const isPublicError =
  //     typeof errorCode === 'number' &&
  //     (errorCode < 500 ||
  //       (!Server.SYSTEM_ERROR_REGEXP.test(originalError?.message) &&
  //         !Server.SYSTEM_ERROR_REGEXP.test(extensions?.exception?.name)));
  //   if (isPublicError) {
  //     return graphQLError;
  //   }
  //   // eslint-disable-next-line no-param-reassign
  //   graphQLError.message = Server.DEFAULT_ERROR_MESSAGE;
  //   // @ts-ignore
  //   // eslint-disable-next-line no-param-reassign
  //   graphQLError.extensions = undefined;
  //   //
  //   return graphQLError;
  // }

  /* GRAPHQL */
  // Enables internal GraphQL server.  Default GraphQL and GraphiQL endpoints
  // can be overridden
  async startServer(): Promise<http.Server> {
    // GraphQL Server
    const {
      typeDefs,
      resolvers,
      subscriptions,
      onHealthCheck,
      disableHealthCheck,
      ...apolloServerOptions
    } = this.graphqlOptions;
    if (!typeDefs) {
      throw new Error('Please provide "typeDefs" value inside "graphqlOptions" object');
    }
    const schema = makeExecutableSchema({
      typeDefs,
      resolvers: resolvers(this),
    });
    //
    return super.startServer({
      beforeListen: async () => {
        // Create websocket server
        const wsServer = new WebSocketServer({
          server: this.httpServer,
          path: subscriptions?.path ?? '/subscriptions',
        });
        // Save the returned server's info so we can shut down this server later
        const serverCleanup = useServer({ schema }, wsServer);

        const apolloServer = new ApolloServer({
          schema,
          debug: process.env.NODE_ENV !== 'production',
          logger: this.logger,
          introspection: true,
          csrfPrevention: true,
          plugins: [
            ApolloServerPluginDrainHttpServer({ httpServer: this.httpServer }),
            {
              async serverWillStart() {
                return {
                  async drainServer() {
                    await serverCleanup.dispose();
                  },
                };
              },
            },
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
          ...apolloServerOptions,
        });
        apolloServer.applyMiddleware({
          // @ts-ignore
          app: this.koaApp,
          // server: apolloServer,
          path: this.graphqlOptions.path,
          //
          bodyParserConfig: this.bodyParserOptions,
          onHealthCheck,
          disableHealthCheck,
          cors: {
            ...this.corsOptions,
            allowMethods:
              this.corsOptions?.allowMethods === null ? undefined : this.corsOptions?.allowMethods,
          },
        });
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
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
