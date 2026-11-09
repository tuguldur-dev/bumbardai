import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`Scout adds a session and opens the calendar editor at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/');
    await page.getByLabel('Email').fill(randomUUID() + '@example.test');
    await page.getByLabel('Password').fill('hallway-browser-test');
    await page.getByText('Use the guided demo with sample data').click();
    await page.getByRole('button', { name: 'Start my adventure' }).click();
    await page.getByLabel('Nickname').fill('Scout tester');
    await page.getByRole('button', { name: 'Go', exact: true }).click();
    await page.getByLabel('Conference goals').fill('Learn about Go tools');
    await page.getByRole('button', { name: 'Go to Today' }).click();

    await page.getByRole('button', { name: 'Chat with Scout' }).click();
    const chat = page.getByRole('dialog', { name: 'Chat with Scout' });
    await chat.getByLabel('Message Scout').fill('Schedule a Go session before 1 pm');
    await chat.getByRole('button', { name: 'Send' }).click();
    await expect(
      chat.getByText('Go tools for cloud native beginners', { exact: true }),
    ).toBeVisible();
    await chat.getByRole('link', { name: 'Edit activity' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit activity' });
    await expect(editor.getByLabel('Title')).toHaveValue('Go tools for cloud native beginners');
    await editor.getByLabel('Title').fill('My Go session');
    await editor.getByRole('button', { name: 'Save activity' }).click();
    await expect(editor).toBeHidden();
    await expect(page.getByRole('button', { name: /My Go session/ })).toBeVisible();
  });
}
