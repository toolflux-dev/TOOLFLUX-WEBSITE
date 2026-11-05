const test = require('node:test');
const assert = require('node:assert');
const o = require('../dts-order.js');

test('file kinds and the drawing rule', () => {
  assert.equal(o.kind('A.PDF'), 'pdf');
  assert.equal(o.kind('photo.HEIC'), 'image');
  assert.equal(o.kind('part.dwg'), 'cad');
  assert.equal(o.kind('virus.exe'), 'other');
  assert.equal(o.checkFiles([]), 'Attach the drawing: a PDF or a photo of it.');
  assert.match(o.checkFiles([{ name: 'a.dxf', size: 10 }]), /PDF or photo/);
  assert.equal(o.checkFiles([{ name: 'a.pdf', size: 10 }, { name: 'a.dxf', size: 10 }]), '');
  assert.match(o.checkFiles([{ name: 'a.pdf', size: 11 * 1048576 }]), /over 10 MB/);
  assert.equal(o.checkFiles([{ name: 'big.jpg', size: 11 * 1048576 }]), '', 'big photos are resized, not refused');
  assert.match(o.checkFiles([1, 2, 3, 4].map(i => ({ name: i + '.pdf', size: 1 }))), /at most 3/);
});

test('field checks', () => {
  assert.equal(o.checkField('email', 'a@b.in'), '');
  assert.match(o.checkField('email', 'a@b'), /incomplete/);
  assert.equal(o.checkField('phone', '+91 98450 12345'), '');
  assert.match(o.checkField('phone', '12345'), /10-digit/);
  assert.match(o.checkField('part', ' '), /part name/);
  assert.equal(o.needsShrink('IMG_1.HEIC', 900000), true);
  assert.equal(o.needsShrink('scan.pdf', 9e6), false);
  assert.equal(o.fmtSize(2048), '2 KB');
  assert.equal(o.fmtSize(3.5 * 1048576), '3.5 MB');
});
