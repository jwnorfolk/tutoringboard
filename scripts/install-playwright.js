const { execSync } = require('child_process');
const isRender = !!process.env.RENDER || !!process.env.RENDER_SERVICE_ID || !!process.env.RENDER_GIT_COMMIT || !!process.env.RENDER_EXTERNAL_HOSTNAME || !!process.env.RENDER_REGION;

if (isRender) {
  console.log('Render detected; skipping Playwright browser install.');
  process.exit(0);
}

console.log('Installing Playwright Chromium browser locally...');
execSync('npx playwright install chromium', { stdio: 'inherit' });
