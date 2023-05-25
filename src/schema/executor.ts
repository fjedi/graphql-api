import { GraphQLExecutor } from 'apollo-server-core';
import { GraphQLSchema } from 'graphql';
import { CompiledQuery, compileQuery, CompilerOptions, isCompiledQuery } from 'graphql-jit';

export default async function graphQLSchemaExecutor(
  schema: GraphQLSchema,
  cacheSize = 1024,
  compilerOpts: Partial<CompilerOptions> = {},
): Promise<GraphQLExecutor> {
  const { lru } = await import('tiny-lru');
  const cache = lru<CompiledQuery>(cacheSize);
  return async ({ context, document, operationName, request, queryHash }) => {
    const prefix = operationName || 'NotParametrized';
    const cacheKey = `${prefix}-${queryHash}`;
    let compiledQuery = cache.get(cacheKey);
    if (!compiledQuery) {
      const compilationResult = compileQuery(
        schema,
        document,
        operationName || undefined,
        compilerOpts,
      );
      if (isCompiledQuery(compilationResult)) {
        compiledQuery = compilationResult;
        cache.set(cacheKey, compiledQuery);
      } else {
        // ...is ExecutionResult
        return compilationResult;
      }
    }
    return compiledQuery.query(undefined, context, request.variables || {});
  };
}
