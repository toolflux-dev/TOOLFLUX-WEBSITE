/* TOOLFLUX PATHPRO — ISO 1832 insert-code recognizer. */

const _INSERT_FAMILIES = [
  // — milling, 90° shoulder —
  { p: ['APKT','APMT','APHT','APHX','APMW'],
    family: 'APKT / APMT',  op: 'mill', kapr: 90, ctf: 1.00, shape: 'Parallelogram, 11° relief',
    desc: '90° shoulder mill. Square shoulders, modest axial DOC. Most common shop insert.' },
  { p: ['SDKT','SDMT'],
    family: 'SDKT / SDMT',  op: 'mill', kapr: 75, ctf: 1.04, shape: 'Square, 75°',
    desc: '75° face mill — balanced cutting force. Big chip section, free chip flow.' },
  { p: ['SEKT','SEKN','SEHW','SEET'],
    family: 'SEKN / SEKT',  op: 'mill', kapr: 75, ctf: 1.04, shape: 'Square, 75°',
    desc: 'Classic 75° face-mill geometry. Forgiving — good first pick for unknown casting skin.' },
  { p: ['SNMU','SPMW','SPKR','SNHU','SNGN'],
    family: 'SNMU / SPMW',  op: 'mill', kapr: 90, ctf: 1.00, shape: 'Square, 90°',
    desc: 'Square 90° insert — heavy DOC face/shoulder milling. 4 or 8 edges.' },
  // — milling, round —
  { p: ['RCKT','RCMT','RCMX','RCHT','RCGX'],
    family: 'RCMT / RCKT',  op: 'mill', kapr: 45, ctf: 1.41, shape: 'Round',
    desc: 'Round insert — strongest edge. Chip-thinning ×1.41 → boost commanded feed. Roughing & hardened steel.' },
  { p: ['RPHT','RPMT','RPGT','RDKT','RDMT','RDHX','RDHT'],
    family: 'RPMT / RDMT',  op: 'mill', kapr: 45, ctf: 1.41, shape: 'Round',
    desc: 'Round insert family.  Copy milling, hardened-steel pocketing, dynamic toolpaths.' },
  // — milling, octagonal 45° —
  { p: ['ONHU','ONMU','ONGU','OFKT','OFMT','OEMT','OEPW','OFCT'],
    family: 'ONHU / OFKT',  op: 'mill', kapr: 45, ctf: 1.41, shape: 'Octagonal, 45°',
    desc: '45° face mill. 8 cutting edges per insert — economy productivity champion.' },
  // — milling, high-feed —
  { p: ['XOMX','XOEX','XPHT'],
    family: 'XOMX (high-feed)', op: 'mill', kapr: 12, ctf: 4.80, shape: 'High-feed, ≤17° lead',
    desc: 'High-feed insert. Force is axial — easy on spindle. ae ≤ 0.10×D, ap ≤ 0.04×D, very high IPT.' },
  { p: ['SOMX','SOMT','SOET','SOGT'],
    family: 'SOMX (high-feed)', op: 'mill', kapr: 12, ctf: 4.80, shape: 'High-feed, ≤17° lead',
    desc: 'High-feed face mill. Tiny lead, very high chip-thinning. Mass material removal.' },
  { p: ['LNMU','LNGU','LNEW','LOMU','LOGU','LNKR','LNGX','LNHX','LNHU','PNHX'],
    family: 'LNMU / LOGU',  op: 'mill', kapr: 17, ctf: 3.42, shape: 'High-feed long edge, ~17° lead',
    desc: 'Long-edge or high-feed geometry. Programs as high-feed mill.' },
  // — milling, triangle —
  { p: ['TPKN','TPKR','TPMN','TPHR','TPGN','TPCN','TPMR'],
    family: 'TPKN / TPMR',  op: 'mill', kapr: 60, ctf: 1.16, shape: 'Triangle, 60°',
    desc: 'Triangular milling insert. 3 sharp edges. Lower-power machines & thin walls.' },
  { p: ['TNMU','TNGX','TNKR','TNHU'],
    family: 'TNMU / TNHU',  op: 'mill', kapr: 90, ctf: 1.00, shape: 'Triangle, 90°',
    desc: 'Triangular shoulder mill insert.' },
  // — milling, trigon —
  { p: ['WNHU','WNMU','WPHX','WPMU','WCMX'],
    family: 'WNHU / WPMU',  op: 'mill', kapr: 88, ctf: 1.00, shape: 'Trigon (80°)',
    desc: 'Trigon insert — 6 edges with stronger corner than triangle.' },
  // — turning —
  { p: ['CNMG','CNMM','CNMP'],
    family: 'CNMG',         op: 'turn', kapr: 95, ctf: 1.00, shape: 'Rhombic 80°',
    desc: 'CNMG — 80° rhombic, negative geometry.  Workhorse OD turning, 4 edges.' },
  { p: ['CCMT','CCGT'],
    family: 'CCMT',         op: 'turn', kapr: 95, ctf: 1.00, shape: 'Rhombic 80°, positive',
    desc: 'CCMT — 80° rhombic, positive geometry.  Light cuts, ID & finishing.' },
  { p: ['WNMG','WNMP','WNMM'],
    family: 'WNMG',         op: 'turn', kapr: 95, ctf: 1.00, shape: 'Trigon, negative',
    desc: 'WNMG — 80° trigon. 6 edges, stronger nose than CNMG. Heavy roughing.' },
  { p: ['DNMG','DNMP'],
    family: 'DNMG',         op: 'turn', kapr: 93, ctf: 1.00, shape: 'Rhombic 55°',
    desc: 'DNMG — 55° rhombic.  Profiling — accesses tight contours.' },
  { p: ['VNMG','VBMT'],
    family: 'VNMG / VBMT',  op: 'turn', kapr: 107, ctf: 1.00, shape: 'Rhombic 35°',
    desc: 'V-style — 35° rhombic.  Acute nose for deep profiling. Fragile — light loads.' },
  { p: ['TNMG','TNMP','TCMT','TCGT'],
    family: 'TNMG / TCMT',  op: 'turn', kapr: 90, ctf: 1.00, shape: 'Triangle',
    desc: 'Triangle turning insert. 3 edges. Plunge & profile work.' },
  { p: ['SNMG','SNMM'],
    family: 'SNMG',         op: 'turn', kapr: 75, ctf: 1.04, shape: 'Square, 75° lead',
    desc: 'SNMG — square turning, 4 edges. Heavy roughing on bar stock.' },
  { p: ['RNMG','RCMX','RCGT'],
    family: 'RNMG',         op: 'turn', kapr: 45, ctf: 1.41, shape: 'Round (turning)',
    desc: 'Round turning insert. Endless edges, strong nose — copy turning.' },
];

