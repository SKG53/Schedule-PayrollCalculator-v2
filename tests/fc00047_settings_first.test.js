// FC-00047: last week's settings file can be loaded first (Schedules tab, opening its own
// entities); schedule and timecard spellings resolve to the file's people; a spelling matched by
// hand is learned as an alternate spelling and exported; archived people are never auto-matched.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, resetToSingleEntity } = require('./load-app');

const SCHED_HDR = ['Name', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const mon = ['OFF', '9:00-17:00', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'];
const WEEK = ['Aug 9 2026', 'Aug 10 2026', 'Aug 11 2026', 'Aug 12 2026', 'Aug 13 2026', 'Aug 14 2026', 'Aug 15 2026'];
const H = ['Entity', 'Employee', 'Wage/hour', 'Pay Method', 'Employee ID', 'Aliases', 'Active'];
const cm = () => { const m = {}; H.forEach((h, i) => { m[h.toLowerCase()] = i; }); return m; };
const FILE = [
  ['Alpha Test', 'Rook Bellamy', '15', 'Cash', 'EMP_ALP_00002', '["ROOK","Rook. B"]', 'Yes'],
  ['Alpha Test', 'Bram Tull', '16', 'Deposit', 'EMP_ALP_00003', '["BRAM"]', 'Yes'],
  ['Alpha Test', 'Wren Ash', '12', 'Cash', 'EMP_ALP_00001', '["WREN"]', 'No'],
  ['Beta Test', 'Quill Marsh', '14', 'Cash', 'EMP_BET_00001', '["QUILL"]', 'Yes'],
];

function fresh() {
  const api = loadApp();
  api.__sandbox.alert = () => {};
  api.__sandbox.confirm = () => true;
  // The tool starts with one empty, unnamed entity.
  resetToSingleEntity(api, { id: 0, name: '', employees: [], dateLabels: WEEK, breakMinutes: 0, breakMinutesSet: true });
  return api;
}
function loadFirst(api, rows = FILE) {
  const opened = api._openFileEntities(rows, cm());
  api.stageSettingsData(rows, cm(), false, [], 'last week', { openedEntities: opened });
  return opened;
}
function row(api, ent, name, i = '09:00', o = '17:00') {
  const r = api.processReviewRow({ empName: name, date: '2026-08-10', clockIn1: i, clockOut1: o, confidence: 0.95, source: 'TC', originalName: name + '.jpg' }, ent);
  ent.intake.reviewRows.push(r);
  api.approveReviewRow(r.id);
  return r;
}

test('test_settings_on_schedules_tab_before_schedule', () => {
  const api = fresh();
  const opened = loadFirst(api);
  assert.deepEqual(api.entities.map(e => e.name), ['Alpha Test', 'Beta Test'], 'the empty entity is reused, the second is opened');
  assert.equal(opened.length, 2);
  assert.equal(api.applyStagedSettings(), true);
  assert.equal(api.wKey(0, 'Rook Bellamy'), 'EMP_ALP_00002');
  assert.equal(api.wKey(1, 'Quill Marsh'), 'EMP_BET_00001');
});

test('test_cancel_closes_opened_entities', () => {
  const api = fresh();
  loadFirst(api);
  api.cancelStagedSettings();
  assert.equal(api.entities.length, 1);
  assert.equal(api.entities[0].name, '', 'the reused entity is back to empty');
});

test('test_prompt_once_when_no_settings', () => {
  const api = fresh();
  api.renderSettingsFirstBar();
  const el = () => api.__sandbox.document.getElementById('settingsFirstBar').innerHTML;
  assert.ok(el().includes('Load last week') && el().includes('Skip'), 'prompt shown when no file is loaded');
  api.skipSettingsFirst();
  assert.ok(!el().includes('Skip') && el().includes("Load last week's settings file"), 'after Skip only the plain button stays');
  loadFirst(api); api.applyStagedSettings(); api.renderSettingsFirstBar();
  assert.ok(el().includes('Settings file loaded'), 'loaded state shown');
  assert.equal(api._settingsLoadedThisSession(), true);
});

test('test_schedule_names_resolve_to_file_ids', () => {
  const api = fresh();
  loadFirst(api); api.applyStagedSettings();
  const n = Object.keys(api.session.roster.byId).length;
  api.parseSchedule([SCHED_HDR, ['ROOK', ...mon], ['BRAM', ...mon]], 0);
  assert.deepEqual(api.entities[0].employees.map(e => e.name), ['Rook Bellamy', 'Bram Tull'], 'schedule spellings load as the saved names');
  assert.equal(Object.keys(api.session.roster.byId).length, n, 'no new ID for anyone already in the file');
});

test('test_full_name_timecard_resolves_to_first_name_person', () => {
  const api = fresh();
  loadFirst(api); api.applyStagedSettings();
  api.parseSchedule([SCHED_HDR, ['ROOK', ...mon], ['BRAM', ...mon]], 0);
  const e = api.entities[0];
  e.dateLabels = WEEK.slice();
  api.ensureIntakeState(e);
  const a = row(api, e, 'Rook. B'), b = row(api, e, 'BRAM TULL', '08:00', '12:00');
  api.syncActualsFromReview();
  assert.deepEqual([a, b].map(r => api.reviewBucketKey(r, e)), ['Rook Bellamy', 'Bram Tull']);
  const { results, orphanRows } = api.computePayrollForEntity(0);
  assert.equal(orphanRows.length, 0);
  assert.deepEqual(results.map(r => [r.schedName, r.actualHours]), [['Rook Bellamy', 8], ['Bram Tull', 4]]);
});

test('test_manual_match_saves_alias_to_id', () => {
  const api = fresh();
  api.entities[0].name = 'Alpha Test'; api._syncEntityCode(api.entities[0]);
  api.parseSchedule([SCHED_HDR, ['BRAM', ...mon]], 0);
  const e = api.entities[0]; e.dateLabels = WEEK.slice(); api.ensureIntakeState(e);
  const r = row(api, e, 'Brn Tl'); // a garbled card spelling nothing matches
  assert.equal(api.reviewBucketKey(r, e), '__unrecognized__');
  api.updateReviewField(r.id, 'empName', 'BRAM');
  assert.deepEqual(api.getAliases(0, 'BRAM'), ['Brn Tl'], 'the card spelling is saved to the person');
  const r2 = row(api, e, 'Brn Tl');
  assert.equal(api.reviewBucketKey(r2, e), 'BRAM', 'the same spelling lands on them next time');
});

test('test_alias_exported_in_settings_file', () => {
  const api = fresh();
  api.entities[0].name = 'Alpha Test'; api._syncEntityCode(api.entities[0]);
  api.parseSchedule([SCHED_HDR, ['BRAM', ...mon]], 0);
  const e = api.entities[0]; e.dateLabels = WEEK.slice(); api.ensureIntakeState(e);
  const r = row(api, e, 'Brn Tl');
  api.updateReviewField(r.id, 'empName', 'BRAM');
  const out = api._gatherPayrollSettingsRows(false).find(x => x.employee === 'BRAM');
  assert.ok(String(out.aliases).includes('Brn Tl'), JSON.stringify(out));
});

test('test_learned_spelling_never_takes_another_persons_name', () => {
  const api = fresh();
  api.entities[0].name = 'Alpha Test'; api._syncEntityCode(api.entities[0]);
  api.parseSchedule([SCHED_HDR, ['BRAM', ...mon], ['ROOK', ...mon]], 0);
  assert.equal(api._learnSpelling(api.entities[0], 'BRAM', 'ROOK'), false);
  assert.deepEqual(api.getAliases(0, 'BRAM'), []);
});

test('test_archived_not_auto_matched_reactivate_offered', () => {
  const api = fresh();
  loadFirst(api); api.applyStagedSettings();
  api.parseSchedule([SCHED_HDR, ['ROOK', ...mon]], 0);
  const e = api.entities[0]; e.dateLabels = WEEK.slice(); api.ensureIntakeState(e);
  const r = row(api, e, 'WREN');
  assert.equal(api.matchEmployeeName('WREN', e).archived, 'Wren Ash');
  assert.equal(api.reviewBucketKey(r, e), '__unrecognized__', 'never auto-matched');
  assert.ok(r.flags.includes('Matches archived: Wren Ash'), JSON.stringify(r.flags));
});

test('test_first_name_schedule_after_file_without_alias', () => {
  const api = fresh();
  const file = [['Alpha Test', 'Rook Bellamy', '15', 'Cash', 'EMP_ALP_00002', '', 'Yes'], ['Alpha Test', 'Wren Ash', '12', 'Cash', 'EMP_ALP_00001', '', 'No']];
  loadFirst(api, file); api.applyStagedSettings();
  const n = Object.keys(api.session.roster.byId).length;
  api.parseSchedule([SCHED_HDR, ['ROOK', ...mon], ['WREN', ...mon]], 0);
  assert.equal(api.wKey(0, 'ROOK'), 'EMP_ALP_00002', 'unique first name of an active file person resolves to them');
  assert.notEqual(api.wKey(0, 'WREN'), 'EMP_ALP_00001', 'never onto an archived person');
  const e = api.entities[0]; e.dateLabels = WEEK.slice(); api.ensureIntakeState(e);
  row(api, e, 'Rook Bellamy');
  api.syncActualsFromReview();
  const { orphanRows, results } = api.computePayrollForEntity(0);
  assert.equal(orphanRows.length, 0);
  assert.equal(results.find(r => api.wKey(0, r.schedName) === 'EMP_ALP_00002').actualHours, 8);
  assert.equal(Object.keys(api.session.roster.byId).length, n + 1, 'only WREN got a new record');
});

test('test_reassigning_one_row_never_moves_the_others', () => {
  const api = fresh();
  api.entities[0].name = 'Alpha Test'; api._syncEntityCode(api.entities[0]);
  api.parseSchedule([SCHED_HDR, ['QUILL', ...mon], ['BRAM', ...mon]], 0);
  const e = api.entities[0]; e.dateLabels = WEEK.slice(); api.ensureIntakeState(e);
  const a = row(api, e, 'Quill Ortiz');
  const b = api.processReviewRow({ empName: 'Quill Ortiz', date: '2026-08-11', clockIn1: '09:00', clockOut1: '17:00', confidence: 0.95, source: 'TC', originalName: 'q2.jpg' }, e);
  e.intake.reviewRows.push(b); api.approveReviewRow(b.id);
  assert.equal(api.reviewBucketKey(b, e), 'QUILL', 'suggested to QUILL');
  api.updateReviewField(a.id, 'empName', 'BRAM');
  assert.equal(api.reviewBucketKey(b, e), 'QUILL', 'the other row stays where it was');
  assert.deepEqual(api.getAliases(0, 'BRAM'), [], 'spelling not learned while another row reads it as someone else');
});

test('test_correcting_a_pick_moves_the_learned_spelling', () => {
  const api = fresh();
  api.entities[0].name = 'Alpha Test'; api._syncEntityCode(api.entities[0]);
  api.parseSchedule([SCHED_HDR, ['QUILL', ...mon], ['BRAM', ...mon]], 0);
  const e = api.entities[0]; e.dateLabels = WEEK.slice(); api.ensureIntakeState(e);
  const r = row(api, e, 'Zx Qv');
  api.updateReviewField(r.id, 'empName', 'BRAM');
  assert.deepEqual(api.getAliases(0, 'BRAM'), ['Zx Qv']);
  api.updateReviewField(r.id, 'empName', 'QUILL');
  assert.deepEqual(api.getAliases(0, 'BRAM'), [], 'the mistaken spelling is taken back');
  assert.deepEqual(api.getAliases(0, 'QUILL'), ['Zx Qv']);
});

test('test_learning_after_payroll_was_viewed', () => {
  const api = fresh();
  api.entities[0].name = 'Alpha Test'; api._syncEntityCode(api.entities[0]);
  api.parseSchedule([SCHED_HDR, ['BRAM', ...mon]], 0);
  const e = api.entities[0]; e.dateLabels = WEEK.slice(); api.ensureIntakeState(e);
  const r = row(api, e, 'Zx Qv');
  api.syncActualsFromReview(); api.computePayrollForEntity(0); api.wKey(0, 'Zx Qv'); // the tool looked the spelling up
  api.updateReviewField(r.id, 'empName', 'BRAM');
  assert.deepEqual(api.getAliases(0, 'BRAM'), ['Zx Qv'], 'still learned');
  assert.equal(Object.values(api.session.roster.byId).filter(x => x.canonical_name === 'Zx Qv').length, 0, 'no stray record left');
});

test('test_undo_load_first_closes_opened_entities', () => {
  const api = fresh();
  loadFirst(api); api.applyStagedSettings();
  assert.equal(api.entities.length, 2);
  assert.equal(api.undoCheckpoint(), true);
  assert.equal(api.entities.length, 1);
  assert.equal(api.entities[0].name, '', 'back to the one empty entity');
  assert.equal(Object.keys(api.session.roster.byId).length, 0);
});
