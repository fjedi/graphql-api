/* eslint-disable import/prefer-default-export, no-console */
// Display a border around a message
import boxen from 'boxen';
// Chalk library, to add colour to our console logs
import chalk, { Chalk } from 'chalk';
// IP library, for determining the local network interface
import ip from 'ip';

import { getServerURL } from './env';

// ----------------------
export type ServerStartLogger = {
  host?: string;
  port?: number | string;
  allowSSL?: boolean;
  chalk?: Chalk;
  bold?: Chalk;
  type: string;
};

export function logServerStarted(opt: ServerStartLogger): void {
  const { type, host, port, allowSSL } = opt;
  let message = chalk.green(
    `Running ${(opt.chalk || chalk.bold)(type)} in ${chalk.bold(process.env.NODE_ENV)} mode\n\n`,
  );
  message += `- ${chalk.bold('Local:           ')} ${getServerURL(host, `${port}`, allowSSL)}`;

  try {
    const url = getServerURL(ip.address(), `${port}`, allowSSL);
    message += `\n- ${chalk.bold('On Your Network: ')} ${url}`;
  } catch (err) {
    /* ignore errors */
  }

  console.log(
    boxen(message, {
      padding: 1,
      borderColor: 'green',
      margin: 1,
    }),
  );
}
