module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  modulePathIgnorePatterns: ['<rootDir>/.scaffold/', '<rootDir>/server/'],
  // Gemeinsame Testdaten, keine Tests.
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/__tests__/fixtures/',
    // Der eigene Server testet sich selbst (`server/`, node:test).
    '<rootDir>/server/',
  ],
};
