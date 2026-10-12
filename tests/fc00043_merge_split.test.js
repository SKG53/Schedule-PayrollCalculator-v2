// FC-00043: merge and split review rows by hand. Values never change; pairs are regrouped,
// edit flags travel with their boxes, every source image stays linked, and with a zero break
// payroll hours are identical before and after.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, resetToSingleEntity } = require('./load-app');

const WEEK = ['Aug 9 2026', 'Aug 10 2026', 'Aug 11 2026', 'Aug 12 2026', 'Aug 13 2026', 'Aug 14 2026', 'Aug 15 2026'];

function setup(breakMinutes = 0) {
  const api = loadApp();
  api.__sandbox.alert = () => {};
  api.__sandbox.confirm = () => true;
  const ent = resetToSingleEntity(api, {
    id: 0, name: 'Merge Co', dateLabels: WEEK, breakMinutes, breakMinutesSet: true,
    employees: [{ name: 'Ann', shifts: ['', '9AM - 5PM', '9AM - 5PM', '', '', '', ''] }, { name: 'Bo', shifts: ['', '9AM - 5PM', '', '', '', '', ''] }],
  });
  api._syncEntityCode(ent);
  api.ensureIntakeState(ent);
  ent.intake.activeEmpTab = 'Ann';
  ent.intake._ocrJobs = [
    { id: 'job_1', name: 'card1.jpg', kind: 'TC', file: { name: 'card1.jpg', type: 'image/jpeg' }, status: 'done' },
    { id: 'job_2', name: 'card2.jpg', kind: 'EC', file: { name: 'card2.jpg', type: 'image/jpeg' }, status: 'done' },
  ];
  api.dispatch({ type: 'wage', screen: 'payroll', target: { kind: 'employee', entity: 0, id: api.wKey(0, 'Ann'), field: 'wage' }, from: null, to: 20, meta: { empName: 'Ann' } });
  return { api, ent };
}
const row = (api, ent, o, job = 'job_1') => {
  const src = job === 'job_2' ? 'EC' : 'TC';
  const r = api.processReviewRow(Object.assign({ empName: 'Ann', date: '2026-08-10', confidence: 0.95, source: src, originalName: job === 'job_2' ? 'card2.jpg' : 'card1.jpg', imageJobId: job }, o), ent);
  ent.intake.reviewRows.push(r);
  return r;
};
const times = (r) => [1, 2, 3].map(n => [r['clockIn' + n], r['clockOut' + n]]).filter(p => p[0] || p[1]);
const annHours = (api) => { api.syncActualsFromReview(); return api._collectExportData()[0].rows.find(x => x._empName === 'Ann').actualHours; };

test('test_merge_same_date_rows', () => {
  const { api, ent } = setup();
  const a = row(api, ent, { clockIn1: '09:00', clockOut1: '12:00' });
  const b = row(api, ent, { clockIn1: '12:30', clockOut1: '17:00' }, 'job_2');
  const plan = api.mergePlan(0, [b.id, a.id]);
  assert.equal(plan.ok, true);
  assert.equal(plan.filingDate, '2026-08-10');
  assert.deepEqual(plan.gapsMin, [30]);
  assert.deepEqual([plan.hoursBefore, plan.hoursAfter], [7.5, 7.5]);
  const m = api.mergeRows(0, [b.id, a.id]);
  assert.equal(ent.intake.reviewRows.length, 1);
  assert.deepEqual(times(m), [['09:00', '12:00'], ['12:30', '17:00']], 'pairs in time order, values unchanged');
  assert.equal(m.date, '2026-08-10');
  assert.equal(m.approved, false);
  assert.equal(m._merged, true);
  assert.match(api.renderReviewTableHtml(ent, 0), /⧉ merged/);
});

test('test_merge_back_to_back_dates_filed_under_clock_in', () => {
  const { api, ent } = setup();
  const late = row(api, ent, { date: '2026-08-11', clockIn1: '00:30', clockOut1: '06:00' });
  const night = row(api, ent, { date: '2026-08-10', clockIn1: '22:00', clockOut1: '23:45' });
  const plan = api.mergePlan(0, [late.id, night.id]);
  assert.equal(plan.ok, true);
  assert.equal(plan.filingDate, '2026-08-10', 'filed under the earliest clock-in');
  assert.deepEqual(plan.gapsMin, [45]);
  assert.deepEqual([plan.hoursBefore, plan.hoursAfter], [7.25, 7.25]);
  const m = api.mergeRows(0, [late.id, night.id]);
  assert.deepEqual(times(m), [['22:00', '23:45'], ['00:30', '06:00']]);
  // Two days apart is refused.
  const { api: api2, ent: ent2 } = setup();
  const x = row(api2, ent2, { date: '2026-08-10', clockIn1: '09:00', clockOut1: '12:00' });
  const y = row(api2, ent2, { date: '2026-08-12', clockIn1: '09:00', clockOut1: '12:00' });
  assert.match(api2.mergePlan(0, [x.id, y.id]).error, /same date or on back-to-back dates/);
});

