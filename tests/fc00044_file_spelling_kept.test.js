// FC-00044: a name the settings file gives keeps the file's spelling. The same name arriving in
// other capitals (schedule, timecards, a screen refresh during or after the import) only resolves
// to it; deliberate renames still win; IDs and pay never change.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, resetToSingleEntity } = require('./load-app');

const SCHED_HDR = ['Name', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shift = ['OFF', '9:00-17:00', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'];
const WEEK = ['Aug 9 2026', 'Aug 10 2026', 'Aug 11 2026', 'Aug 12 2026', 'Aug 13 2026', 'Aug 14 2026', 'Aug 15 2026'];
const H = ['Entity', 'Employee', 'Wage/hour', 'Employee ID', 'Active', 'Aliases', 'Palette'];
const cm = () => { const m = {}; H.forEach((h, i) => { m[h.toLowerCase()] = i; }); return m; };

function setup() {
  const api = loadApp();
  api.__sandbox.alert = () => {};
  api.__sandbox.confirm = () => true;
  const ent = resetToSingleEntity(api, { id: 0, name: 'Alpha Test', employees: [], dateLabels: WEEK, breakMinutes: 0, breakMinutesSet: true });
  api._syncEntityCode(ent);
  // Schedule spells one person in capitals; a timecard row does too.
  api.parseSchedule([SCHED_HDR, ['QUILL', ...shift], ['Avery Stone', ...shift]], 0);
  api.entities[0].dateLabels = WEEK.slice();
  api.ensureIntakeState(api.entities[0]);
  const r = api.processReviewRow({ empName: 'QUILL', date: '2026-08-10', clockIn1: '09:00', clockOut1: '17:00', confidence: 0.95, source: 'TC', originalName: 'x.jpg' }, api.entities[0]);
  api.entities[0].intake.reviewRows.push(r);
  api.approveReviewRow(r.id);
  api.syncActualsFromReview();
  api.setTab('payroll'); // payroll on screen: the palette column re-renders it mid-import
  return api;
}
const palette = (api) => Object.keys(api.FC14_PRESETS)[1];
const fileRows = (api, quill = 'Quill') => [
  ['Alpha Test', quill, '15', 'EMP_ALP_00001', 'Yes', '', palette(api)],
  ['Alpha Test', 'Avery Stone', '16', 'EMP_ALP_00002', 'Yes', '', palette(api)],
];
const saved = (api, id) => api.session.roster.byId[id].canonical_name;
const screens = (api) => {
  const e = api.entities[0];
  return { schedule: e.employees.map(x => x.name), rows: e.intake.reviewRows.map(x => x.empName), actuals: e.actualDays.map(x => x.empName) };
};

test('test_schedule_caps_do_not_rewrite_file_name', () => {
  const api = setup();
  api._ingestPayrollSettings(fileRows(api), cm(), false);
  assert.equal(saved(api, 'EMP_ALP_00001'), 'Quill');
  api._rerenderAll(); api.renderPayroll(); api._collectExportData();
  assert.equal(api.getRosterRecord(0, 'QUILL').id, 'EMP_ALP_00001', 'the capitals still find the person');
  assert.equal(saved(api, 'EMP_ALP_00001'), 'Quill', 'but no longer rewrite the saved name');
});

test('test_import_after_schedule_rewrites_screen_names_to_file_spelling', () => {
  const api = setup();
  api._ingestPayrollSettings(fileRows(api), cm(), false);
  assert.deepEqual(screens(api), { schedule: ['Quill', 'Avery Stone'], rows: ['Quill'], actuals: ['Quill'] });
});

test('test_name_without_file_record_unchanged', () => {
  const api = setup();
  // No settings file: the session spelling follows what arrives, as before.
  assert.equal(api.getRosterRecord(0, 'QUILL').canonical_name, 'QUILL');
  api.ensureRosterRecord(0, 'Quill');
  assert.equal(api.getRosterRecord(0, 'Quill').canonical_name, 'Quill');
});

test('test_rename_in_tool_still_wins', () => {
  const api = setup();
  api._ingestPayrollSettings(fileRows(api), cm(), false);
  assert.equal(api.renameEmployeeViaDispatcher(0, 'Quill', 'Quill Tobin', 'payroll'), true);
  api._rerenderAll(); api.renderPayroll();
  assert.equal(saved(api, 'EMP_ALP_00001'), 'Quill Tobin');
  assert.equal(screens(api).schedule[0], 'Quill Tobin');
  const out = api._gatherPayrollSettingsRows(false).find(r => r.employeeId === 'EMP_ALP_00001');
  assert.equal(out.employee, 'Quill Tobin', 'the next settings file carries the new name');
});

test('test_rename_in_file_still_wins', () => {
  const api = setup();
  api._ingestPayrollSettings(fileRows(api), cm(), false);
  // A later file changes only the capitals, then the whole name.
  api._ingestPayrollSettings(fileRows(api, 'QUILL'), cm(), false);
  assert.equal(saved(api, 'EMP_ALP_00001'), 'QUILL');
  assert.equal(screens(api).schedule[0], 'QUILL');
  api._ingestPayrollSettings(fileRows(api, 'Quill Tobin'), cm(), false);
  api._rerenderAll(); api.renderPayroll();
  assert.equal(saved(api, 'EMP_ALP_00001'), 'Quill Tobin');
  assert.deepEqual(screens(api), { schedule: ['Quill Tobin', 'Avery Stone'], rows: ['Quill Tobin'], actuals: ['Quill Tobin'] });
});

test('test_ids_and_pay_unchanged', () => {
  const api = setup();
  api._ingestPayrollSettings(fileRows(api), cm(), false);
  api.syncActualsFromReview();
  const row = api._collectExportData()[0].rows.find(r => r._empName === 'Quill');
  assert.equal(api.wKey(0, 'Quill'), 'EMP_ALP_00001');
  assert.equal(row.actualHours, 8);
  assert.equal(row._breakdown.actualFinal, 120);
});
