// FC-00039: undo for big actions (checkpoints) and a History panel with per-line revert.
// A checkpoint is taken before every big action; Undo puts the whole session back exactly
// (roster IDs and name matching included) and lists what else would be lost first. Punch
// edits, approvals, employee assignment and row add/delete are logged and revertable one
// line at a time without dropping anything after them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, resetToSingleEntity } = require('./load-app');

const WEEK = ['Aug 9 2026', 'Aug 10 2026', 'Aug 11 2026', 'Aug 12 2026', 'Aug 13 2026', 'Aug 14 2026', 'Aug 15 2026'];
const SCHED_HDR = ['Name', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shift = ['OFF', '9:00-17:00', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'];

function setup() {
  const api = loadApp();
  api.__sandbox.alert = () => {};
  const ent = resetToSingleEntity(api, {
    id: 0, name: 'Undo Co',
    employees: [{ name: 'Ann', shifts: ['', '9AM - 5PM', '9AM - 5PM', '', '', '', ''] }, { name: 'Bo', shifts: ['', '9AM - 5PM', '', '', '', '', ''] }],
    dateLabels: WEEK, breakMinutes: 0, breakMinutesSet: true,
  });
  api._syncEntityCode(ent);
  api.ensureIntakeState(ent);
  ent.intake.activeEmpTab = 'Ann';
  api._prefSet('pv26_api_key', 'FAKEKEY');
  // A real File is a Blob; checkpoints must reference it, never copy it.
  const img = Object.assign(new api.__sandbox.Blob(), { name: 'card.jpg', type: 'image/jpeg' });
  ent.intake._ocrJobs = [{ id: 'job_1', name: 'card.jpg', kind: 'TC', file: img, status: 'done' }];
  const confirms = [];
  api.__sandbox.confirm = (m) => { confirms.push(m); return true; };
  return { api, ent, confirms, img };
}
const ocrRow = (api, ent, o) => {
  const r = api.processReviewRow(Object.assign({ empName: 'Ann', date: '2026-08-10', clockIn1: '09:00', clockOut1: '17:00', confidence: 0.95, source: 'TC', originalName: 'card.jpg', imageJobId: 'job_1' }, o), ent);
  ent.intake.reviewRows.push(r);
  return r;
};
function fakeGemini(api, reply) {
  api.__sandbox.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }) });
}
const el = (o) => Object.assign({ empName: 'Ann', date: '2026-08-10', clockIn1: '', clockOut1: '', confidence: 0.97, notes: '' }, o);
const sig = (api) => api._stateSig(api._captureState());
// The live app renders after every change, and rendering fills derived state (roster IDs for
// names on screen, next-week labels). Render first so "before" is a state the app can be in.
const settle = (api) => { api._rerenderAll(); return api; };
const labels = (api) => api.getCheckpoints().map(c => c.label.split(' · ')[0]);
function settingsFile(api, rows) {
  const hdr = ['Entity', 'Employee', 'Wage/hour', 'Type', 'Pay Method'];
  api.__sandbox.FileReader = class { readAsArrayBuffer() { this.onload({ target: { result: new ArrayBuffer(0) } }); } };
  api.__sandbox.XLSX = { read: () => ({ SheetNames: ['Payroll Settings'], Sheets: { 'Payroll Settings': {} } }), utils: { sheet_to_json: () => [hdr, ...rows] } };
  return { name: 'settings.xlsx' };
}

