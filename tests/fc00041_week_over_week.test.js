// FC-00041: week-over-week check. Last week's snapshot is read into a separate read-only
// model and compared with this week by permanent employee ID: new and missing people,
// setting changes, hours/pay swings (editable thresholds) and entity totals. This week's
// session is never changed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, resetToSingleEntity } = require('./load-app');

const W1 = ['Aug 9 2026', 'Aug 10 2026', 'Aug 11 2026', 'Aug 12 2026', 'Aug 13 2026', 'Aug 14 2026', 'Aug 15 2026'];
const W2 = ['Aug 16 2026', 'Aug 17 2026', 'Aug 18 2026', 'Aug 19 2026', 'Aug 20 2026', 'Aug 21 2026', 'Aug 22 2026'];
const W3 = ['Aug 23 2026', 'Aug 24 2026', 'Aug 25 2026', 'Aug 26 2026', 'Aug 27 2026', 'Aug 28 2026', 'Aug 29 2026'];
const ENT = 'Alpha Test';

// people: {name, hours, rate?, blank?, method?, deposit?, flat?, inactive?}. Order fixes the IDs.
function week(labels, people, renames) {
  const api = loadApp();
  api.__sandbox.alert = () => {};
  api.__sandbox.confirm = () => true;
  const iso = (l) => api.schedLabelToIso(l);
  const ent = resetToSingleEntity(api, {
    id: 0, name: ENT, dateLabels: labels, breakMinutes: 0, breakMinutesSet: true,
    employees: people.map(p => ({ name: p.name, shifts: ['', '9AM - 5PM', '', '', '', '', ''] })),
  });
  api._syncEntityCode(ent);
  const k = (n) => api.wKey(0, n);
  const d = (type, n, to, extra) => api.dispatch(Object.assign({ type, screen: 'payroll', target: { kind: 'employee', entity: 0, id: k(n), field: type }, from: null, to, meta: { empName: n } }, extra || {}));
  people.forEach(p => k(p.name)); // mint IDs in order
  people.forEach(p => {
    if (p.blank) d('wageBlank', p.name, null);
    else if (p.rate != null) d('wage', p.name, p.rate);
    if (p.method) api.setPayMethod(0, p.name, p.method);
    if (p.deposit != null) api.setSplitDeposit(0, p.name, p.deposit);
    if (p.flat != null) d('flatWage', p.name, p.flat);
    if (p.inactive) api.setRosterActive(0, p.name, false);
  });
  (renames || []).forEach(([from, to]) => api.dispatch({ type: 'rosterRename', screen: 'schedule', target: { kind: 'employee', entity: 0, id: k(from), field: 'canonical_name' }, from, to, meta: { empName: from } }));
  const nameNow = (n) => ((renames || []).find(r => r[0] === n) || [n, n])[1];
  ent.actualDays = people.filter(p => p.hours > 0).map(p => ({ empName: nameNow(p.name), entityName: ENT, date: iso(labels[1]), dayIdx: 1, pairs: [{ in: 9, out: 9 + p.hours, outAdj: 9 + p.hours, minutes: p.hours * 60 }] }));
  api._rerenderAll();
  return api;
}
const LAST = [
  { name: 'Ann Able', hours: 2, rate: 15, method: 'cash' },
  { name: 'Bo Best', hours: 8, rate: 20 },
  { name: 'Cy Cole', hours: 8, rate: 18, method: 'both', deposit: 50 },
  { name: 'Dee Dunn', hours: 6, rate: 14 },
  { name: 'Fozzle Fuvane', hours: 5, rate: 14 },
  { name: 'Gozzle Gray', hours: 0, flat: 300 },
  { name: 'Hozzle Hart', hours: 4, rate: 13 },
];
const THIS = [
  { name: 'Ann Able', hours: 12, rate: 16, method: 'cash' },
  { name: 'Bo Best', hours: 8, rate: 20, method: 'cash' },
  { name: 'Cy Cole', hours: 8, rate: 18, method: 'both', deposit: 60 },
  { name: 'Dee Dunn', hours: 0, rate: 14 },
  { name: 'Fozzle Fuvane', hours: 5, blank: true },
  { name: 'Gozzle Gray', hours: 0, flat: 350 },
  { name: 'Hozzle Hart', hours: 4, rate: 13, inactive: true },
  { name: 'Eozzle Egan', hours: 3, rate: 15 },
];
async function snap(api) { return JSON.parse(JSON.stringify(await api.buildSnapshot())); }
const names = (list) => list.map(x => x.name);

