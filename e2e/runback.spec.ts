import { test, expect } from '@appetize/playwright';

const text = (value: string) => ({ attributes: { text: value } });

test.beforeEach(async ({ session }) => {
  await expect(session).toHaveElement(text('Welcome to Runback'));
  await session.tap({ element: text('Later') });
  await expect(session).toHaveElement(text('Start run'));
});

test.afterEach(async ({ session }) => {
  await session.reinstallApp();
});

test('opens empty training history and returns to Today', async ({ session }) => {
  await session.tap({ element: text('History') });
  await expect(session).toHaveElement(text('Your history starts here'));
  await expect(session).not.toHaveElement(text('Start run'), { timeout: 1000 });
  await session.tap({ element: text('Today') });
  await expect(session).toHaveElement(text('Start run'));
});

test('recording deep link opens Runback without starting an unauthorized recording', async ({ session }) => {
  // Watch recording commands require a permit; a URL alone must not create data.
  await session.openUrl(
    'runback://recording?action=com.runback.recording.START&runId=e2e-untrusted',
  );
  await expect(session).toHaveElement(text('Start run'));
  await expect(session).not.toHaveElement(text('Run in progress'), { timeout: 3000 });
  await session.tap({ element: text('History') });
  await expect(session).toHaveElement(text('Your history starts here'));
});

test('strength deep link opens Runback without creating a strength session', async ({ session }) => {
  // This link brings the phone to the foreground; it carries no commands.
  await session.openUrl('runback://strength');
  await expect(session).toHaveElement(text('Start strength training'));
  await session.tap({ element: text('History') });
  await expect(session).toHaveElement(text('Your history starts here'));
});
