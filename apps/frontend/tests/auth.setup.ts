import fs from 'fs';
import { chromium } from '@playwright/test';

const BASE_URL = 'http://frontend:5173/';
const USER_EMAIL = 'ci@example.org';
const USER_PASSWORD = 'xyz123@@';

export default async function globalSetup() {
  fs.mkdirSync('playwright/.auth', { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(BASE_URL);

  await page.fill('#loginEmail', USER_EMAIL);
  await page.fill('#loginPassword', USER_PASSWORD);
  await page.click('button[type="submit"]');

  // Wait for login to complete
  await page.waitForURL(/dashboard/i);

  // Save authenticated state
  await page.context().storageState({ path: 'playwright/.auth/user.json' });
  await browser.close();
}