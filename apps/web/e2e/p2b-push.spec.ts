import { test, expect, type Page } from '@playwright/test';
import { admin, PHONES, login } from './helpers';

// Test plan P2b: NOT-03 (turn push on) and NOT-04 (permission blocked). Delivery needs a real push service and is out of scope:
// headless Chromium reports notifications as blocked and cannot reach Google's push service, so the browser side is stubbed
// (permission, PushManager) and everything on our side is real: the card, the push_subscription row and its removal.
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'browser API behaviour, one project is enough'); });
const ownerId = async () => (await admin.from('app_user').select('id').eq('phone', '+91 98490 12345').single()).data!.id;
test.afterEach(async () => { await admin.from('push_subscription').delete().eq('user_id', await ownerId()); });

async function browser(page: Page, o: { permission: 'default' | 'denied'; answer: 'granted' | 'denied' }) {
  await page.addInitScript((o) => {
    let live: object | null = null;
    Object.defineProperty(Notification, 'permission', { get: () => o.permission });
    Notification.requestPermission = async () => o.answer;
    PushManager.prototype.getSubscription = async () => live as PushSubscription | null;
    PushManager.prototype.subscribe = async () => {
      const endpoint = 'https://fcm.googleapis.com/fcm/send/e2e-' + Date.now();
      live = {
        toJSON: () => ({ endpoint, keys: { p256dh: 'BE2E-p256dh', auth: 'e2e-auth' } }),
        unsubscribe: async () => { live = null; return true; }, endpoint,
      };
      return live as unknown as PushSubscription;
    };
  }, o);
}
const stored = async () => (await admin.from('push_subscription').select('id').eq('user_id', await ownerId())).data!.length;

test('NOT-04: with notifications blocked the card explains it and nothing is stored', async ({ page }) => {
  await login(page, PHONES.owner);
  await browser(page, { permission: 'denied', answer: 'denied' });
  await page.goto('/more/notifications');
  await expect(page.getByText('Notifications are blocked for this site')).toBeVisible();
  await expect(page.getByRole('button', { name: /Turn on/ })).toHaveCount(0);
  expect(await stored()).toBe(0);
});

test('NOT-04: refusing the browser prompt explains it and stores nothing', async ({ page }) => {
  await login(page, PHONES.owner);
  await browser(page, { permission: 'default', answer: 'denied' });
  await page.goto('/more/notifications');
  await page.getByRole('button', { name: /Turn on/ }).click();
  await expect(page.getByText('Notifications are blocked for this site')).toBeVisible();
  expect(await stored()).toBe(0);
});

test('NOT-03: turning alerts on stores this browser, turning them off removes it', async ({ page }) => {
  await login(page, PHONES.owner);
  await browser(page, { permission: 'default', answer: 'granted' });
  await page.goto('/more/notifications');
  await page.getByRole('button', { name: /Turn on/ }).click();
  await expect(page.getByText('Alerts are on for this phone.')).toBeVisible();
  await expect(page.locator('.toast').last()).toContainText('Alerts turned on');
  await expect.poll(stored).toBe(1);
  await page.getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByRole('button', { name: /Turn on/ })).toBeVisible();
  await expect.poll(stored).toBe(0);
});
