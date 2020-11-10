import { logger } from '@fjedi/logger';
import Sentry from './sentry';

type ExceptionHandlerProps = {
  cleanupFn: (exception?: any) => Promise<any>;
  exit?: boolean;
  exitCode?: number;
};

// Gracefully shutdown our process
export function processExitHandler(opts: ExceptionHandlerProps) {
  const { cleanupFn, exit = false, exitCode = 1 } = opts;
  // @ts-ignore
  return (e) => {
    //
    if (e) {
      if (logger && typeof logger.error === 'function') {
        logger.error(e);
      }
      //
      if (Sentry && typeof Sentry.captureException === 'function') {
        Sentry.captureException(e);
      }
    }
    if (typeof cleanupFn === 'function') {
      cleanupFn(e)
        .catch(logger.error)
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

export async function initExceptionHandler(opts: any) {
  // Catch all exceptions
  process.on('exit', processExitHandler({ exit: true, ...opts }));
  process.on('SIGINT', processExitHandler(opts));
  process.on('SIGHUP', processExitHandler(opts));
  process.on('SIGTERM', processExitHandler(opts));
  process.on('SIGUSR1', processExitHandler(opts));
  process.on('SIGUSR2', processExitHandler(opts));
  process.on('uncaughtException', processExitHandler(opts));
  process.on('unhandledRejection', processExitHandler(opts));
}
