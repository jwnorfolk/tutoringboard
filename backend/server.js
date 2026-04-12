#!/usr/bin/env node
const express = require('express');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const app = express();

const AdminPassword = process.env.ADMIN_PASSWORD;

const XLSX_PATH = path.join(__dirname, '..', 'FUTURE_USERS_LOOK_HERE', 'tutors.xlsx');
const PHOTO_DIR = path.join(__dirname, '..', 'frontend', 'photos');
const PASSWORD_FILE = path.join(__dirname, '..', 'FUTURE_USERS_LOOK_HERE', 'adminpassword.txt');

const upload = multer({ storage: multer.memoryStorage() });

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: PHOTO_DIR,
    filename: (req, file, cb) => {
      const safeName = path.basename(file.originalname);
      cb(null, safeName);
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpe?g|png)$/i;
    if (allowed.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, JPEG and PNG images are allowed.'));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));


// ---------------------------
// Tutor JSON Helpers
// ---------------------------
function loadTutors() {
  try {
    const workbook = XLSX.readFile(XLSX_PATH);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {header:1});
    const seenIds = new Set();
    const tutors = [];
    rows.slice(1).forEach(row => {
      const id = row[2] ? String(row[2]).trim() : '';
      if (!id || seenIds.has(id)) return;
      seenIds.add(id);
      const name = row[3] ? String(row[3]).trim() : '';
      const grade = row[4] ? String(row[4]).trim() : '';
      const subjects = row.slice(5, 12).filter(Boolean).map(s => String(s).trim());
      const available = row[12] === true || row[12] === 'true' || row[12] === '1';
      const photo = name ? `${name}.jpeg` : '';
      tutors.push({ name, id, photo, grade, subjects, available });
    });
    return tutors;
  } catch (err) {
    return [];
  }
}

function saveTutors(tutors) {
  try {
    const workbook = XLSX.readFile(XLSX_PATH);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const originalRows = XLSX.utils.sheet_to_json(sheet, {header:1});
    const header = originalRows[0];
    const newRows = [header];
    tutors.forEach((tutor, idx) => {
      const orig = originalRows[idx+1] || [];
      const row = [];
      row[0] = orig[0] || '';
      row[1] = orig[1] || '';
      row[2] = tutor.id || '';
      row[3] = tutor.name || '';
      row[4] = tutor.grade || '';
      for (let i = 0; i < 7; i++) {
        row[5+i] = tutor.subjects && tutor.subjects[i] ? tutor.subjects[i] : '';
      }
      row[12] = tutor.available ? 'true' : 'false';
      newRows.push(row);
    });
    const worksheet = XLSX.utils.aoa_to_sheet(newRows);
    const newWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWorkbook, worksheet, sheetName);
    XLSX.writeFile(newWorkbook, XLSX_PATH);
  } catch (err) {
    console.error('Error saving tutors to .xlsx:', err);
  }
}

// ---------------------------
// Dynamic Photo Route
// ---------------------------
app.get('/photos/:filename', (req, res) => {
  const requestedFile = req.params.filename;
  const baseName = path.basename(requestedFile, path.extname(requestedFile));
  const nameWords = baseName.split(/\s+/).filter(Boolean);
  const extensions = ['.jpg', '.jpeg', '.png'];
  const candidates = [];
  for (const ext of extensions) candidates.push(baseName + ext);
  for (const word of nameWords) {
    for (const ext of extensions) {
      candidates.push(`${word}${ext}`);
      candidates.push(`${word.toLowerCase()}${ext}`);
    }
  }
  for (const candidate of candidates) {
    const candidatePath = path.join(PHOTO_DIR, candidate);
    if (fs.existsSync(candidatePath)) return res.sendFile(candidatePath);
  }
  console.error(`[PhotoError] No photo found for ${baseName}`);
  res.status(404).send('Photo not found');
});

// ---------------------------
// In-memory last activity tracker
// ---------------------------
const lastSeen = {};

