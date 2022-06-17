import { Server, ParameterizedContext, DefaultState } from '@fjedi/rest-api';
import { logger } from '@fjedi/logger';
import { DefaultError } from '@fjedi/errors';
import { DatabaseModels } from '@fjedi/database-client';
import type { ApolloServerPlugin } from 'apollo-server-plugin-base';
// Parse userAgent
import UserAgent from 'useragent';
import git from 'git-rev-sync';

let gitCommit: string;
let gitBranch: string;
try {
  gitCommit = git.message();
  gitBranch = git.branch();
} catch (e) {
  logger.warn('Failed to attach git info to the error sent to Sentry', e);
}

export default function apolloSentryPlugin<
  TAppContext extends ParameterizedContext<DefaultState, ParameterizedContext>,
  TDatabaseModels extends DatabaseModels,
>(server: Server<TAppContext, TDatabaseModels>): ApolloServerPlugin<TAppContext> {
  const sentry = server!.sentry!;
  return {
    // server lifecycle event
    async requestDidStart(_: unknown) {
      /* Within this returned object, define functions that respond
           to request-specific lifecycle events. */
      return {
        async didEncounterErrors(ctx) {
          const { operationName } = ctx; // name of the query/mutation (logIn, viewer, etc)
          const operationKind = ctx.operation?.operation; // mutation || 'query' || 'subscription'

          // If we couldn't parse the operation (usually invalid queries)
          if (!ctx.operation) {
            ctx.errors.forEach((err) => {
              sentry.withScope((scope) => {
                scope.setExtra('query', ctx.request.query);
                // Group errors together based on their operationName
                const fingerprint = ['{{ default }}'];
                if (operationName) {
                  fingerprint.push(operationName);
                }
                scope.setFingerprint(fingerprint);

                sentry.captureException(err);
              });
            });
            return;
          }

          const headers = ctx.request.http?.headers;
          ctx.errors.forEach((err) => {
            // Add scoped report details and send to Sentry
            sentry.withScope((scope) => {
              let ipFromHeaders;
              if (headers) {
                const transactionId = headers.get('x-transaction-id');
                if (transactionId) {
                  scope.setTransactionName(transactionId);
                }
                ipFromHeaders =
                  headers.get('Cf-Connecting-Ip') ||
                  headers.get('X-Forwarded-For') ||
                  headers.get('X-Real-Ip') ||
                  // @ts-ignore
                  ctx.request.ip;

                //
                const ua = headers.get('user-agent');
                scope.setExtra('origin', headers.get('origin'));
                scope.setExtra('user-agent', ua);
                //
                const userAgent = ua && UserAgent.parse(ua);
                if (userAgent) {
                  scope.setTag('os', userAgent && userAgent.os.toString());
                  scope.setTag('device', userAgent && userAgent.device.toString());
                  scope.setTag('browser', userAgent && userAgent.toAgent());
                }
              }
              // @ts-ignore
              const { id, email } = ctx.state?.viewer ?? {};
              scope.setUser({
                id,
                email: email || undefined,
                ip_address: ipFromHeaders,
              });

              if (typeof gitCommit === 'string') {
                scope.setTag('git_commit', gitCommit);
              }
              if (typeof gitBranch === 'string') {
                scope.setTag('git_branch', gitBranch);
              }

              // Annotate whether failing operation was query/mutation/subscription
              if (operationKind) {
                scope.setTag('kind', operationKind);
              }

              // Log query and variables as extras (make sure to strip out sensitive data!)
              scope.setExtra('query', ctx.request.query);
              // @ts-ignore
              scope.setExtra('variables', ctx.request.variables);

              if (err.path) {
                // We can also add the path as breadcrumb
                scope.addBreadcrumb({
                  category: 'query-path',
                  message: err.path.join(' > '),
                  level: 'debug',
                });
              }
              // Group errors together based on their operationName
              const fingerprint = ['{{ default }}'];
              if (operationName) {
                fingerprint.push(operationName);
              }
              scope.setFingerprint(fingerprint);
              // Add prefix to error's message
              // eslint-disable-next-line no-param-reassign
              sentry.captureException(
                new DefaultError(`[${operationName}]: ${err.name}`, {
                  originalError: err,
                  meta: ctx.request,
                }),
              );
            });
          });
        },
      };
    },
  };
}
