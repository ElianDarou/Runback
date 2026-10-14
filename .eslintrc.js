module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    { files: ['jest.setup.js'], env: { jest: true } },
    {
      files: ['scripts/*.cjs'],
      env: { node: true, es2022: true },
      parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
    },
  ],
};