function scheduleMidnightLogout() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  const msUntilMidnight = nextMidnight - now;
  setTimeout(() => {
    const tutors = loadTutors();
    let updated = false;
    tutors.forEach(tutor => {
      if (tutor.available) { tutor.available = false; updated = true; }
    });
    if (updated) {
      saveTutors(tutors);
      console.log('[AutoLogout] All tutors logged out at midnight');
    }
    scheduleMidnightLogout();
  }, msUntilMidnight);
}
scheduleMidnightLogout();

// ---------------------------
// API Routes
// ---------------------------

app.get('/api/instructions', (req, res) => {
  const readmePath = path.join(__dirname, '..', 'FUTURE_USERS_LOOK_HERE', 'READ ME.txt');
  res.sendFile(readmePath);
});

app.get('/api/tutors', (req, res) => {
  const tutors = loadTutors();
  res.json(tutors);
});

app.post('/api/login', (req, res) => {
  const { id } = req.body;
  const tutors = loadTutors();
  const tutor = tutors.find(t => t.id === id);
  if (!tutor) return res.status(404).json({ message: 'Tutor not found' });
  tutor.available = true;
  saveTutors(tutors);
  lastSeen[id] = Date.now();
  res.json({ message: 'Logged in', tutor });
});

app.post('/api/logout', (req, res) => {
  const { id } = req.body;
  const tutors = loadTutors();
  const tutor = tutors.find(t => t.id === id);
  if (!tutor) return res.status(404).json({ message: 'Tutor not found' });
  tutor.available = false;
  saveTutors(tutors);
  delete lastSeen[id];
  res.json({ message: 'Logged out', tutor });
});

app.post('/api/heartbeat', (req, res) => {
  const { id } = req.body;
  if (id) lastSeen[id] = Date.now();
  res.json({ status: 'ok' });
});

app.post('/api/toggle-availability', (req, res) => {
  const { id } = req.body;
  const tutors = loadTutors();
  const tutor = tutors.find(t => t.id === id);
  if (!tutor) return res.status(404).json({ message: 'Tutor not found' });
  tutor.available = !tutor.available;
  saveTutors(tutors);
  res.json({ message: 'Availability toggled', tutor });
});

app.post('/api/delete-tutor', (req, res) => {
  const { id } = req.body;
  let tutors = loadTutors();
  const index = tutors.findIndex(t => t.id === id);
  if (index === -1) return res.status(404).json({ message: 'Tutor not found' });
  tutors.splice(index, 1);
  saveTutors(tutors);
  res.json({ message: 'Tutor deleted' });
});

app.post('/api/add-tutor', (req, res) => {
  const { name, id, grade, subjects } = req.body;
  if (!name || !id) return res.status(400).json({ message: 'Missing fields' });
  let tutors = loadTutors();
  if (tutors.some(t => t.id === id)) return res.status(409).json({ message: 'Tutor with this ID already exists' });
  tutors.push({ name, id, grade, subjects, available: false });
  saveTutors(tutors);
  res.json({ message: 'Tutor added' });
});

app.post('/api/edit-tutor', (req, res) => {
  const { id, name, grade, subjects, originalId } = req.body;
  let tutors = loadTutors();
  let index = tutors.findIndex(t => t.id === originalId);
  if (index === -1 && name) {
    index = tutors.findIndex(t => t.name.trim().toLowerCase() === name.trim().toLowerCase());
  }
  if (index === -1) return res.status(404).json({ message: 'Tutor not found' });
  if (id !== undefined && id !== tutors[index].id) {
    if (tutors.some(t => t.id === id)) return res.status(409).json({ message: 'Tutor with this ID already exists' });
    tutors[index].id = id;
  }
  if (name !== undefined) tutors[index].name = name;
  if (grade !== undefined) tutors[index].grade = grade;
  if (subjects !== undefined) tutors[index].subjects = subjects;
  saveTutors(tutors);
  res.json({ message: 'Tutor updated', tutor: tutors[index] });
});