test('test_merge_refused_over_three_pairs', () => {
  const { api, ent } = setup();
  const a = row(api, ent, { clockIn1: '08:00', clockOut1: '10:00', clockIn2: '10:30', clockOut2: '12:00' });
  const b = row(api, ent, { clockIn1: '13:00', clockOut1: '15:00', clockIn2: '15:30', clockOut2: '17:00' });
  const plan = api.mergePlan(0, [a.id, b.id]);
  assert.equal(plan.ok, false);
  assert.match(plan.error, /at most 3 in\/out pairs; these rows have 4/);
  assert.equal(api.mergeRows(0, [a.id, b.id]), null);
  assert.equal(ent.intake.reviewRows.length, 2, 'nothing changed');
  assert.equal(api.getCheckpoints().length, 0);
});

test('test_merge_refused_for_different_employees', () => {
  const { api, ent } = setup();
  const a = row(api, ent, { clockIn1: '09:00', clockOut1: '12:00' });
  const b = row(api, ent, { empName: 'Bo', clockIn1: '13:00', clockOut1: '17:00' });
  assert.match(api.mergePlan(0, [a.id, b.id]).error, /same employee/);
  assert.match(api.mergePlan(0, [a.id]).error, /two or more/);
  // The bar says why the button is off.
  api.toggleRowSelect(0, a.id, true);
  api.toggleRowSelect(0, b.id, true);
  ent.intake.activeEmpTab = 'Ann';
  const html = api.renderReviewTableHtml(ent, 0);
  assert.match(html, /disabled title="Only rows for the same employee can be merged\."/);
});

test('test_split_one_row_per_pair', () => {
  const { api, ent } = setup();
  const before = row(api, ent, { date: '2026-08-11', clockIn1: '09:00', clockOut1: '17:00' });
  const r = row(api, ent, { clockIn1: '08:00', clockOut1: '10:00', clockIn2: '10:30', clockOut2: '12:00', clockIn3: '13:00', clockOut3: '17:00' });
  const after = row(api, ent, { date: '2026-08-12', clockIn1: '09:00', clockOut1: '17:00' });
  api.approveReviewRow(r.id);
  const pieces = api.splitRow(0, r.id);
  assert.equal(pieces.length, 3);
  assert.deepEqual(ent.intake.reviewRows.map(x => x.id), [before.id, ...pieces.map(p => p.id), after.id], 'pieces sit where the row was');
  assert.deepEqual(pieces.map(times), [[['08:00', '10:00']], [['10:30', '12:00']], [['13:00', '17:00']]]);
  assert.ok(pieces.every(p => p.date === '2026-08-10' && p._split && p.approved === false));
  assert.match(api.renderReviewTableHtml(ent, 0), /⇹ split/);
  assert.equal(api.splitRow(0, pieces[0].id), null, 'a one-pair row cannot be split');
});

test('test_edit_flags_travel_with_boxes', () => {
  const { api, ent } = setup();
  const pm = row(api, ent, { clockIn1: '13:00', clockOut1: '17:00' });
  const am = row(api, ent, { clockIn1: '09:00', clockOut1: '12:00' });
  api.commitTimeInput({ value: '5:30 PM' }, pm.id, 'clockOut1');
  assert.deepEqual(api.editedBoxes(pm), ['clockOut1']);
  const m = api.mergeRows(0, [pm.id, am.id]);
  assert.deepEqual(times(m), [['09:00', '12:00'], ['13:00', '17:30']]);
  assert.deepEqual(api.editedBoxes(m), ['clockOut2'], 'the edited box moved to pair 2 and is still edited');
  assert.equal(m._ocr.clockOut2, '17:00', 'with its OCR reading');
  assert.equal(m.source, 'MN');
  assert.equal(api._isManualPair(m, 1), false);
  assert.equal(api._isManualPair(m, 2), true);
  const [p1, p2] = api.splitRow(0, m.id);
  assert.deepEqual(api.editedBoxes(p1), []);
  assert.deepEqual(api.editedBoxes(p2), ['clockOut1']);
  assert.equal(p1.source, 'TC');
  // A hand-typed row's boxes count as edits wherever they land.
  api.addManualRow(0);
  const hand = ent.intake.reviewRows.at(-1);
  api.updateReviewField(hand.id, 'empName', 'Ann');
  api.updateReviewField(hand.id, 'date', '2026-08-10');
  api.commitTimeInput({ value: '6:00 PM' }, hand.id, 'clockIn1');
  api.commitTimeInput({ value: '7:00 PM' }, hand.id, 'clockOut1');
  const m2 = api.mergeRows(0, [p1.id, hand.id]);
  assert.deepEqual(api.editedBoxes(m2), ['clockIn2', 'clockOut2']);
});

