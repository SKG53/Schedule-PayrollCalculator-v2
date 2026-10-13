// FC-00048: Unrecognized rows grouped by the name OCR read, each group with "Add as new employee";
// "+ New employee…" in the name dropdown; a new person's missing rate is red and listed before
// export; the person is in the next settings file; "(orphan)" no longer prints on exports.
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { loadApp, resetToSingleEntity } = require('./load-app');

const SCHED_HDR = ['Name', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const mon = ['OFF', '9:00-17:00', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'];
const WEEK = ['Aug 9 2026', 'Aug 10 2026', 'Aug 11 2026', 'Aug 12 2026', 'Aug 13 2026', 'Aug 14 2026', 'Aug 15 2026'];
const H = ['Entity', 'Employee', 'Wage/hour', 'Pay Method', 'Employee ID', 'Aliases', 'Active'];
const cm = () => { const m = {}; H.forEach((h, i) => { m[h.toLowerCase()] = i; }); return m; };

function setup({ file = false } = {}) {
  const api = loadApp();
  api.__sandbox.alert = () => {};
  api.__sandbox.confirm = () => true;
  api.__sandbox.crypto = webcrypto;
  const ent = resetToSingleEntity(api, { id: 0, name: 'Alpha Test', employees: [], dateLabels: WEEK, breakMinutes: 0, breakMinutesSet: true });
  api._syncEntityCode(ent);
  if (file) api._ingestPayrollSettings([['Alpha Test', 'Rook Bellamy', '15', 'Cash', 'EMP_ALP_00003', '["ROOK"]', 'Yes']], cm(), false);
  api.parseSchedule([SCHED_HDR, ['ROOK', ...mon]], 0);
  const e = api.entities[0];
  e.dateLabels = WEEK.slice();
  api.ensureIntakeState(e);
  const add = (name, i = '09:00', o = '17:00') => {
    const r = api.processReviewRow({ empName: name, date: '2026-08-10', clockIn1: i, clockOut1: o, confidence: 0.95, source: 'TC', originalName: name + '.jpg' }, e);
    e.intake.reviewRows.push(r); api.approveReviewRow(r.id); return r;
  };
  add('ROOK');
  const o1 = add('Ozzie Lark', '08:00', '12:00'), o2 = add('Ozzie Lark', '13:00', '15:00'), p1 = add('Pip Moss', '10:00', '14:00');
  api.syncActualsFromReview();
  api.setTab('intake');
  return { api, e, o1, o2, p1 };
}

test('test_unrecognized_grouped_by_ocr_name', () => {
  const { api, e } = setup();
  const un = e.intake.reviewRows.filter(r => api.reviewBucketKey(r, e) === '__unrecognized__');
  const g = api._unrecognizedGroups(e, un);
  assert.deepEqual(g.map(x => [x.name, x.rows.length]), [['Ozzie Lark', 2], ['Pip Moss', 1]]);
  e.intake.activeEmpTab = '__unrecognized__';
  const html = api.renderReviewTableHtml(e, 0);
  assert.equal((html.match(/Add as new employee/g) || []).length, 2);
});

test('test_add_as_new_creates_next_permanent_id', () => {
  const { api, e } = setup({ file: true });
  const rec = api.addNewEmployee(0, 'Ozzie Lark', 'Ozzie Lark');
  assert.equal(rec.id, 'EMP_ALP_00004', 'continues after the settings file\'s highest ID');
  assert.equal(rec.addedNew, true);
  const keys = e.intake.reviewRows.filter(r => r.empName === 'Ozzie Lark').map(r => api.reviewBucketKey(r, e));
  assert.deepEqual(keys, ['Ozzie Lark', 'Ozzie Lark'], 'both rows moved to the new person');
  assert.equal(e.intake.activeEmpTab, 'Ozzie Lark', 'the screen switches to their tab');
  const html = api.renderReviewTableHtml(e, 0);
  assert.ok(html.includes('Ozzie Lark <span style="font-size:10px;color:var(--text3)">(not on schedule)</span>'), 'own tab');
});

test('test_add_as_new_without_file_shows_id_pending', () => {
  const { api } = setup();
  api.addNewEmployee(0, 'Ozzie Lark', 'Ozzie Lark');
  assert.equal(api._empIdText(0, 'Ozzie Lark'), 'ID pending');
});

test('test_new_employee_from_dropdown', () => {
  const { api, e, p1 } = setup();
  api.__sandbox.prompt = () => 'Pip Moss';
  api.updateReviewField(p1.id, 'empName', '__new__');
  assert.equal(p1.empName, 'Pip Moss');
  assert.equal(api.session.roster.byId[api.wKey(0, 'Pip Moss')].addedNew, true);
  assert.equal(api.reviewBucketKey(p1, e), 'Pip Moss');
  const html = api.renderReviewTableHtml(e, 0);
  assert.ok(html.includes('+ New employee…'), 'dropdown offers a new employee');
});

test('test_two_new_hires_two_groups_nothing_created_before_click', () => {
  const { api, e } = setup();
  const before = Object.values(api.session.roster.byId).filter(r => r.addedNew).length;
  e.intake.activeEmpTab = '__unrecognized__';
  api.renderReviewTableHtml(e, 0); api.renderPayroll();
  assert.equal(Object.values(api.session.roster.byId).filter(r => r.addedNew).length, before);
  assert.equal(api._unrecognizedGroups(e, e.intake.reviewRows.filter(r => api.reviewBucketKey(r, e) === '__unrecognized__')).length, 2);
});

test('test_move_row_saves_alias', () => {
  const { api, e } = setup();
  api.addNewEmployee(0, 'Ozzie Larkin', 'Ozzie Lark');
  assert.deepEqual(api.getAliases(0, 'Ozzie Larkin'), ['Ozzie Lark']);
  assert.equal(e.intake.reviewRows.filter(r => r.empName === 'Ozzie Larkin').length, 2);
  const r = api.processReviewRow({ empName: 'Ozzie Lark', date: '2026-08-11', clockIn1: '09:00', clockOut1: '10:00', confidence: 0.9, source: 'TC', originalName: 'y.jpg' }, e);
  assert.equal(api.reviewBucketKey(r, e), 'Ozzie Larkin', 'the spelling lands on them next time');
});

test('test_missing_rate_red_and_listed', () => {
  const { api } = setup();
  api.addNewEmployee(0, 'Ozzie Lark', 'Ozzie Lark');
  api.syncActualsFromReview();
  api.setTab('payroll'); api.renderPayroll();
  assert.ok(api._rateMissingNames().includes('Ozzie Lark'), JSON.stringify(api._rateMissingNames()));
  assert.ok(api.downloadStatus('payroll').reasons.some(x => x.startsWith('Rate missing:') && x.includes('Ozzie Lark')));
  const calc = api.__sandbox.document.getElementById('payrollCalcTable').innerHTML;
  assert.ok(calc.includes('rate-missing'));
});

test('test_new_person_in_settings_export', () => {
  const { api } = setup({ file: true });
  api.addNewEmployee(0, 'Ozzie Lark', 'Ozzie Lark');
  api.syncActualsFromReview();
  const row = api._gatherPayrollSettingsRows(false).find(r => r.employee === 'Ozzie Lark');
  assert.ok(row, 'in the settings file');
  assert.equal(row.employeeId, 'EMP_ALP_00004');
});

test('test_no_orphan_label_on_exports', async () => {
  const { api } = setup();
  api.addNewEmployee(0, 'Ozzie Lark', 'Ozzie Lark');
  api.syncActualsFromReview();
  await api._exportExcel('combined');
  const flat = JSON.stringify(api.__lastExcelWorkbook.worksheets.map(w => w.rows.map(r => (r || []).map(c => c && c.value))));
  assert.ok(flat.includes('Ozzie Lark'));
  assert.ok(!/orphan/i.test(flat), 'no "(orphan)" label');
});

test('test_reactivate_archived_from_review', () => {
  const api = loadApp();
  api.__sandbox.alert = () => {}; api.__sandbox.confirm = () => true;
  const ent = resetToSingleEntity(api, { id: 0, name: 'Alpha Test', employees: [], dateLabels: WEEK, breakMinutes: 0, breakMinutesSet: true });
  api._syncEntityCode(ent);
  api._ingestPayrollSettings([['Alpha Test', 'Wren Ash', '12', 'Cash', 'EMP_ALP_00001', '["WREN"]', 'No']], cm(), false);
  api.parseSchedule([SCHED_HDR, ['ROOK', ...mon]], 0);
  const e = api.entities[0]; e.dateLabels = WEEK.slice(); api.ensureIntakeState(e);
  const r = api.processReviewRow({ empName: 'WREN', date: '2026-08-10', clockIn1: '09:00', clockOut1: '17:00', confidence: 0.95, source: 'TC', originalName: 'w.jpg' }, e);
  e.intake.reviewRows.push(r);
  e.intake.activeEmpTab = '__unrecognized__';
  assert.ok(api.renderReviewTableHtml(e, 0).includes('Reactivate'));
  api.reactivateFromReview(0, 'WREN');
  assert.equal(api.isRosterActive(0, 'Wren Ash'), true);
  assert.equal(r.empName, 'Wren Ash');
  assert.equal(api.reviewBucketKey(r, e), 'Wren Ash');
});

test('test_new_employee_name_of_archived_person_refused', () => {
  const api = loadApp();
  let said = '';
  api.__sandbox.alert = (m) => { said = m; };
  api.__sandbox.confirm = () => true;
  const ent = resetToSingleEntity(api, { id: 0, name: 'Alpha Test', employees: [], dateLabels: WEEK, breakMinutes: 0, breakMinutesSet: true });
  api._syncEntityCode(ent);
  api._ingestPayrollSettings([['Alpha Test', 'Wren Ash', '12', 'Cash', 'EMP_ALP_00001', '', 'No']], cm(), false);
  const rec = api.addNewEmployee(0, 'Wren Ash', null);
  assert.equal(rec, null, 'not added');
  assert.ok(said.includes('archived') && said.includes('Reactivate'), said);
  assert.equal(api.isRosterActive(0, 'Wren Ash'), false);
});

test('test_new_employee_name_of_scheduled_person_not_marked_new', () => {
  const { api, e } = setup();
  const rec = api.addNewEmployee(0, 'ROOK', 'Pip Moss');
  assert.ok(!rec.addedNew, 'a scheduled person is not marked as newly added');
  assert.equal(api.reviewBucketKey(e.intake.reviewRows.find(r => r.rawOcrName === 'Pip Moss' || r.empName === 'ROOK'), e), 'ROOK');
});
