// FC-00042: edit state per box, and a row re-read that changes nothing until the owner picks
// Current or Re-read under each box and presses Apply.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, resetToSingleEntity } = require('./load-app');

const WEEK = ['Aug 9 2026', 'Aug 10 2026', 'Aug 11 2026', 'Aug 12 2026', 'Aug 13 2026', 'Aug 14 2026', 'Aug 15 2026'];

function setup() {
  const api = loadApp();
  api.__sandbox.alert = () => {};
  api.__sandbox.confirm = () => true;
  const ent = resetToSingleEntity(api, {
    id: 0, name: 'Box Co', employees: [{ name: 'Ann', shifts: ['', '9AM - 5PM', '', '', '', '', ''] }],
    dateLabels: WEEK, breakMinutes: 0, breakMinutesSet: true,
  });
  api._syncEntityCode(ent);
  api.ensureIntakeState(ent);
  ent.intake.activeEmpTab = 'Ann';
  api._prefSet('pv26_api_key', 'FAKEKEY');
  ent.intake._ocrJobs = [{ id: 'job_1', name: 'card.jpg', kind: 'TC', file: { name: 'card.jpg', type: 'image/jpeg' }, status: 'done' }];
  return { api, ent };
}
const ocr = (api, ent, o, src = 'TC') => {
  const r = api.processReviewRow(Object.assign({ empName: 'Ann', date: '2026-08-10', confidence: 0.95, source: src, originalName: 'card.jpg', imageJobId: 'job_1' }, o), ent);
  ent.intake.reviewRows.push(r);
  return r;
};
const time = (api, r, k, v) => api.commitTimeInput({ value: v }, r.id, k);
function fakeGemini(api, reply) {
  api.__sandbox.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }) });
}
const el = (o) => Object.assign({ empName: 'Ann', date: '2026-08-10', clockIn1: '', clockOut1: '', confidence: 0.97, notes: '' }, o);
const hoursFor = (api, name) => { api.syncActualsFromReview(); return api._collectExportData()[0].rows.find(r => r._empName === name).actualHours; };

test('test_each_box_tracks_its_own_edit', () => {
  const { api, ent } = setup();
  const r = ocr(api, ent, { clockIn1: '09:00', clockOut1: '17:00' });
  time(api, r, 'clockOut1', '5:30 PM');
  api.updateReviewField(r.id, 'date', '2026-08-11');
  assert.deepEqual(api.editedBoxes(r), ['date', 'clockOut1']);
  assert.equal(r.source, 'MN', 'any edited box makes the row a manual entry');
  const html = api.renderReviewTableHtml(ent, 0);
  assert.equal((html.match(/box-edited/g) || []).length, 2);
  assert.match(html, /title="Edited — OCR read 5:00 PM"/);
  assert.match(html, /title="Edited — OCR read 2026-08-10"/);
});

test('test_box_reset_clears_only_that_box', () => {
  const { api, ent } = setup();
  const r = ocr(api, ent, { clockIn1: '09:00', clockOut1: '17:00' });
  time(api, r, 'clockIn1', '8:45 AM');
  time(api, r, 'clockOut1', '5:30 PM');
  time(api, r, 'clockOut1', '5:00 PM'); // back to what OCR read
  assert.deepEqual(api.editedBoxes(r), ['clockIn1']);
  assert.equal(r.source, 'MN');
  time(api, r, 'clockIn1', '9:00 AM');
  assert.deepEqual(api.editedBoxes(r), []);
  assert.equal(r.source, 'TC');
});

test('test_pair_manual_if_either_box_edited', () => {
  const { api, ent } = setup();
  // One OCR row with two pairs; only pair 2's Out is edited.
  const r = ocr(api, ent, { clockIn1: '09:00', clockOut1: '12:00', clockIn2: '13:00', clockOut2: '16:00' });
  time(api, r, 'clockOut2', '5:00 PM');
  assert.equal(api._isManualPair(r, 1), false);
  assert.equal(api._isManualPair(r, 2), true);
  // Another OCR reading of the same day overlapping each pair.
  const p1dup = ocr(api, ent, { clockIn1: '09:00', clockOut1: '12:00' }, 'EC');
  const p2dup = ocr(api, ent, { clockIn1: '13:00', clockOut1: '16:00' }, 'EC');
  [r, p1dup, p2dup].forEach(x => api.approveReviewRow(x.id));
  api.syncActualsFromReview();
  assert.equal(p2dup._superseded, true, 'the edited pair replaces the OCR pair it overlaps');
  assert.ok(!p1dup._superseded, 'the unedited pair is still an OCR reading: it does not replace anything');
  // A hand-typed row is manual throughout.
  api.addManualRow(0);
  const m = ent.intake.reviewRows.at(-1);
  assert.equal(api._isManualPair(m, 1), true);
});

test('test_fc00029_pay_results_unchanged', () => {
  const { api, ent } = setup();
  // FC-00029 case: OCR misread fixed by the reviewer; an EasyClocking row overlaps it.
  const tc = ocr(api, ent, { clockIn1: '09:00', clockOut1: '07:00' });
  const ec = ocr(api, ent, { clockIn1: '09:02', clockOut1: '17:01' }, 'EC');
  time(api, tc, 'clockOut1', '5:00 PM');
  [tc, ec].forEach(x => api.approveReviewRow(x.id));
  assert.equal(hoursFor(api, 'Ann'), 8, 'manual pair replaces the overlapping OCR pair; no double count');
  assert.equal(ec._superseded, true);
  // Both In and Out edited: still one manual pair.
  time(api, tc, 'clockIn1', '8:30 AM');
  api.approveReviewRow(tc.id);
  assert.equal(hoursFor(api, 'Ann'), 8.5);
});

