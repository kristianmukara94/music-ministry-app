// Tests that a PowerPoint import tells the window how far it has got: the reporter's messages, and the real Whiteboard service sending them
// in order, for one file and for several, and staying quiet about a failure it did not get to.
// Run with: node --test electron/powerpoint-importer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { WHITEBOARD_FOLDER_MIGRATIONS, WHITEBOARD_RESTORE_MIGRATIONS, WHITEBOARD_LAYER_MIGRATIONS, WHITEBOARD_MIGRATIONS, WHITEBOARD_POWERPOINT_MIGRATIONS, createWhiteboardService } = await import('./whiteboard.js');
const { createImportReporter, sendToWindow } = await import('./powerpoint-importer.js');

test('the reporter sends the overall percentage and the slide counts', () => {
  const sent = [];
  const report = createImportReporter({ emit: (p) => sent.push(p), fileName: 'Deck.pptx' });
  report('rendering', 0, 4, 4);
  report('rendering', 2, 4);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].currentSlide, 2);
  assert.equal(sent[1].totalSlides, 4);
  assert.equal(sent[1].fileName, 'Deck.pptx');
  assert.ok(sent[1].percentage > sent[0].percentage);
});

test('the reporter does not repeat itself or go backwards', () => {
  const sent = [];
  const report = createImportReporter({ emit: (p) => sent.push(p) });
  report('rendering', 3, 6, 6);
  report('rendering', 3, 6);
  report('rendering', 1, 6);
  assert.equal(sent.length, 2, 'the repeat is dropped, the earlier slide is a new message');
  assert.ok(sent[1].percentage >= sent[0].percentage);
});

test('a window that is gone is not an error', () => {
  assert.doesNotThrow(() => sendToWindow(null)({ percentage: 1 }));
  assert.doesNotThrow(() => sendToWindow({ isDestroyed: () => true })({ percentage: 1 }));
  assert.doesNotThrow(() => sendToWindow({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: () => { throw new Error('gone'); } } })({ percentage: 1 }));
});

test('a window gets the message on the import channel', () => {
  const calls = [];
  const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (...a) => calls.push(a) } };
  sendToWindow(win)({ percentage: 40 });
  assert.deepEqual(calls, [['powerpoint:import-progress', { percentage: 40 }]]);
});

function setup({ slidesPerFile = 3, failDeck = null, withLayers = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE announcement_slides (id INTEGER PRIMARY KEY, notes TEXT)');
  for (const sql of [...WHITEBOARD_MIGRATIONS, ...WHITEBOARD_POWERPOINT_MIGRATIONS, ...WHITEBOARD_FOLDER_MIGRATIONS, ...WHITEBOARD_RESTORE_MIGRATIONS, ...WHITEBOARD_LAYER_MIGRATIONS]) db.exec(sql);
  db.transaction = (fn) => () => fn();
  const sent = [];
  let nextId = 1;
  const service = createWhiteboardService(db, {
    showOpenDialog: async () => ({ canceled: false, filePaths: ['/music/First.pptx', '/music/Second.pptx'] }),
    importDeck: async (file, report) => {
      if (failDeck && file.endsWith(failDeck)) throw new Error('PowerPoint could not open this file.');
      report('rendering', 0, slidesPerFile, slidesPerFile);
      const pictures = [];
      for (let i = 1; i <= slidesPerFile; i++) {
        report('rendering', i, slidesPerFile);
        db.prepare('INSERT INTO announcement_slides (id, notes) VALUES (?, NULL)').run(nextId);
        pictures.push({ id: nextId++, name: `${file} - Slide ${i}` });
      }
      for (let i = 1; i <= slidesPerFile; i++) report('saving', i, slidesPerFile);
      return pictures;
    },
    ...(withLayers
      ? {
          readLayers: async () => Array.from({ length: slidesPerFile }, () => ({ background: Buffer.from('x'), boxes: [] })),
          saveLayerImage: async () => 'layer.jpg',
        }
      : {}),
    emitProgress: (_win, payload) => sent.push(payload),
  });
  return { service, sent };
}

test('an import reports every stage in order, ending at 100%', async () => {
  const { service, sent } = setup({ slidesPerFile: 3 });
  // One file only: the dialog stub gives two, so use importFile with a reporter of our own.
  const out = [];
  const report = createImportReporter({ emit: (p) => out.push(p), fileName: 'First.pptx' });
  assert.equal(await service.importFile('/music/First.pptx', null, report), 3);
  const stages = [...new Set(out.map((p) => p.stage))];
  assert.deepEqual(stages, ['reading', 'rendering', 'saving', 'layers', 'layerImages', 'finishing']);
  for (let i = 1; i < out.length; i++) assert.ok(out[i].percentage >= out[i - 1].percentage);
  assert.equal(out.at(-1).percentage, 100);
  assert.equal(sent.length, 0, 'a reporter of our own does not go through the window');
  const saving = out.filter((p) => p.stage === 'saving');
  assert.deepEqual(saving.map((p) => `${p.currentSlide}/${p.totalSlides}`), ['1/3', '2/3', '3/3']);
});

test('a deck that cannot be taken apart still reports and finishes', async () => {
  const { service } = setup({ withLayers: false });
  const out = [];
  await service.importFile('/music/First.pptx', null, createImportReporter({ emit: (p) => out.push(p) }));
  assert.ok(!out.some((p) => p.stage === 'layers'));
  assert.equal(out.at(-1).percentage, 100);
});

test('several files share one bar that only moves forward', async () => {
  const { service, sent } = setup({ slidesPerFile: 2 });
  assert.equal(await service.importPowerPoint({}, null), 4);
  assert.deepEqual([...new Set(sent.map((p) => p.fileIndex))], [0, 1]);
  assert.equal(sent[0].fileCount, 2);
  assert.equal(sent.find((p) => p.fileIndex === 1).fileName, 'Second.pptx');
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i].percentage >= sent[i - 1].percentage, `${i}: ${sent[i - 1].percentage} then ${sent[i].percentage}`);
  assert.ok(sent.find((p) => p.fileIndex === 1).percentage >= 50, 'the second file starts from half');
  assert.equal(sent.at(-1).percentage, 100);
});

test('a failed import rejects with the reason, and never reports 100%', async () => {
  const { service, sent } = setup({ failDeck: 'First.pptx' });
  await assert.rejects(() => service.importPowerPoint({}, null), /PowerPoint could not open this file\./);
  assert.ok(sent.length > 0, 'it had started');
  assert.ok(sent.every((p) => p.percentage < 100));
  assert.deepEqual(service.list(), [], 'nothing half done was kept');
});
