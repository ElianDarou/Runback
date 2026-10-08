// Tests read German UI text unless they switch the language themselves.
jest.mock('./src/ui/deviceLanguage', () => ({ deviceLanguage: () => 'de' }));
beforeEach(() => {
  require('./src/domain/i18n').setLanguage('de');
});
