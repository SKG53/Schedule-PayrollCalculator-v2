// FC-00037: session snapshot. One file holds the whole session; opening it in a fresh tab
// puts every screen, edit, approval, setting and export back exactly. Images are referenced
// by SHA-256 fingerprint with a small thumbnail, and re-attached by content, never by name.
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { loadApp, resetToSingleEntity } = require('./load-app');

const WEEK = ['Aug 9 2026', 'Aug 10 2026', 'Aug 11 2026', 'Aug 12 2026', 'Aug 13 2026', 'Aug 14 2026', 'Aug 15 2026'];
const SCHED_HDR = ['Name', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shift = ['OFF', '9:00-17:00', '9:00-17:00', 'OFF', 'OFF', 'OFF', 'OFF'];

function fresh() {
  const api = loadApp();
  api.__sandbox.alert = () => {};
  api.__sandbox.confirm = () => true;
  api.__sandbox.crypto = webcrypto;
  return api;
}
// A File is a Blob with a name; content decides the fingerprint.
function mkFile(api, name, bytes) {
  const buf = Uint8Array.from(bytes);
  return Object.assign(new api.__sandbox.Blob(), { name, type: 'image/jpeg', size: buf.length, arrayBuffer: async () => buf.buffer.slice(0) });
}
const BYTES = { a: [1, 2, 3, 4], b: [9, 8, 7, 6, 5], q: [42, 42] };

// A full fabricated session: two entities, schedule, OCR rows from two images, an edit,
// approvals, a manual row, an ignored employee, pay settings, a break override, a palette,
// a flat amount, a queued (not yet run) image and an editable preview copy.
function build(api) {
  const ent = resetToSingleEntity(api, { id: 0, name: 'Alpha Test', employees: [], dateLabels: WEEK, breakMinutes: 30, breakMinutesSet: true });
  api._syncEntityCode(ent);
  api.parseSchedule([SCHED_HDR, ['Ann Able', ...shift], ['Bo Best', ...shift], ['Cy Cole', ...shift]], 0);
  ent.dateLabels = WEEK.slice();
  api.entities.push({ id: 1, name: 'Beta Test', code: '', employees: [], dateLabels: WEEK.slice(), newDateLabels: ['', '', '', '', '', '', ''], newWeekStartVal: '', breakMinutes: 0, breakMinutesSet: true, actualDays: [], intake: null });
  api._syncEntityCode(api.entities[1]);
  api.ensureIntakeState(ent);
  api.ensureIntakeState(api.entities[1]);
  const fa = mkFile(api, 'card-a.jpg', BYTES.a), fb = mkFile(api, 'card-b.jpg', BYTES.b);
  ent.intake._ocrJobs = [
    { id: 'job_a', name: 'card-a.jpg', kind: 'TC', file: fa, status: 'done', detail: '2 rows extracted' },
    { id: 'job_b', name: 'card-b.jpg', kind: 'TC', file: fb, status: 'done', detail: '1 row extracted' },
  ];
  const row = (o) => { const r = api.processReviewRow(Object.assign({ confidence: 0.95, source: 'TC' }, o), ent); ent.intake.reviewRows.push(r); return r; };
  const r1 = row({ empName: 'Ann Able', date: '2026-08-10', clockIn1: '09:00', clockOut1: '17:00', originalName: 'card-a.jpg', imageJobId: 'job_a' });
  const r2 = row({ empName: 'Ann Able', date: '2026-08-11', clockIn1: '09:05', clockOut1: '12:00', clockIn2: '12:30', clockOut2: '17:10', originalName: 'card-a.jpg', imageJobId: 'job_a' });
  const r3 = row({ empName: 'Bo Best', date: '2026-08-10', clockIn1: '08:55', clockOut1: '16:40', originalName: 'card-b.jpg', imageJobId: 'job_b' });
  api.commitTimeInput({ value: '5:20 PM' }, r1.id, 'clockOut1');
  [r1, r2, r3].forEach(r => api.approveReviewRow(r.id));
  api.addManualRow(0);
  const m = ent.intake.reviewRows.at(-1);
  api.updateReviewField(m.id, 'empName', 'Cy Cole');
  api.commitTimeInput({ value: '10:00 AM' }, m.id, 'clockIn1');
  api.commitTimeInput({ value: '2:00 PM' }, m.id, 'clockOut1');
  api.approveReviewRow(m.id);
  api.toggleIgnoreEmployee(0, 'Bo Best');
  const k = (n) => api.wKey(0, n);
  api.dispatch({ type: 'wage', screen: 'payroll', target: { kind: 'employee', entity: 0, id: k('Ann Able'), field: 'wage' }, from: null, to: 15.37, meta: { empName: 'Ann Able' } });
  api.dispatch({ type: 'wage', screen: 'payroll', target: { kind: 'employee', entity: 0, id: k('Bo Best'), field: 'wage' }, from: null, to: 18.5, meta: { empName: 'Bo Best' } });
  api.setPayMethod(0, 'Ann Able', 'both');
  api.setSplitDeposit(0, 'Ann Able', 50);
  api.setPayMethod(0, 'Bo Best', 'cash');
  api.dispatch({ type: 'flatWage', screen: 'payroll', target: { kind: 'employee', entity: 0, id: k('Cy Cole'), field: 'flatWage' }, from: null, to: 120, meta: { empName: 'Cy Cole' } });
  api.setBreakOverride(0, 'Ann Able', 2, 15);
  api.setEntityPalette(0, Object.keys(api.FC14_PRESETS)[1]);
  api.entities[1].intake.timecardFiles = [mkFile(api, 'queued.jpg', BYTES.q)];
  api.syncActualsFromReview();
  api.setTab('payroll');
  api._fc24MakeCopy();
  api._rerenderAll();
  return { ent, files: { fa, fb } };
}
async function snapshotOf(api) { return JSON.parse(JSON.stringify(await api.buildSnapshot())); }
async function reattachAll(api) {
  return api.reattachImages([mkFile(api, 'card-a.jpg', BYTES.a), mkFile(api, 'card-b.jpg', BYTES.b), mkFile(api, 'queued.jpg', BYTES.q)]);
}
const sig = (api) => api._stateSig(api._captureState());
// Object URLs and click-to-rename element ids are minted per render; everything else must match.
const blobs = (html) => String(html).replace(/blob:mock-\d+/g, 'blob:X').replace(/nmedit_[a-z0-9]+/g, 'nmedit_X');
const screens = (api) => {
  const d = api.__sandbox.document, out = {};
  api.entities.forEach((e, i) => { out['review' + i] = blobs(api.renderReviewTableHtml(e, i)); });
  api.renderIntake(); out.intake = blobs(d.getElementById('intakeContent').innerHTML);
  api.entities.forEach((e, i) => { api.renderPayrollEntityContent(i); out['payroll' + i] = d.getElementById('payrollEntityContent').innerHTML; });
  api.renderFc00013PreviewPanel(); out.preview = d.getElementById('fc13PreviewHost').innerHTML;
  return out;
};
async function exportsOf(api) {
  const out = {};
  for (const kind of ['combined', 'cashOnly', 'depositOnly', 'timecard', 'payrollCalc', 'full']) {
    await api._exportExcel(kind);
    out[kind] = JSON.stringify(api.__lastExcelWorkbook.worksheets.map(ws => ws.rows.map(r => (r || []).map(c => c && c.value))));
  }
  return out;
}

test('test_snapshot_round_trip_restores_identical_state', async () => {
  const A = fresh(); build(A);
  const snap = await snapshotOf(A);
  assert.equal(snap.schema, 'SPCalcSessionSnapshot');
  assert.equal(snap.version, A.SNAPSHOT_VERSION);
  assert.equal(snap.images.length, 3, 'two OCR images + one queued image');
  const B = fresh();
  assert.deepEqual(B.openSnapshotData(snap), { ok: true, missing: 3 });
  // Before re-attach: every row, edit flag, approval and setting is already back.
  assert.deepEqual(JSON.stringify(B.entities.map(e => e.intake && e.intake.reviewRows)), JSON.stringify(A.entities.map(e => e.intake && e.intake.reviewRows)));
  assert.deepEqual({ ...B.wageRates }, { ...A.wageRates });
  assert.deepEqual({ ...B.splitAmounts }, { ...A.splitAmounts });
  assert.deepEqual({ ...B.breakOverrides }, { ...A.breakOverrides });
  assert.deepEqual(JSON.stringify(B.session.roster), JSON.stringify(A.session.roster));
  assert.equal(JSON.stringify(B.session.log), JSON.stringify(A.session.log), 'History comes back too');
  assert.equal(B.getCurrentTabName(), 'payroll');
  assert.deepEqual(B.getScratch(), A.getScratch(), 'editable preview copy comes back');
  const res = await reattachAll(B);
  assert.equal(res.matched.length, 3);
  assert.equal(sig(B), sig(A), 'deep-equal state once the images are back');
  assert.equal(B.entities[1].intake.timecardFiles.length, 1, 'queued image is back in its queue');
});

test('test_restored_screens_render_identically', async () => {
  const A = fresh(); build(A);
  const before = screens(A);
  const B = fresh();
  B.openSnapshotData(await snapshotOf(A));
  await reattachAll(B);
  assert.deepEqual(screens(B), before);
});

test('test_restored_exports_identical', async () => {
  const A = fresh(); build(A);
  const before = await exportsOf(A);
  const B = fresh();
  B.openSnapshotData(await snapshotOf(A));
  assert.deepEqual(await exportsOf(B), before, 'exports need no images');
});

test('test_snapshot_has_no_api_key', async () => {
  const A = fresh(); build(A);
  A._prefSet('pv26_api_key', 'SECRET-KEY-123');
  A._prefSet('pv26_tc_model', 'gemini-test-model');
  const text = JSON.stringify(await A.buildSnapshot());
  assert.ok(!text.includes('SECRET-KEY-123'));
  assert.ok(!text.includes('pv26_'));
  assert.ok(!text.includes('gemini-test-model'));
});

test('test_images_rematched_by_fingerprint_not_name', async () => {
  const A = fresh(); build(A);
  const snap = await snapshotOf(A);
  snap.images.find(i => i.name === 'card-a.jpg').thumb = 'data:image/jpeg;base64,AAAA';
  const B = fresh();
  B.openSnapshotData(snap);
  const html = B.renderReviewTableHtml(B.entities[0], 0);
  assert.match(html, /tc-thumb-small" src="data:image\/jpeg;base64,AAAA"/, 'small copy shows until re-attached');
  assert.equal(B.missingImages().length, 3);
  // Names swapped on purpose: content decides.
  const x = mkFile(B, 'card-b.jpg', BYTES.a), y = mkFile(B, 'card-a.jpg', BYTES.b);
  const res = await B.reattachImages([x, y]);
  const jobs = B.entities[0].intake._ocrJobs;
  assert.equal(jobs.find(j => j.id === 'job_a').file, x);
  assert.equal(jobs.find(j => j.id === 'job_b').file, y);
  assert.deepEqual(res.unused, []);
  assert.deepEqual(res.missing, ['queued.jpg']);
  assert.match(B.renderReviewTableHtml(B.entities[0], 0), /class="tc-thumb" src="blob:/);
});

test('test_changed_image_not_attached', async () => {
  const A = fresh(); build(A);
  const B = fresh();
  B.openSnapshotData(await snapshotOf(A));
  const edited = mkFile(B, 'card-a.jpg', [1, 2, 3, 4, 0]); // same name, different content
  const res = await B.reattachImages([edited]);
  assert.deepEqual(res.matched, []);
  assert.deepEqual(res.unused, ['card-a.jpg']);
  assert.equal(B.entities[0].intake._ocrJobs.find(j => j.id === 'job_a').file, null);
  assert.ok(B.missingImages().some(m => m.name === 'card-a.jpg'));
});

test('test_unknown_version_refused', async () => {
  const A = fresh(); build(A);
  const snap = await snapshotOf(A);
  const B = fresh();
  const alerts = [];
  B.__sandbox.alert = (m) => alerts.push(m);
  const before = sig(B);
  let r = B.openSnapshotData(Object.assign({}, snap, { version: 99 }));
  assert.equal(r.ok, false);
  assert.match(alerts[0], /newer version of the tool \(version 99\)/);
  r = B.openSnapshotData({ schema: 'SomethingElse', version: 1, state: {} });
  assert.equal(r.ok, false);
  assert.match(alerts[1], /not a session snapshot/);
  assert.equal(sig(B), before, 'nothing changed');
  assert.equal(B.getCheckpoints().length, 0);
});

test('test_open_into_busy_session_asks_and_is_undoable', async () => {
  const A = fresh(); build(A);
  const snap = await snapshotOf(A);
  const B = fresh();
  const ent = resetToSingleEntity(B, { id: 0, name: 'Busy Co', employees: [], dateLabels: WEEK });
  B.setTab('schedule');
  B._syncEntityCode(ent);
  B.parseSchedule([SCHED_HDR, ['Dee Dunn', ...shift]], 0);
  B.setPayMethod(0, 'Dee Dunn', 'cash');
  B._rerenderAll();
  const before = sig(B), logBefore = JSON.stringify(B.session.log);
  const asked = [];
  B.__sandbox.confirm = (m) => { asked.push(m); return false; };
  assert.equal(B.openSnapshotData(snap).ok, false);
  assert.match(asked[0], /replaces everything/);
  assert.equal(sig(B), before);
  B.__sandbox.confirm = () => true;
  assert.equal(B.openSnapshotData(snap, 'week.json').ok, true);
  assert.deepEqual(B.entities.map(e => e.name), ['Alpha Test', 'Beta Test']);
  assert.match(B.getCheckpoints().at(-1).label, /^Open snapshot · week\.json/);
  B.undoCheckpoint();
  assert.deepEqual(B.entities.map(e => e.name), ['Busy Co']);
  assert.equal(B.getCurrentTabName(), 'schedule', 'undo also puts the screen back');
  assert.equal(sig(B), before);
  assert.equal(JSON.stringify(B.session.log), logBefore);
});

test('test_leave_page_warning_only_with_unsaved_changes', async () => {
  const A = fresh();
  assert.equal(A._onBeforeUnload(null), false, 'empty tool: no warning');
  build(A);
  const ev = { preventDefault() { this.prevented = true; } };
  assert.equal(A._onBeforeUnload(ev), true);
  assert.equal(ev.prevented, true);
  await A.saveSnapshot();
  assert.equal(A.hasUnsavedChanges(), false, 'just saved');
  A.setPayMethod(0, 'Bo Best', 'deposit');
  assert.equal(A.hasUnsavedChanges(), true);
  const B = fresh();
  B.openSnapshotData(await snapshotOf(A));
  assert.equal(B.hasUnsavedChanges(), false, 'just opened');
});

test('test_snapshot_file_name_uses_labels_and_week', () => {
  const A = fresh(); build(A);
  assert.equal(A._fileStem(), 'AlphaTest_BetaTest_0809to0815');
  A.entities[0].name = 'NIRVANA 11TH'; A._syncEntityCode(A.entities[0]);
  assert.equal(A._fileStem(), 'Nirvana_BetaTest_0809to0815');
});