app.post('/api/upload-tutors', upload.single('tutorFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
  if (!/\.xlsx$/i.test(req.file.originalname)) return res.status(400).json({ success: false, message: 'Only .xlsx files are accepted' });
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    if (!workbook.SheetNames.length) return res.status(400).json({ success: false, message: 'Uploaded workbook has no sheets' });
    fs.writeFileSync(XLSX_PATH, req.file.buffer);
    return res.json({ success: true, message: 'Tutor workbook uploaded successfully' });
  } catch (err) {
    console.error('Upload workbook error:', err);
    return res.status(400).json({ success: false, message: 'Invalid workbook or corrupted file' });
  }
});

app.post('/api/upload-photos', (req, res, next) => {
  try {
    if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR, { recursive: true });
    const existingFiles = fs.readdirSync(PHOTO_DIR);
    existingFiles.forEach(existing => {
      const ext = path.extname(existing).toLowerCase();
      if (['.jpg', '.jpeg', '.png'].includes(ext)) fs.unlinkSync(path.join(PHOTO_DIR, existing));
    });
    next();
  } catch (err) {
    console.error('Error clearing photo folder:', err);
    return res.status(500).json({ success: false, message: 'Could not clear photo folder' });
  }
}, photoUpload.array('photos'), (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ success: false, message: 'No photos uploaded' });
  const savedFiles = req.files.map(file => file.filename);
  res.json({ success: true, message: 'Photos uploaded successfully', files: savedFiles });
});

