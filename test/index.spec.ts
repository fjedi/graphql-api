process.env.AUTH_JWT_SECRET = '77dg2DVQyDqrWYWFRLSaMJrMHpB9LWCZ';
import { Server, WSRequest, getRawType, removeUndefinedValues } from '../src';
//
const NODE_INSTANCES_NUMBER = parseInt(process.env.NODE_INSTANCES_NUMBER || '', 10) || 1;
const DB_MAX_CONNECTIONS = parseInt(process.env.DB_MAX_CONNECTIONS || '', 10) || 150;

describe('Test api server', function () {
  let server: Server<any, any> | undefined;

  afterAll(async () => {
    console.log('Emit afterAll test-hook');
    server?.redis?.end(true);
    await server?.pubsub?.close();
  });

  it('Get valid rawType of object-like variable', async function () {
    expect(getRawType(null)).toBe('Null');
    expect(getRawType(/sdfsd/)).toBe('RegExp');
    expect(getRawType(Server)).toBe('Function');
    expect(getRawType({ testObjectField: 'test-value' })).toBe('Object');
    expect(getRawType(() => null)).toBe('Function');
  });

  it('Remove undefined or null values from object', async function () {
    expect(
      removeUndefinedValues({
        someField: 'test-value',
        anotherOne: 'test-value-2',
        undefinedField: undefined,
        nullField: null,
        emptyString: '',
      }),
    ).toMatchObject({
      someField: 'test-value',
      anotherOne: 'test-value-2',
    });
  });

  it('Should create instance of Server', async function () {
    server = new Server({
      allowedOrigins: ['example.com'],
      // Set-up CORS to allow credentials to be passed to origins outside of the
      // server.  We'll need this in order to test this out in development on :8080
      // *  - {String|Function(ctx)} origin `Access-Control-Allow-Origin`, default is request Origin header
      // *  - {String|Array} allowMethods `Access-Control-Allow-Methods`, default is 'GET,HEAD,PUT,POST,DELETE,PATCH'
      // *  - {String|Array} exposeHeaders `Access-Control-Expose-Headers`
      // *  - {String|Array} allowHeaders `Access-Control-Allow-Headers`
      // *  - {String|Number} maxAge `Access-Control-Max-Age` in seconds
      // *  - {Boolean|Function(ctx)} credentials `Access-Control-Allow-Credentials`, default is false.
      // *  - {Boolean} keepHeadersOnError Add set headers to `err.header` if an error is thrown
      corsOptions: {
        credentials: true,
        // origin(ctx: RouteContext) {
        //   return ctx.origin;
        // },
        // allowMethods: 'GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS',
        // allowHeaders:
        // 'Accept, Accept-Language, Content-Language, Content-Type, Origin, X-Device-Id, Authorization, Cookie',
      },
      // Change default limits for uploading files
      bodyParserOptions: {
        jsonLimit: '50mb',
        textLimit: '10mb',
      },
      graphqlOptions: {
        url: '/api',
        // @ts-ignore
        schema: {},
        subscriptions: {
          async onConnect(
            connectionParams: any,
            webSocket,
            { request: { headers } }: { request: WSRequest },
          ) {
            // const db = config.getDatabaseInstance();
            // if (headers.cookie && headers.cookie.indexOf('token') > -1) {
            //   const { token } = Cookie.parse(headers.cookie);
            //   const userId = token && User.getIdFromToken(token);
            //   //
            //   if (userId) {
            //     const session = await UserSession.findByPk(token);
            //     //
            //     if (session && !session.expiredAt) {
            //       const viewer = await User.findByPk(userId);
            //       return {
            //         db,
            //         helpers: contextHelpers,
            //         state: {
            //           viewer,
            //           token,
            //           session,
            //         },
            //       };
            //     }
            //   }
            // }
            throw new Error('Missing auth token!');
          },
          // onOperation(message, params, webSocket) {
          //   return params;
          // },
          // onOperationComplete(webSocket, d, a) {
          //   return webSocket;
          // },
          // onDisconnect() {
          //   logger.info('Client disconnected');
          // },
        },
      },
      dbOptions: {
        sync: true,
        maxConnections: Math.floor(DB_MAX_CONNECTIONS / NODE_INSTANCES_NUMBER),
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(`${process.env.DB_PORT}`, 10) || 3306,
        engine: 'mysql',
        name: process.env.DB_NAME || process.env.DB_USER || 'default_db',
        user: process.env.DB_USER || 'default_user',
        password: process.env.DB_PASSWORD || undefined,
        timezone: '+00:00',
      },
    });

    expect(server).toBeInstanceOf(Server);
  });
});
