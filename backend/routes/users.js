// ─── TOOLFLUX – User Auth Routes ─────────────────────────────────────────────
const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../config/db');

// ── POST /api/users/register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, full_name, company, designation, phone, country } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ success: false, error: 'username, email and password are required.' });

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.execute(
      `INSERT INTO users (username, email, password_hash, full_name, company, designation, phone, country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, email, hash, full_name || null, company || null, designation || null, phone || null, country || null]
    );
    res.status(201).json({ success: true, id: result.insertId, message: 'User registered.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ success: false, error: 'Username or email already exists.' });
    console.error('Register error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/users/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await db.execute('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);
    if (!rows.length) return res.status(401).json({ success: false, error: 'Invalid credentials.' });

    const user  = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)  return res.status(401).json({ success: false, error: 'Invalid credentials.' });

    await db.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || 'toolflux_secret',
      { expiresIn: '7d' }
    );

    res.json({ success: true, token, user: { id: user.id, username: user.username, email: user.email, company: user.company } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