app.post('/api/admin-login', (req, res) => {
  const { password } = req.body;
  const realPassword = AdminPassword;
  if (!realPassword) return res.status(500).json({ success: false, message: 'Server misconfigured: password file missing' });
  if (password === realPassword) {
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// ---------------------------
// Schoology Photo Sync (SSE streaming)
// ---------------------------
app.post('/api/sync-schoology-photos', async (req, res) => {
  const { username, password, groupId, domain } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  const DOMAIN   = domain   || 'schoology.wintondrivedistrict.org';
  const GROUP_ID = groupId  || '312025711';
  const BASE_URL = `https://${DOMAIN}`;

  let browser;
  try {
    let chromium;
    try {
      chromium = require('playwright').chromium;
    } catch (e) {
      send('error', { message: 'Playwright is not installed. Run: npm install playwright && npx playwright install chromium' });
      res.end();
      return;
    }

    send('log', { message: '🚀 Starting browser...' });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
    });
    const page = await context.newPage();

    // ── Login ──
    send('log', { message: 'Logging into Schoology...' });
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });

    await page.evaluate(function(creds) {
      var mailEl = document.querySelector('input[name="mail"]');
      var passEl = document.querySelector('input[name="pass"]');
      if (mailEl) mailEl.value = creds.u;
      if (passEl) passEl.value = creds.p;
    }, { u: username, p: password });

    await page.evaluate(function() {
      var form = document.querySelector('form#s-user-login-form');
      if (form) form.submit();
    });

    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});

    const afterUrl1 = page.url();
    send('log', { message: '  After first submit: ' + afterUrl1 });

    if (afterUrl1.includes('/login')) {
      send('log', { message: '  School field step detected. Filling school...' });

      await page.evaluate(function() {
        var el = document.querySelector('input[name="school"]');
        if (el) {
          el.style.display = 'block';
          el.style.visibility = 'visible';
          el.removeAttribute('hidden');
          el.focus();
        }
      });

      await page.type('input[name="school"]', 'Winton Drive', { delay: 120 });
      await page.waitForTimeout(2500);

      const acClicked = await page.evaluate(function() {
        var items = document.querySelectorAll('#ac_results_1 li, .ac_results li, ul[id^="ac_results"] li');
        for (var i = 0; i < items.length; i++) {
          if (items[i].textContent.toLowerCase().indexOf('winton drive') !== -1) {
            items[i].click();
            return items[i].textContent.trim();
          }
        }
        if (items.length > 0) { items[0].click(); return 'FALLBACK: ' + items[0].textContent.trim(); }
        return null;
      });
      send('log', { message: '  Autocomplete result: ' + JSON.stringify(acClicked) });
      await page.waitForTimeout(1000);

      await page.evaluate(function(creds) {
        var mailEl = document.querySelector('input[name="mail"]');
        var passEl = document.querySelector('input[name="pass"]');
        if (mailEl) mailEl.value = creds.u;
        if (passEl) passEl.value = creds.p;
      }, { u: username, p: password });

      await page.evaluate(function() {
        var form = document.querySelector('form#s-user-login-form, form');
        if (form) form.submit();
      });

      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    }

    const afterLoginUrl = page.url();
    send('log', { message: 'Landed on: ' + afterLoginUrl });
    if (afterLoginUrl.includes('/login') || afterLoginUrl.includes('/access-denied')) {
      send('error', { message: '❌ Login failed. Check your Schoology username and password.' });
      await browser.close();
      res.end();
      return;
    }
    send('log', { message: '✅ Logged in successfully.' });

    // ── Collect ALL member profile links across all pages ──
    send('log', { message: '📋 Loading group members page...' });

    const allProfileUrls = [];
    const seenUrls = new Set();

    // ── Collect members by clicking Schoology's AJAX "Next" div ──
    // Schoology renders pagination as:
    //   <div class="next sEnrollmentEditprocessed" ajax="enrollments/edit/members/group/GROUP_ID/ajax?ss=&p=2">Next</div>
    // Clicking it replaces the member list in-place via AJAX — no page navigation occurs.

    const MEMBERS_URL = `${BASE_URL}/group/${GROUP_ID}/members`;
    send('log', { message: `  📄 Loading members page: ${MEMBERS_URL}` });
    await page.goto(MEMBERS_URL, { waitUntil: 'networkidle', timeout: 20000 });

    // Helper: harvest all /user/<id> links currently visible on the page
    const harvestLinks = async () => {
      const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href*="/user/"]'));
        const seen = new Set();
        const result = [];
        for (const a of anchors) {
          if (/\/user\/\d+/.test(a.href) && !seen.has(a.href)) {
            seen.add(a.href);
            result.push(a.href);
          }
        }
        return result;
      });
      let newCount = 0;
      for (const url of links) {
        const match = url.match(/(\/user\/\d+)/);
        if (!match) continue;
        const profileUrl = `${BASE_URL}${match[1]}/info`;
        if (!seenUrls.has(profileUrl)) {
          seenUrls.add(profileUrl);
          allProfileUrls.push(profileUrl);
          newCount++;
        }
      }
      return newCount;
    };

    // Scrape page 1
    let pageNum = 1;
    let newOnPage = await harvestLinks();
    send('log', { message: `  Page ${pageNum}: found ${newOnPage} member(s). Total: ${allProfileUrls.length}` });

    // Keep clicking "Next" as long as it exists
    while (true) {
      // The Next div Schoology uses — match on class "next" inside the enrollment pager
      const hasNext = await page.evaluate(() => {
        const el = document.querySelector('div.next[ajax], div[class*="next"][ajax]');
        return !!el;
      });

      if (!hasNext) {
        send('log', { message: `  No more "Next" button found — done collecting members.` });
        break;
      }

      // Grab a snapshot of the current first member link so we can detect when the DOM updates
      const anchorBefore = await page.evaluate(() => {
        const a = document.querySelector('a[href*="/user/"]');
        return a ? a.href : null;
      });

      // Click the Next div
      await page.evaluate(() => {
        const el = document.querySelector('div.next[ajax], div[class*="next"][ajax]');
        if (el) el.click();
      });

      // Wait for the member list to update (first member link changes, or up to 8 s)
      try {
        await page.waitForFunction(
          (before) => {
            const a = document.querySelector('a[href*="/user/"]');
            return a && a.href !== before;
          },
          anchorBefore,
          { timeout: 8000 }
        );
      } catch (_) {
        // Timeout — content may not have changed; harvest anyway then stop
        send('log', { message: `  ⚠️  DOM did not update after clicking Next — stopping.` });
        break;
      }

      pageNum++;
      newOnPage = await harvestLinks();
      send('log', { message: `  Page ${pageNum}: found ${newOnPage} new member(s). Total: ${allProfileUrls.length}` });

      if (newOnPage === 0) {
        send('log', { message: `  No new members on page ${pageNum} — stopping.` });
        break;
      }

      // Safety cap
      if (allProfileUrls.length >= 500) {
        send('log', { message: '  ⚠️  Reached 500-member safety cap. Stopping.' });
        break;
      }

      await page.waitForTimeout(500);
    }

    if (allProfileUrls.length === 0) {
      send('error', { message: '❌ No member profiles found on the group page.' });
      await browser.close();
      res.end();
      return;
    }

    send('log', { message: `👥 Found ${allProfileUrls.length} total member(s). Downloading photos...` });
    send('total', { count: allProfileUrls.length });

    if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR, { recursive: true });

    const saved = [], failed = [];

    for (let i = 0; i < allProfileUrls.length; i++) {
      const profileUrl = allProfileUrls[i];
      send('progress', { current: i + 1, total: allProfileUrls.length, url: profileUrl });

      try {
        await page.goto(profileUrl, { waitUntil: 'networkidle', timeout: 15000 });

        const fullName = await page.evaluate(() => {
          const selectors = ['h1.page-title', 'h2.profile-name', '.profile-header-name', '#profile-header-name', 'h1'];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent.trim()) return el.textContent.trim();
          }
          return null;
        });

        if (!fullName) {
          send('log', { message: `  ⚠️  [${i+1}/${allProfileUrls.length}] Could not read name — skipping.` });
          failed.push({ url: profileUrl, reason: 'Name not found' });
          continue;
        }

        const safeName   = fullName.replace(/[/\\:*?"<>|]/g, '').trim();
        const outputPath = path.join(PHOTO_DIR, `${safeName}.jpeg`);

        const photoUrl = await page.evaluate(() => {
          const selectors = [
            'img.profile-picture', 'img.user-photo', '.profile-picture img',
            '.profile-header img', 'img[src*="imagecache/profile"]', 'img[src*="pictures/picture-"]'
          ];
          for (const sel of selectors) {
            const img = document.querySelector(sel);
            if (img && img.src && !img.src.includes('default') && !img.src.includes('placeholder')) return img.src;
          }
          const allImgs = Array.from(document.querySelectorAll('img'));
          const pic = allImgs.find(img => img.src.includes('picture-'));
          return pic ? pic.src : null;
        });

        if (!photoUrl) {
          send('log', { message: `  ⚠️  [${i+1}/${allProfileUrls.length}] No photo for ${fullName}.` });
          failed.push({ url: profileUrl, reason: `No photo (${fullName})` });
          continue;
        }

        const response = await context.request.get(photoUrl);
        if (!response.ok()) {
          send('log', { message: `  ⚠️  [${i+1}/${allProfileUrls.length}] Photo request failed (${response.status()}) for ${fullName}.` });
          failed.push({ url: profileUrl, reason: `HTTP ${response.status()} (${fullName})` });
          continue;
        }

        const buffer = await response.body();
        fs.writeFileSync(outputPath, buffer);
        send('log', { message: `  ✅ [${i+1}/${allProfileUrls.length}] Saved: ${safeName}.jpeg` });
        saved.push(safeName);

      } catch (err) {
        send('log', { message: `  ❌ [${i+1}/${allProfileUrls.length}] Error: ${err.message}` });
        failed.push({ url: profileUrl, reason: err.message });
      }

      await page.waitForTimeout(600 + Math.random() * 400);
    }

    await browser.close();
    send('done', { saved: saved.length, failed: failed.length, failedList: failed });

  } catch (err) {
    console.error('Sync error:', err);
    send('error', { message: `Server error: ${err.message}` });
    if (browser) await browser.close().catch(() => {});
    res.end();
  }
});

// ---------------------------
// Global error handler
// ---------------------------
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  if (err instanceof multer.MulterError) return res.status(400).json({ success: false, message: err.message });
  if (err.message) return res.status(400).json({ success: false, message: err.message });
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ---------------------------
// Start Server
// ---------------------------
const port = 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});