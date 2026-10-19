module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  modulePathIgnorePatterns: ['<rootDir>/.scaffold/', '<rootDir>/server/'],
  // Shared test data, not tests.
  testPathIgnorePatterns: [
    '<rootDir>/e2e/',
    '/node_modules/',
    '<rootDir>/__tests__/fixtures/',
    // The own server tests itself (`server/`, node:test).
    '<rootDir>/server/',
  ],
};