test('test_matches_by_permanent_id_across_renames', async () => {
  const last = await snap(week(W1, LAST));
  const cur = week(W2, THIS, [['Bo Best', 'Robert Best']]);
  cur.loadLastWeekSnapshot(last, 'last.json');
  const w = cur.weekOverWeek();
  assert.ok(!names(w.newPeople).includes('Robert Best'), 'renamed person is not "new"');
  assert.ok(!names(w.missing).includes('Bo Best'), 'and not "missing"');
  assert.deepEqual(names(w.method), ['Robert Best'], 'his pay-method change is still found, under his current name');
});

test('test_lists_new_missing_and_setting_changes', async () => {
  const cur = week(W2, THIS);
  cur.loadLastWeekSnapshot(await snap(week(W1, LAST)), 'last.json');
  const w = cur.weekOverWeek();
  assert.deepEqual(names(w.newPeople), ['Eozzle Egan']);
  assert.deepEqual(w.missing.map(x => [x.name, x.lastPay, x.active, x.onPayroll]), [['Dee Dunn', 84, true, true], ['Fozzle Fuvane', 70, true, true], ['Hozzle Hart', 52, false, false]]);
  assert.deepEqual(w.rate.map(x => [x.name, x.from, x.to]), [['Ann Able', 15, 16]]);
  assert.deepEqual(w.blank.map(x => [x.name, x.last]), [['Fozzle Fuvane', 14]]);
  assert.deepEqual(w.method.map(x => [x.name, x.from, x.to]), [['Bo Best', 'Deposit', 'Cash']]);
  assert.deepEqual(w.deposit.map(x => [x.name, x.from, x.to]), [['Cy Cole', 50, 60]]);
  assert.deepEqual(w.flat.map(x => [x.name, x.from, x.to]), [['Gozzle Gray', 300, 350]]);
  assert.deepEqual(w.active.map(x => [x.name, x.from, x.to]), [['Hozzle Hart', true, false]]);
  assert.equal(w.warning, '');
  cur.renderWowPanel();
  const html = cur.__sandbox.document.getElementById('wowHost').innerHTML;
  for (const t of ['New this week', 'Paid last week, missing this week', 'Blank rate', 'Rate changed', 'Pay method changed', 'Deposit amount changed', 'Flat amount changed', 'Active switched', 'Hours or pay swing', 'Entity totals']) assert.ok(html.includes(t), t);
});