test('test_checkpoint_before_each_big_action', async () => {
  const { api, ent } = setup();
  api.entities.push({ id: 1, name: 'Second Co', employees: [], dateLabels: WEEK, newDateLabels: ['', '', '', '', '', '', ''], newWeekStartVal: '', breakMinutes: 0, breakMinutesSet: true, actualDays: [], intake: null });
  api.parseSchedule([SCHED_HDR, ['Ann', ...shift], ['Bo', ...shift], ['Cy', ...shift]], 0);
  ent.intake.timecardFiles = [{ name: 'new.jpg', type: 'image/jpeg' }];
  fakeGemini(api, [el({ clockIn1: '09:00', clockOut1: '17:00' })]);
  await api.runOcrForEntity(0);
  const r = ent.intake.reviewRows[0];
  fakeGemini(api, [el({ clockIn1: '09:02', clockOut1: '17:00' })]);
  await api.rerunOcrForImage(0, r.imageJobId, 1);
  const row = ent.intake.reviewRows[0];
  fakeGemini(api, [el({ clockIn1: '09:05', clockOut1: '17:10' })]);
  await api.rerunOcrForRow(0, row.id);
  api.importPayrollSettingsFile(settingsFile(api, [['Undo Co', 'Ann', '15', 'Hourly', 'Cash']]), false);
  api.clearIntake(0);
  api.switchEntity(1);
  api.removeEntity();
  assert.deepEqual(labels(api), ['Schedule load', 'Run OCR', 'Image re-run', 'Row re-read', 'Settings import', 'Clear intake', 'Remove entity']);
  assert.ok(api.getCheckpoints().every(c => !c.running));
});

test('test_action_that_changes_nothing_leaves_no_checkpoint', async () => {
  const { api, ent } = setup();
  const r = ocrRow(api, ent, {});
  settle(api);
  fakeGemini(api, []); // no matching entry: row left unchanged
  await api.rerunOcrForRow(0, r.id);
  assert.equal(api.getCheckpoints().length, 0);
});

test('test_undo_restores_exact_state', async () => {
  const { api, ent, confirms } = setup();
  api.parseSchedule([SCHED_HDR, ['Ann', ...shift], ['Bo', ...shift]], 0);
  api.setPayMethod(0, 'Ann', 'cash');
  const r = ocrRow(api, ent, {});
  api.approveReviewRow(r.id);
  const entitiesRef = api.entities, wagesRef = api.wageRates, logRef = api.session.log;
  const before = sig(settle(api));
  const logBefore = JSON.stringify(api.session.log);
  const annId = api._employeeIdFor(0, 'Ann');
  // A new week's schedule with a new person and a missing one.
  api.parseSchedule([SCHED_HDR, ['Ann', ...shift], ['Dozzle New', ...shift]], 0);
  const drewFirst = api._employeeIdFor(0, 'Dozzle New');
  assert.notEqual(sig(api), before);
  confirms.length = 0;
  assert.equal(api.undoCheckpoint(), true);
  assert.equal(confirms.length, 0, 'nothing after the action: no question asked');
  assert.equal(sig(api), before, 'deep-equal to the state before the action');
  assert.equal(JSON.stringify(api.session.log), logBefore, 'change log back to the same lines');
  assert.equal(api.entities, entitiesRef, 'same entities array (aliases stay valid)');
  assert.equal(api.wageRates, wagesRef);
  assert.equal(api.session.log, logRef);
  assert.deepEqual(api.entities[0].employees.map(e => e.name), ['Ann', 'Bo']);
  assert.equal(api._employeeIdFor(0, 'Ann'), annId);
  assert.equal(api.getPayMethod(0, 'Ann'), 'cash');
  assert.equal(api.getCheckpoints().length, 1, 'the earlier schedule load can still be undone');
  // Name matching and ID minting are back where they were: loading again mints the same ID.
  api.parseSchedule([SCHED_HDR, ['Ann', ...shift], ['Dozzle New', ...shift]], 0);
  assert.equal(api._employeeIdFor(0, 'Dozzle New'), drewFirst);
});

test('test_undo_run_ocr_requeues_the_same_image_files', async () => {
  const { api, ent } = setup();
  const f = { name: 'new.jpg', type: 'image/jpeg' };
  ent.intake.timecardFiles = [f];
  const before = sig(settle(api));
  fakeGemini(api, [el({ clockIn1: '09:00', clockOut1: '17:00' })]);
  await api.runOcrForEntity(0);
  assert.equal(api.entities[0].intake.reviewRows.length, 1);
  assert.equal(api.entities[0].intake.timecardFiles.length, 0);
  api.undoCheckpoint();
  assert.equal(sig(api), before);
  assert.equal(api.entities[0].intake.reviewRows.length, 0);
  assert.equal(api.entities[0].intake.timecardFiles.length, 1, 'queued file is back, ready to run again');
});