test('test_merged_row_keeps_all_images', async () => {
  const { api, ent } = setup();
  const a = row(api, ent, { clockIn1: '09:00', clockOut1: '12:00' }, 'job_1');
  const b = row(api, ent, { clockIn1: '12:30', clockOut1: '17:00' }, 'job_2');
  const m = api.mergeRows(0, [a.id, b.id]);
  assert.deepEqual(m._imageJobIds, ['job_1', 'job_2']);
  assert.deepEqual(m._originalNames, ['card1.jpg', 'card2.jpg']);
  const html = api.renderReviewTableHtml(ent, 0);
  assert.equal((html.match(/class="tc-thumb"/g) || []).length, 2, 'both thumbnails shown');
  // Re-running one of its images must not drop the merged row (it holds the other image's punches).
  api._prefSet('pv26_api_key', 'FAKEKEY');
  api.__sandbox.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '[]' }] } }] }) });
  await api.rerunOcrForImage(0, 'job_1', 1);
  assert.ok(api.findReviewRow(m.id), 'merged row kept');
});

test('test_hours_unchanged_with_zero_break', () => {
  const { api, ent } = setup(0);
  const rows = [
    row(api, ent, { clockIn1: '08:58', clockOut1: '12:03' }),
    row(api, ent, { clockIn1: '12:41', clockOut1: '17:19' }, 'job_2'),
    row(api, ent, { date: '2026-08-11', clockIn1: '21:10', clockOut1: '23:55' }),
    row(api, ent, { date: '2026-08-12', clockIn1: '00:20', clockOut1: '04:05' }),
  ];
  rows.forEach(r => api.approveReviewRow(r.id));
  const before = annHours(api);
  const m1 = api.mergeRows(0, [rows[0].id, rows[1].id]);
  const m2 = api.mergeRows(0, [rows[2].id, rows[3].id]);
  [m1, m2].forEach(r => api.approveReviewRow(r.id));
  assert.equal(annHours(api), before, 'merge');
  const pieces = api.splitRow(0, m1.id).concat(api.splitRow(0, m2.id));
  pieces.forEach(r => api.approveReviewRow(r.id));
  assert.equal(annHours(api), before, 'split');
  // With a break minimum the preview says the hours move (it applies once per day).
  const { api: b, ent: e } = setup(30);
  const x = row(b, e, { date: '2026-08-10', clockIn1: '21:00', clockOut1: '23:00' });
  const y = row(b, e, { date: '2026-08-11', clockIn1: '00:00', clockOut1: '04:00' });
  const plan = b.mergePlan(0, [x.id, y.id]);
  // Before: 2h − 0.5 + 4h − 0.5 = 5. After: one day, 7h span − 1h actual gap (> 0.5 minimum) = 6.
  assert.deepEqual([plan.hoursBefore, plan.hoursAfter], [5, 6]);
});

test('test_merge_and_split_undoable', () => {
  const { api, ent } = setup();
  const a = row(api, ent, { clockIn1: '09:00', clockOut1: '12:00' });
  const b = row(api, ent, { clockIn1: '12:30', clockOut1: '17:00' }, 'job_2');
  const c = row(api, ent, { clockIn1: '18:00', clockOut1: '19:00', clockIn2: '19:30', clockOut2: '20:00' });
  api._rerenderAll();
  const sig0 = api._stateSig(api._captureState());
  const ids0 = ent.intake.reviewRows.map(r => r.id);
  // Through the preview dialog.
  api.toggleRowSelect(0, a.id, true);
  api.toggleRowSelect(0, b.id, true);
  api.openMergePreview(0);
  assert.match(api.__sandbox.document.getElementById('mergeBody').innerHTML, /2 rows → 1 row filed under <b>2026-08-10<\/b>/);
  const m = api.confirmMerge();
  assert.match(api.getCheckpoints().at(-1).label, /^Merge rows · Ann 2026-08-10/);
  api.splitRow(0, c.id);
  assert.match(api.getCheckpoints().at(-1).label, /^Split row · Ann 2026-08-10/);
  const kinds = api.historyRows().map(h => h.kind);
  assert.deepEqual(kinds.slice(0, 2), ['Row split', 'Rows merged']);
  // History revert of the merge alone (the later split stays).
  const mergeLine = api.session.log.find(e => e.type === 'reviewMerge');
  api.revertFromHistory(mergeLine.id);
  assert.ok(!api.findReviewRow(m.id));
  assert.deepEqual(ent.intake.reviewRows.slice(0, 2).map(r => r.id), [a.id, b.id], 'sources back in place');
  assert.equal(ent.intake.reviewRows.length, 4, 'split pieces untouched');
  // Undo the split checkpoint, then the merge checkpoint: back to the start exactly.
  api.undoCheckpoint();
  api.undoCheckpoint();
  // Undo restores fresh copies of the entities: look them up again.
  assert.deepEqual(api.entities[0].intake.reviewRows.map(r => r.id), ids0);
  assert.equal(api._stateSig(api._captureState()), sig0);
});
