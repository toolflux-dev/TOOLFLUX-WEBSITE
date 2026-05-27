// ─── TOOLFLUX – Feeds & Speeds: Indexable Milling Routes ─────────────────────
const express = require('express');
const router  = express.Router();
const db      = require('../config/db');

// ── POST /api/milling  – Save an indexable milling calculation record ──────────
router.post('/', async (req, res) => {
  try {
    const d = req.body;

    const sql = `
      INSERT INTO indexable_milling_feeds_speeds (
        user_id, session_id, record_name,
        workpiece_material, material_subgroup, material_hardness_hb,
        material_hardness_hrc, tensile_strength_mpa, iso_material_group,
        milling_operation, operation_type,
        cutter_type, cutter_diameter_mm, cutter_diameter_inch,
        cutter_bore_mm, number_of_inserts, max_depth_of_cut_ap_mm,
        body_material, tool_brand, cutter_catalog_number,
        insert_shape, insert_size, insert_grade, insert_geometry,
        insert_coating, insert_nose_radius_mm, insert_catalog_number, inserts_per_cutter,
        axial_depth_ap_mm, radial_depth_ae_mm, ae_to_dc_ratio,
        coolant_type, coolant_pressure_bar, machine_type,
        machine_max_rpm, machine_spindle_power_kw, machine_spindle_torque_nm, unit_system,
        input_cutting_speed_vc, input_feed_per_tooth_fz,
        input_spindle_speed_rpm, input_feed_rate_vf,
        rec_cutting_speed_vc, rec_feed_per_tooth_fz,
        calc_spindle_speed_n, calc_feed_rate_vf,
        calc_metal_removal_rate, calc_specific_cutting_force,
        calc_net_power_kw, calc_torque_nm,
        calc_machining_time_min, calc_cutting_force_n,
        calc_surface_roughness_ra, estimated_tool_life_min, estimated_inserts_per_part,
        notes, is_saved
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
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
      d.milling_operation, d.operation_type || 'Roughing',
      d.cutter_type, d.cutter_diameter_mm, d.cutter_diameter_inch || null,
      d.cutter_bore_mm || null, d.number_of_inserts, d.max_depth_of_cut_ap_mm || null,
      d.body_material || null, d.tool_brand || null, d.cutter_catalog_number || null,
      d.insert_shape || null, d.insert_size || null, d.insert_grade, d.insert_geometry || null,
      d.insert_coating || null, d.insert_nose_radius_mm || null, d.insert_catalog_number || null, d.inserts_per_cutter || null,
      d.axial_depth_ap_mm, d.radial_depth_ae_mm, d.ae_to_dc_ratio || null,
      d.coolant_type || null, d.coolant_pressure_bar || null, d.machine_type || null,
      d.machine_max_rpm || null, d.machine_spindle_power_kw || null, d.machine_spindle_torque_nm || null, d.unit_system || 'Metric',
      d.input_cutting_speed_vc || null, d.input_feed_per_tooth_fz || null,
      d.input_spindle_speed_rpm || null, d.input_feed_rate_vf || null,
      d.rec_cutting_speed_vc || null, d.rec_feed_per_tooth_fz || null,
      d.calc_spindle_speed_n || null, d.calc_feed_rate_vf || null,
      d.calc_metal_removal_rate || null, d.calc_specific_cutting_force || null,
      d.calc_net_power_kw || null, d.calc_torque_nm || null,
      d.calc_machining_time_min || null, d.calc_cutting_force_n || null,
      d.calc_surface_roughness_ra || null, d.estimated_tool_life_min || null, d.estimated_inserts_per_part || null,
      d.notes || null, d.is_saved ? 1 : 0,
    ];

    const [result] = await db.execute(sql, values);
    res.status(201).json({ success: true, id: result.insertId, message: 'Milling record saved.' });
  } catch (err) {
    console.error('Milling POST error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/milling  – List records ──────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { user_id, session_id, limit = 50, offset = 0 } = req.query;
    let sql    = 'SELECT * FROM indexable_milling_feeds_speeds WHERE 1=1';
    const args = [];

    if (user_id)    { sql += ' AND user_id = ?';    args.push(user_id); }
    if (session_id) { sql += ' AND session_id = ?'; args.push(session_id); }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    args.push(parseInt(limit), parseInt(offset));

    const [rows] = await db.execute(sql, args);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('Milling GET error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/milling/:id  – Get single record ─────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM indexable_milling_feeds_speeds WHERE id = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Record not found.' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Milling GET/:id error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/milling/:id  – Delete a record ───────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await db.execute('DELETE FROM indexable_milling_feeds_speeds WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Record deleted.' });
  } catch (err) {
    console.error('Milling DELETE error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