test('test_undo_warns_when_later_changes_exist', () => {
  const { api, ent, confirms } = setup();
  const r = ocrRow(api, ent, {});
  api.parseSchedule([SCHED_HDR, ['Ann', ...shift], ['Cy', ...shift]], 0);
  api.setPayMethod(0, 'Ann', 'cash');
  api.approveReviewRow(r.id);
  const after = sig(api);
  api.__sandbox.confirm = (m) => { confirms.push(m); return false; };
  assert.equal(api.undoCheckpoint(), false);
  assert.equal(sig(api), after, 'declined: nothing restored');
  assert.match(confirms[0], /Undo "Schedule load/);
  assert.match(confirms[0], /2 later changes/);
  assert.match(confirms[0], /Pay method/);
  assert.match(confirms[0], /Approval/);
  api.__sandbox.confirm = () => true;
  assert.equal(api.undoCheckpoint(), true);
  assert.equal(api.getPayMethod(0, 'Ann'), 'deposit');
  assert.equal(api.findReviewRow(r.id).row.approved, false, 'restored rows are fresh copies; look them up by id');
});

test('test_undo_refused_while_action_running', async () => {
  const { api, ent } = setup();
  api.parseSchedule([SCHED_HDR, ['Ann', ...shift], ['Cy', ...shift]], 0);
  ent.intake.timecardFiles = [{ name: 'slow.jpg', type: 'image/jpeg' }];
  let release;
  api.__sandbox.fetch = () => new Promise(res => { release = () => res({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '[]' }] } }] }) }); });
  const p = api.runOcrForEntity(0);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(api.getCheckpoints().at(-1).running, true);
  assert.equal(api.undoCheckpoint(), false);
  assert.deepEqual(api.entities[0].employees.map(e => e.name), ['Ann', 'Cy'], 'nothing restored while OCR runs');
  release();
  await p;
  assert.equal(api.getCheckpoints().at(-1).running, false);
});

test('test_only_last_ten_checkpoints_kept', () => {
  const { api } = setup();
  for (let i = 1; i <= 12; i++) api.parseSchedule([SCHED_HDR, ['Ann', ...shift], ['Temp ' + i, ...shift]], 0);
  const cps = api.getCheckpoints();
  assert.equal(api.CHECKPOINT_LIMIT, 10);
  assert.equal(cps.length, 10);
  for (let i = 0; i < 10; i++) api.undoCheckpoint();
  assert.deepEqual(api.entities[0].employees.map(e => e.name), ['Ann', 'Temp 2'], 'oldest reachable state is just before load 3');
  assert.equal(api.getCheckpoints().length, 0);
});

test('test_remove_entity_confirms_and_undoes', () => {
  const { api, ent, confirms, img } = setup();
  ocrRow(api, ent, {});
  ocrRow(api, ent, { date: '2026-08-11' });
  api.entities.push({ id: 1, name: 'Second Co', employees: [], dateLabels: WEEK, newDateLabels: ['', '', '', '', '', '', ''], newWeekStartVal: '', breakMinutes: 0, breakMinutesSet: true, actualDays: [], intake: null });
  const before = sig(settle(api));
  api.__sandbox.confirm = (m) => { confirms.push(m); return false; };
  assert.equal(api.removeEntity(), false);
  assert.equal(api.entities.length, 2);
  assert.match(confirms[0], /Remove entity "Undo Co"/);
  assert.match(confirms[0], /2 employees on the schedule, 2 punch rows and 1 timecard image/);
  assert.equal(api.getCheckpoints().length, 0);
  api.__sandbox.confirm = () => true;
  assert.equal(api.removeEntity(), true);
  assert.deepEqual(api.entities.map(e => e.name), ['Second Co']);
  assert.match(api.getCheckpoints()[0].label, /^Remove entity · Undo Co/);
  api.undoCheckpoint();
  assert.deepEqual(api.entities.map(e => e.name), ['Undo Co', 'Second Co']);
  assert.equal(sig(api), before);
  assert.equal(api.entities[0].intake._ocrJobs[0].file, img, 'image file is the same object, not a copy');
});

