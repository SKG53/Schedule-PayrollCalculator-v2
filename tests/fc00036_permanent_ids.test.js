// FC-00036: permanent employee IDs. The settings (master) file owns each person's ID and
// canonical name; aliases, other cases and punctuation all land on that one ID; new people
// continue after the highest ID; and the order files are loaded in never changes an ID or
// a dollar.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, resetToSingleEntity } = require('./load-app');

const HEADERS = ['Entity', 'Employee', 'Wage/hour', 'Type', 'Pay Method', 'Employee ID', 'Aliases', 'Active'];
const colMap = () => { const m = {}; HEADERS.forEach((h, i) => { m[h.toLowerCase()] = i; }); return m; };
const SCHED_HDR = ['Name', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shift = ['OFF', '9:00-17:00', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'];

function fresh() {
  const api = loadApp();
  api.__sandbox.alert = () => {};
  const ent = resetToSingleEntity(api, { id: 0, name: 'Test Co', employees: [] });
  api._syncEntityCode(ent);
  return { api, ent, code: ent.code };
}
const id = (code, n) => `EMP_${code}_${String(n).padStart(5, '0')}`;
function settingsRows(code) {
  // File people: 00001 Avery Stone, 00002 Beacon Mortar (alias BEACON), 00004 Casey Parcel
  // (inactive, not on the schedule). 00003 is a gap and must never be reused.
  return [
    ['Test Co', 'Avery Stone', '15', 'Hourly', 'Cash', id(code, 1), '', 'Yes'],
    ['Test Co', 'Beacon Mortar', '20', 'Hourly', 'Deposit', id(code, 2), '["BEACON","Beacon M"]', 'Yes'],
    ['Test Co', 'Casey Parcel', '18', 'Hourly', 'Deposit', id(code, 4), '', 'No'],
  ];
}
const schedule = () => [SCHED_HDR, ['BEACON', ...shift], ['avery  stone.', ...shift], ['Dune New', ...shift]];
function actuals(api) {
  const ent = api.entities[0];
  ent.actualDays = ['Beacon Mortar', 'Avery Stone', 'Dune New'].map(empName => ({ empName, entityName: 'Test Co', date: '2026-08-10', dayIdx: 1, pairs: [{ in: 9, out: 17, outAdj: 17, minutes: 480 }] }));
}
function load(order) {
  const { api, code } = fresh();
  const steps = {
    settings: () => api._ingestPayrollSettings(settingsRows(code), colMap(), false),
    schedule: () => api.parseSchedule(schedule(), 0),
  };
  order.forEach(s => steps[s]());
  actuals(api);
  return { api, code };
}
const snapshot = (api) => api._collectExportData()[0].rows
  .map(r => ({ name: r._empName, id: api._employeeIdFor(0, r._empName), pay: r._breakdown.actualFinal }))
  .sort((a, b) => a.id.localeCompare(b.id));

test('test_alias_norm_ignores_case_periods_and_spaces', () => {
  const { api } = fresh();
  assert.equal(api._aliasNorm('devon. P'), api._aliasNorm('Devon P.'));
  assert.equal(api._aliasNorm('  DEVON   P '), 'devon p');
});

test('test_schedule_alias_and_spelling_land_on_file_person', () => {
  const { api, code } = load(['settings', 'schedule']);
  const names = api.entities[0].employees.map(e => e.name);
  assert.deepEqual(names, ['Beacon Mortar', 'Avery Stone', 'Dune New'], 'schedule loads under canonical names');
  assert.equal(api._employeeIdFor(0, 'Beacon Mortar'), id(code, 2));
  assert.equal(api._employeeIdFor(0, 'BEACON'), id(code, 2), 'alias resolves to the same ID');
  const snap = snapshot(api);
  assert.deepEqual(snap.find(r => r.name === 'Beacon Mortar'), { name: 'Beacon Mortar', id: id(code, 2), pay: 160 });
});

test('test_new_employee_continues_after_highest_file_id', () => {
  const { api, code } = load(['settings', 'schedule']);
  assert.equal(api._employeeIdFor(0, 'Dune New'), id(code, 5), 'gap 00003 is never reused');
});

test('test_load_order_never_changes_ids_or_pay', () => {
  const a = snapshot(load(['settings', 'schedule']).api);
  const b = snapshot(load(['schedule', 'settings']).api);
  assert.deepEqual(b, a);
});

test('test_schedule_first_squatter_is_moved_not_renamed', () => {
  // Schedule first mints BEACON=00001, avery=00002, Dune=00003. The file then claims 00001 for
  // Avery Stone: the provisional BEACON record must not be renamed into Avery.
  const { api, code } = load(['schedule', 'settings']);
  assert.equal(api._employeeIdFor(0, 'Avery Stone'), id(code, 1));
  assert.equal(api.wageRates[id(code, 1)], 15);
  assert.equal(api.wageRates[id(code, 2)], 20);
  assert.equal(api.getPayMethod(0, 'Avery Stone'), 'cash');
  assert.deepEqual(api.entities[0].employees.map(e => e.name), ['Beacon Mortar', 'Avery Stone', 'Dune New']);
  assert.equal(api.hasDuplicateNames(0), false);
});

test('test_settings_export_keeps_everyone_from_file_sorted_by_id', () => {
  const { api, code } = load(['settings', 'schedule']);
  const rows = api._gatherPayrollSettingsRows(false);
  assert.deepEqual(rows.map(r => r.employeeId), [id(code, 1), id(code, 2), id(code, 4), id(code, 5)]);
  const casey = rows.find(r => r.employee === 'Casey Parcel');
  assert.equal(casey.active, 'No', 'inactive, unscheduled file person stays in the master file');
});

test('test_ocr_alias_matches_even_when_not_on_schedule', () => {
  const { api } = load(['settings']);
  const m = api.matchEmployeeName('Beacon M', api.entities[0]);
  assert.equal(m.exact, 'Beacon Mortar');
  assert.equal(api.matchEmployeeName('CASEY PARCEL', api.entities[0]).exact, 'Casey Parcel');
});
