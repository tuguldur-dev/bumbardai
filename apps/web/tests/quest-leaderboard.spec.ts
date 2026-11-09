import { randomUUID } from 'node:crypto';
import { devices, expect, test } from '@playwright/test';

for (const device of ['mobile', 'desktop'] as const) {
  test.describe(device, () => {
    test.use(
      device === 'mobile'
        ? {
            viewport: devices['iPhone 13'].viewport,
            deviceScaleFactor: devices['iPhone 13'].deviceScaleFactor,
            isMobile: true,
            hasTouch: true,
          }
        : {
            viewport: { width: 1440, height: 900 },
          },
    );

    test('quest XP appears after completion and disappears after opt-out', async ({ page }) => {
      const nickname = 'Quest player ' + randomUUID().slice(0, 8);
      await page.goto('/');
      await page.getByLabel('Email').fill(randomUUID() + '@example.test');
      await page.getByLabel('Password').fill('hallway-browser-test');
      await page.getByText('Use the guided demo with sample data').click();
      await page.getByRole('button', { name: 'Start my adventure' }).click();
      await page.getByLabel('Nickname').fill(nickname);
      await page.getByRole('button', { name: 'Kubernetes', exact: true }).click();
      await page.getByLabel('Conference goals').fill('Meet a Kubernetes maintainer.');
      const visibility = page.getByRole('checkbox', { name: /Show me on the quest leaderboard/ });
      await expect(visibility).not.toBeChecked();
      await visibility.check();
      await page.getByRole('button', { name: 'Go to Today' }).click();

      const navigation = page.getByRole('navigation', {
        name: device === 'mobile' ? 'Primary mobile' : 'Primary',
        exact: true,
      });
      await navigation.getByRole('link', { name: 'Quests' }).click();
      const leaderboard = page.getByRole('region', { name: 'Quest leaderboard' });
      const ownRow = leaderboard.getByRole('row', { name: new RegExp(nickname) });
      await expect(ownRow).toHaveCount(0);
      await page.getByRole('button', { name: 'Generate a quest' }).click();
      await page.getByRole('button', { name: 'Start quest' }).click();
      await page.getByRole('button', { name: 'Complete quest' }).click();
      await page.getByRole('button', { name: 'Keep exploring' }).click();
      await expect(ownRow).toContainText('50 XP');
      await expect(ownRow).toContainText('(you)');

      await navigation.getByRole('link', { name: 'Profile' }).click();
      await expect(visibility).toBeChecked();
      await visibility.uncheck();
      await page.getByRole('button', { name: 'Save preferences' }).click();
      await expect(page.getByText('Saved', { exact: true })).toBeVisible();
      await navigation.getByRole('link', { name: 'Quests' }).click();
      await expect(
        leaderboard.getByText('No ranked attendees yet').or(leaderboard.getByRole('table')),
      ).toBeVisible();
      await expect(ownRow).toHaveCount(0);
    });
  });
}
