import { expect, test } from '@playwright/test';

test.setTimeout(480000);

test.describe('Chat E2E Flow', () => {
  test('should send a question and receive an AI answer', async ({ page }) => {

    console.log('Starting test...');
    await page.goto('/conversations/me');
    console.log('Visited conversations page');
    await page.getByTestId('conversations-sidebar__new-conversation-button').click();
    console.log('Started a new conversation.');

    const chatInput = page.locator('textarea[placeholder="Type a message…"]');
    await expect(chatInput).toBeVisible({ timeout: 10000 });

    console.log('Asking question...');
    await chatInput.fill('What is Meedan?');
    await page.keyboard.press('Enter');

    const messages = page.locator('[id^="message-"]');

    // Wait for at least 3 messages: user message, welcome, and final answer
    // Then wait for the final answer to have substantial content
    await expect.poll(async () => {
      const count = await messages.count();
      if (count < 3) return '';
      const text = await messages.first().innerText();
      return text.trim();
    }, {
      timeout: 240000,
      intervals: [5000],
      message: 'Waiting for AI response with substantial content',
    }).toMatch(/.{10,}/);

    const text = (await messages.first().innerText()).trim();
    console.log('AI response:', text);
    expect(text.length).toBeGreaterThan(10);
    expect(text.toLowerCase()).toContain('meedan');
  });
});
