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

// Serve frontend static files
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
    // rows[0] is header, rows[1...] are data
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
      tutors.push({
        name,
        id,
        photo,
        grade,
        subjects,
        available
      });
    });
    return tutors;
  } catch (err) {
    return [];
  }
}

function saveTutors(tutors) {
  try {
    // Read the original sheet to preserve timestamp/email columns
    const workbook = XLSX.readFile(XLSX_PATH);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const originalRows = XLSX.utils.sheet_to_json(sheet, {header:1});
    const header = originalRows[0];
    // Build new rows, preserving columns A and B
    const newRows = [header];
    tutors.forEach((tutor, idx) => {
      // Try to preserve timestamp/email if present in original
      const orig = originalRows[idx+1] || [];
      const row = [];
      row[0] = orig[0] || '';
      row[1] = orig[1] || '';
      row[2] = tutor.id || '';
      row[3] = tutor.name || '';
      row[4] = tutor.grade || '';
      // Subjects: F-L (columns 5-11)
      for (let i = 0; i < 7; i++) {
        row[5+i] = tutor.subjects && tutor.subjects[i] ? tutor.subjects[i] : '';
      }
      // Availability: M (column 12)
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
// Dynamic Photo Route with Redundancy (unchanged)
// ---------------------------
app.get('/photos/:filename', (req, res) => {
  const requestedFile = req.params.filename;
  const baseName = path.basename(requestedFile, path.extname(requestedFile)); 
  const nameWords = baseName.split(/\s+/).filter(Boolean); 

  const extensions = ['.jpg', '.jpeg', '.png'];
  const candidates = [];

  for (const ext of extensions) {
    candidates.push(baseName + ext);
  }

  for (const word of nameWords) {
    for (const ext of extensions) {
      candidates.push(`${word}${ext}`);
      candidates.push(`${word.toLowerCase()}${ext}`);
    }
  }

  for (const candidate of candidates) {
    const candidatePath = path.join(PHOTO_DIR, candidate);
    if (fs.existsSync(candidatePath)) {
      return res.sendFile(candidatePath);
    }
  }

  console.error(`[PhotoError] No photo found for ${baseName}`);
  res.status(404).send('Photo not found');
});

// ---------------------------
// In-memory last activity tracker
// ---------------------------
const lastSeen = {};

// Auto-logout checker (every 30 seconds)

// Auto-logout everyone at midnight server time
function scheduleMidnightLogout() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  const msUntilMidnight = nextMidnight - now;
  setTimeout(() => {
    const tutors = loadTutors();
    let updated = false;
    tutors.forEach(tutor => {
      if (tutor.available) {
        tutor.available = false;
        updated = true;
      }
    });
    if (updated) {
      saveTutors(tutors);
      console.log('[AutoLogout] All tutors logged out at midnight');
    }
    scheduleMidnightLogout(); // Schedule next midnight
  }, msUntilMidnight);
}
scheduleMidnightLogout();

// ---------------------------
// API Routes
// ---------------------------

// Get instructions
app.get('/api/instructions', (req, res) => {
  const readmePath = path.join(__dirname, '..', 'FUTURE_USERS_LOOK_HERE', 'READ ME.txt');
  res.sendFile(readmePath);
});

// Get all tutors
app.get('/api/tutors', (req, res) => {
  const tutors = loadTutors();
  res.json(tutors);
});

// Login: mark tutor available by ID
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

// Logout: mark tutor unavailable by ID
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

// Heartbeat endpoint
app.post('/api/heartbeat', (req, res) => {
  const { id } = req.body;
  if (id) {
    lastSeen[id] = Date.now();
  }
  res.json({ status: 'ok' });
});

// Admin: toggle availability
app.post('/api/toggle-availability', (req, res) => {
  const { id } = req.body;
  const tutors = loadTutors();
  const tutor = tutors.find(t => t.id === id);
  if (!tutor) return res.status(404).json({ message: 'Tutor not found' });

  tutor.available = !tutor.available;
  saveTutors(tutors);
  res.json({ message: 'Availability toggled', tutor });
});

// Admin: delete tutor
app.post('/api/delete-tutor', (req, res) => {
  const { id } = req.body;
  let tutors = loadTutors();
  const index = tutors.findIndex(t => t.id === id);
  if (index === -1) return res.status(404).json({ message: 'Tutor not found' });

  tutors.splice(index, 1);
  saveTutors(tutors);
  res.json({ message: 'Tutor deleted' });
});

// Admin: add tutor
app.post('/api/add-tutor', (req, res) => {
  const { name, id, grade, subjects } = req.body;
  if (!name || !id) {
    return res.status(400).json({ message: 'Missing fields' });
  }

  let tutors = loadTutors();
  if (tutors.some(t => t.id === id)) {
    return res.status(409).json({ message: 'Tutor with this ID already exists' });
  }

  tutors.push({ name, id, grade, subjects, available: false });
  saveTutors(tutors);
  res.json({ message: 'Tutor added' });
});

// Admin: edit tutor
app.post('/api/edit-tutor', (req, res) => {
  const { id, name, grade, subjects, originalId } = req.body;
  let tutors = loadTutors();
  // Try to find by originalId first
  let index = tutors.findIndex(t => t.id === originalId);
  // If not found, try by name (case-insensitive)
  if (index === -1 && name) {
    index = tutors.findIndex(t => t.name.trim().toLowerCase() === name.trim().toLowerCase());
  }
  if (index === -1) return res.status(404).json({ message: 'Tutor not found' });
  // If changing ID, check for conflicts
  if (id !== undefined && id !== tutors[index].id) {
    if (tutors.some(t => t.id === id)) {
      return res.status(409).json({ message: 'Tutor with this ID already exists' });
    }
    tutors[index].id = id;
  }
  if (name !== undefined) tutors[index].name = name;
  if (grade !== undefined) tutors[index].grade = grade;
  if (subjects !== undefined) tutors[index].subjects = subjects;

  saveTutors(tutors);
  res.json({ message: 'Tutor updated', tutor: tutors[index] });
});

// ---------------------------
// Upload tutors workbook
// ---------------------------
app.post('/api/upload-tutors', upload.single('tutorFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  if (!/\.xlsx$/i.test(req.file.originalname)) {
    return res.status(400).json({ success: false, message: 'Only .xlsx files are accepted' });
  }

  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    if (!workbook.SheetNames.length) {
      return res.status(400).json({ success: false, message: 'Uploaded workbook has no sheets' });
    }
    fs.writeFileSync(XLSX_PATH, req.file.buffer);
    return res.json({ success: true, message: 'Tutor workbook uploaded successfully' });
  } catch (err) {
    console.error('Upload workbook error:', err);
    return res.status(400).json({ success: false, message: 'Invalid workbook or corrupted file' });
  }
});

// ---------------------------
// Upload tutor photos
// ---------------------------
app.post('/api/upload-photos', (req, res, next) => {
  try {
    if (!fs.existsSync(PHOTO_DIR)) {
      fs.mkdirSync(PHOTO_DIR, { recursive: true });
    }
    const existingFiles = fs.readdirSync(PHOTO_DIR);
    existingFiles.forEach(existing => {
      const ext = path.extname(existing).toLowerCase();
      if (['.jpg', '.jpeg', '.png'].includes(ext)) {
        fs.unlinkSync(path.join(PHOTO_DIR, existing));
      }
    });
    next();
  } catch (err) {
    console.error('Error clearing photo folder:', err);
    return res.status(500).json({ success: false, message: 'Could not clear photo folder' });
  }
}, photoUpload.array('photos'), (req, res) => {
  if (!req.files || !req.files.length) {
    return res.status(400).json({ success: false, message: 'No photos uploaded' });
  }
  const savedFiles = req.files.map(file => file.filename);
  res.json({ success: true, message: 'Photos uploaded successfully', files: savedFiles });
});

// ---------------------------
// Admin login verification
// ---------------------------
app.post('/api/admin-login', (req, res) => {
  const { password } = req.body;
  const realPassword = AdminPassword;

  if (!realPassword) {
    return res.status(500).json({ success: false, message: 'Server misconfigured: password file missing' });
  }

  if (password === realPassword) {
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});


// ---------------------------
// Global error handler
// ---------------------------
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err.message) {
    return res.status(400).json({ success: false, message: err.message });
  }
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ---------------------------
// Start Server
// ---------------------------
const port = 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
