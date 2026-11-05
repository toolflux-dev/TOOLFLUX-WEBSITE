#!/usr/bin/env node
/* Direct client for Fusion's own MCP server (http://127.0.0.1:27182/mcp).
 *
 * Claude Code connects to MCP servers only when a session starts. If Fusion was not up yet,
 * that session has no Fusion tools for its whole life. This client needs no session setup:
 * it works whenever Fusion is running, so modelling never waits on a restart.
 *
 *   node fusion/fx.js <script.py> [--ro]     run a Fusion Python script (def run(_context): ...)
 *   node fusion/fx.js --ping                 is Fusion answering?
 *
 * --ro marks the script read-only (allowed while a Fusion command dialog is open).
 * Prints the script's output; exits 1 on failure. */
'use strict';
const fs = require('fs');
const URL = process.env.FUSION_MCP_URL || 'http://127.0.0.1:27182/mcp';
const H = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

async function rpc(headers, body) {
  const r = await fetch(URL, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10 * 60 * 1000) });
  const text = await r.text();
  // Fusion answers plain JSON; tolerate an SSE frame just in case
  const json = text.startsWith('{') ? text : (text.split('\n').find(l => l.startsWith('data:')) || '').slice(5);
  return { headers: r.headers, body: json ? JSON.parse(json) : null };
}

async function session() {
  const init = await rpc(H, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dts-fx', version: '1' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = Object.assign({}, H, sid ? { 'Mcp-Session-Id': sid } : {});
  await fetch(URL, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }).then(r => r.text());
  return { h, server: init.body && init.body.result && init.body.result.serverInfo };
}

async function main() {
  const args = process.argv.slice(2);
  let s;
  try { s = await session(); }
  catch (e) { console.error('Fusion is not answering on ' + URL + '. Start Fusion (Preferences > General > API > Fusion MCP Server must be ticked). ' + e.message); process.exit(1); }
  if (args[0] === '--ping') { console.log('Fusion answering: ' + JSON.stringify(s.server)); return; }
  if (!args[0]) { console.error('usage: node fusion/fx.js <script.py> [--ro] | --ping'); process.exit(2); }
  const script = fs.readFileSync(args[0], 'utf8');
  const res = await rpc(s.h, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fusion_mcp_execute',
    arguments: { featureType: 'script', object: { script, readOnly: args.includes('--ro') } } } });
  const r = res.body && res.body.result;
  const text = r && Array.isArray(r.content) ? r.content.map(c => c.text || '').join('\n') : JSON.stringify(res.body);
  let out = text;
  try { const j = JSON.parse(text); out = j.success ? j.message : (j.error || text); if (!j.success) { console.error(out); process.exit(1); } } catch (e) { /* not JSON: print as is */ }
  if (r && r.isError) { console.error(out); process.exit(1); }
  process.stdout.write(out.endsWith('\n') ? out : out + '\n');
}
main().catch(e => { console.error(e.message); process.exit(1); });
