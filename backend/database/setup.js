// ─── TOOLFLUX – Database Setup Script ─────────────────────────────────────────
// Run with:  node database/setup.js
// Creates the 'toolflux' database and all tables from schema.sql
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');
const fs    = require('fs');
const path  = require('path');

async function setup() {
  let connection;
  try {
    console.log('\n🔧  TOOLFLUX – Database Setup\n');

    // Connect WITHOUT specifying a database (so we can create it)
    connection = await mysql.createConnection({
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT) || 3306,
      user:     process.env.DB_USER     || 'root',
      password: process.env.DB_PASSWORD || 'toolflux123',
      multipleStatements: true,
    });

    console.log('✅  Connected to MySQL server');

    // Read schema.sql
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema     = fs.readFileSync(schemaPath, 'utf8');

    // Execute the full schema (CREATE DATABASE + all tables)
    await connection.query(schema);

    console.log('✅  Database "toolflux" created (or already exists)');
    console.log('✅  Tables created:');
    console.log('      • users');
    console.log('      • drilling_feeds_speeds');
    console.log('      • indexable_milling_feeds_speeds');
    console.log('      • saved_calculations');
    console.log('\n🎉  Setup complete! You can now run: npm run dev\n');
  } catch (err) {
    console.error('\n❌  Setup failed:', err.message);
    console.error('    Check that MySQL is running and credentials in .env are correct.\n');
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

setup();
