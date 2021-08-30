import { Server } from '@fjedi/rest-api';

import { IMiddlewareFunction } from 'graphql-middleware';

export type ExceptionScope<TContext> = (
  scope: any,
  error: Error,
  context: TContext,
  reportError?: (res: Error | unknown) => boolean,
) => void;

export function captureException<TContext>(
  sentryInstance: Server<any, any>['sentry'],
  error: Error,
  ctx: TContext,
  withScope: ExceptionScope<TContext>,
  reportError?: (res: unknown) => boolean,
): void {
  if (!sentryInstance) {
    throw new Error(
      "sentryMiddleware.captureException was called while no 'sentryInstance' has been provided",
    );
  }
  if ((reportError && reportError(error)) || reportError === undefined) {
    sentryInstance.withScope((scope) => {
      withScope(scope, error, ctx);
      sentryInstance.captureException(error);
    });
  }
}

// Options for graphql-middleware-sentry
export interface SentryMiddlewareOptions<Context> {
  sentryInstance: Server<any, any>['sentry'];
  withScope?: ExceptionScope<Context>;
  captureReturnedErrors?: boolean;
  forwardErrors?: boolean;
  reportError?: (res: Error | any) => boolean;
}

export const sentryMiddleware = <Context>({
  sentryInstance,
  withScope = () => {},
  captureReturnedErrors = false,
  reportError,
}: SentryMiddlewareOptions<Context>): IMiddlewareFunction => {
  // Return middleware resolver
  return async (resolve, parent, args, ctx, info) => {
    try {
      const res = await resolve(parent, args, ctx, info);

      if (captureReturnedErrors && res instanceof Error) {
        captureException(sentryInstance, res, ctx, withScope, reportError);
      }

      return res;
    } catch (error) {
      captureException(sentryInstance, error as Error, ctx, withScope, reportError);

      throw error;
    }
  };
};
