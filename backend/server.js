// ═══════════════════════════════════════════════════════════════════════════════
//  TOOLFLUX – Backend API Server
//  Industrial Cutting Tools | Feeds & Speeds Calculator
// ═══════════════════════════════════════════════════════════════════════════════
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');

const drillingRoutes = require('./routes/drilling');
const millingRoutes  = require('./routes/milling');
const userRoutes     = require('./routes/users');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'TOOLFLUX API', timestamp: new Date().toISOString() });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/users',   userRoutes);
app.use('/api/drilling', drillingRoutes);
app.use('/api/milling',  millingRoutes);

// ── 404 Handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found.' });
});

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  TOOLFLUX API running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);
});
