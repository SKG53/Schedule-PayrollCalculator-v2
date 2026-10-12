// Fixes from the independent review of series 3 (FC-00037 to FC-00043). One test per finding.
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { loadApp, resetToSingleEntity } = require('./load-app');

const WEEK = ['Aug 9 2026', 'Aug 10 2026', 'Aug 11 2026', 'Aug 12 2026', 'Aug 13 2026', 'Aug 14 2026', 'Aug 15 2026'];
const W0 = ['Aug 2 2026', 'Aug 3 2026', 'Aug 4 2026', 'Aug 5 2026', 'Aug 6 2026', 'Aug 7 2026', 'Aug 8 2026'];

function setup(labels = WEEK) {
  const api = loadApp();
  api.__sandbox.alert = () => {};
  api.__sandbox.confirm = () => true;
  api.__sandbox.crypto = webcrypto;
  const ent = resetToSingleEntity(api, {
    id: 0, name: 'Fix Co', dateLabels: labels, breakMinutes: 0, breakMinutesSet: true,
    employees: [{ name: 'Ann', shifts: ['', '9AM - 5PM', '', '', '', '', ''] }],
  });
  api._syncEntityCode(ent);
  api.ensureIntakeState(ent);
  ent.intake.activeEmpTab = 'Ann';
  api._prefSet('pv26_api_key', 'FAKEKEY');
  ent.intake._ocrJobs = [{ id: 'job_1', name: 'c.jpg', kind: 'TC', file: Object.assign(new api.__sandbox.Blob(), { name: 'c.jpg', type: 'image/jpeg', size: 1, arrayBuffer: async () => new Uint8Array([7]).buffer }), status: 'done' }];
  api.dispatch({ type: 'wage', screen: 'payroll', target: { kind: 'employee', entity: 0, id: api.wKey(0, 'Ann'), field: 'wage' }, from: null, to: 10, meta: { empName: 'Ann' } });
  return { api, ent };
}
const row = (api, ent, o, src = 'TC') => {
  const r = api.processReviewRow(Object.assign({ empName: 'Ann', date: ent.dateLabels ? api.schedLabelToIso(ent.dateLabels[1]) : '2026-08-10', confidence: 0.95, source: src, originalName: 'c.jpg', imageJobId: 'job_1' }, o), ent);
  ent.intake.reviewRows.push(r);
  return r;
};
const annHours = (api) => { api.syncActualsFromReview(); const r = (api._collectExportData()[0] || { rows: [] }).rows.find(x => x._empName === 'Ann'); return r ? r.actualHours : 0; };

test('merge_refuses_overlapping_punches', () => {
  const { api, ent } = setup();
  const a = row(api, ent, { clockIn1: '09:00', clockOut1: '17:00' });
  const b = row(api, ent, { clockIn1: '09:00', clockOut1: '17:00' }, 'EC');
  [a, b].forEach(x => api.approveReviewRow(x.id));
  const before = annHours(api);
  assert.match(api.mergePlan(0, [a.id, b.id]).error, /overlap .*the same time read twice/);
  assert.equal(api.mergeRows(0, [a.id, b.id]), null);
  assert.equal(annHours(api), before, 'hours untouched');
  const c = row(api, ent, { date: '2026-08-11', clockIn1: '09:00', clockOut1: '13:00' });
  const d = row(api, ent, { date: '2026-08-11', clockIn1: '12:00', clockOut1: '17:00' });
  assert.equal(api.mergePlan(0, [c.id, d.id]).ok, false, 'partial overlap refused too');
});

test('date_correction_still_supersedes_overlapping_ocr', () => {
  const { api, ent } = setup();
  const tc = row(api, ent, { date: '2026-08-11', clockIn1: '09:00', clockOut1: '17:00' }); // OCR read the wrong day
  const ec = row(api, ent, { clockIn1: '08:50', clockOut1: '17:20' }, 'EC');
  api.updateReviewField(tc.id, 'date', '2026-08-10');
  assert.equal(api._isManualPair(tc, 1), true, 'a corrected date makes every pair on the row manual');
  [tc, ec].forEach(x => api.approveReviewRow(x.id));
  assert.equal(annHours(api), 8, 'same as before FC-00042');
  assert.equal(ec._superseded, true);
});

test('week_over_week_resyncs_actuals_from_review_rows', async () => {
  const last = setup(W0);
  const r = row(last.api, last.ent, { clockIn1: '09:00', clockOut1: '17:00' });
  last.api.approveReviewRow(r.id); // approved on Intake; payroll never rendered, actualDays still empty
  assert.equal(last.ent.actualDays.length, 0);
  const snap = JSON.parse(JSON.stringify(await last.api.buildSnapshot()));
  const cur = setup(WEEK);
  const r2 = row(cur.api, cur.ent, { clockIn1: '09:00', clockOut1: '17:00' });
  cur.api.approveReviewRow(r2.id);
  cur.api.loadLastWeekSnapshot(snap, 'last.json');
  const w = cur.api.weekOverWeek();
  assert.equal(w.entities[0].last.hours, 8);
  assert.equal(w.entities[0].cur.hours, 8);
  assert.deepEqual(w.swings, []);
});

