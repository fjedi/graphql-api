import { Context } from 'graphql-ws';
import { ReadStream } from 'fs-capacitor';
import type { DefaultState } from '@fjedi/rest-api';
import type { Extra } from 'graphql-ws/lib/use/ws';

type CustomContextFields<TContextState = DefaultState> = {
  authToken?: string;
  Authorization?: string;
  extra?: TContextState;
};

declare global {
  interface GraphQLContext<TContextState = DefaultState> {
    state: TContextState;
  }

  interface GraphQLWSContext<TContextState = DefaultState>
    extends Context<CustomContextFields<TContextState>> {
    extra: Extra & TContextState;
    authToken?: string;
    Authorization?: string;
  }

  interface FileUpload {
    filename: string;
    mimetype: string;
    encoding: string;
    createReadStream(): ReadStream;
  }
}
