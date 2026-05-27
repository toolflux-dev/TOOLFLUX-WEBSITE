// ─── TOOLFLUX – Feeds & Speeds: Drilling Routes ───────────────────────────────
const express = require('express');
const router  = express.Router();
const db      = require('../config/db');

// ── POST /api/drilling  – Save a drilling calculation record ──────────────────
router.post('/', async (req, res) => {
  try {
    const d = req.body;

    const sql = `
      INSERT INTO drilling_feeds_speeds (
        user_id, session_id, record_name,
        workpiece_material, material_subgroup, material_hardness_hb,
        material_hardness_hrc, tensile_strength_mpa, iso_material_group,
        drill_diameter_mm, drill_diameter_inch, drill_type,
        drill_length_overall_mm, flute_length_mm, point_angle_deg,
        helix_angle_deg, number_of_flutes,
        tool_material, carbide_grade, coating, tool_brand, tool_catalog_number,
        hole_type, hole_depth_mm, hole_diameter_tolerance,
        surface_finish_ra, number_of_holes,
        coolant_type, coolant_pressure_bar, machine_type,
        machine_max_rpm, machine_spindle_power_kw, unit_system,
        input_cutting_speed_vc, input_feed_per_rev_fn,
        input_spindle_speed_rpm, input_feed_rate_vf,
        rec_cutting_speed_vc, rec_feed_per_rev_fn,
        calc_spindle_speed_n, calc_feed_rate_vf,
        calc_machining_time_min, calc_total_time_min,
        calc_thrust_force_n, calc_torque_nm,
        calc_power_kw, calc_mrr_cm3_min, estimated_tool_life_holes,
        notes, is_saved
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?
      )`;

    const values = [
      d.user_id || null, d.session_id || null, d.record_name || null,
      d.workpiece_material, d.material_subgroup || null, d.material_hardness_hb || null,
      d.material_hardness_hrc || null, d.tensile_strength_mpa || null, d.iso_material_group || null,
      d.drill_diameter_mm, d.drill_diameter_inch || null, d.drill_type,
      d.drill_length_overall_mm || null, d.flute_length_mm || null, d.point_angle_deg || null,
      d.helix_angle_deg || null, d.number_of_flutes || null,
      d.tool_material, d.carbide_grade || null, d.coating || null, d.tool_brand || null, d.tool_catalog_number || null,
      d.hole_type || 'Through', d.hole_depth_mm || null, d.hole_diameter_tolerance || null,
      d.surface_finish_ra || null, d.number_of_holes || null,
      d.coolant_type || null, d.coolant_pressure_bar || null, d.machine_type || null,
      d.machine_max_rpm || null, d.machine_spindle_power_kw || null, d.unit_system || 'Metric',
      d.input_cutting_speed_vc || null, d.input_feed_per_rev_fn || null,
      d.input_spindle_speed_rpm || null, d.input_feed_rate_vf || null,
      d.rec_cutting_speed_vc || null, d.rec_feed_per_rev_fn || null,
      d.calc_spindle_speed_n || null, d.calc_feed_rate_vf || null,
      d.calc_machining_time_min || null, d.calc_total_time_min || null,
      d.calc_thrust_force_n || null, d.calc_torque_nm || null,
      d.calc_power_kw || null, d.calc_mrr_cm3_min || null, d.estimated_tool_life_holes || null,
      d.notes || null, d.is_saved ? 1 : 0,
    ];

    const [result] = await db.execute(sql, values);
    res.status(201).json({ success: true, id: result.insertId, message: 'Drilling record saved.' });
  } catch (err) {
    console.error('Drilling POST error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/drilling  – List records (optionally by user) ────────────────────
router.get('/', async (req, res) => {
  try {
    const { user_id, session_id, limit = 50, offset = 0 } = req.query;
    let sql    = 'SELECT * FROM drilling_feeds_speeds WHERE 1=1';
    const args = [];

    if (user_id)    { sql += ' AND user_id = ?';    args.push(user_id); }
    if (session_id) { sql += ' AND session_id = ?'; args.push(session_id); }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    args.push(parseInt(limit), parseInt(offset));

    const [rows] = await db.execute(sql, args);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('Drilling GET error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/drilling/:id  – Get single record ────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM drilling_feeds_speeds WHERE id = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Record not found.' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Drilling GET/:id error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/drilling/:id  – Delete a record ───────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await db.execute('DELETE FROM drilling_feeds_speeds WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Record deleted.' });
  } catch (err) {
    console.error('Drilling DELETE error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
