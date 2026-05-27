-- ═══════════════════════════════════════════════════════════════════════════
--  TOOLFLUX Database Schema
--  Industrial Cutting Tools – Feeds & Speeds Calculator
--  MySQL 8.0+
-- ═══════════════════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS toolflux
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE toolflux;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: users
--   Stores registered users of the TOOLFLUX platform
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username         VARCHAR(100)  NOT NULL UNIQUE,
  email            VARCHAR(255)  NOT NULL UNIQUE,
  password_hash    VARCHAR(255)  NOT NULL,
  full_name        VARCHAR(200)  DEFAULT NULL,
  company          VARCHAR(200)  DEFAULT NULL,
  designation      VARCHAR(150)  DEFAULT NULL,
  phone            VARCHAR(30)   DEFAULT NULL,
  country          VARCHAR(100)  DEFAULT NULL,
  is_active        TINYINT(1)    NOT NULL DEFAULT 1,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login       DATETIME      DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: drilling_feeds_speeds
--   Records every Feeds & Speeds – Drilling calculation session.
--   Captures all user inputs AND the calculated outputs.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drilling_feeds_speeds (
  id                        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- ── Session / User linkage ─────────────────────────────────────────────────
  user_id                   INT UNSIGNED  DEFAULT NULL,
  session_id                VARCHAR(100)  DEFAULT NULL,         -- guest sessions
  record_name               VARCHAR(200)  DEFAULT NULL,         -- user-saved name

  -- ── Workpiece Material ────────────────────────────────────────────────────
  workpiece_material        VARCHAR(150)  NOT NULL,             -- e.g. P Steel, M Stainless
  material_subgroup         VARCHAR(150)  DEFAULT NULL,         -- e.g. Low Carbon Steel
  material_hardness_hb      DECIMAL(7,2)  DEFAULT NULL,         -- Brinell Hardness
  material_hardness_hrc     DECIMAL(5,2)  DEFAULT NULL,         -- Rockwell C
  tensile_strength_mpa      DECIMAL(8,2)  DEFAULT NULL,         -- UTS (MPa)
  iso_material_group        CHAR(2)       DEFAULT NULL,         -- P, M, K, N, S, H

  -- ── Drill / Tool Geometry ─────────────────────────────────────────────────
  drill_diameter_mm         DECIMAL(10,4) NOT NULL,             -- mm
  drill_diameter_inch       DECIMAL(10,5) DEFAULT NULL,         -- inch (auto-converted)
  drill_type                VARCHAR(100)  NOT NULL,             -- Twist, Indexable, Gun, Step, Centre, Spot
  drill_length_overall_mm   DECIMAL(10,3) DEFAULT NULL,         -- OAL mm
  flute_length_mm           DECIMAL(10,3) DEFAULT NULL,         -- mm
  point_angle_deg           DECIMAL(6,2)  DEFAULT NULL,         -- degrees
  helix_angle_deg           DECIMAL(6,2)  DEFAULT NULL,         -- degrees
  number_of_flutes          TINYINT       DEFAULT NULL,

  -- ── Tool Material & Coating ───────────────────────────────────────────────
  tool_material             VARCHAR(100)  NOT NULL,             -- HSS, HSCO, Solid Carbide, Carbide Tipped
  carbide_grade             VARCHAR(100)  DEFAULT NULL,         -- e.g. K10, K20, P25
  coating                   VARCHAR(100)  DEFAULT NULL,         -- TiN, TiCN, TiAlN, AlTiN, DLC, Uncoated
  tool_brand                VARCHAR(100)  DEFAULT NULL,
  tool_catalog_number       VARCHAR(100)  DEFAULT NULL,

  -- ── Hole Parameters ───────────────────────────────────────────────────────
  hole_type                 ENUM('Through','Blind','Step')      NOT NULL DEFAULT 'Through',
  hole_depth_mm             DECIMAL(10,3) DEFAULT NULL,         -- mm
  hole_diameter_tolerance   VARCHAR(50)   DEFAULT NULL,         -- e.g. H7, H8
  surface_finish_ra         DECIMAL(6,3)  DEFAULT NULL,         -- Ra µm
  number_of_holes           INT UNSIGNED  DEFAULT NULL,

  -- ── Cutting Conditions (User Input) ──────────────────────────────────────
  coolant_type              VARCHAR(100)  DEFAULT NULL,         -- Flood, MQL, Through Spindle, Dry, Air Blast
  coolant_pressure_bar      DECIMAL(8,2)  DEFAULT NULL,
  machine_type              VARCHAR(100)  DEFAULT NULL,         -- VMC, HMC, CNC Lathe, Radial Drill
  machine_max_rpm           INT UNSIGNED  DEFAULT NULL,
  machine_spindle_power_kw  DECIMAL(8,3)  DEFAULT NULL,
  unit_system               ENUM('Metric','Imperial') NOT NULL DEFAULT 'Metric',

  -- ── User-Entered Cutting Parameters (override / manual entry) ─────────────
  input_cutting_speed_vc    DECIMAL(10,3) DEFAULT NULL,         -- m/min (user entered)
  input_feed_per_rev_fn     DECIMAL(10,4) DEFAULT NULL,         -- mm/rev (user entered)
  input_spindle_speed_rpm   DECIMAL(10,2) DEFAULT NULL,         -- RPM (user entered)
  input_feed_rate_vf        DECIMAL(10,3) DEFAULT NULL,         -- mm/min (user entered)

  -- ── Calculated / Recommended Outputs ──────────────────────────────────────
  rec_cutting_speed_vc      DECIMAL(10,3) DEFAULT NULL,         -- m/min  (recommended)
  rec_feed_per_rev_fn       DECIMAL(10,4) DEFAULT NULL,         -- mm/rev (recommended)
  calc_spindle_speed_n      DECIMAL(10,2) DEFAULT NULL,         -- RPM    (calculated)
  calc_feed_rate_vf         DECIMAL(10,3) DEFAULT NULL,         -- mm/min (calculated)
  calc_machining_time_min   DECIMAL(10,4) DEFAULT NULL,         -- minutes per hole
  calc_total_time_min       DECIMAL(10,4) DEFAULT NULL,         -- total time (all holes)
  calc_thrust_force_n       DECIMAL(10,3) DEFAULT NULL,         -- Thrust Force (N)
  calc_torque_nm            DECIMAL(10,4) DEFAULT NULL,         -- Torque (Nm)
  calc_power_kw             DECIMAL(8,4)  DEFAULT NULL,         -- Net Power (kW)
  calc_mrr_cm3_min          DECIMAL(10,4) DEFAULT NULL,         -- Material Removal Rate cm³/min
  estimated_tool_life_holes INT UNSIGNED  DEFAULT NULL,         -- approx holes per edge

  -- ── Remarks ───────────────────────────────────────────────────────────────
  notes                     TEXT          DEFAULT NULL,
  is_saved                  TINYINT(1)    NOT NULL DEFAULT 0,   -- user bookmarked this
  created_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_drill_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_drill_user      (user_id),
  INDEX idx_drill_session   (session_id),
  INDEX idx_drill_material  (workpiece_material),
  INDEX idx_drill_diameter  (drill_diameter_mm),
  INDEX idx_drill_created   (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: indexable_milling_feeds_speeds
--   Records every Feeds & Speeds – Indexable Milling calculation session.
--   Captures all user inputs AND the calculated outputs.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS indexable_milling_feeds_speeds (
  id                          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- ── Session / User linkage ─────────────────────────────────────────────────
  user_id                     INT UNSIGNED  DEFAULT NULL,
  session_id                  VARCHAR(100)  DEFAULT NULL,
  record_name                 VARCHAR(200)  DEFAULT NULL,

  -- ── Workpiece Material ────────────────────────────────────────────────────
  workpiece_material          VARCHAR(150)  NOT NULL,
  material_subgroup           VARCHAR(150)  DEFAULT NULL,
  material_hardness_hb        DECIMAL(7,2)  DEFAULT NULL,
  material_hardness_hrc       DECIMAL(5,2)  DEFAULT NULL,
  tensile_strength_mpa        DECIMAL(8,2)  DEFAULT NULL,
  iso_material_group          CHAR(2)       DEFAULT NULL,        -- P, M, K, N, S, H

  -- ── Milling Operation ────────────────────────────────────────────────────
  milling_operation           VARCHAR(100)  NOT NULL,            -- Face, Shoulder, Slot, Ramping, Helical, Plunge, Profile
  operation_type              ENUM('Roughing','Semi-Finishing','Finishing') NOT NULL DEFAULT 'Roughing',

  -- ── Cutter / Body ────────────────────────────────────────────────────────
  cutter_type                 VARCHAR(100)  NOT NULL,            -- Face Mill, Shoulder Mill, Slot Mill, Copy Mill, etc.
  cutter_diameter_mm          DECIMAL(10,3) NOT NULL,            -- mm (Dc)
  cutter_diameter_inch        DECIMAL(10,5) DEFAULT NULL,        -- inch
  cutter_bore_mm              DECIMAL(8,3)  DEFAULT NULL,        -- bore / arbor size
  number_of_inserts           TINYINT       NOT NULL,            -- z (effective teeth)
  max_depth_of_cut_ap_mm      DECIMAL(8,3)  DEFAULT NULL,        -- max ap from catalogue
  body_material               VARCHAR(100)  DEFAULT NULL,        -- Steel body, Heavy metal, etc.
  tool_brand                  VARCHAR(100)  DEFAULT NULL,
  cutter_catalog_number       VARCHAR(100)  DEFAULT NULL,

  -- ── Insert Details ───────────────────────────────────────────────────────
  insert_shape                VARCHAR(50)   DEFAULT NULL,        -- APKT, SEKT, RPMT, XNEX, HNEX, SPMT, ONHU
  insert_size                 VARCHAR(50)   DEFAULT NULL,        -- e.g. 1204, 1606, 0904
  insert_grade                VARCHAR(100)  NOT NULL,            -- Carbide grade / Cermet / Ceramic / CBN / PCD
  insert_geometry             VARCHAR(100)  DEFAULT NULL,        -- e.g. MF, MM, MR (chip breaker)
  insert_coating              VARCHAR(100)  DEFAULT NULL,        -- CVD, PVD, TiAlN, AlTiN, Uncoated
  insert_nose_radius_mm       DECIMAL(5,3)  DEFAULT NULL,        -- rε (mm)
  insert_catalog_number       VARCHAR(100)  DEFAULT NULL,
  inserts_per_cutter          TINYINT       DEFAULT NULL,        -- total pockets (may differ from effective)

  -- ── Cutting Conditions (User Input) ──────────────────────────────────────
  axial_depth_ap_mm           DECIMAL(10,4) NOT NULL,            -- ap (mm)
  radial_depth_ae_mm          DECIMAL(10,4) NOT NULL,            -- ae (mm)
  ae_to_dc_ratio              DECIMAL(6,4)  DEFAULT NULL,        -- ae/Dc (calculated or input)
  coolant_type                VARCHAR(100)  DEFAULT NULL,        -- Flood, MQL, Dry, Through Spindle, Air
  coolant_pressure_bar        DECIMAL(8,2)  DEFAULT NULL,
  machine_type                VARCHAR(100)  DEFAULT NULL,        -- VMC, HMC, Universal, Gantry
  machine_max_rpm             INT UNSIGNED  DEFAULT NULL,
  machine_spindle_power_kw    DECIMAL(8,3)  DEFAULT NULL,
  machine_spindle_torque_nm   DECIMAL(10,3) DEFAULT NULL,
  unit_system                 ENUM('Metric','Imperial') NOT NULL DEFAULT 'Metric',

  -- ── User-Entered Cutting Parameters (override / manual entry) ─────────────
  input_cutting_speed_vc      DECIMAL(10,3) DEFAULT NULL,        -- m/min
  input_feed_per_tooth_fz     DECIMAL(10,5) DEFAULT NULL,        -- mm/tooth
  input_spindle_speed_rpm     DECIMAL(10,2) DEFAULT NULL,        -- RPM
  input_feed_rate_vf          DECIMAL(10,3) DEFAULT NULL,        -- mm/min (table feed)

  -- ── Calculated / Recommended Outputs ──────────────────────────────────────
  rec_cutting_speed_vc        DECIMAL(10,3) DEFAULT NULL,        -- m/min  (recommended)
  rec_feed_per_tooth_fz       DECIMAL(10,5) DEFAULT NULL,        -- mm/tooth (recommended)
  calc_spindle_speed_n        DECIMAL(10,2) DEFAULT NULL,        -- n (RPM)
  calc_feed_rate_vf           DECIMAL(10,3) DEFAULT NULL,        -- Vf (mm/min)
  calc_metal_removal_rate     DECIMAL(12,4) DEFAULT NULL,        -- Q (cm³/min)
  calc_specific_cutting_force DECIMAL(10,2) DEFAULT NULL,        -- Kc (N/mm²)
  calc_net_power_kw           DECIMAL(8,4)  DEFAULT NULL,        -- Pc (kW)
  calc_torque_nm              DECIMAL(10,4) DEFAULT NULL,        -- Mc (Nm)
  calc_machining_time_min     DECIMAL(10,4) DEFAULT NULL,        -- minutes per pass
  calc_cutting_force_n        DECIMAL(10,3) DEFAULT NULL,        -- Fc (N)
  calc_surface_roughness_ra   DECIMAL(7,4)  DEFAULT NULL,        -- Ra (µm) theoretical
  estimated_tool_life_min     DECIMAL(10,2) DEFAULT NULL,        -- tool life (min)
  estimated_inserts_per_part  DECIMAL(10,4) DEFAULT NULL,        -- estimated inserts per component

  -- ── Remarks ───────────────────────────────────────────────────────────────
  notes                       TEXT          DEFAULT NULL,
  is_saved                    TINYINT(1)    NOT NULL DEFAULT 0,
  created_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_mill_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX idx_mill_user         (user_id),
  INDEX idx_mill_session      (session_id),
  INDEX idx_mill_material     (workpiece_material),
  INDEX idx_mill_operation    (milling_operation),
  INDEX idx_mill_cutter_dia   (cutter_diameter_mm),
  INDEX idx_mill_created      (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: saved_calculations
--   Allows users to name and bookmark any calculation from any module
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_calculations (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED NOT NULL,
  module          ENUM('drilling','indexable_milling') NOT NULL,
  record_id       INT UNSIGNED NOT NULL,              -- FK to the module table
  label           VARCHAR(200) DEFAULT NULL,           -- user-given name
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_saved_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_saved_user   (user_id),
  INDEX idx_saved_module (module, record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
