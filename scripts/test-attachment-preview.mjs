#!/usr/bin/env node
/**
 * Smoke test: attachment dock shows image preview inside the send box.
 * Requires: server running (npm start), Playwright chromium installed.
 *
 *   npx playwright install chromium
 *   npm run test:attachment-preview
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BASE_URL = process.env.AETHER_TEST_URL || 'http://127.0.0.1:8787';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PNG = path.join(__dirname, '.test-attachment.png');

async function main() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('Playwright is required. Run: npx playwright install chromium');
    process.exit(1);
  }

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAD0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  fs.writeFileSync(TEST_PNG, png);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => {
      throw err;
    });

    const response = await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    if (!response?.ok()) {
      throw new Error(`Failed to load ${BASE_URL} — is the server running?`);
    }

    await page.locator('#composerAttachBtn').waitFor({ state: 'visible', timeout: 10000 });

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('#composerAttachBtn'),
    ]);
    await fileChooser.setFiles(TEST_PNG);

    const dock = page.locator('#composerAttachmentDock');
    await dock.waitFor({ state: 'visible', timeout: 5000 });

    const result = await page.evaluate(() => {
      const dockEl = document.getElementById('composerAttachmentDock');
      const img = document.querySelector('.composer-attachment-preview-image');
      return {
        dockHidden: dockEl?.hidden ?? true,
        gridChildren: document.getElementById('composerAttachments')?.childElementCount ?? 0,
        count: document.getElementById('composerAttachmentCount')?.textContent?.trim() ?? '',
        imgNaturalWidth: img?.naturalWidth ?? 0,
        imgSrcPrefix: img?.src?.slice(0, 24) ?? '',
      };
    });

    if (result.dockHidden) throw new Error('composerAttachmentDock is still hidden after attach');
    if (result.gridChildren < 1) throw new Error('composerAttachments grid has no children');
    if (result.count !== '1') throw new Error(`Expected attachment count 1, got "${result.count}"`);
    if (result.imgNaturalWidth < 1) throw new Error('Preview image did not load');
    if (!result.imgSrcPrefix.startsWith('data:image/')) {
      throw new Error(`Unexpected image src: ${result.imgSrcPrefix}`);
    }

    console.log('OK attachment preview visible in send box');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
    try {
      fs.unlinkSync(TEST_PNG);
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error('FAIL', err.message || err);
  process.exit(1);
});
