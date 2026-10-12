// FC-00040: Downloads list. One line per export with format ticks, the exact file names, and
// a status that never blocks; "Download selected" saves each ticked file and "Download all"
// saves one zip with exactly the ticked files. The accountant line is a disabled placeholder.
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { loadApp, resetToSingleEntity } = require('./load-app');

const WEEK = ['Aug 9 2026', 'Aug 10 2026', 'Aug 11 2026', 'Aug 12 2026', 'Aug 13 2026', 'Aug 14 2026', 'Aug 15 2026'];
const SCHED_HDR = ['Name', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shift = ['OFF', '9:00-17:00', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'];
const STEM = 'Nirvana_Zion_0809to0815';

function setup() {
  const api = loadApp();
  api.__sandbox.alert = () => {};
  api.__sandbox.confirm = () => true;
  api.__sandbox.crypto = webcrypto;
  const a = resetToSingleEntity(api, { id: 0, name: 'NIRVANA 11TH', employees: [], dateLabels: WEEK, breakMinutes: 0, breakMinutesSet: true });
  api._syncEntityCode(a);
  api.entities.push({ id: 1, name: 'ZION', code: '', employees: [], dateLabels: WEEK.slice(), newDateLabels: ['', '', '', '', '', '', ''], newWeekStartVal: '', breakMinutes: 0, breakMinutesSet: true, actualDays: [], intake: null });
  api._syncEntityCode(api.entities[1]);
  api.parseSchedule([SCHED_HDR, ['Ann Able', ...shift]], 0);
  api.parseSchedule([SCHED_HDR, ['Bo Best', ...shift]], 1);
  api.entities.forEach(e => { e.dateLabels = WEEK.slice(); api.ensureIntakeState(e); });
  const rows = [];
  [[0, 'Ann Able'], [1, 'Bo Best']].forEach(([i, n]) => {
    const e = api.entities[i];
    const r = api.processReviewRow({ empName: n, date: '2026-08-10', clockIn1: '09:00', clockOut1: '17:00', confidence: 0.95, source: 'TC', originalName: 'x.jpg' }, e);
    e.intake.reviewRows.push(r); rows.push(r);
    api.dispatch({ type: 'wage', screen: 'payroll', target: { kind: 'employee', entity: e.id, id: api.wKey(e.id, n), field: 'wage' }, from: null, to: 15, meta: { empName: n } });
  });
  api.approveReviewRow(rows[0].id);
  api.approveReviewRow(rows[1].id);
  api.syncActualsFromReview();
  api._rerenderAll();
  // Capture what the browser would save: each <a download> click.
  const saved = [];
  api.__sandbox.document.createElement = () => { const el = { style: {}, click() { saved.push(el.download); } }; return el; };
  return { api, rows, saved };
}

test('test_lists_every_export_with_defaults', () => {
  const { api } = setup();
  assert.deepEqual(api.DOWNLOADS.map(d => d.key), ['payroll', 'timecards', 'settings', 'snapshot', 'accountant', 'cashOnly', 'depositOnly', 'timecardData', 'payrollCalc', 'full', 'manager']);
  const ticks = Object.fromEntries(api.DOWNLOADS.map(d => [d.key, Object.keys(d.formats).filter(f => api.downloadFileNames(d.key).some(n => n.endsWith('.' + f))).join('+')]));
  assert.deepEqual(ticks, { payroll: 'xlsx+pdf', timecards: 'xlsx', settings: 'xlsx', snapshot: 'json', accountant: '', cashOnly: '', depositOnly: '', timecardData: '', payrollCalc: '', full: '', manager: '' });
  api.renderDownloadsPanel();
  const html = api.__sandbox.document.getElementById('downloadsHost').innerHTML;
  for (const t of ['Payroll report', 'Reviewed timecards', 'Settings (new master)', 'Snapshot', 'Accountant file', 'Cash-only report', 'Manager schedule report', 'Download selected', 'Download all (.zip)']) assert.ok(html.includes(t), t);
});

test('test_file_names_follow_convention', () => {
  const { api } = setup();
  assert.deepEqual(api.downloadFileNames('payroll'), [STEM + '_AllEmployeesPayroll.xlsx', STEM + '_AllEmployeesPayroll.pdf']);
  assert.deepEqual(api.downloadFileNames('timecards'), [STEM + '_AllEmployeesTimecards.xlsx']);
  assert.deepEqual(api.downloadFileNames('settings'), [STEM + '_AllEmployeesPayroll_Settings.xlsx']);
  assert.deepEqual(api.downloadFileNames('snapshot'), [STEM + '_Snapshot.json']);
  // An edited label is used everywhere and saved in the settings file.
  api.setEntityFileLabel(1, 'Zion Dist!');
  assert.deepEqual(api.downloadFileNames('snapshot'), ['Nirvana_ZionDist_0809to0815_Snapshot.json']);
  return api.exportPayrollSettingsExcel(false).then(() => {
    const ts = api.__lastExcelWorkbook.worksheets.find(w => w.name === 'Tool Settings');
    const rows = ts.rows.slice(2).map(r => [r[1].value, r[2].value]);
    assert.deepEqual(rows.at(-1), ['File label · ZION', 'ZionDist']);
    const { api: b } = setup();
    b._ingestToolSettings([['File label · ZION', 'ZionDist']]);
    assert.deepEqual(b.downloadFileNames('snapshot'), ['Nirvana_ZionDist_0809to0815_Snapshot.json'], 'label comes back from the settings file');
  });
});

test('test_status_reports_unapproved_and_exclusions', () => {
  const { api, rows } = setup();
  assert.deepEqual(api.downloadStatus('payroll'), { ok: true, reasons: [] });
  api.unapproveReviewRow(rows[1].id);
  api.entities[0].breakMinutesSet = false;
  api.setRosterActive(0, 'Ann Able', false);
  api.syncActualsFromReview();
  const st = api.downloadStatus('payroll');
  assert.equal(st.ok, false);
  assert.ok(st.reasons.includes('ZION: 1 row not approved'), st.reasons.join(' | '));
  assert.ok(st.reasons.includes('Active unchecked with hours: Ann Able'), st.reasons.join(' | '));
  assert.ok(st.reasons.includes('Break not confirmed: NIRVANA 11TH'), st.reasons.join(' | '));
  assert.deepEqual(api.downloadStatus('timecards').reasons, ['ZION: 1 row not approved']);
  api.renderDownloadsPanel();
  assert.match(api.__sandbox.document.getElementById('downloadsHost').innerHTML, /⚠ ZION: 1 row not approved/);
});

test('test_download_selected_writes_each_file', async () => {
  const { api, saved } = setup();
  const files = await api.downloadSelected();
  assert.deepEqual(saved, [STEM + '_AllEmployeesPayroll.xlsx', STEM + '_AllEmployeesPayroll.pdf', STEM + '_AllEmployeesTimecards.xlsx', STEM + '_AllEmployeesPayroll_Settings.xlsx', STEM + '_Snapshot.json']);
  assert.ok(files.every(f => f.data), 'every file has content');
  assert.equal(JSON.parse(files.find(f => f.name.endsWith('.json')).data).schema, 'SPCalcSessionSnapshot');
  assert.equal(api.hasUnsavedChanges(), false, 'a downloaded snapshot counts as saved');
});

test('test_zip_contains_ticked_files_only', async () => {
  const { api, saved } = setup();
  const zips = [];
  api.__sandbox.JSZip = class { constructor() { this.files = {}; zips.push(this); } file(n, d) { this.files[n] = d; } async generateAsync() { return new api.__sandbox.Blob(); } };
  api.setDownloadTick('payroll', 'pdf', false);
  api.setDownloadTick('snapshot', 'json', false);
  api.setDownloadTick('cashOnly', 'pdf', true);
  api.setDownloadTick('manager', 'xlsx', true);
  const managerNames = api.downloadFileNames('manager');
  assert.equal(managerNames.length, 2, 'one per entity with a schedule');
  assert.ok(managerNames[0].startsWith('Nirvana_') && managerNames[1].startsWith('Zion_'));
  const out = await api.downloadZip();
  assert.equal(out.name, STEM + '_All.zip');
  assert.deepEqual(saved, [STEM + '_All.zip'], 'one file saved');
  assert.deepEqual(Object.keys(zips[0].files), [STEM + '_AllEmployeesPayroll.xlsx', STEM + '_AllEmployeesTimecards.xlsx', STEM + '_AllEmployeesPayroll_Settings.xlsx', STEM + '_CashOnly.pdf', ...managerNames]);
  // Ticks are part of the snapshot.
  const snap = await api.buildSnapshot();
  assert.equal(snap.parts.downloadTicks.cashOnly.pdf, true);
});

test('test_accountant_line_disabled', () => {
  const { api } = setup();
  api.setDownloadTick('accountant', 'xlsx', true);
  assert.deepEqual(api.downloadFileNames('accountant'), []);
  api.renderDownloadsPanel();
  const html = api.__sandbox.document.getElementById('downloadsHost').innerHTML;
  assert.match(html, /<tr class="dl-disabled"><td class="dl-name"><b>Accountant file<\/b>/);
  assert.match(html, /coming soon/);
});