function parseInsertCode(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (code.length < 3) return null;

  let match = null;
  for (const fam of _INSERT_FAMILIES) {
    for (const p of fam.p) {
      if (code.startsWith(p)) { match = { fam, prefix: p }; break; }
    }
    if (match) break;
  }

  if (match) {
    const tail = code.slice(match.prefix.length);
    const md = tail.match(/^(\d{2})(\d{2})(\d{2})?/);
    let ic_mm = null, thickness_mm = null, corner_r_mm = null;
    if (md) {
      ic_mm = parseInt(md[1], 10);
      thickness_mm = parseInt(md[2], 10) / 10;
      if (md[3]) corner_r_mm = parseInt(md[3], 10) / 10;
    }
    if (corner_r_mm == null) {
      if (match.fam.shape.startsWith('Round')) corner_r_mm = ic_mm ? ic_mm / 2 : 5;
      else corner_r_mm = 0.8;
    }
    return {
      recognized: true,
      input: code,
      family: match.fam.family,
      op: match.fam.op,
      shape: match.fam.shape,
      kapr: match.fam.kapr,
      ctf: match.fam.ctf,
      desc: match.fam.desc,
      ic_mm, thickness_mm, corner_r_mm,
      matched_prefix: match.prefix,
    };
  }

  const SHAPE_BY_FIRST = {
    R: { shape: 'Round',         kapr: 45, ctf: 1.41 },
    S: { shape: 'Square',        kapr: 75, ctf: 1.04 },
    O: { shape: 'Octagonal',     kapr: 45, ctf: 1.41 },
    T: { shape: 'Triangle',      kapr: 90, ctf: 1.00 },
    W: { shape: 'Trigon (80°)',  kapr: 88, ctf: 1.00 },
    C: { shape: 'Rhombic 80°',   kapr: 90, ctf: 1.00 },
    D: { shape: 'Rhombic 55°',   kapr: 90, ctf: 1.00 },
    V: { shape: 'Rhombic 35°',   kapr: 90, ctf: 1.00 },
    P: { shape: 'Pentagonal',    kapr: 90, ctf: 1.00 },
    L: { shape: 'Rectangular',   kapr: 90, ctf: 1.00 },
    K: { shape: 'Parallelogram', kapr: 75, ctf: 1.04 },
    E: { shape: 'Rhombic 75°',   kapr: 90, ctf: 1.00 },
    M: { shape: 'Rhombic 86°',   kapr: 90, ctf: 1.00 },
  };
  const s = SHAPE_BY_FIRST[code[0]];
  if (s) {
    return {
      recognized: true,
      uncertain: true,
      input: code,
      family: `${code[0]}-shape (inferred)`,
      op: 'mill',
      shape: s.shape, kapr: s.kapr, ctf: s.ctf,
      desc: 'Inferred from ISO first-letter shape only — family unknown. Verify against catalog.',
      corner_r_mm: 0.8, ic_mm: null, thickness_mm: null,
    };
  }

  return { recognized: false, input: code };
}

const INSERT_EXAMPLES = [
  'APMT1604PDER',
  'APKT1003PDFR',
  'SDMT1204PDR',
  'SEKN1203AFTN',
  'RCMT1606MO',
  'RDHT10T3MO',
  'ONHU0606ANSN',
  'XOMX120508TR',
  'LNMU0905ZNTR',
  'SOMT12T308',
  'CNMG432',
  'WNMG080408',
];

Object.assign(window, { parseInsertCode, INSERT_EXAMPLES, _INSERT_FAMILIES });
