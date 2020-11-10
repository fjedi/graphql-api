// Sentry
import * as Sentry from '@sentry/node';
import * as Integrations from '@sentry/integrations';
import { sentry as graphQLSentry } from 'graphql-middleware-sentry';
import { ValidationError, UniqueConstraintError, DatabaseError } from 'sequelize';
import { Request, Response, ParameterizedContext, DefaultState, DefaultContext } from 'koa';
//
import git from 'git-rev-sync';
import { get, compact, pick } from 'lodash';
// Parse userAgent
import UserAgent from 'useragent';
//
import { logger } from '@fjedi/logger';
import { DefaultError } from '@fjedi/errors';

const sentryEnv = process.env.SENTRY_ENV || process.env.NODE_ENV;
const dsn = process.env.SENTRY_DSN;
const sentrySettings = {
  dsn,
  enabled: true,
  debug: sentryEnv !== 'production',
  // None = 0, // No logs will be generated
  // Error = 1, // Only SDK internal errors will be logged
  // Debug = 2, // Information useful for debugging the SDK will be logged
  // Verbose = 3 // All SDK actions will be logged
  logLevel: sentryEnv === 'production' ? 1 : 3,
  release: git.long(),
  environment: sentryEnv,
  serverName: process.env.HOST,
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
};
Sentry.init(sentrySettings);
Sentry.configureScope((scope) => {
  scope.setTag('git_commit', git.message());
  scope.setTag('git_branch', git.branch());
});

export type SentryErrorProps = {
  messagePrefix?: string;
  request?: Request;
  response?: Response;
  path?: string;
  userId?: string | number;
  [k: string]: any;
};

export type SentryError =
  | DefaultError
  | ValidationError
  | DatabaseError
  | UniqueConstraintError
  | Error;

export async function sendErrorToSentry(
  error: DefaultError | ValidationError | DatabaseError | UniqueConstraintError | Error,
  args: SentryErrorProps = {},
) {
  if (!dsn) {
    logger.error('Sentry DSN has not been set. Failed to send error to the Sentry cloud', error);
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
  Sentry.withScope((scope) => {
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

export const graphQLSentryMiddleware = !dsn
  ? null
  : graphQLSentry({
      forwardErrors: true,
      config: sentrySettings,
      withScope: (scope, error, context: ParameterizedContext<DefaultState, DefaultContext>) => {
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
        scope.setExtra('body', get(context, 'request.body'));
        const { origin, 'user-agent': ua } = get(context, 'request.headers', {});
        scope.setExtra('origin', origin);
        scope.setExtra('user-agent', ua);
        //
        const userAgent =
          typeof context?.get === 'function'
            ? UserAgent.parse(context.get('user-agent'))
            : undefined;
        if (userAgent) {
          scope.setTag('os', userAgent && userAgent.os.toString());
          scope.setTag('device', userAgent && userAgent.device.toString());
          scope.setTag('browser', userAgent && userAgent.toAgent());
        }

        scope.setTag('url', context?.request?.url);
      },
    });

export default Sentry;