test('no_big_action_or_undo_while_ocr_runs', async () => {
  const { api, ent } = setup();
  const a = row(api, ent, { clockIn1: '09:00', clockOut1: '12:00' });
  const b = row(api, ent, { clockIn1: '13:00', clockOut1: '17:00' });
  api.parseSchedule([['Name', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], ['Ann', 'OFF', '9:00-17:00', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'], ['Cy', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF']], 0);
  ent.intake.timecardFiles = [{ name: 'slow.jpg', type: 'image/jpeg' }];
  let release;
  api.__sandbox.fetch = () => new Promise(res => { release = () => res({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '[]' }] } }] }) }); });
  const p = api.runOcrForEntity(0);
  await new Promise(r => setTimeout(r, 20));
  const n = api.getCheckpoints().length;
  assert.equal(api.mergeRows(0, [a.id, b.id]), null, 'merge refused while OCR runs');
  assert.equal(api.getCheckpoints().length, n);
  assert.equal(api.undoCheckpoint(), false);
  assert.equal(await api.saveSnapshot(), null);
  release();
  await p;
  assert.ok(api.mergeRows(0, [a.id, b.id]), 'allowed once it finished');
});

test('row_reread_in_flight_counts_as_busy_and_is_never_saved', async () => {
  const { api, ent } = setup();
  const r = row(api, ent, { clockIn1: '09:00', clockOut1: '17:00' });
  r._rerunning = true;
  assert.equal(await api.saveSnapshot(), null);
  assert.equal(api.splitRow(0, r.id), null);
  assert.equal(JSON.stringify(api._captureState()).includes('_rerunning'), false, 'never part of a saved state');
  delete r._rerunning;
});

test('unapproved_review_rows_stop_paying', () => {
  const { api, ent } = setup();
  const a = row(api, ent, { clockIn1: '09:00', clockOut1: '12:00' });
  const b = row(api, ent, { clockIn1: '12:30', clockOut1: '17:00' });
  [a, b].forEach(x => api.approveReviewRow(x.id));
  assert.equal(annHours(api), 7.5);
  const m = api.mergeRows(0, [a.id, b.id]); // the only rows; merged row is unapproved
  assert.equal(annHours(api), 0, 'nothing approved: nothing paid');
  api.approveReviewRow(m.id);
  assert.equal(annHours(api), 7.5);
  // Actuals loaded from a file (no review rows behind them) are still kept.
  const { api: x } = setup();
  x.entities[0].actualDays = [{ empName: 'Ann', entityName: 'Fix Co', date: '2026-08-10', dayIdx: 1, pairs: [{ in: 9, out: 17, outAdj: 17, minutes: 480 }] }];
  row(x, x.entities[0], { clockIn1: '09:00', clockOut1: '17:00' });
  assert.equal(annHours(x), 8);
});

test('history_revert_does_not_approve_a_broken_row', () => {
  const { api, ent } = setup();
  const r = row(api, ent, { clockIn1: '09:00', clockOut1: '17:00' });
  api.approveReviewRow(r.id);
  api.unapproveReviewRow(r.id);
  const unapproveLine = api.session.log.at(-1);
  api.commitTimeInput({ value: '' }, r.id, 'clockOut1'); // now missing its clock-out
  api.revertFromHistory(unapproveLine.id);
  assert.equal(r.approved, false);
});

test('undo_open_snapshot_restores_addons_and_import_lines_are_not_your_edit', async () => {
  const A = setup();
  const s = JSON.parse(JSON.stringify(await A.api.buildSnapshot()));
  const B = setup();
  row(B.api, B.ent, { clockIn1: '09:00', clockOut1: '17:00' });
  B.api.approveReviewRow(B.ent.intake.reviewRows[0].id);
  B.api.syncActualsFromReview();
  B.api._fc24MakeCopy();
  const scratch = JSON.stringify(B.api.getScratch());
  B.api.openSnapshotData(s);
  assert.equal(B.api.getScratch(), null);
  B.api.undoCheckpoint();
  assert.equal(JSON.stringify(B.api.getScratch()), scratch, 'editable copy back too');
  // A threshold set by an earlier settings import is not "your edit".
  const H = ['Entity', 'Employee', 'Wage/hour'];
  const cm = {}; H.forEach((h, i) => { cm[h.toLowerCase()] = i; });
  B.api.stageSettingsData([], cm, false, [['Week-over-week hours swing', '6']], 'a.xlsx');
  B.api.applyStagedSettings();
  const st = B.api.stageSettingsData([], cm, false, [['Week-over-week hours swing', '5']], 'b.xlsx');
  const d = st.preview.changes.find(c => c.name === '(tool settings)').diffs[0];
  assert.equal(d.yourEdit, false);
});
