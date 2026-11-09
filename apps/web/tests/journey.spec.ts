import { randomUUID } from 'node:crypto';
import { devices, expect, test } from '@playwright/test';

test('phone onboarding to XP, offline schedule, and the same account on desktop', async ({
  browser,
  baseURL,
}) => {
  const phone = await browser.newContext({
    ...devices['iPhone 13'],
    defaultBrowserType: 'chromium',
    baseURL,
  });
  const page = await phone.newPage();
  const email = 'browser-' + randomUUID() + '@example.test';
  const password = 'hallway-browser-test';
  try {
    await page.goto('/');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByText('Use the guided demo with sample data').click();
    await page.getByRole('button', { name: 'Start my adventure' }).click();
    await page.getByLabel('Nickname').fill('Avery');
    await page.getByLabel('Professional background').fill('Platform engineer');
    await page.getByRole('button', { name: 'Kubernetes', exact: true }).click();
    await page.getByRole('button', { name: 'Go', exact: true }).click();
    await page
      .getByLabel('Conference goals')
      .fill('Learn Kubernetes and practice one introduction.');
    await page.getByRole('button', { name: 'Go to Today' }).click();
    await expect(page.getByRole('heading', { name: 'Hello, Avery.' })).toBeVisible();
    await expect(page.getByText('Pack a warm layer.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    const mobile = page.getByRole('navigation', { name: 'Primary mobile' });
    await mobile.getByRole('link', { name: 'Schedule' }).click();
    await page.getByRole('button', { name: 'Add activity' }).click();
    const editor = page.getByRole('dialog', { name: 'Add activity' });
    await editor.getByLabel('Title').fill('My hackathon');
    await editor.getByLabel('Category').selectOption('hackathon');
    await editor.getByLabel('Location').fill('The Shop Workspace');
    await editor.getByLabel('Starts').fill('2026-11-10T11:15');
    await editor.getByLabel('Ends').fill('2026-11-10T12:30');
    await editor.getByRole('button', { name: 'Save activity' }).click();
    await expect(page.getByRole('button', { name: /My hackathon/ })).toBeVisible();
    await mobile.getByRole('link', { name: 'Today' }).click();
    await expect(page.getByText('Pack your laptop')).toBeVisible();
    await expect(page.getByText('Pack your charger')).toBeVisible();
    await page.getByRole('button', { name: 'What should I do next?' }).click();
    const assistant = page.getByRole('dialog', { name: 'Chat with Scout' });
    await expect(assistant.getByText('Make the first hello', { exact: false })).toBeVisible();
    await assistant.getByRole('link', { name: 'Explore this' }).click();
    await page.getByRole('button', { name: 'Start quest' }).click();
    await page.getByRole('button', { name: 'New icebreaker' }).click();
    await expect(page.getByText(/What are you excited to learn/)).toBeVisible();
    await page.getByRole('button', { name: 'Complete quest' }).click();
    const reward = page.getByRole('dialog', { name: 'Quest completed' });
    await expect(reward.getByText('+50 XP', { exact: true })).toBeVisible();
    await expect(reward.getByText('First Hello')).toBeVisible();
    await reward.getByRole('button', { name: 'Keep exploring' }).click();
    await expect(page.getByRole('heading', { name: 'Quest tree' })).toBeVisible();
    await page.getByRole('button', { name: 'Available First Hello' }).click();
    await page.getByRole('button', { name: 'Start tree quest' }).click();
    await page
      .getByRole('dialog', { name: 'First Hello' })
      .getByRole('button', { name: 'Skip' })
      .click();
    await expect(page.getByRole('button', { name: 'Start tree quest' })).toBeVisible();
    await page.keyboard.press('Escape');
    await mobile.getByRole('link', { name: 'Explore' }).click();
    await page.getByPlaceholder('Try “beginner-friendly Kubernetes talks”').fill('beginner Go');
    await expect(
      page.getByRole('heading', { name: 'Go tools for cloud native beginners' }),
    ).toBeVisible();
    if (process.env.EXPECT_HYBRID === '1')
      await expect(page.getByText('Hybrid semantic search · Demo')).toBeVisible();

    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await phone.setOffline(true);
    await page.reload();
    await expect(page.getByText('Offline mode')).toBeVisible();
    await expect(page.getByText('My hackathon')).toBeVisible();
    await phone.setOffline(false);

    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
    try {
      const tab = await desktop.newPage();
      await tab.goto('/');
      await tab.getByRole('button', { name: 'Already have an account? Sign in' }).click();
      await tab.getByLabel('Email').fill(email);
      await tab.getByLabel('Password').fill(password);
      await tab.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(tab.getByRole('heading', { name: 'Hello, Avery.' })).toBeVisible();
      await expect(tab.getByText('50 XP', { exact: true })).toBeVisible();
      await tab
        .getByRole('navigation', { name: 'Primary', exact: true })
        .getByRole('link', { name: 'Profile' })
        .click();
      await expect(tab.getByText('First Hello', { exact: true })).toBeVisible();
      await tab.getByRole('button', { name: 'Use dark mode' }).click();
      await expect(tab.locator('html')).toHaveAttribute('data-theme', 'dark');
      await tab.getByRole('button', { name: 'Sign out' }).click();
      await expect(tab.getByRole('heading', { name: 'Create your account' })).toBeVisible();
      expect(await tab.evaluate(() => localStorage.getItem('hallway-offline'))).toBeNull();
    } finally {
      await desktop.close();
    }
  } finally {
    await phone.close();
  }
});