test('test_swing_thresholds_and_edit', async () => {
  const cur = week(W2, THIS);
  cur.loadLastWeekSnapshot(await snap(week(W1, LAST)), 'last.json');
  let w = cur.weekOverWeek();
  assert.deepEqual(w.thresholds, { hours: 8, payPct: 25 }, 'defaults');
  const ann = w.swings.find(x => x.name === 'Ann Able');
  assert.deepEqual([ann.dh, ann.hoursHit, ann.payHit], [10, true, true]);
  assert.ok(!w.swings.some(x => x.name === 'Cy Cole'), 'same hours, same pay: no swing');
  assert.ok(!w.swings.some(x => x.name === 'Fozzle Fuvane'), 'blank rate drops pay to 0: listed as missing pay, not again as a swing');
  cur.setToolSetting('wowHours', '12');
  cur.setToolSetting('wowPayPct', 1000);
  w = cur.weekOverWeek();
  assert.deepEqual(w.thresholds, { hours: 12, payPct: 1000 });
  assert.ok(!w.swings.some(x => x.name === 'Ann Able'));
  // Saved in the snapshot and the settings file, logged and revertable.
  const s2 = await snap(cur);
  assert.deepEqual(s2.state.toolSettings, { wowHours: 12, wowPayPct: 1000 });
  await cur.exportPayrollSettingsExcel(false);
  const ts = cur.__lastExcelWorkbook.worksheets.find(x => x.name === 'Tool Settings');
  assert.deepEqual(ts.rows.slice(2).map(r => [r[1].value, r[2].value]), [['Week-over-week hours swing', 12], ['Week-over-week pay swing %', 1000]]);
  const fresh = week(W2, THIS);
  assert.equal(fresh._ingestToolSettings([['Week-over-week hours swing', '6'], ['Unknown thing', 3]]), 1);
  assert.equal(fresh.getToolSetting('wowHours'), 6);
  const line = cur.session.log.filter(e => e.type === 'toolSetting').at(-1);
  cur.revertFromHistory(line.id);
  assert.equal(cur.getToolSetting('wowPayPct'), 25);
  assert.equal(cur.setToolSetting('wowHours', '-1'), false, 'negative refused');
});

test('test_entity_totals_and_differences', async () => {
  const lastApi = week(W1, LAST);
  const cur = week(W2, THIS);
  cur.loadLastWeekSnapshot(await snap(lastApi), 'last.json');
  const w = cur.weekOverWeek();
  assert.equal(w.entities.length, 1);
  const sum = (api, f) => Math.round(api._collectExportData()[0].rows.reduce((s, r) => s + f(r), 0) * 100) / 100;
  const e = w.entities[0];
  assert.equal(e.name, ENT);
  assert.equal(e.last.actual, sum(lastApi, r => r._breakdown.actualFinal));
  assert.equal(e.cur.actual, sum(cur, r => r._breakdown.actualFinal));
  assert.equal(e.cur.hours, sum(cur, r => r.isFlat ? 0 : r.actualHours));
  assert.equal(e.cur.cash, sum(cur, r => r._breakdown.cash));
  assert.equal(e.diff.actual, Math.round((e.cur.actual - e.last.actual) * 100) / 100);
  assert.equal(e.diff.deposit, Math.round((e.cur.deposit - e.last.deposit) * 100) / 100);
});

test('test_current_session_unchanged', async () => {
  const last = await snap(week(W1, LAST));
  const cur = week(W2, THIS);
  const sig = () => cur._stateSig(cur._captureState());
  const before = sig(), log = JSON.stringify(cur.session.log), ent0 = cur.entities[0], rec = Object.values(cur.session.roster.byId)[0];
  const exportBefore = JSON.stringify(cur._collectExportData());
  cur.loadLastWeekSnapshot(last, 'last.json');
  cur.weekOverWeek();
  assert.equal(sig(), before);
  assert.equal(JSON.stringify(cur.session.log), log);
  assert.equal(cur.entities[0], ent0, 'same live objects, not copies');
  assert.equal(Object.values(cur.session.roster.byId)[0], rec);
  assert.equal(JSON.stringify(cur._collectExportData()), exportBefore);
  assert.equal(cur.getCheckpoints().length, 0, 'nothing to undo: nothing changed');
  assert.equal(cur.hasUnsavedChanges(), true, 'unsaved-state tracking untouched (fresh session with data)');
});

test('test_same_or_later_week_warns', async () => {
  const cur = week(W2, THIS);
  cur.loadLastWeekSnapshot(await snap(week(W2, LAST)), 'same.json');
  assert.match(cur.weekOverWeek().warning, /same week/);
  cur.loadLastWeekSnapshot(await snap(week(W3, LAST)), 'later.json');
  assert.match(cur.weekOverWeek().warning, /later week/);
  cur.loadLastWeekSnapshot(await snap(week(W1, LAST)), 'last.json');
  assert.equal(cur.weekOverWeek().warning, '');
  cur.clearLastWeek();
  assert.equal(cur.weekOverWeek(), null);
});
