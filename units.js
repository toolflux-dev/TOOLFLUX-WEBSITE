/* TOOLFLUX PATHPRO — units & conversion.
 * Inputs and outputs default to METRIC.
 * The engine still calculates in imperial under the hood
 * (it's calibrated against SFM-based tables), so this module:
 *   1. Converts user inputs mm → inches before calling calc*
 *   2. Converts engine result (imperial) → display units
 */

const UNITS = {
  metric: {
    length:   { fromImp: v => v * 25.4,    label: 'mm',      dec: 2 },
    speed:    { fromImp: v => v * 0.3048,  label: 'm/min',   dec: 0 },
    feed:     { fromImp: v => v * 25.4,    label: 'mm/min',  dec: 0 },
    perRev:   { fromImp: v => v * 25.4,    label: 'mm/rev',  dec: 3 },
    perTooth: { fromImp: v => v * 25.4,    label: 'mm/z',    dec: 3 },
    mrr:      { fromImp: v => v * 16.3871, label: 'cm³/min', dec: 1 },
    power:    { fromImp: v => v * 0.7457,  label: 'kW',      dec: 2 },
    torque:   { fromImp: v => v * 1.3558,  label: 'N·m',     dec: 1 },
    force:    { fromImp: v => v * 4.4482,  label: 'N',       dec: 0 },
  },
  imperial: {
    length:   { fromImp: v => v,           label: 'in',      dec: 3 },
    speed:    { fromImp: v => v,           label: 'SFM',     dec: 0 },
    feed:     { fromImp: v => v,           label: 'IPM',     dec: 2 },
    perRev:   { fromImp: v => v,           label: 'IPR',     dec: 4 },
    perTooth: { fromImp: v => v,           label: 'IPT',     dec: 4 },
    mrr:      { fromImp: v => v,           label: 'in³/min', dec: 3 },
    power:    { fromImp: v => v,           label: 'HP',      dec: 2 },
    torque:   { fromImp: v => v,           label: 'lbf·ft',  dec: 2 },
    force:    { fromImp: v => v,           label: 'lbf',     dec: 0 },
  },
};

function ufmt(value, kind, units = 'metric') {
  const u = UNITS[units][kind];
  if (typeof value !== 'number' || !isFinite(value)) return { v: '—', u: u.label };
  const v = u.fromImp(value);
  return { v: round(v, u.dec), u: u.label, raw: v, dec: u.dec };
}

function round(v, d) {
  if (!isFinite(v)) return v;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

function mmToIn(mm) { return mm / 25.4; }
function inToMm(inc) { return inc * 25.4; }

const RANGES = {
  metric: {
    drillDia:   { def: 12,    min: 0.4,  max: 76,  step: 1 },
    drillOverhang: { def: 50, min: 5,    max: 305, step: 5 },
    drillDepth: { def: 25,    min: 0.5,  max: 500, step: 1 },
    millDia:    { def: 25,    min: 1.5,  max: 152, step: 1 },
    millOverhang:  { def: 60, min: 10,   max: 254, step: 5 },
    ap:         { def: 2.5,   min: 0.05, max: 100, step: 0.5 },
    ae:         { def: 12.5,  min: 0.05, max: 152, step: 0.5 },
    stockDia:   { def: 50,    min: 1.5,  max: 500, step: 5 },
    doc:        { def: 2.0,   min: 0.05, max: 25,  step: 0.25 },
    noseRad:    { def: 0.8,   min: 0.05, max: 2.4, step: 0.1 },
  },
  imperial: {
    drillDia:   { def: 0.500, min: 0.0156, max: 3,   step: 0.0625 },
    drillOverhang: { def: 2.0, min: 0.2,   max: 12,  step: 0.125 },
    drillDepth: { def: 1.0,   min: 0.02,   max: 20,  step: 0.0625 },
    millDia:    { def: 1.000, min: 0.0625, max: 6,   step: 0.125 },
    millOverhang:  { def: 2.5, min: 0.5,   max: 10,  step: 0.125 },
    ap:         { def: 0.100, min: 0.001,  max: 4,   step: 0.01 },
    ae:         { def: 0.500, min: 0.001,  max: 6,   step: 0.025 },
    stockDia:   { def: 2.000, min: 0.062,  max: 20,  step: 0.125 },
    doc:        { def: 0.080, min: 0.001,  max: 1,   step: 0.005 },
    noseRad:    { def: 0.0312, min: 0.002, max: 0.094, step: 0.0078 },
  },
};

function toInches(value, units) {
  if (units === 'imperial') return value;
  return mmToIn(value);
}

function convertInputsBetween(state, fromU, toU) {
  if (fromU === toU) return state;
  const conv = (v) => fromU === 'metric' ? mmToIn(v) : inToMm(v);
  return {
    drill: {
      ...state.drill,
      dia: conv(state.drill.dia),
      overhang: conv(state.drill.overhang),
      depth: conv(state.drill.depth),
    },
    mill: {
      ...state.mill,
      dia: conv(state.mill.dia),
      overhang: conv(state.mill.overhang),
      ap: conv(state.mill.ap),
      ae: conv(state.mill.ae),
    },
    turn: {
      ...state.turn,
      stockDia: conv(state.turn.stockDia),
      doc: conv(state.turn.doc),
      noseRad: conv(state.turn.noseRad),
    },
  };
}

Object.assign(window, {
  UNITS, ufmt, mmToIn, inToMm, RANGES, toInches, convertInputsBetween,
});
