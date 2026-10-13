// FC-00046: a settings file applied late (after schedules and timecards, on the Payroll tab) keeps
// every person's hours on their own row. Timecard rows, review tabs and payroll follow the person
// (ID, alternate spelling, former name) — not only the exact spelling. Session-made IDs show as
// "ID pending" until a settings file is loaded. No blank records.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, resetToSingleEntity } = require('./load-app');

const SCHED_HDR = ['Name', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const mon = ['OFF', '9:00-17:00', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'];
const WEEK = ['Aug 9 2026', 'Aug 10 2026', 'Aug 11 2026', 'Aug 12 2026', 'Aug 13 2026', 'Aug 14 2026', 'Aug 15 2026'];
const H = ['Entity', 'Employee', 'Wage/hour', 'Pay Method', 'Employee ID', 'Aliases', 'Active'];
const cm = () => { const m = {}; H.forEach((h, i) => { m[h.toLowerCase()] = i; }); return m; };

// The owner's real order: first-name schedule, raw card spellings, approve — then the file.
function session(extraSched = []) {
  const api = loadApp();
  api.__sandbox.alert = () => {};
  api.__sandbox.confirm = () => true;
  const ent = resetToSingleEntity(api, { id: 0, name: 'Alpha Test', employees: [], dateLabels: WEEK, breakMinutes: 0, breakMinutesSet: true });
  api._syncEntityCode(ent);
  api.parseSchedule([SCHED_HDR, ['ROOK', ...mon], ['BRAM', ...mon], ...extraSched], 0);
  api.entities[0].dateLabels = WEEK.slice();
  api.ensureIntakeState(api.entities[0]);
  const add = (name, i, o) => {
    const r = api.processReviewRow({ empName: name, date: '2026-08-10', clockIn1: i, clockOut1: o, confidence: 0.95, source: 'TC', originalName: name + '.jpg' }, api.entities[0]);
    api.entities[0].intake.reviewRows.push(r);
    api.approveReviewRow(r.id);
    return r;
  };
  add('Rook. B', '09:00', '17:00');     // card spelling, suggests ROOK
  add('Bram Tull', '08:00', '12:30');   // full name, suggests BRAM
  api.syncActualsFromReview();
  api.setTab('payroll');
  return api;
}
// File numbers its people differently from the session (session: ROOK=1, BRAM=2).
const FILE = [
  ['Alpha Test', 'Wren Ash', '12', 'Cash', 'EMP_ALP_00001', '["WREN"]', 'No'],
  ['Alpha Test', 'Rook Bellamy', '15', 'Cash', 'EMP_ALP_00002', '["ROOK","Rook. B"]', 'Yes'],
  ['Alpha Test', 'Bram Tull', '16', 'Deposit', 'EMP_ALP_00003', '["BRAM"]', 'Yes'],
];
const hours = (api) => {
  const { results, orphanRows } = api.computePayrollForEntity(0);
  const out = {};
  results.concat(orphanRows).forEach(r => { out[(r.isOrphan ? '!' : '') + r.name] = r.actualHours; });
  return out;
};
const stage = (api, rows = FILE) => api.stageSettingsData(rows, cm(), false, [], 'test file');

test('test_late_import_keeps_people_when_ids_collide', () => {
  const api = session();
  assert.deepEqual(hours(api), { 'Rook. B': 8, 'Bram Tull': 4.5 }, 'before: hours on the schedule rows');
  stage(api); assert.equal(api.applyStagedSettings(), true);
  const h = hours(api);
  assert.deepEqual(h, { 'Rook Bellamy': 8, 'Bram Tull': 4.5 }, 'after: same hours, same rows, no orphan rows: ' + JSON.stringify(h));
  assert.equal(api.wKey(0, 'Rook Bellamy'), 'EMP_ALP_00002');
  assert.equal(api.wKey(0, 'Bram Tull'), 'EMP_ALP_00003');
  assert.equal(api.session.roster.byId.EMP_ALP_00001.canonical_name, 'Wren Ash', 'the file person keeps the file ID');
});

test('test_review_rows_follow_the_person_after_rename', () => {
  const api = session();
  stage(api); api.applyStagedSettings();
  const e = api.entities[0];
  const keys = e.intake.reviewRows.map(r => api.reviewBucketKey(r, e));
  assert.deepEqual(keys, ['Rook Bellamy', 'Bram Tull'], 'review rows land on the renamed people, not Unrecognized or a stray tab');
  assert.ok(e.intake.reviewRows.every(r => !r._suggestedName || ['Rook Bellamy', 'Bram Tull'].includes(r._suggestedName)), 'no suggestion left on an old spelling');
});

test('test_placeholder_shows_id_pending', () => {
  const api = session();
  api.renderPayroll();
  const before = api.__sandbox.document.getElementById('payrollGrid').innerHTML;
  assert.ok(before.includes('ID pending'));
  assert.ok(!/EMP_ALP_\d{5}/.test(before), 'no session number shown as if permanent');
  stage(api); api.applyStagedSettings(); api.renderPayroll();
  const after = api.__sandbox.document.getElementById('payrollGrid').innerHTML;
  assert.ok(after.includes('EMP_ALP_00002') && after.includes('EMP_ALP_00003'));
  assert.ok(!after.includes('ID pending'));
});

test('test_permanent_id_matches_first', () => {
  const api = session();
  stage(api); api.applyStagedSettings();
  // Next file: same ID, the person spelled as an alias. Same record, no new ID.
  const again = FILE.map(r => r.slice()); again[1][1] = 'ROOK';
  const n = Object.keys(api.session.roster.byId).length;
  stage(api, again); api.applyStagedSettings();
  assert.equal(Object.keys(api.session.roster.byId).length, n);
  assert.equal(api.wKey(0, 'ROOK'), 'EMP_ALP_00002');
});

test('test_temp_id_moves_every_store', () => {
  const api = session();
  const tmp = api.wKey(0, 'ROOK');
  api.setBreakOverride(0, 'ROOK', 1, 20);
  api.setFinalPassMethod(0, 'ROOK', 'cash');
  stage(api); api.applyStagedSettings();
  assert.equal(api.getBreakOverride(0, 'Rook Bellamy', 1), 20, 'break override followed the person');
  assert.equal(api.getFinalPassMethod(0, 'Rook Bellamy'), 'cash');
  assert.ok(tmp, 'had a session ID before');
});

test('test_first_name_match_unique_only', () => {
  const api = session([['QUILL', ...mon]]);
  // File without aliases: QUILL → Quill Marsh (only Quill); ROOK has two file candidates → no fold.
  const file = [
    ['Alpha Test', 'Quill Marsh', '14', 'Cash', 'EMP_ALP_00010', '', 'Yes'],
    ['Alpha Test', 'Rook Bellamy', '15', 'Cash', 'EMP_ALP_00011', '', 'Yes'],
    ['Alpha Test', 'Rook Dane', '15', 'Cash', 'EMP_ALP_00012', '', 'Yes'],
  ];
  stage(api, file); api.applyStagedSettings();
  assert.equal(api.wKey(0, 'QUILL'), 'EMP_ALP_00010', 'unique first name folds into the file person');
  const rook = api.session.roster.byId[api.wKey(0, 'ROOK')];
  assert.ok(!rook.fromFile, 'ambiguous first name stays a session person');
});

test('test_idle_lookup_record_folds_into_file_person', () => {
  const api = session();
  // A record the tool made when it looked a card spelling up: it carries nothing, so it folds in.
  api.ensureRosterRecord(0, 'Rook Bellamy');
  const file = [['Alpha Test', 'Rook Bellamy', '15', 'Cash', 'EMP_ALP_00030', '', 'Yes']];
  const st = stage(api, file);
  assert.equal(st.preview.conflicts.length, 0, JSON.stringify(st.preview.conflicts));
  api.applyStagedSettings();
  assert.equal(api.wKey(0, 'Rook Bellamy'), 'EMP_ALP_00030');
  assert.equal(Object.values(api.session.roster.byId).filter(r => r.canonical_name === 'Rook Bellamy').length, 1, 'one record, no hidden duplicate');
});

test('test_strongest_match_wins_weaker_reported', () => {
  const api = session();
  // A session person holding data under the exact file name, plus ROOK (first name only).
  api.ensureRosterRecord(0, 'Rook Bellamy');
  api.wageRates[api.wKey(0, 'Rook Bellamy')] = 9;
  const file = [['Alpha Test', 'Rook Bellamy', '15', 'Cash', 'EMP_ALP_00030', '', 'Yes']];
  const st = stage(api, file);
  assert.equal(st.preview.conflicts.length, 1);
  assert.equal(st.preview.conflicts[0].matched, 'Rook Bellamy');
  assert.deepEqual(st.preview.conflicts[0].separate, ['ROOK']);
  api.applyStagedSettings();
  assert.equal(api.wKey(0, 'Rook Bellamy'), 'EMP_ALP_00030', 'exact name merged');
  assert.notEqual(api.wKey(0, 'ROOK'), 'EMP_ALP_00030', 'first-name match left separate');
  assert.equal(Object.values(api.session.roster.byId).filter(r => r.canonical_name === 'Rook Bellamy').length, 1);
});

test('test_first_name_never_folds_into_archived', () => {
  const api = session([['THANE', ...mon]]);
  api.wageRates[api.wKey(0, 'THANE')] = 11;
  const file = [['Alpha Test', 'Thane Ivers', '25', 'Cash', 'EMP_ALP_00007', '', 'No']];
  stage(api, file); api.applyStagedSettings();
  assert.equal(api.entities[0].employees.map(e => e.name).includes('THANE'), true, 'schedule row not renamed');
  assert.notEqual(api.wKey(0, 'THANE'), 'EMP_ALP_00007');
  assert.equal(api.wageRates[api.wKey(0, 'THANE')], 11, 'rate unchanged');
  assert.equal(api.isRosterActive(0, 'Thane Ivers'), false, 'archived person stays archived');
});

test('test_unmatched_session_person_kept_with_new_id', () => {
  const api = session([['OZZIE', ...mon]]);
  const pv = stage(api).preview;
  assert.ok(pv.notInFile.some(x => x.name === 'OZZIE'), JSON.stringify(pv.notInFile));
  api.applyStagedSettings();
  const id = api.wKey(0, 'OZZIE');
  assert.equal(id, 'EMP_ALP_00004', 'continues after the file\'s highest ID');
  assert.ok(!api.session.roster.byId[id].fromFile);
});

test('test_no_blank_records_after_import_or_render', () => {
  const api = session();
  const r = api.processReviewRow({ empName: '', date: '2026-08-10', clockIn1: '09:00', clockOut1: '10:00', confidence: 0.5, source: 'TC', originalName: 'blank.jpg' }, api.entities[0]);
  api.entities[0].intake.reviewRows.push(r);
  api.wKey(0, ''); api.ensureRosterRecord(0, '');
  api._rerenderAll(); api.renderPayroll(); api.renderIntake();
  const blank = () => Object.values(api.session.roster.byId).filter(x => !x.canonical_name).length;
  assert.equal(blank(), 0, 'an empty lookup never creates a record');
  // A blank left by an older session is dropped by the next settings import.
  api.session.roster.byId.EMP_ALP_00099 = { id: 'EMP_ALP_00099', canonical_name: '', entity: 0, aliases: [], rate: null, pay_method: 'deposit', final_pass_method: '', deposit_amount: null, flat_amount: null, active: true, notes: '' };
  stage(api); api.applyStagedSettings();
  assert.equal(blank(), 0);
});

test('test_archived_with_hours_flagged_and_paid', () => {
  const api = session();
  const file = FILE.map(r => r.slice()); file[2][6] = 'No'; // Bram archived in the file, but worked
  const st = stage(api, file);
  assert.ok(st.preview.archivedWorked.some(x => x.name === 'Bram Tull' && x.hours === 4.5), JSON.stringify(st.preview.archivedWorked));
  api.applyStagedSettings();
  assert.equal(api.isRosterActive(0, 'Bram Tull'), true, 'kept active');
  const rows = [];
  api._collectExportData().forEach(d => d.rows.forEach(r => rows.push(r)));
  assert.ok(rows.some(r => r._empName === 'Bram Tull' && r.actualHours === 4.5), 'still paid');
});

test('test_preview_equals_apply_late_import', () => {
  const api = session([['OZZIE', ...mon]]);
  const st = stage(api);
  const expected = JSON.stringify(st.simAfter.roster);
  api.applyStagedSettings();
  const got = JSON.stringify(api._captureState().roster);
  assert.equal(got, expected);
});
