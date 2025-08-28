#!/usr/bin/env node
const express = require('express');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const app = express();

const AdminPassword = process.env.ADMIN_PASSWORD;

const XLSX_PATH = path.join(__dirname, '..', 'FUTURE_USERS_LOOK_HERE', 'tutors.xlsx');
const PHOTO_DIR = path.join(__dirname, '..', 'frontend', 'photos');
const PASSWORD_FILE = path.join(__dirname, '..', 'FUTURE_USERS_LOOK_HERE', 'adminpassword.txt');

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
    const tutors = rows.slice(1).map(row => {
      // Columns: 0=timestamp, 1=email, 2=student ID, 3=full name, 4=grade, 5-11=subjects
      const id = row[2] ? String(row[2]).trim() : '';
      const name = row[3] ? String(row[3]).trim() : '';
      const grade = row[4] ? String(row[4]).trim() : '';
      const subjects = row.slice(5, 12).filter(Boolean).map(s => String(s).trim());
      // Derive photo filename: "Full Name.jpeg"
      const photo = name ? `${name}.jpeg` : '';
      return {
        name,
        id,
        photo,
        grade,
        subjects,
        available: false // default, can be set elsewhere
      };
    });
    console.log(`[Tutors] Successfully read ${tutors.length} tutors from spreadsheet.`);
    return tutors;
  } catch (err) {
    return [];
  }
}

function saveTutors(tutors) {
  try {
    // Convert subjects array to comma-separated string for Excel
    const rows = tutors.map(t => ({
      Name: t.name,
      ID: t.id,
      Photo: t.photo,
      Grade: t.grade,
      Subjects: Array.isArray(t.subjects) ? t.subjects.join(', ') : t.subjects,
      Available: t.available
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tutors');
    XLSX.writeFile(workbook, XLSX_PATH);
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
setInterval(() => {
  const now = Date.now();
  const tutors = loadTutors();
  let updated = false;

  tutors.forEach(tutor => {
    if (tutor.available && lastSeen[tutor.id] && now - lastSeen[tutor.id] > 30000) {
      console.log(`[AutoLogout] Tutor ${tutor.id} timed out`);
      tutor.available = false;
      updated = true;
    }
  });

  if (updated) {
    saveTutors(tutors);
  }
}, 30000);

// ---------------------------
// API Routes
// ---------------------------

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
  const { name, id, photo, grade, subjects } = req.body;
  if (!name || !id || !photo) {
    return res.status(400).json({ message: 'Missing fields' });
  }

  let tutors = loadTutors();
  if (tutors.some(t => t.id === id)) {
    return res.status(409).json({ message: 'Tutor with this ID already exists' });
  }

  tutors.push({ name, id, photo, grade, subjects, available: false });
  saveTutors(tutors);
  res.json({ message: 'Tutor added' });
});

// Admin: edit tutor
app.post('/api/edit-tutor', (req, res) => {
  const { id, name, grade, subjects, photo, originalId } = req.body;
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
  if (photo !== undefined) tutors[index].photo = photo;

  saveTutors(tutors);
  res.json({ message: 'Tutor updated', tutor: tutors[index] });
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
// Start Server
// ---------------------------
const port = 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
