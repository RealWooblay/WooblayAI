import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function testWooblayDetailed() {
  const screenshotsDir = path.join(process.cwd(), 'screenshots');
  
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  console.log('🌐 Navigating to https://app.wooblay.com...\n');
  
  try {
    await page.goto('https://app.wooblay.com', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    await page.waitForTimeout(2000);
    
    // === MAIN PAGE ANALYSIS ===
    console.log('=== MAIN PAGE ANALYSIS ===\n');
    
    const title = await page.title();
    const url = page.url();
    console.log(`📄 Page Title: ${title}`);
    console.log(`🔗 URL: ${url}\n`);
    
    // Check for Clerk sign-in
    const hasClerk = await page.locator('[data-clerk-id], .cl-component, [class*="clerk"]').count() > 0;
    console.log(`🔐 Clerk Authentication: ${hasClerk ? 'Yes' : 'No'}`);
    
    // Get all text content
    const bodyText = await page.locator('body').textContent();
    console.log('\n📝 Page Text Content:');
    console.log(bodyText?.trim().substring(0, 800));
    console.log('\n');
    
    // Check for specific UI elements
    const googleButton = await page.locator('text=/continue with google/i').count();
    const emailInput = await page.locator('input[type="email"], input[name="email"]').count();
    const passwordInput = await page.locator('input[type="password"]').count();
    
    console.log(`🔘 Google Sign-in Button: ${googleButton > 0 ? 'Found' : 'Not found'}`);
    console.log(`📧 Email Input: ${emailInput > 0 ? 'Found' : 'Not found'}`);
    console.log(`🔒 Password Input: ${passwordInput > 0 ? 'Found' : 'Not found'}\n`);
    
    // Take main page screenshot
    await page.screenshot({ 
      path: path.join(screenshotsDir, 'detailed-01-main.png'),
      fullPage: true 
    });
    console.log('✅ Screenshot: detailed-01-main.png\n');
    
    // === CHECK FOR WEATHER EFFECTS ===
    console.log('=== VISUAL EFFECTS CHECK ===\n');
    
    // Check for various weather/visual effect class names
    const effectClasses = [
      'weather', 'rain', 'snow', 'particle', 'effect',
      'scan', 'scanning', 'line', 'grid', 'cyber',
      'matrix', 'terminal', 'glitch', 'neon'
    ];
    
    for (const className of effectClasses) {
      const count = await page.locator(`[class*="${className}"]`).count();
      if (count > 0) {
        console.log(`✨ Found "${className}" effect: ${count} elements`);
      }
    }
    
    // Check canvas elements (often used for effects)
    const canvasCount = await page.locator('canvas').count();
    console.log(`🎨 Canvas elements: ${canvasCount}`);
    
    // Check for CSS animations
    const animatedElements = await page.locator('[class*="animate"], [class*="animation"]').count();
    console.log(`🎬 Animated elements: ${animatedElements}\n`);
    
    // === TRY TO ACCESS PROTECTED ROUTES ===
    console.log('=== TESTING PROTECTED ROUTES ===\n');
    
    const routes = [
      '/agents',
      '/instances', 
      '/approvals',
      '/policies',
      '/github',
      '/receipts'
    ];
    
    for (const route of routes) {
      try {
        console.log(`\n📍 Testing route: ${route}`);
        await page.goto(`https://app.wooblay.com${route}`, {
          waitUntil: 'networkidle',
          timeout: 10000
        });
        
        await page.waitForTimeout(1500);
        
        const currentUrl = page.url();
        const isRedirected = !currentUrl.includes(route);
        
        console.log(`   Current URL: ${currentUrl}`);
        console.log(`   Redirected: ${isRedirected ? 'Yes (auth required)' : 'No'}`);
        
        // Check for "Coming Soon" overlay
        const comingSoonText = await page.locator('text=/coming soon/i').count();
        if (comingSoonText > 0) {
          console.log(`   ⏳ Coming Soon overlay: Found`);
        }
        
        // Take screenshot
        const routeName = route.substring(1) || 'root';
        await page.screenshot({ 
          path: path.join(screenshotsDir, `detailed-route-${routeName}.png`),
          fullPage: true 
        });
        console.log(`   ✅ Screenshot: detailed-route-${routeName}.png`);
        
      } catch (error) {
        console.log(`   ❌ Error accessing ${route}: ${error.message}`);
      }
    }
    
    // === CHECK CONSOLE ERRORS ===
    console.log('\n\n=== CONSOLE MESSAGES ===\n');
    
    const messages: string[] = [];
    page.on('console', msg => {
      messages.push(`[${msg.type()}] ${msg.text()}`);
    });
    
    // Reload to capture console messages
    await page.goto('https://app.wooblay.com', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    if (messages.length > 0) {
      messages.forEach(msg => console.log(msg));
    } else {
      console.log('No console messages captured');
    }
    
  } catch (error) {
    console.error('\n❌ Error during testing:', error);
    await page.screenshot({ 
      path: path.join(screenshotsDir, 'detailed-error.png'),
      fullPage: true 
    });
  } finally {
    await browser.close();
    console.log('\n\n✨ Testing complete! Check ./screenshots/ for all images.\n');
  }
}

testWooblayDetailed().catch(console.error);
