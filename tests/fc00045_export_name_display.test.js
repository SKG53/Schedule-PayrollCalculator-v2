// FC-00045: choose how names print on exports — As saved, FIRST LAST, FIRST — for all exports
// at once or per export. Printing only: IDs, saved names, the settings file and the reviewed
// timecards never change.
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { loadApp, resetToSingleEntity } = require('./load-app');

const WEEK = ['Aug 9 2026', 'Aug 10 2026', 'Aug 11 2026', 'Aug 12 2026', 'Aug 13 2026', 'Aug 14 2026', 'Aug 15 2026'];
const SCHED_HDR = ['Name', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shift = ['OFF', '9:00-17:00', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'];
const PEOPLE = ['Avery Stone', 'Avery Tobin', 'Bram M.', 'Quill Pell', 'Quill Penn', 'Wren'];

function setup() {
  const api = loadApp();
  api.__sandbox.alert = () => {};
  api.__sandbox.confirm = () => true;
  api.__sandbox.crypto = webcrypto;
  const ent = resetToSingleEntity(api, { id: 0, name: 'Alpha Test', employees: [], dateLabels: WEEK, breakMinutes: 0, breakMinutesSet: true });
  api._syncEntityCode(ent);
  api.parseSchedule([SCHED_HDR, ...PEOPLE.map(n => [n, ...shift])], 0);
  const e = api.entities[0];
  e.dateLabels = WEEK.slice();
  api.ensureIntakeState(e);
  PEOPLE.forEach(n => {
    const r = api.processReviewRow({ empName: n, date: '2026-08-10', clockIn1: '09:00', clockOut1: '17:00', confidence: 0.95, source: 'TC', originalName: 'x.jpg' }, e);
    e.intake.reviewRows.push(r);
    api.approveReviewRow(r.id);
    api.dispatch({ type: 'wage', screen: 'payroll', target: { kind: 'employee', entity: 0, id: api.wKey(0, n), field: 'wage' }, from: null, to: 10, meta: { empName: n } });
  });
  api.dispatch({ type: 'flatWage', screen: 'payroll', target: { kind: 'employee', entity: 0, id: api.wKey(0, 'Wren'), field: 'flatWage' }, from: null, to: 100, meta: { empName: 'Wren' } });
  api.syncActualsFromReview();
  api._rerenderAll();
  return api;
}
async function printed(api, kind = 'combined') {
  await api._exportExcel(kind);
  const ws = api.__lastExcelWorkbook.worksheets[0];
  const header = ws.rows.findIndex(r => r && r.some(c => c && c.value === 'Employee'));
  const col = ws.rows[header].findIndex(c => c && c.value === 'Employee');
  return ws.rows.slice(header + 1).filter(r => r && r[col] && typeof r[col].value === 'string' && r[1] && r[1].value === 'Alpha Test').map(r => r[col].value);
}
const sig = (api) => api._stateSig(api._captureState());

test('test_three_options_format_names', async () => {
  const api = setup();
  assert.deepEqual(await printed(api), ['Avery Stone', 'Avery Tobin', 'Bram M.', 'Quill Pell', 'Quill Penn', 'Wren (flat)']);
  api.setExportNameMode('all', 'firstLast');
  assert.deepEqual(await printed(api), ['AVERY STONE', 'AVERY TOBIN', 'BRAM M.', 'QUILL PELL', 'QUILL PENN', 'WREN (flat)']);
  api.setExportNameMode('all', 'first');
  const first = await printed(api);
  assert.equal(first[2], 'BRAM');
  assert.equal(first[5], 'WREN (flat)');
});

test('test_first_only_disambiguates_within_entity', async () => {
  const api = setup();
  api.setExportNameMode('all', 'first');
  // Two Averys: different last initials. Two Quills: same initial P, so full names.
  assert.deepEqual(await printed(api), ['AVERY S.', 'AVERY T.', 'BRAM', 'QUILL PELL', 'QUILL PENN', 'WREN (flat)']);
  // In another entity, a lone Avery is just AVERY.
  api.entities.push({ id: 1, name: 'Beta Test', code: '', employees: [], dateLabels: WEEK.slice(), newDateLabels: ['', '', '', '', '', '', ''], newWeekStartVal: '', breakMinutes: 0, breakMinutesSet: true, actualDays: [], intake: null });
  api._syncEntityCode(api.entities[1]);
  api.parseSchedule([SCHED_HDR, ['Avery Stone', ...shift]], 1);
  await api.exportManager(1);
  const ws = api.__lastExcelWorkbook.worksheets[0];
  assert.equal(ws.rows[3][1].value, 'AVERY');
});

test('test_same_for_all_vs_per_export_toggle', async () => {
  const api = setup();
  api.setExportNameMode('all', 'firstLast');
  api.setExportNameScope('per');
  api.setExportNameMode('cashOnly', 'first');
  api.setDownloadTick && api.renderDownloadsPanel();
  assert.equal(api.exportNameMode('payroll'), 'firstLast', 'an export with no own choice follows "all"');
  assert.equal(api.exportNameMode('cashOnly'), 'first');
  const html = api.__sandbox.document.getElementById('downloadsHost').innerHTML;
  assert.match(html, /Per export/);
  assert.equal((html.match(/class="dl-line-names"/g) || []).length, 7, 'one name choice on each of the seven export lines');
  api.setExportNameScope('all');
  assert.equal(api.exportNameMode('cashOnly'), 'firstLast', 'Same for all wins while it is on');
  api.setExportNameScope('per');
  assert.equal(api.exportNameMode('cashOnly'), 'first', 'the per-export choice was kept');
});

test('test_settings_and_timecards_keep_saved_names', async () => {
  const api = setup();
  const before = sig(api);
  api.setExportNameMode('all', 'first');
  await api.exportPayrollSettingsExcel(false);
  const st = api.__lastExcelWorkbook.worksheets[0];
  assert.ok(st.rows.some(r => r && r[2] && r[2].value === 'Avery Stone'));
  assert.ok(!st.rows.some(r => r && r[2] && r[2].value === 'AVERY S.'));
  await api.exportActualsIntakeExcel();
  const flat = JSON.stringify(api.__lastExcelWorkbook.worksheets.map(w => w.rows.map(r => (r || []).map(c => c && c.value))));
  assert.ok(flat.includes('"Avery Stone"') && !flat.includes('AVERY S.'));
  // Only the tool settings changed; names and IDs did not.
  const st2 = JSON.parse(api._stateSig(api._captureState())), st1 = JSON.parse(before);
  assert.deepEqual(st2.roster, st1.roster);
  assert.deepEqual(st2.entities, st1.entities);
});

test('test_flat_label_kept_and_unrecognized_names_follow_option', async () => {
  const api = setup();
  const e = api.entities[0];
  const r = api.processReviewRow({ empName: 'Ozzie Rook', date: '2026-08-10', clockIn1: '09:00', clockOut1: '12:00', confidence: 0.95, source: 'TC', originalName: 'x.jpg' }, e);
  e.intake.reviewRows.push(r);
  api.approveReviewRow(r.id);
  api.syncActualsFromReview();
  api.setExportNameMode('all', 'firstLast');
  const names = await printed(api);
  assert.ok(names.includes('OZZIE ROOK (orphan)'), names.join(' | '));
  assert.ok(names.includes('WREN (flat)'));
});

test('test_choice_saved_in_settings_file_and_snapshot', async () => {
  const api = setup();
  api.setExportNameScope('per');
  api.setExportNameMode('all', 'firstLast');
  api.setExportNameMode('payroll', 'first');
  await api.exportPayrollSettingsExcel(false);
  const ts = api.__lastExcelWorkbook.worksheets.find(w => w.name === 'Tool Settings');
  const rows = ts.rows.slice(2).map(r => [r[1].value, r[2].value]);
  assert.deepEqual(rows.filter(r => /^Names on exports/.test(r[0])), [
    ['Names on exports · same or per export', 'Per export'],
    ['Names on exports · all exports', 'FIRST LAST'],
    ['Names on exports · Payroll report', 'FIRST'],
  ]);
  const b = setup();
  b._ingestToolSettings(rows);
  assert.equal(b.exportNameMode('payroll'), 'first');
  assert.equal(b.exportNameMode('cashOnly'), 'firstLast');
  const snap = JSON.parse(JSON.stringify(await api.buildSnapshot()));
  const c = loadApp(); c.__sandbox.confirm = () => true;
  c.openSnapshotData(snap);
  assert.equal(c.exportNameMode('payroll'), 'first');
});

test('test_pay_and_ids_unchanged', async () => {
  const api = setup();
  const pay = () => JSON.stringify(api._collectExportData()[0].rows.map(r => [api.wKey(0, r._empName), r.actualHours, r._breakdown.actualFinal, r._breakdown.deposit, r._breakdown.cash]));
  const p0 = pay();
  await api._exportExcel('combined');
  const f0 = JSON.stringify(api.__lastExcelWorkbook.worksheets[0].rows.map(r => (r || []).slice(3).map(c => c && c.value)));
  api.setExportNameMode('all', 'first');
  assert.equal(pay(), p0);
  await api._exportExcel('combined');
  const f1 = JSON.stringify(api.__lastExcelWorkbook.worksheets[0].rows.map(r => (r || []).slice(3).map(c => c && c.value)));
  assert.equal(f1, f0, 'every column after the name is identical, formulas included');
});

test('test_printed_name_is_the_person_who_is_paid', async () => {
  // A punch spelled with one person's former name that is also another person's alias:
  // pay goes to the former-name owner, so the printed name must be theirs too.
  const api = setup();
  api.renameEmployeeViaDispatcher(0, 'Avery Stone', 'Averill Stone', 'payroll');
  api.setAliases(0, 'Averill Stone', []);
  api.setAliases(0, 'Avery Tobin', ['Avery Stone']);
  const paidId = api.wKey(0, 'Avery Stone');
  const fmt = api._makeNameFormatter('payroll');
  assert.equal(api.session.roster.byId[paidId].canonical_name, fmt(0, 'Avery Stone'));
});
