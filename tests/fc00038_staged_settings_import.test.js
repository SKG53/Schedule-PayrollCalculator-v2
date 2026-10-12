// FC-00038: staged settings import. Choosing a settings file shows what it would change —
// field changes, identity changes, new people, people not in the file, red rows needing a
// decision, unchanged — and nothing changes until Apply. Rows for an entity that is not
// loaded yet wait and are offered through the same preview when that entity appears.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, resetToSingleEntity } = require('./load-app');

const HEADERS = ['Entity', 'Employee', 'Wage/hour', 'Type', 'Pay Method', 'Employee ID', 'Aliases', 'Active'];
const colMap = () => { const m = {}; HEADERS.forEach((h, i) => { m[h.toLowerCase()] = i; }); return m; };
const SCHED_HDR = ['Name', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shift = ['OFF', '9:00-17:00', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'];
const ENT = 'Alpha Test';

function fresh(names) {
  const api = loadApp();
  api.__sandbox.alert = () => {};
  api.__sandbox.confirm = () => true;
  const ent = resetToSingleEntity(api, { id: 0, name: ENT, employees: [] });
  api._syncEntityCode(ent);
  if (names) api.parseSchedule([SCHED_HDR, ...names.map(n => [n, ...shift])], 0);
  api._rerenderAll();
  return { api, code: ent.code };
}
const id = (code, n) => `EMP_${code}_${String(n).padStart(5, '0')}`;
const row = (name, rate, method, empId, aliases = '', active = 'Yes', entity = ENT) => [entity, name, String(rate), 'Hourly', method, empId || '', aliases, active];
const stage = (api, rows, label = 'week.xlsx') => api.stageSettingsData(rows, colMap(), false, [], label);
const sig = (api) => api._stateSig(api._captureState());
const names = (list) => list.map(x => x.name);

test('test_preview_changes_nothing_until_apply', () => {
  const { api, code } = fresh(['Avery Stone', 'Bozzle Mozzle']);
  const before = sig(api), log = JSON.stringify(api.session.log), ent0 = api.entities[0], cps = api.getCheckpoints().length;
  const st = stage(api, [row('Avery Stone', 15, 'Cash', id(code, 1)), row('Bozzle Mozzle', 20, 'Deposit', id(code, 2))]);
  assert.equal(sig(api), before, 'state identical while the preview is open');
  assert.equal(JSON.stringify(api.session.log), log);
  assert.equal(api.entities[0], ent0, 'same live objects');
  assert.equal(api.getCheckpoints().length, cps, 'no checkpoint for a preview');
  assert.ok(st.preview.changes.some(c => c.name === 'Avery Stone' && c.diffs.some(d => d.field === 'rate' && d.to === '$15.00')));
  assert.match(api.__sandbox.document.getElementById('stageBody').innerHTML, /Nothing below has been applied yet/);
  assert.equal(api.applyStagedSettings(), true);
  assert.equal(api.wageRates[id(code, 1)], 15);
  assert.equal(api.getPayMethod(0, 'Avery Stone'), 'cash');
  assert.equal(api.getStaged(), null);
});

test('test_cancel_leaves_state_identical', () => {
  const { api, code } = fresh(['Avery Stone']);
  const before = sig(api), cps = api.getCheckpoints().length;
  stage(api, [row('Avery Stone', 15, 'Cash', id(code, 1)), row('New Person', 12, 'Cash', id(code, 9))]);
  api.cancelStagedSettings();
  assert.equal(sig(api), before);
  assert.equal(api.getStaged(), null);
  assert.equal(api.getCheckpoints().length, cps);
  assert.equal(api.__sandbox.document.getElementById('stageOverlay').style.display, 'none');
});

test('test_preview_lists_changes_new_missing_unchanged', () => {
  const { api, code } = fresh(['Avery Stone', 'Bozzle Mozzle', 'Dozzle Dale']);
  stage(api, [row('Avery Stone', 15, 'Cash', id(code, 1)), row('Bozzle Mozzle', 20, 'Deposit', id(code, 2))]);
  api.applyStagedSettings();
  const st = stage(api, [row('Avery Stone', 16, 'Cash', id(code, 1)), row('Bozzle Mozzle', 20, 'Deposit', id(code, 2)), row('Erin Ellis', 14, 'Cash', id(code, 7))]);
  const pv = st.preview;
  assert.deepEqual(pv.changes.map(c => [c.name, c.diffs.map(d => [d.label, d.from, d.to])]), [['Avery Stone', [['Rate', '$15.00', '$16.00']]]]);
  assert.deepEqual(pv.added.map(a => [a.name, a.id]), [['Erin Ellis', id(code, 7)]]);
  assert.deepEqual(names(pv.notInFile), ['Dozzle Dale'], 'left as he is');
  assert.ok(pv.identity.some(x => x.name === 'Dozzle Dale' && x.kind === 'moved'), 'his session ID moves after the file\'s highest (FC-00036)');
  assert.deepEqual(names(pv.unchanged), ['Bozzle Mozzle']);
  assert.equal(pv.blocking.length, 0);
  assert.equal(pv.unresolved, 0);
});

test('test_identity_changes_previewed', () => {
  // Schedule first: BOZZLE gets 00001 and "avery  stone." 00002. The file owns 00001 for
  // Avery Stone and lists BOZZLE as Bozzle Mozzle's alias (FC-00036 case).
  const { api, code } = fresh(['BOZZLE', 'avery  stone.']);
  const st = stage(api, [row('Avery Stone', 15, 'Cash', id(code, 1)), row('Bozzle Mozzle', 20, 'Deposit', id(code, 2), '["BOZZLE"]')]);
  const texts = st.preview.identity.map(x => x.text).join(' | ');
  assert.ok(st.preview.identity.length >= 2, texts);
  assert.ok(st.preview.identity.some(x => x.name === 'BOZZLE' && x.kind === 'merged' && x.to === id(code, 2)), texts);
  assert.ok(st.preview.identity.some(x => x.name === 'avery  stone.' && x.kind === 'moved' && x.to === id(code, 1)), texts);
  assert.deepEqual(st.preview.added, [], 'nobody is "new": both file people were already on screen');
  const avery = st.preview.changes.find(c => c.name === 'Avery Stone');
  assert.ok(avery && avery.diffs.some(d => d.field === 'method' && d.to === 'Cash'), 'compared with the record that was "avery  stone."');
  api.applyStagedSettings();
  assert.equal(api._employeeIdFor(0, 'Avery Stone'), id(code, 1));
  assert.equal(api._employeeIdFor(0, 'BOZZLE'), id(code, 2));
});

test('test_blocking_rows_disable_apply_until_skipped', () => {
  const { api, code } = fresh(['Avery Stone', 'Bozzle Mozzle', 'Cy Cole']);
  stage(api, [row('Avery Stone', 15, 'Cash', id(code, 1)), row('Bozzle Mozzle', 20, 'Deposit', id(code, 2)), row('Cy Cole', 18, 'Cash', id(code, 3))]);
  api.applyStagedSettings();
  const rows = [
    row('Zed Zero', 11, 'Cash', id(code, 3)),                      // 0: ID belongs to Cy Cole
    row('Bozzle Mozzle', 21, 'Deposit', id(code, 2), '["Avery Stone"]'), // 1: alias is someone else's name
    row('Cozzle Cole', 12, 'Cash', id(code, 5)),                    // 2: same ID twice
    row('Cora Cole', 12, 'Cash', id(code, 5)),                    // 3
    row('Gozzle Gray', 13, 'Cash', 'EMP_GAM_00001', '', 'Yes', 'Gamma Test'), // 4: entity not loaded
  ];
  const st = stage(api, rows);
  const reasons = st.preview.blocking.map(b => b.row + ':' + b.reason).join(' | ');
  assert.match(reasons, /0:ID EMP_\w+_00003 is Cy Cole in this session/);
  assert.match(reasons, /1:Alias refused/);
  assert.match(reasons, /2:ID EMP_\w+_00005 appears 2 times/);
  assert.match(reasons, /3:ID EMP_\w+_00005 appears 2 times/);
  assert.deepEqual(st.preview.unknownEntities.map(u => [u.name, u.rows]), [['Gamma Test', [4]]]);
  assert.equal(st.preview.unresolved, 5);
  assert.match(api.__sandbox.document.getElementById('stageBody').innerHTML, /disabled onclick="applyStagedSettings\(\)"/);
  const before = sig(api);
  assert.equal(api.applyStagedSettings(), false);
  assert.equal(sig(api), before);
  [0, 1, 3].forEach(i => api.stageSkipRow(i, true));
  assert.equal(api.getStaged().preview.unresolved, 2, 'row 2 still shares its ID with a skipped row — skipping one does not clear the other');
  api.stageSkipRow(2, true);
  api.stageEntityChoice('Gamma Test', 'skip');
  assert.equal(api.getStaged().preview.unresolved, 0);
  assert.equal(api.applyStagedSettings(), true);
  assert.equal(api.wageRates[id(code, 3)], 18, 'skipped row not applied');
  assert.equal(api.wageRates[id(code, 2)], 20);
  assert.deepEqual(api.pendingSettings(), []);
});

test('test_session_edit_marked_your_edit', () => {
  const { api, code } = fresh(['Avery Stone', 'Bozzle Mozzle']);
  stage(api, [row('Avery Stone', 15, 'Cash', id(code, 1)), row('Bozzle Mozzle', 20, 'Deposit', id(code, 2))]);
  api.applyStagedSettings();
  // Hand edits after the import.
  api.dispatch({ type: 'wage', screen: 'payroll', target: { kind: 'employee', entity: 0, id: id(code, 1), field: 'wage' }, from: 15, to: 17, meta: { empName: 'Avery Stone' } });
  api.setPayMethod(0, 'Avery Stone', 'deposit');
  const st = stage(api, [row('Avery Stone', 16, 'Cash', id(code, 1)), row('Bozzle Mozzle', 22, 'Deposit', id(code, 2))]);
  const avery = st.preview.changes.find(c => c.name === 'Avery Stone');
  assert.deepEqual(avery.diffs.map(d => [d.field, d.yourEdit]), [['rate', true], ['method', true]]);
  const bozzle = st.preview.changes.find(c => c.name === 'Bozzle Mozzle');
  assert.deepEqual(bozzle.diffs.map(d => [d.field, d.yourEdit]), [['rate', false]], 'set by the earlier import, not by hand');
  assert.match(api.__sandbox.document.getElementById('stageBody').innerHTML, /your edit/);
});

test('test_pending_entity_settings_applied_when_entity_added', async () => {
  const { api, code } = fresh(['Avery Stone']);
  const st = stage(api, [row('Avery Stone', 15, 'Cash', id(code, 1)), row('Gozzle Gray', 13, 'Cash', 'EMP_GAM_00001', '', 'Yes', 'Gamma Test')], 'master.xlsx');
  api.stageEntityChoice('Gamma Test', 'pending');
  assert.equal(st.preview.unresolved, 0);
  api.applyStagedSettings();
  assert.deepEqual(api.pendingSettings(), [{ entityName: 'Gamma Test', rows: 1, label: 'master.xlsx' }]);
  // Waiting settings travel in the snapshot.
  const snap = JSON.parse(JSON.stringify(await api.buildSnapshot()));
  assert.equal(snap.state.pendingSettings.length, 1);
  // The entity appears: the same preview opens for its rows.
  api.addEntity();
  api.onEntityNameChange('Gamma Test');
  const st2 = api.getStaged();
  assert.ok(st2 && st2.pendingEntry, 'preview opened for the waiting rows');
  assert.deepEqual(st2.preview.added.map(a => [a.name, a.id]), [['Gozzle Gray', 'EMP_GAM_00001']]);
  api.applyStagedSettings();
  assert.equal(api.wageRates['EMP_GAM_00001'], 13);
  assert.deepEqual(api.pendingSettings(), []);
});

test('test_apply_is_undoable', () => {
  const { api, code } = fresh(['Avery Stone', 'Bozzle Mozzle']);
  const before = sig(api), log = JSON.stringify(api.session.log);
  stage(api, [row('Avery Stone', 15, 'Cash', id(code, 1)), row('Bozzle Mozzle', 20, 'Deposit', id(code, 2))], 'week.xlsx');
  api.applyStagedSettings();
  assert.match(api.getCheckpoints().at(-1).label, /^Settings import · week\.xlsx/);
  const lines = api.session.log.filter(e => e.type === 'wage');
  assert.ok(lines.length === 2 && lines.every(e => e.screen === 'settings-import'), 'every change is in History, marked as an import');
  api.undoCheckpoint();
  assert.equal(sig(api), before);
  assert.equal(JSON.stringify(api.session.log), log);
});
