module.exports = {
  preset: 'react-native',
  modulePathIgnorePatterns: ['<rootDir>/.scaffold/'],
  // Gemeinsame Testdaten, keine Tests.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/__tests__/fixtures/'],
};
