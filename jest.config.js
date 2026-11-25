export default {
  testEnvironment: 'jsdom',
  testMatch: ['**/tests/**/*.test.js', '**/tests/**/*.test.ts'],
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.js',
    'src/**/*.ts',
    '!src/**/*.test.js',
    '!src/**/*.test.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  transform: {
    '^.+\\.(js|ts)$': 'babel-jest',
  },
  transformIgnorePatterns: ['node_modules/(?!(eventemitter3)/)'],
};