test('test_history_lists_punch_edits_and_approvals', () => {
  const { api, ent } = setup();
  const r = ocrRow(api, ent, {});
  // Typing then leaving the box logs one line with the value before typing started.
  const box = { value: '5:3' };
  api.handleTimeInput(box, r.id, 'clockOut1');
  box.value = '5:30 PM';
  api.handleTimeInput(box, r.id, 'clockOut1');
  api.commitTimeInput(box, r.id, 'clockOut1');
  api.commitTimeInput({ value: '5:30 PM' }, r.id, 'clockOut1'); // blur again, same value: no line
  api.updateReviewField(r.id, 'empName', 'Bo');
  api.approveReviewRow(r.id);
  api.unapproveReviewRow(r.id);
  api.approveAllForEmployee(0, 'Bo');
  api.addManualRow(0);
  const manual = ent.intake.reviewRows.at(-1);
  api.deleteReviewRow(manual.id);
  api.toggleIgnoreEmployee(0, 'Ann');
  const rows = api.historyRows();
  assert.deepEqual(rows.map(x => x.kind), ['Ignore time cards', 'Row deleted', 'Row added', 'Approval (bulk)', 'Approval', 'Approval', 'Employee assignment', 'Punch edit']);
  const edit = rows.at(-1);
  assert.equal(edit.screen, 'intake');
  assert.equal(edit.entity, 'Undo Co');
  assert.equal(edit.employee, 'Ann');
  assert.equal(edit.field, 'Out 1 · 2026-08-10');
  assert.equal(edit.from, '5:00 PM');
  assert.equal(edit.to, '5:30 PM');
  assert.ok(edit.time.match(/^\d{1,2}:\d{2}:\d{2} (AM|PM)$/));
  const assign = rows.find(x => x.kind === 'Employee assignment');
  assert.equal(assign.from, 'Ann');
  assert.equal(assign.to, 'Bo');
  assert.ok(rows.every(x => x.canRevert || x.kind === 'Row added'), 'the deleted row\'s "added" line has nothing left to remove');
  api.openHistory();
  const html = api.__sandbox.document.getElementById('historyBody').innerHTML;
  assert.match(html, /revertFromHistory\('l\d+'\)/);
  assert.match(html, /Employee assignment/);
});

test('test_revert_single_line_keeps_later_changes', () => {
  const { api, ent } = setup();
  const r = ocrRow(api, ent, {});
  api.commitTimeInput({ value: '5:30 PM' }, r.id, 'clockOut1'); // line A
  api.commitTimeInput({ value: '8:45 AM' }, r.id, 'clockIn1'); // line B
  api.setPayMethod(0, 'Ann', 'cash'); // line C
  const [a, b, c] = api.session.log;
  const out = api.revertFromHistory(a.id);
  assert.equal(out.type, 'revert');
  assert.equal(out.originalId, a.id);
  assert.equal(r.clockOut1, '17:00', 'A reverted');
  assert.equal(r.clockIn1, '08:45', 'B kept');
  assert.equal(api.getPayMethod(0, 'Ann'), 'cash', 'C kept');
  assert.equal(r.source, 'MN', 'still edited (In 1 differs from what OCR read)');
  assert.equal(api.session.log.length, 4, 'revert is its own line; nothing dropped');
  assert.equal(a.reverted, true);
  assert.equal(b.reverted, false);
  assert.equal(c.reverted, false);
  assert.equal(api.canRevertEntry(a), false, 'a line reverts once');
  assert.equal(api.revertFromHistory(a.id), null);
  api.revertFromHistory(b.id);
  assert.equal(r.source, 'TC', 'both boxes back to the OCR reading');
  // A deleted row comes back where it was, with its id.
  const second = ocrRow(api, ent, { date: '2026-08-11' });
  ocrRow(api, ent, { date: '2026-08-12' });
  api.deleteReviewRow(second.id);
  const del = api.session.log.at(-1);
  api.revertFromHistory(del.id);
  assert.equal(ent.intake.reviewRows[1].id, second.id);
  assert.equal(ent.intake.reviewRows[1].date, '2026-08-11');
});
