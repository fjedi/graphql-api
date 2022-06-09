/* eslint-disable import/prefer-default-export */
import { createStringScalar, createIntScalar, createFloatScalar } from 'graphql-scalar';

// const stringScalar = createStringScalar({
//   name: string;
//   description?: string;
//   capitalize?: 'characters' | 'words' | 'sentences' | 'first';
//   collapseWhitespace?: boolean;
//   lowercase?: boolean;
//   maxLength?: number;
//   minLength?: number;
//   nonEmpty?: boolean;
//   pattern?: RegExp | string;
//   singleline?: string;
//   trim?: boolean;
//   trimLeft?: boolean;
//   trimRight?: boolean;
//   truncate?: number;
//   uppercase?: boolean;
//   coerce?: ScalarCoerceFunction<TValue>;
//   errorHandler?: ScalarParseErrorHandler<TInternal, TConfig, TErrorCode>;
//   parse?: ScalarParseFunction<TValue, TInternal>;
//   sanitize?: ScalarSanitizeFunction<TValue>;
//   serialize?: ScalarSerializeFunction<TInternal, TExternal>;
//   validate?: ScalarValidateFunction<TValue>;
// })

// const intScalar = createIntScalar({
//   name: string;
//   description?: string;
//   maximum?: number;
//   minimum?: number;
//   coerce?: ScalarCoerceFunction<TValue>;
//   errorHandler?: ScalarParseErrorHandler<TInternal, TConfig, TErrorCode>;
//   parse?: ScalarParseFunction<TValue, TInternal>;
//   sanitize?: ScalarSanitizeFunction<TValue>;
//   serialize?: ScalarSerializeFunction<TInternal, TExternal>;
//   validate?: ScalarValidateFunction<TValue>;
// })

export const SanitizedString = createStringScalar({
  // @ts-ignore
  name: 'SanitizedString',
});
