module.exports = {
  transform: { '^.+\\.ts?$': 'ts-jest' },
  testEnvironment: 'node',
  testRegex: '/test/.*\\.(test|spec)?\\.(ts|tsx)$',
  moduleDirectories: ['node_modules'],
  moduleNameMapper: {
    'module_name_(.*)': '<rootDir>/substituted_module_$1.js',
    '^graphql-upload/(.*)': [
      '<rootDir>/node_modules/graphql-upload/$1',
      '<rootDir>/node_modules/graphql-upload/$1',
      '<rootDir>/node_modules/graphql-upload/$1',
    ],
  },
};
