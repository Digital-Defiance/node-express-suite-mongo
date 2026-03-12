const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('../../tsconfig.base.json');

// Suppress TypeScript ESLint deprecation warnings
const originalWarn = process.emitWarning;
process.emitWarning = function(warning, type, code) {
  if (
    typeof warning === 'string' &&
    warning.includes('The \'argument\' property is deprecated on TSImportType nodes')
  ) {
    return;
  }
  originalWarn.call(process, warning, type, code);
};

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.spec.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  moduleFileExtensions: ['js', 'ts'],
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!([^/]*/)*((@faker-js|@scure|@noble|@ethereumjs|uuid)))',
    'node_modules/@digitaldefiance/mongoose-types',
  ],

  moduleNameMapper: {
    '^@digitaldefiance/mongoose-types$':
      '<rootDir>/../../packages/digitaldefiance-mongoose-types/src/index.js',
    ...pathsToModuleNameMapper(compilerOptions.paths, {
      prefix: '<rootDir>/../../',
    }),
  },
};
