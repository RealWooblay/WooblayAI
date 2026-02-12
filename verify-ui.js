/**
 * Wooblay UI Verification Script
 * 
 * This script navigates through the Wooblay platform and takes screenshots
 * of each page to verify functionality.
 * 
 * Usage:
 *   npm install -D playwright
 *   npx playwright install chromium
 *   node verify-ui.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://wooblay-alb-1564688078.us-east-1.elb.amazonaws.com';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function verifyWooblayUI() {
  console.log('🚀 Starting Wooblay UI verification...\n');
  
  const browser = await chromium.launch({ 
    headless: false, // Set to true for headless mode
    slowMo: 500 // Slow down actions for visibility
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  
  // Enable console logging from the page
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err));
  
  try {
    // Step 1: Navigate to home page
    console.log('📍 Step 1: Navigating to home page...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.screenshot({ 
      path: path.join(SCREENSHOT_DIR, '01-home.png'),
      fullPage: true 
    });
    console.log('✅ Home page loaded - screenshot saved as 01-home.png\n');
    
    // Check for any visible errors
    const errorElements = await page.locator('text=/error|Error|ERROR/i').count();
    if (errorElements > 0) {
      console.log('⚠️  Warning: Found error text on home page');
    }
    
    // Step 2: Navigate to Instances
    console.log('📍 Step 2: Navigating to Instances page...');
    
    // Try multiple selectors for the Instances link
    const instancesSelectors = [
      'a[href="/instances"]',
      'text=Instances',
      '[data-testid="instances-link"]',
      'nav a:has-text("Instances")'
    ];
    
    let instancesClicked = false;
    for (const selector of instancesSelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.count() > 0) {
          await element.click();
          instancesClicked = true;
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    if (!instancesClicked) {
      console.log('⚠️  Could not find Instances link, trying direct navigation...');
      await page.goto(`${BASE_URL}/instances`, { waitUntil: 'networkidle' });
    }
    
    await page.waitForTimeout(2000);
    await page.screenshot({ 
      path: path.join(SCREENSHOT_DIR, '02-instances.png'),
      fullPage: true 
    });
    console.log('✅ Instances page loaded - screenshot saved as 02-instances.png\n');
    
    // Step 3: Look for Deploy or New Instance button
    console.log('📍 Step 3: Looking for Deploy/New Instance button...');
    
    const buttonSelectors = [
      'button:has-text("Deploy")',
      'button:has-text("New Instance")',
      'button:has-text("Create")',
      '[data-testid="deploy-button"]',
      '[data-testid="new-instance-button"]'
    ];
    
    let buttonClicked = false;
    for (const selector of buttonSelectors) {
      try {
        const button = page.locator(selector).first();
        if (await button.count() > 0 && await button.isVisible()) {
          console.log(`Found button with selector: ${selector}`);
          await button.click();
          buttonClicked = true;
          await page.waitForTimeout(2000);
          await page.screenshot({ 
            path: path.join(SCREENSHOT_DIR, '03-deploy-modal.png'),
            fullPage: true 
          });
          console.log('✅ Deploy/New Instance button clicked - screenshot saved as 03-deploy-modal.png\n');
          
          // Close modal if it opened
          const closeSelectors = ['button:has-text("Cancel")', 'button:has-text("Close")', '[aria-label="Close"]'];
          for (const closeSelector of closeSelectors) {
            try {
              const closeBtn = page.locator(closeSelector).first();
              if (await closeBtn.count() > 0 && await closeBtn.isVisible()) {
                await closeBtn.click();
                await page.waitForTimeout(500);
                break;
              }
            } catch (e) {
              // Continue
            }
          }
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    if (!buttonClicked) {
      console.log('⚠️  No Deploy/New Instance button found on this page\n');
    }
    
    // Step 4: Navigate to Approvals
    console.log('📍 Step 4: Navigating to Approvals page...');
    
    const approvalsSelectors = [
      'a[href="/approvals"]',
      'text=Approvals',
      '[data-testid="approvals-link"]',
      'nav a:has-text("Approvals")'
    ];
    
    let approvalsClicked = false;
    for (const selector of approvalsSelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.count() > 0) {
          await element.click();
          approvalsClicked = true;
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    if (!approvalsClicked) {
      console.log('⚠️  Could not find Approvals link, trying direct navigation...');
      await page.goto(`${BASE_URL}/approvals`, { waitUntil: 'networkidle' });
    }
    
    await page.waitForTimeout(2000);
    await page.screenshot({ 
      path: path.join(SCREENSHOT_DIR, '04-approvals.png'),
      fullPage: true 
    });
    console.log('✅ Approvals page loaded - screenshot saved as 04-approvals.png\n');
    
    // Step 5: Navigate to Settings
    console.log('📍 Step 5: Navigating to Settings page...');
    
    const settingsSelectors = [
      'a[href="/settings"]',
      'text=Settings',
      '[data-testid="settings-link"]',
      'nav a:has-text("Settings")'
    ];
    
    let settingsClicked = false;
    for (const selector of settingsSelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.count() > 0) {
          await element.click();
          settingsClicked = true;
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    if (!settingsClicked) {
      console.log('⚠️  Could not find Settings link, trying direct navigation...');
      await page.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle' });
    }
    
    await page.waitForTimeout(2000);
    await page.screenshot({ 
      path: path.join(SCREENSHOT_DIR, '05-settings.png'),
      fullPage: true 
    });
    console.log('✅ Settings page loaded - screenshot saved as 05-settings.png\n');
    
    // Additional pages to check
    const additionalPages = [
      { name: 'Agents', path: '/agents' },
      { name: 'Policies', path: '/policies' },
      { name: 'GitHub', path: '/github' },
      { name: 'Receipts', path: '/receipts' }
    ];
    
    let pageNum = 6;
    for (const { name, path: pagePath } of additionalPages) {
      console.log(`📍 Bonus: Checking ${name} page...`);
      try {
        await page.goto(`${BASE_URL}${pagePath}`, { waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ 
          path: path.join(SCREENSHOT_DIR, `${String(pageNum).padStart(2, '0')}-${name.toLowerCase()}.png`),
          fullPage: true 
        });
        console.log(`✅ ${name} page loaded - screenshot saved\n`);
        pageNum++;
      } catch (e) {
        console.log(`⚠️  Could not load ${name} page: ${e.message}\n`);
      }
    }
    
    console.log('🎉 Verification complete! Check the screenshots folder for results.');
    
  } catch (error) {
    console.error('❌ Error during verification:', error);
    await page.screenshot({ 
      path: path.join(SCREENSHOT_DIR, 'error.png'),
      fullPage: true 
    });
  } finally {
    await browser.close();
  }
}

// Run the verification
verifyWooblayUI().catch(console.error);
