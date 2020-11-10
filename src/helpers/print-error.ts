import PrettyError from 'pretty-error';

const pe = new PrettyError();

export const printToConsole = (error: Error): void => {
  // eslint-disable-next-line no-console
  console.log(pe.render(error));
};

export default pe;