test('test_reread_changes_nothing_until_apply', async () => {
  const { api, ent } = setup();
  const r = ocr(api, ent, { clockIn1: '09:00', clockOut1: '07:00' });
  api.approveReviewRow(r.id);
  const before = JSON.stringify([r.clockIn1, r.clockOut1, r.date, r.empName, r._ocr]);
  fakeGemini(api, [el({ clockIn1: '09:00', clockOut1: '17:00' })]);
  await api.rerunOcrForRow(0, r.id);
  assert.equal(JSON.stringify([r.clockIn1, r.clockOut1, r.date, r.empName, r._ocr]), before);
  assert.equal(r._reread.values.clockOut1, '17:00');
  assert.deepEqual(Object.values(r._reread.choice), ['current', 'current', 'current', 'current', 'current', 'current', 'current']);
  const html = api.renderReviewTableHtml(ent, 0);
  assert.match(html, /class="reread-row"/);
  assert.match(html, /rr-val rr-diff">5:00 PM/);
  assert.equal(api.getCheckpoints().length, 0, 'a re-read alone is not a big action');
  api.discardReread(r.id);
  assert.equal(r._reread, undefined);
  assert.equal(r.approved, true, 'Discard puts the approval back');
  assert.equal(r.clockOut1, '07:00');
});

test('test_reread_toggle_per_box', async () => {
  const { api, ent } = setup();
  const r = ocr(api, ent, { clockIn1: '09:10', clockOut1: '17:00' });
  time(api, r, 'clockOut1', '5:30 PM'); // owner's edit
  fakeGemini(api, [el({ clockIn1: '09:00', clockOut1: '17:05' })]);
  await api.rerunOcrForRow(0, r.id);
  api.setRereadChoice(r.id, 'clockIn1', 'reread');
  api.applyReread(r.id);
  assert.equal(r.clockIn1, '09:00', 'Re-read chosen');
  assert.equal(r.clockOut1, '17:30', 'Current kept: the edit stays');
  assert.deepEqual(api.editedBoxes(r), ['clockOut1']);
  assert.match(api.getCheckpoints().at(-1).label, /^Re-read apply · Ann 2026-08-10/);
  // Use all re-read / Keep all current
  fakeGemini(api, [el({ clockIn1: '08:58', clockOut1: '17:04' })]);
  await api.rerunOcrForRow(0, r.id);
  api.rereadChooseAll(r.id, 'reread');
  assert.ok(Object.values(r._reread.choice).every(c => c === 'reread'));
  api.rereadChooseAll(r.id, 'current');
  assert.ok(Object.values(r._reread.choice).every(c => c === 'current'));
});

test('test_choose_reread_becomes_new_ocr_baseline', async () => {
  const { api, ent } = setup();
  const r = ocr(api, ent, { clockIn1: '09:00', clockOut1: '07:00' });
  time(api, r, 'clockOut1', '5:20 PM');
  fakeGemini(api, [el({ clockIn1: '09:00', clockOut1: '17:15' })]);
  await api.rerunOcrForRow(0, r.id);
  api.setRereadChoice(r.id, 'clockOut1', 'reread');
  api.applyReread(r.id);
  assert.equal(r.clockOut1, '17:15');
  assert.equal(r._ocr.clockOut1, '17:15', 'the re-read is now what OCR read for that box');
  assert.deepEqual(api.editedBoxes(r), []);
  assert.equal(r.source, 'TC');
  const line = api.session.log.at(-1);
  assert.equal(line.type, 'reviewReread');
  assert.deepEqual(line.meta.fields, ['clockOut1']);
  const hist = api.historyRows()[0];
  assert.equal(hist.kind, 'Re-read applied');
  assert.equal(hist.to, 'Out 1 5:15 PM');
  api.revertFromHistory(line.id);
  assert.equal(r.clockOut1, '17:20', 'revert puts the value back');
  assert.equal(r._ocr.clockOut1, '07:00', 'and the old OCR reading, so the box is an edit again');
  assert.deepEqual(api.editedBoxes(r), ['clockOut1']);
});

test('test_pending_comparison_unapproves_row', async () => {
  const { api, ent } = setup();
  const r = ocr(api, ent, { clockIn1: '09:00', clockOut1: '17:00' });
  api.approveReviewRow(r.id);
  fakeGemini(api, [el({ clockIn1: '09:00', clockOut1: '17:05' })]);
  await api.rerunOcrForRow(0, r.id);
  assert.equal(r.approved, false);
  assert.ok(r.flags.includes('Re-read waiting — choose values, then Apply'));
  api.approveReviewRow(r.id);
  assert.equal(r.approved, false, 'cannot approve while a re-read waits');
  api.approveAll(0);
  assert.equal(r.approved, false, 'bulk approve skips it too');
  // The waiting comparison is part of the snapshot.
  api.__sandbox.crypto = require('node:crypto').webcrypto;
  ent.intake._ocrJobs[0].file = Object.assign(new api.__sandbox.Blob(), { name: 'card.jpg', type: 'image/jpeg', size: 1, arrayBuffer: async () => new Uint8Array([1]).buffer });
  const snap = JSON.parse(JSON.stringify(await api.buildSnapshot()));
  const B = loadApp(); B.__sandbox.confirm = () => true;
  B.openSnapshotData(snap);
  const rb = B.findReviewRow(r.id).row;
  assert.equal(rb._reread.values.clockOut1, '17:05');
  assert.match(B.renderReviewTableHtml(B.entities[0], 0), /class="reread-row"/);
  // Apply with nothing changed returns the row to its earlier approval.
  api.applyReread(r.id);
  assert.equal(r.approved, true);
  assert.equal(r.empName, 'Ann', 'employee never changed by a re-read');
});
