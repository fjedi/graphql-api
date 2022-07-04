/* eslint-disable lines-between-class-members  */
import {
  Server as APIServer,
  ServerParams as APIServerParams,
  ContextState,
  WSServerOptions,
  ParameterizedContext,
} from '@fjedi/rest-api';
import { decodeJWT } from '@fjedi/jwt';
import http from 'http';
// Cookies
import Cookie from 'cookie';
import { get, pick, merge } from 'lodash';
// Database
import { DatabaseModels } from '@fjedi/database-client';
import { redis } from '@fjedi/redis-client';
import { DefaultError } from '@fjedi/errors';
//
import { GraphQLError, DocumentNode } from 'graphql';
import { makeExecutableSchema, IExecutableSchemaDefinition } from '@graphql-tools/schema';
import { ApolloServer, ServerRegistration, Config } from 'apollo-server-koa';
import {
  ApolloServerPluginCacheControl,
  ApolloServerPluginDrainHttpServer,
  ApolloServerPluginLandingPageDisabled,
  ApolloServerPluginLandingPageGraphQLPlayground,
  ApolloServerPluginLandingPageGraphQLPlaygroundOptions,
} from 'apollo-server-core';
import type { ApolloServerPlugin } from 'apollo-server-plugin-base';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import { RedisCache } from 'apollo-server-cache-redis';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import type { ServerOptions as GraphQLWSOptions, Disposable } from 'graphql-ws/lib';
import { createWriteStream, WriteStream } from 'fs';
// @ts-ignore
import graphqlUploadKoa from 'graphql-upload/graphqlUploadKoa.js';
import type { FileUpload } from 'graphql-upload';
import { finished } from 'stream/promises';
import defaultTypeDefs from './schema/type-defs';
import defaultResolvers from './schema/resolvers';
import graphQLSchemaExecutor from './schema/executor';
import sentryPlugin from './plugins/sentry.plugin';

export { withFilter } from 'graphql-subscriptions';
export { gql } from 'apollo-server-koa';
export type { FileUpload, UploadOptions } from 'graphql-upload';

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
    typeDefs?: DocumentNode;
    resolvers: (s: Server<TAppContext, TDatabaseModels>) => Config['resolvers'];
    subscriptions?: GraphQLWSOptions & {
      path: WSServerOptions['path'];
    };
    schemaDirectives?: IExecutableSchemaDefinition<TAppContext>['schemaDirectives'];
    playground?: ApolloServerPluginLandingPageGraphQLPlaygroundOptions | boolean;
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

  static async readGraphQLFileStream(
    file: Promise<FileUpload>,
    dest: WriteStream | string,
  ): Promise<Omit<FileUpload, 'createReadStream'>> {
    const { createReadStream, ...bypassProps } = await file;
    // Invoking the `createReadStream` will return a Readable Stream.
    // See https://nodejs.org/api/stream.html#stream_readable_streams
    const stream = createReadStream();

    const out = typeof dest === 'string' ? createWriteStream(dest) : dest;
    stream.pipe(out);
    await finished(out);

    return bypassProps;
  }

  /* GRAPHQL */
  // Enables internal GraphQL server.  Default GraphQL and GraphiQL endpoints
  // can be overridden
  async startServer(): Promise<http.Server> {
    // GraphQL Server
    const {
      typeDefs,
      resolvers,
      playground,
      subscriptions,
      onHealthCheck,
      disableHealthCheck,
      schemaDirectives,
      plugins = [],
      ...apolloServerOptions
    } = this.graphqlOptions;
    if (!typeDefs) {
      throw new Error('Please provide "typeDefs" value inside "graphqlOptions" object');
    }

    const schema = makeExecutableSchema({
      typeDefs: [defaultTypeDefs, typeDefs],
      resolvers: merge(defaultResolvers(this), resolvers(this)),
      schemaDirectives,
    });
    //
    return super.startServer({
      beforeListen: async () => {
        // Create websocket server
        let serverCleanup: Disposable;
        if (subscriptions) {
          const wsServer = new WebSocketServer({
            server: this.httpServer,
            path: subscriptions?.path ?? '/subscriptions',
          });
          // Save the returned server's info so we can shut down this server later
          serverCleanup = useServer(
            {
              schema,
              context: ({ extra }) => ({ db: this.db, state: extra }),
              onConnect: async (context: GraphQLWSContext): Promise<boolean> => {
                const { User, UserSession } = this.db!.models;
                const { connectionParams, extra } = context;
                const token =
                  ((connectionParams?.authToken ||
                    connectionParams?.Authorization ||
                    extra.request.headers.authorization) as string | null) ||
                  (extra.request.headers.cookie
                    ? Cookie.parse(extra.request.headers.cookie)?.token
                    : '');
                //
                this.logger.info('graphql-ws.authToken', { token });
                extra.wsAdapter = 'graphql-ws';
                //
                if (token) {
                  try {
                    const { sub } = decodeJWT(token) as { sub: string };
                    if (!sub) {
                      return false;
                    }
                    const session = await UserSession.findByPk(token);
                    //
                    if (session) {
                      const viewer = await User.findByPk(sub);
                      context.extra = { viewer, token, session };
                      return true;
                    }
                  } catch (error) {
                    return false;
                  }
                }
                return false;
              },
              ...subscriptions,
            },
            wsServer,
          );
        }

        if (this.sentry) {
          plugins.unshift(sentryPlugin(this));
        }
        // Add following plugins as default ones to the beginning of plugins-array
        plugins.unshift(
          playground === false
            ? ApolloServerPluginLandingPageDisabled()
            : ApolloServerPluginLandingPageGraphQLPlayground(
                playground === true ? undefined : playground,
              ),
          ApolloServerPluginCacheControl({
            defaultMaxAge: 0,
          }),
        );
        // Add to the end of plugins-array following default plugins
        plugins.push(ApolloServerPluginDrainHttpServer({ httpServer: this.httpServer }), {
          async serverWillStart() {
            return {
              async drainServer() {
                if (serverCleanup) {
                  await serverCleanup.dispose();
                }
              },
            };
          },
        });

        const apolloServer = new ApolloServer({
          schema,
          executor: graphQLSchemaExecutor(schema),
          debug: process.env.NODE_ENV !== 'production',
          logger: this.logger,
          introspection: true,
          csrfPrevention: true,
          plugins,
          // Bind the current request context, so it's accessible within GraphQL
          context: ({ ctx, connection }) => {
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
        await apolloServer.start();
        // This middleware should be added before calling `applyMiddleware`.
        this.koaApp.use(graphqlUploadKoa());
        //
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
