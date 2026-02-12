import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function testWooblayApp() {
  const screenshotsDir = path.join(process.cwd(), 'screenshots');
  
  // Create screenshots directory if it doesn't exist
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  console.log('🌐 Navigating to https://app.wooblay.com...');
  
  try {
    // Navigate to the main page
    await page.goto('https://app.wooblay.com', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Wait a bit for any animations or dynamic content
    await page.waitForTimeout(2000);
    
    // Take screenshot of main page
    await page.screenshot({ 
      path: path.join(screenshotsDir, '01-main-page.png'),
      fullPage: true 
    });
    console.log('✅ Screenshot saved: 01-main-page.png');
    
    // Get page title and URL
    const title = await page.title();
    const url = page.url();
    console.log(`📄 Page Title: ${title}`);
    console.log(`🔗 Current URL: ${url}`);
    
    // Check for sign-in page
    const signInText = await page.locator('text=/sign.?in/i').count();
    if (signInText > 0) {
      console.log('🔐 Sign-in page detected');
    }
    
    // Check for weather effects
    const hasWeatherEffect = await page.locator('[class*="weather"], [class*="rain"], [class*="snow"]').count();
    console.log(`🌦️  Weather effects found: ${hasWeatherEffect > 0 ? 'Yes' : 'No'}`);
    
    // Check for scanning line
    const hasScanningLine = await page.locator('[class*="scan"], [class*="line"]').count();
    console.log(`📡 Scanning line found: ${hasScanningLine > 0 ? 'Yes' : 'No'}`);
    
    // Look for agent/instance cards
    const cardSelectors = [
      '[class*="card"]',
      '[class*="agent"]',
      '[class*="instance"]',
      'article',
      '[role="article"]'
    ];
    
    let foundCards = false;
    for (const selector of cardSelectors) {
      const cards = await page.locator(selector).count();
      if (cards > 0) {
        console.log(`🎴 Found ${cards} elements matching "${selector}"`);
        foundCards = true;
        
        // Try to click the first card
        try {
          const firstCard = page.locator(selector).first();
          const isVisible = await firstCard.isVisible();
          
          if (isVisible) {
            console.log(`🖱️  Attempting to click first card...`);
            await firstCard.click();
            await page.waitForTimeout(2000);
            
            // Take screenshot after click
            await page.screenshot({ 
              path: path.join(screenshotsDir, '02-after-card-click.png'),
              fullPage: true 
            });
            console.log('✅ Screenshot saved: 02-after-card-click.png');
            
            const newUrl = page.url();
            console.log(`🔗 New URL after click: ${newUrl}`);
            
            // Check for detail page content
            const detailContent = await page.content();
            if (detailContent.includes('detail') || detailContent.includes('Detail')) {
              console.log('📋 Detail page detected');
            }
          }
        } catch (clickError) {
          console.log(`⚠️  Could not click card: ${clickError.message}`);
        }
        
        break;
      }
    }
    
    if (!foundCards) {
      console.log('❌ No cards found on the page');
    }
    
    // Check for error messages
    const errorSelectors = [
      'text=/error/i',
      '[class*="error"]',
      '[role="alert"]',
      'text=/failed/i'
    ];
    
    for (const selector of errorSelectors) {
      const errors = await page.locator(selector).count();
      if (errors > 0) {
        const errorText = await page.locator(selector).first().textContent();
        console.log(`❌ Error found: ${errorText}`);
      }
    }
    
    // Get all visible text on the page
    const bodyText = await page.locator('body').textContent();
    console.log('\n📝 Page Content Preview:');
    console.log(bodyText?.substring(0, 500) + '...');
    
    // Check if page is blank
    const visibleElements = await page.locator('body *:visible').count();
    console.log(`\n👁️  Visible elements on page: ${visibleElements}`);
    
    if (visibleElements < 5) {
      console.log('⚠️  Page appears to be mostly blank');
    }
    
  } catch (error) {
    console.error('❌ Error during testing:', error);
    
    // Take screenshot of error state
    await page.screenshot({ 
      path: path.join(screenshotsDir, 'error-state.png'),
      fullPage: true 
    });
    console.log('✅ Error screenshot saved: error-state.png');
  } finally {
    await browser.close();
    console.log('\n✨ Testing complete! Screenshots saved in ./screenshots/');
  }
}

testWooblayApp().catch(console.error);
