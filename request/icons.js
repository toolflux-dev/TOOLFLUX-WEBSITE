// Flat 2D vector icons for the TOOLFLUX insert finder. Colours come from CSS variables, so
// every icon follows the page palette. Classes (.spin, .flutes, .tool, .cutter, ...) are
// animation hooks in request.css; nothing here moves on its own.
window.TFX_ICONS = (function () {
  const S = (vb, body, cls) => `<svg viewBox="${vb}" class="ico ${cls || ''}" aria-hidden="true" focusable="false">${body}</svg>`;
  const k = 'stroke="var(--ink)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"';

  // ---------------------------------------------------------------- what do you need
  const insert = S('0 0 64 64', `<g class="spin">
    <path d="M6 32 33 11 59 32 33 53Z" fill="var(--steel)" ${k}/>
    <path d="M15.5 32 33 18.3 50.5 32 33 45.7Z" fill="var(--tint)" stroke="var(--acc)" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="33" cy="32" r="6.6" fill="var(--paper)" ${k}/>
    <circle cx="33" cy="32" r="2.2" fill="var(--ink)"/></g>`, 'ico-insert');

  const drill = S('0 0 64 64', `<defs><clipPath id="dclip"><rect x="23" y="22" width="30" height="20" rx="2"/></clipPath></defs>
    <rect x="4" y="25" width="21" height="14" rx="2" fill="var(--steel-2)" ${k}/>
    <rect x="23" y="22" width="30" height="20" rx="2" fill="var(--steel)" ${k}/>
    <g clip-path="url(#dclip)"><g class="flutes" fill="var(--acc)" opacity=".85">
      <path d="M14 42 22 22h4l-8 20z"/><path d="M24 42 32 22h4l-8 20z"/><path d="M34 42 42 22h4l-8 20z"/>
      <path d="M44 42 52 22h4l-8 20z"/><path d="M54 42 62 22h4l-8 20z"/><path d="M64 42 72 22h4l-8 20z"/></g></g>
    <rect x="23" y="22" width="30" height="20" rx="2" fill="none" ${k}/>
    <path d="M53 23h5l3 4-3 3h-5z" fill="var(--acc)" ${k}/><path d="M53 34h5l3 3-3 4h-5z" fill="var(--acc)" ${k}/>`, 'ico-drill');

  const holder = S('0 0 64 64', `<rect x="4" y="31" width="38" height="12" rx="1.5" fill="var(--steel-2)" ${k}/>
    <path d="M40 31 52 21h9v22H40z" fill="var(--steel)" ${k}/>
    <g class="seat"><path d="M51 22.5 60.5 22.5 60.5 32 55 34.5Z" fill="var(--acc)" ${k}/></g>
    <circle cx="48" cy="36" r="3.2" fill="var(--paper)" ${k}/><path d="M46.4 36h3.2" ${k}/>
    <path d="M10 37h24" stroke="var(--paper)" stroke-width="2" stroke-linecap="round" opacity=".7"/>`, 'ico-holder');

  // ---------------------------------------------------------------- metal families (stock shapes)
  const bar = (extra) => `<path d="M12 20h36a10 12 0 0 1 0 24H12a10 12 0 0 1 0-24z" fill="var(--steel)" ${k}/>
    <ellipse cx="48" cy="32" rx="10" ry="12" fill="var(--steel-2)" ${k}/>
    <ellipse cx="48" cy="32" rx="6" ry="7.5" fill="none" stroke="var(--ink)" stroke-width="1.4" opacity=".55"/>
    <ellipse cx="48" cy="32" rx="2.4" ry="3" fill="var(--ink)" opacity=".55"/>${extra || ''}`;
  const metals = {
    P: S('0 0 64 64', bar('<path d="M14 26h26M14 38h26" stroke="var(--paper)" stroke-width="2" stroke-linecap="round" opacity=".8"/>'), 'ico-metal'),
    M: S('0 0 64 64', bar('<g class="shine"><path d="M16 42 26 22M22 42 32 22" stroke="var(--paper)" stroke-width="2.6" stroke-linecap="round"/></g>'), 'ico-metal'),
    K: S('0 0 64 64', `<path d="M8 26h48v24H8z" fill="var(--steel-2)" ${k}/><path d="M24 26v-8h10v8" fill="var(--steel)" ${k}/>
      <g fill="var(--ink)" opacity=".45"><circle cx="15" cy="33" r="1.3"/><circle cx="22" cy="41" r="1.1"/><circle cx="31" cy="35" r="1.4"/>
      <circle cx="40" cy="43" r="1.2"/><circle cx="47" cy="33" r="1.3"/><circle cx="51" cy="43" r="1"/><circle cx="18" cy="45" r="1"/><circle cx="36" cy="30" r="1"/></g>`, 'ico-metal'),
    N: S('0 0 64 64', `<path d="M12 12h40v12H38v16h14v12H12V40h14V24H12z" fill="var(--steel)" ${k}/>
      <path d="M17 17h30M17 47h30" stroke="var(--paper)" stroke-width="2" stroke-linecap="round" opacity=".85"/>`, 'ico-metal'),
    S: S('0 0 64 64', `<path d="M14 50c4-16 14-30 36-38 2 10-4 26-18 34-6 3-12 4-18 4z" fill="var(--steel)" ${k}/>
      <path d="M20 46c6-10 14-20 26-28" stroke="var(--paper)" stroke-width="2" stroke-linecap="round" opacity=".85" fill="none"/>
      <path d="M10 52h12" ${k}/>`, 'ico-metal'),
    H: S('0 0 64 64', `<path d="M29 6h6l1.5 6 5 2 5.5-3.5 4 4L47.5 20l2 5 6 1.5v6l-6 1.5-2 5 3.5 5.5-4 4-5.5-3.5-5 2L35 58h-6l-1.5-6-5-2-5.5 3.5-4-4L16.5 44l-2-5-6-1.5v-6l6-1.5 2-5L13 20.5l4-4 5.5 3.5 5-2z" fill="var(--steel-2)" ${k}/>
      <circle cx="32" cy="32" r="8" fill="var(--paper)" ${k}/><g class="spark" fill="var(--acc)"><path d="M32 23l1.4 3.6L37 28l-3.6 1.4L32 33l-1.4-3.6L27 28l3.6-1.4z" transform="translate(13 -13) scale(.7)"/></g>`, 'ico-metal'),
  };

  // ---------------------------------------------------------------- operations (small looping scenes)
  const stripes = (x, y, w, h, id) => `<defs><clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/></clipPath></defs>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="var(--steel)"/>
    <g clip-path="url(#${id})"><g class="rot" stroke="var(--steel-2)" stroke-width="3">
      ${Array.from({ length: 9 }, (_, i) => `<path d="M${x} ${y - 6 + i * 6}h${w}"/>`).join('')}</g></g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="none" ${k}/>`;
  const ops = {
    turning: S('0 0 96 64', `<rect x="4" y="14" width="12" height="36" rx="2" fill="var(--steel-2)" ${k}/>
      ${stripes(16, 20, 64, 24, 'tclip')}
      <g class="tool"><path d="M62 46 70 46 66 54Z" fill="var(--acc)" ${k}/><path d="M66 54v8" ${k}/>
      <path class="chip" d="M70 47c5 0 7 4 4 6s-5-1-3-3" fill="none" stroke="var(--acc)" stroke-width="2" stroke-linecap="round"/></g>`, 'ico-op op-turning'),
    milling: S('0 0 96 64', `<rect x="10" y="42" width="76" height="16" rx="1.5" fill="var(--steel-2)" ${k}/>
      <g class="traverse"><rect x="42" y="2" width="12" height="16" rx="1.5" fill="var(--steel)" ${k}/>
        <g class="cutter"><circle cx="48" cy="30" r="12" fill="var(--steel)" ${k}/>
        <path d="M48 18l3 4h-6zM60 30l-4 3v-6zM48 42l-3-4h6zM36 30l4-3v6z" fill="var(--acc)" ${k}/>
        <circle cx="48" cy="30" r="3" fill="var(--ink)"/></g></g>`, 'ico-op op-milling'),
    grooving: S('0 0 96 64', `<rect x="4" y="14" width="12" height="36" rx="2" fill="var(--steel-2)" ${k}/>
      ${stripes(16, 20, 64, 24, 'gclip')}
      <path d="M45 44v-6h6v6" fill="var(--paper)" ${k}/>
      <g class="plunge"><path d="M45 46h6v16h-6z" fill="var(--acc)" ${k}/></g>`, 'ico-op op-grooving'),
    drilling: S('0 0 96 64', `<rect x="10" y="38" width="76" height="22" rx="1.5" fill="var(--steel-2)" ${k}/>
      <path d="M43 38h10v12H43z" fill="var(--paper)" ${k}/>
      <g class="plunge-d"><defs><clipPath id="dr"><rect x="43" y="0" width="10" height="40"/></clipPath></defs>
        <rect x="43" y="0" width="10" height="40" fill="var(--steel)"/>
        <g clip-path="url(#dr)"><g class="flutes" fill="var(--acc)" opacity=".85">
          ${Array.from({ length: 8 }, (_, i) => `<path d="M43 ${i * 7 - 6}l10 5v3l-10-5z"/>`).join('')}</g></g>
        <path d="M43 0h10v40l-5 5-5-5z" fill="none" ${k}/></g>`, 'ico-op op-drilling'),
  };

  // ---------------------------------------------------------------- duty: the surface it leaves
  // A machined surface seen edge-on: the metal below, the profile the cut leaves on top.
  const profile = (step, lo, hi) => {
    let d = `M0 ${hi}`;
    for (let x = step; x <= 240; x += step) d += ` ${x} ${(x / step) % 2 ? lo : hi}`;
    return d;
  };
  const surface = (d, extra) => `<svg viewBox="0 0 240 40" preserveAspectRatio="none" class="ico ico-duty" aria-hidden="true" focusable="false">
    <path d="${d} L240 40 0 40Z" fill="var(--steel)"/>
    <path class="draw" d="${d}" fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${extra || ''}</svg>`;
  const duty = {
    roughing: surface(profile(16, 6, 30)),
    medium: surface(profile(8, 13, 25)),
    finishing: surface(profile(4, 18, 21), '<path class="sheen" d="M0 17H240" stroke="var(--acc)" stroke-width="2" vector-effect="non-scaling-stroke" opacity=".0"/>'),
  };

  // ---------------------------------------------------------------- what needs fixing (small)
  const s = (body) => S('0 0 32 32', body, 'ico-issue');
  const edge = 'M3 26 16 5 29 26Z';
  const issues = {
    chipping: s(`<path d="${edge}" fill="var(--steel)" ${k}/><path d="M13 9.6 16 14 19 9.6 16 5Z" fill="var(--paper)" stroke="var(--crit)" stroke-width="2" stroke-linejoin="round"/>`),
    wear: s(`<path d="${edge}" fill="var(--steel)" ${k}/><path d="M6 21h20l2.4 4H3.6z" fill="var(--warn)" stroke="none"/><path d="${edge}" fill="none" ${k}/>`),
    finish: s(`<path d="M2 20c3-6 5-6 7 0s4 6 7 0 5-6 7 0 4 6 7 0" fill="none" ${k}/><path d="M2 27h28" stroke="var(--steel-2)" stroke-width="2.2" stroke-linecap="round"/>`),
    chatter: s(`<path d="M2 16l3-6 3 12 3-12 3 12 3-12 3 12 3-12 3 12 3-6" fill="none" ${k}/>`),
    chips: s(`<path d="M16 16c0-2 3-2 3 0s-2 5-6 5-7-4-7-8 5-9 10-9 11 5 11 11-6 12-13 12" fill="none" ${k}/>`),
    bue: s(`<path d="${edge}" fill="var(--steel)" ${k}/><circle cx="16" cy="8.5" r="4" fill="var(--warn)" stroke="var(--ink)" stroke-width="1.8"/>`),
    none: s(`<path d="M16 4l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" fill="var(--acc)" ${k}/>`),
  };

  // ---------------------------------------------------------------- bits of chrome
  const back = '<svg viewBox="0 0 24 24" class="ico-ui" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const tick = '<svg viewBox="0 0 64 64" class="ico-tick" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="var(--acc)"/><path class="draw" d="M19 33l9 9 17-19" fill="none" stroke="var(--paper)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const tip = '<svg viewBox="0 0 20 20" class="ico-tip" aria-hidden="true"><path d="M2 10 10 2 18 10 10 18Z" fill="var(--acc)" stroke="var(--ink)" stroke-width="1.6" stroke-linejoin="round"/><circle cx="10" cy="10" r="2.6" fill="var(--paper)"/></svg>';
  const camera = '<svg viewBox="0 0 24 24" class="ico-ui" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

  // ---- insert shapes, seen from the top. Negative: double-sided, a chipbreaker line inside the
  // edge and a straight hole. Positive: the flank shows (clearance angle) and the hole is
  // countersunk for a screw. --turn is the indexing turn played when the tile is picked.
  const P = (pts) => `M${pts.map((p) => p.join(' ')).join('L')}Z`;
  const inner = (d) => `<path d="${d}" transform="translate(32 32) scale(.78) translate(-32 -32)" fill="none" stroke="var(--steel-2)" stroke-width="1.6" stroke-linejoin="round"/>`;
  const holeN = (r = 5) => `<circle cx="32" cy="32" r="${r}" fill="var(--paper)" ${k}/>`;
  const holeP = (r = 6) => `<circle cx="32" cy="32" r="${r}" fill="var(--steel-2)" ${k}/><circle cx="32" cy="32" r="${(r * 0.55).toFixed(1)}" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.6"/>`;
  const shape = (d, neg, turn, hole = true, r) => S('0 0 64 64', `<g class="ins">
    ${neg ? '' : `<path d="${d}" transform="translate(1.6 2.4)" fill="var(--steel-2)" ${k}/>`}
    <path d="${d}" fill="var(--steel)" ${k}/>${neg ? inner(d) : ''}${hole ? (neg ? holeN(r) : holeP(r)) : ''}</g>`, 'ico-ins').replace('<svg ', `<svg style="--turn:${turn}deg" `);
  const C80 = P([[6, 32], [32, 10.5], [58, 32], [32, 53.5]]);
  const D55 = P([[5, 32], [32, 18], [59, 32], [32, 46]]);
  const V35 = P([[4, 32], [32, 23.5], [60, 32], [32, 40.5]]);
  const TRI = P([[32, 8], [54.5, 47], [9.5, 47]]);
  const TRIGON = P([[32, 7], [46.7, 24.5], [54.5, 46], [32, 50], [9.5, 46], [17.3, 24.5]]);
  const SQ = 'M14 12h36a2 2 0 0 1 2 2v36a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V14a2 2 0 0 1 2-2z';
  const SQ45 = P([[18, 12], [46, 12], [52, 18], [52, 46], [46, 52], [18, 52], [12, 46], [12, 18]]);
  const RND = 'M32 10a22 22 0 1 1 0 44a22 22 0 1 1 0-44z';
  const APM = P([[10, 24], [48, 14], [55, 40], [17, 50]]);
  const XO = P([[9, 30], [22, 15], [52, 19], [55, 34], [42, 49], [12, 45]]);
  const TDC = P([[4, 21], [13, 25], [51, 25], [60, 21], [60, 43], [51, 39], [13, 39], [4, 43]]);
  const MGMN = P([[8, 20], [26, 27], [38, 27], [56, 20], [56, 44], [38, 37], [26, 37], [8, 44]]);
  const unsure = S('0 0 64 64', `<g class="ins"><path d="${C80}" fill="none" stroke="var(--steel-2)" stroke-width="2.2" stroke-dasharray="4 4" stroke-linejoin="round"/>
    <text x="32" y="40" text-anchor="middle" font-size="24" font-weight="700" fill="var(--ink-2)" font-family="system-ui,sans-serif">?</text></g>`, 'ico-ins');
  const inserts = {
    CNMG: shape(C80, true, 180), CCMT: shape(C80, false, 180),
    DNMG: shape(D55, true, 180), DCMT: shape(D55, false, 180),
    VNMG: shape(V35, true, 180, true, 3), VCMT: shape(V35, false, 180, true, 3.6), VCGT: shape(V35, false, 180, true, 3.6),
    TNMG: shape(TRI, true, 120, true, 4.5), TCMT: shape(TRI, false, 120, true, 5),
    WNMG: shape(TRIGON, true, 120), SNMG: shape(SQ, true, 90), RCMT: shape(RND, false, 45),
    APMT: shape(APM, false, 180, true, 5), APKT: shape(APM, false, 180, true, 5),
    SEKT: shape(SQ45, false, 90), SNMX: shape(SQ, true, 90), RPMT: shape(RND, false, 45),
    TDC: shape(TDC, true, 180, false), MGMN: shape(MGMN, true, 180, false),
    SPMG: shape(SQ, false, 90, true, 5.5), WCMX: shape(TRIGON, false, 120, true, 5.5), XOMX: shape(XO, false, 180, true, 5),
    unsure,
  };

  return { insert, drill, holder, metals, ops, duty, issues, back, tick, tip, camera, inserts };
}());
