// Tests renaming a Whiteboard slide's title (including a PowerPoint slide's) and deleting several slides at once.
// The service is the real one, on a real in-memory schema.
// Run with: node --test electron/whiteboard-edit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { WHITEBOARD_MIGRATIONS, WHITEBOARD_POWERPOINT_MIGRATIONS, WHITEBOARD_FOLDER_MIGRATIONS, WHITEBOARD_RESTORE_MIGRATIONS, WHITEBOARD_LAYER_MIGRATIONS, createWhiteboardService, validSlideTitle, MAX_SLIDE_TITLE, slideText } = await import('./whiteboard.js');

function setup(pictures = []) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE announcement_slides (id INTEGER PRIMARY KEY, notes TEXT)');
  for (const sql of [...WHITEBOARD_MIGRATIONS, ...WHITEBOARD_POWERPOINT_MIGRATIONS, ...WHITEBOARD_FOLDER_MIGRATIONS, ...WHITEBOARD_RESTORE_MIGRATIONS, ...WHITEBOARD_LAYER_MIGRATIONS]) db.exec(sql);
  for (const p of pictures) db.prepare('INSERT INTO announcement_slides (id, notes) VALUES (?, ?)').run(p.id, null);
  db.transaction = (fn) => () => fn();
  const service = createWhiteboardService(db, { importDeck: async () => pictures });
  return { db, service };
}

const text = (title) => ({ title, content: '- one', design: {} });

test('a title is trimmed, its spacing made one, and it must be given and short enough', () => {
  assert.equal(validSlideTitle('  Welcome   to   church '), 'Welcome to church');
  assert.throws(() => validSlideTitle('   '), /Give the slide a title/);
  assert.throws(() => validSlideTitle('x'.repeat(MAX_SLIDE_TITLE + 1)), /at most 120/);
});

test('a text slide can be renamed; its content is kept', () => {
  const { service } = setup();
  const slide = service.save(text('Old title'));
  const renamed = service.rename(slide.id, '  New   title ');
  assert.equal(renamed.title, 'New title');
  assert.equal(renamed.content, '- one');
  assert.throws(() => service.rename(999, 'Nowhere'), /no longer exists/);
});

test('a PowerPoint slide can be renamed, and keeps its picture', async () => {
  const { service } = setup([{ id: 7, name: 'Deck - Slide 1' }]);
  await service.importFile('deck.pptx', null);
  const [picture] = service.list();
  const renamed = service.rename(picture.id, 'Opening picture');
  assert.equal(renamed.title, 'Opening picture');
  assert.equal(renamed.slideId, 7);
  assert.equal(renamed.image, 'apcc-media://slide/7');
});

test('several slides are deleted at once; missing ids are skipped and counted correctly', () => {
  const { service } = setup();
  const a = service.save(text('A'));
  const b = service.save(text('B'));
  const c = service.save(text('C'));
  assert.equal(service.removeMany([a.id, c.id, 999, a.id]), 2);
  assert.deepEqual(service.list().map((s) => s.title), ['B']);
  assert.equal(service.removeMany([]), 0);
  assert.equal(service.removeMany(['x', null]), 0);
  assert.equal(service.get(b.id).title, 'B');
});

test('deleting slides in bulk leaves their folders in place', () => {
  const { service } = setup();
  const folder = service.createFolder('Sermons');
  const one = service.save({ ...text('One'), folderId: folder.id });
  service.save({ ...text('Two'), folderId: folder.id });
  assert.equal(service.removeMany([one.id]), 1);
  assert.equal(service.listFolders()[0].count, 1);
});

test('a PowerPoint slide\'s words become content: its title as a line, then bullets', () => {
  assert.equal(slideText({ title: ' Welcome ', paragraphs: ['Good morning', '  ', 'Please stand'] }), 'Welcome\n- Good morning\n- Please stand');
  assert.equal(slideText({ title: null, paragraphs: ['Only bullet'] }), '- Only bullet');
  assert.equal(slideText(null), '');
  assert.equal(slideText({ title: 'x', paragraphs: ['y'.repeat(5000)] }).length, 4000);
});

test('the text of a PowerPoint is kept with its pictures, in slide order, when the counts line up', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE announcement_slides (id INTEGER PRIMARY KEY, notes TEXT)');
  for (const sql of [...WHITEBOARD_MIGRATIONS, ...WHITEBOARD_POWERPOINT_MIGRATIONS, ...WHITEBOARD_FOLDER_MIGRATIONS, ...WHITEBOARD_RESTORE_MIGRATIONS, ...WHITEBOARD_LAYER_MIGRATIONS]) db.exec(sql);
  for (const id of [7, 8]) db.prepare('INSERT INTO announcement_slides (id) VALUES (?)').run(id);
  db.transaction = (fn) => () => fn();
  const pictures = [{ id: 7, name: 'Deck - Slide 1' }, { id: 8, name: 'Deck - Slide 2' }];
  const texts = [{ title: 'Welcome', paragraphs: ['Hello'] }, { title: null, paragraphs: ['Second'] }];
  const service = createWhiteboardService(db, { importDeck: async () => pictures, readTexts: async () => texts });
  await service.importFile('deck.pptx', null);
  assert.deepEqual(service.list().map((s) => s.content), ['Welcome\n- Hello', '- Second']);

  // Text that does not line up with the pictures (a different count) is not used; a failing reader is not fatal.
  const mismatch = createWhiteboardService(db, { importDeck: async () => pictures, readTexts: async () => [texts[0]] });
  await mismatch.importFile('deck.pptx', null);
  assert.deepEqual(mismatch.list().slice(2).map((s) => s.content), ['', '']);
  const broken = createWhiteboardService(db, { importDeck: async () => pictures, readTexts: async () => { throw new Error('not a zip'); } });
  assert.equal(await broken.importFile('old.ppt', null), 2);
});

const design = (patch = {}) => ({ bgColor: '#112233', textColor: '#FFFFFF', ...patch });

async function withPicture() {
  const ctx = setup([{ id: 7, name: 'Deck - Slide 1' }]);
  const folder = ctx.service.createFolder('Talk');
  await ctx.service.importFile('deck.pptx', folder.id);
  return { ...ctx, folder, picture: ctx.service.list()[0] };
}

test('a PowerPoint slide becomes an editable slide in place, and remembers its picture', async () => {
  const { service, folder, picture } = await withPicture();
  const edited = service.makeEditable(picture.id, { title: 'Opening words', content: '- Hello', design: design() });
  assert.equal(edited.id, picture.id);
  assert.equal(edited.title, 'Opening words');
  assert.equal(edited.content, '- Hello');
  assert.equal(edited.design.bgColor, '#112233');
  assert.equal(edited.image, null);
  assert.equal(edited.slideId, null);
  assert.equal(edited.folderId, folder.id);
  assert.equal(edited.originalImage, 'apcc-media://slide/7');
  // It keeps its place in the list.
  assert.deepEqual(service.list().map((s) => s.id), [picture.id]);
});

test('an edited slide keeps being saved as an ordinary slide', async () => {
  const { service, picture } = await withPicture();
  service.makeEditable(picture.id, { title: 'A', content: '- one', design: design() });
  const again = service.save({ id: picture.id, title: 'B', content: '- two', design: design({ bgColor: '#000000' }) });
  assert.equal(again.title, 'B');
  assert.equal(again.originalImage, 'apcc-media://slide/7');
  assert.equal(again.image, null);
});

test('a slide can be turned back into its PowerPoint picture, keeping its text', async () => {
  const { service, picture } = await withPicture();
  service.makeEditable(picture.id, { title: 'Edited', content: '- my words', design: design({ bgColor: '#ABCDEF' }) });
  const back = service.restorePicture(picture.id);
  assert.equal(back.image, 'apcc-media://slide/7');
  assert.equal(back.slideId, 7);
  assert.equal(back.originalImage, null);
  assert.equal(back.content, '- my words');
  assert.equal(back.design.bgColor, '#1C1917', 'the design goes back to the default');
  // It can be edited again afterwards.
  assert.equal(service.makeEditable(picture.id, { title: 'Again', content: '', design: design() }).image, null);
});

test('the change and the restore are refused when they make no sense', async () => {
  const { db, service, picture } = await withPicture();
  const plain = service.save({ title: 'Plain', content: '- x', design: {} });
  assert.throws(() => service.makeEditable(plain.id, { title: 'x', content: '', design: {} }), /already editable/);
  assert.throws(() => service.makeEditable(999, { title: 'x', content: '', design: {} }), /no longer exists/);
  assert.throws(() => service.makeEditable(picture.id, { title: '  ', content: '', design: {} }), /needs a title/);
  assert.equal(service.get(picture.id).image, 'apcc-media://slide/7', 'a refused change leaves the picture slide as it was');
  assert.throws(() => service.restorePicture(plain.id), /no PowerPoint picture/);
  service.makeEditable(picture.id, { title: 'E', content: '', design: {} });
  db.prepare('DELETE FROM announcement_slides WHERE id = 7').run();
  assert.throws(() => service.restorePicture(picture.id), /was deleted/);
  assert.equal(service.get(picture.id).originalImage, null, 'a deleted picture is not offered');
});

test('the picture itself is never touched by editing', async () => {
  const { db, service, picture } = await withPicture();
  service.makeEditable(picture.id, { title: 'E', content: '- x', design: {} });
  service.removeMany([picture.id]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM announcement_slides WHERE id = 7').get().n, 1);
});

const BG = (n) => `0000000${n}-0000-4000-8000-000000000000.jpg`;

/** A service whose deck comes apart into `parts`, with the saved and removed background files recorded. */
function setupLayers(pictures, parts) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE announcement_slides (id INTEGER PRIMARY KEY, notes TEXT)');
  for (const sql of [...WHITEBOARD_MIGRATIONS, ...WHITEBOARD_POWERPOINT_MIGRATIONS, ...WHITEBOARD_FOLDER_MIGRATIONS, ...WHITEBOARD_RESTORE_MIGRATIONS, ...WHITEBOARD_LAYER_MIGRATIONS]) db.exec(sql);
  for (const p of pictures) db.prepare('INSERT INTO announcement_slides (id, notes) VALUES (?, ?)').run(p.id, null);
  db.transaction = (fn) => () => fn();
  const saved = [];
  const removed = [];
  let n = 0;
  const service = createWhiteboardService(db, {
    importDeck: async () => pictures,
    readLayers: async () => {
      if (parts instanceof Error) throw parts;
      return parts;
    },
    saveLayerImage: async (jpeg) => {
      const name = BG((n += 1));
      saved.push({ name, jpeg });
      return name;
    },
    removeLayerImage: (name) => removed.push(name),
  });
  return { db, service, saved, removed };
}

const box = (text, more = {}) => ({ text, x: 10, y: 20, w: 80, h: 30, size: 80, font: 'Calibri', color: '#000000', bold: true, align: 'center', valign: 'middle', ...more });

test('an imported slide is taken apart: its background without words, and each text box in its place', async () => {
  const { service, saved } = setupLayers(
    [{ id: 7, name: 'Prayer - Slide 1' }, { id: 8, name: 'Prayer - Slide 2' }],
    [
      { background: Buffer.from('bg1'), boxes: [box('PRAYER TO TAKE AUTHORITY', { underline: true, y: 2, h: 8, size: 40 }), box('IN THE NAME OF JESUS,\nI TAKE AUTHORITY')] },
      { background: Buffer.from('bg2'), boxes: [] },
    ],
  );
  await service.importFile('prayer.pptx', null);
  const [first, second] = service.list();
  assert.equal(saved.length, 2);
  assert.equal(first.layers.background, `apcc-media://wb/${BG(1)}`);
  assert.equal(first.layers.boxes.length, 2);
  assert.equal(first.layers.boxes[0].text, 'PRAYER TO TAKE AUTHORITY');
  assert.equal(first.layers.boxes[0].underline, true);
  assert.equal(first.layers.boxes[1].text, 'IN THE NAME OF JESUS,\nI TAKE AUTHORITY');
  assert.equal(first.layers.boxes[1].font, 'Calibri');
  assert.equal(second.layers.background, `apcc-media://wb/${BG(2)}`);
  assert.deepEqual(second.layers.boxes, []);
  // The picture is still what goes on the projector until the slide is edited.
  assert.equal(first.image, 'apcc-media://slide/7');
});

test('a deck that cannot be taken apart still imports, without layers', async () => {
  const failing = setupLayers([{ id: 7, name: 'Old - Slide 1' }], new Error('Older .ppt files can only be shown with PowerPoint'));
  await failing.service.importFile('old.ppt', null);
  assert.equal(failing.service.list()[0].layers, null);
  assert.equal(failing.service.list()[0].image, 'apcc-media://slide/7');

  // Parts that do not line up with the pictures are not used, and nothing is saved for them.
  const mismatch = setupLayers([{ id: 7, name: 'A' }, { id: 8, name: 'B' }], [{ background: Buffer.from('x'), boxes: [] }]);
  await mismatch.service.importFile('deck.pptx', null);
  assert.deepEqual(mismatch.service.list().map((s) => s.layers), [null, null]);
  assert.equal(mismatch.saved.length, 0);
});

test('an edited slide keeps its layers, so it can be edited again after going back to the picture', async () => {
  const { service } = setupLayers([{ id: 7, name: 'A' }], [{ background: Buffer.from('x'), boxes: [box('Hello')] }]);
  await service.importFile('deck.pptx', null);
  const [slide] = service.list();
  const edited = service.makeEditable(slide.id, { title: 'A', content: '', design: { bgImage: slide.layers.background, bgFit: 'stretch', bgDim: 0, boxes: [box('Hello there', { x: 5 })] } });
  assert.equal(edited.design.bgImage, slide.layers.background);
  assert.equal(edited.design.bgFit, 'stretch');
  assert.equal(edited.design.boxes[0].text, 'Hello there');
  assert.equal(edited.design.boxes[0].x, 5);
  assert.equal(edited.layers.boxes[0].text, 'Hello', 'the words as imported stay as they were');
  assert.equal(service.restorePicture(slide.id).layers.background, slide.layers.background);
});

test("deleting slides deletes their backgrounds, but never one another slide still uses", async () => {
  const { service, removed } = setupLayers(
    [{ id: 7, name: 'A' }, { id: 8, name: 'B' }, { id: 9, name: 'C' }],
    [0, 1, 2].map(() => ({ background: Buffer.from('x'), boxes: [] })),
  );
  await service.importFile('deck.pptx', null);
  const [a, b, c] = service.list();
  // C borrows A's background for its own design.
  service.makeEditable(c.id, { title: 'C', content: '', design: { bgImage: a.layers.background } });
  service.remove(a.id);
  assert.deepEqual(removed, [], "A's background is still used by C");
  assert.equal(service.removeMany([b.id, c.id]), 2);
  assert.deepEqual(removed.sort(), [BG(1), BG(2), BG(3)]);
});

/** Slides imported before they were taken apart: pictures that remember their file and number, and a deck that comes apart when read again. */
function setupOldImport(parts) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE announcement_slides (id INTEGER PRIMARY KEY, notes TEXT, folder_id INTEGER, original_name TEXT, source_name TEXT)');
  for (const sql of [...WHITEBOARD_MIGRATIONS, ...WHITEBOARD_POWERPOINT_MIGRATIONS, ...WHITEBOARD_FOLDER_MIGRATIONS, ...WHITEBOARD_RESTORE_MIGRATIONS, ...WHITEBOARD_LAYER_MIGRATIONS]) db.exec(sql);
  db.transaction = (fn) => () => fn();
  const add = db.prepare('INSERT INTO announcement_slides (id, folder_id, original_name, source_name) VALUES (?, 1, ?, ?)');
  add.run(7, 'Prayer - Slide 1', 'Prayer.pptx');
  add.run(8, 'Prayer - Slide 2', 'Prayer.pptx');
  add.run(9, 'Other - Slide 1', 'Other.ppt');
  const pictures = [{ id: 7, name: 'Prayer - Slide 1' }, { id: 8, name: 'Prayer - Slide 2' }, { id: 9, name: 'Other - Slide 1' }];
  let n = 0;
  const removed = [];
  const service = createWhiteboardService(db, {
    importDeck: async () => pictures,
    readLayers: async () => parts,
    saveLayerImage: async () => BG((n += 1)),
    removeLayerImage: (name) => removed.push(name),
  });
  // The import happened before slides were taken apart: no layers yet.
  for (const p of pictures) db.prepare('INSERT INTO whiteboard_slides (title, content, design, position, slide_id) VALUES (?, ?, ?, ?, ?)').run(p.name, '', '{}', p.id, p.id);
  return { db, service, removed };
}

test('a slide imported before can be taken apart later from its file, and so is every slide from that file', async () => {
  const { service } = setupOldImport([
    { background: Buffer.from('1'), boxes: [box('REGULAR PRAYER')] },
    { background: Buffer.from('2'), boxes: [box('PRAYER TO TAKE AUTHORITY'), box('IN THE NAME OF JESUS')] },
  ]);
  const [first, second, other] = service.list();
  assert.deepEqual(service.pptxSource(second.id), { file: 'Prayer.pptx', slideNo: 2 });
  assert.equal(service.pptxSource(other.id), null, 'an old .ppt file cannot be read again');
  // Renamed and edited since: it still knows where it came from.
  service.rename(second.id, 'qweqeweq');
  service.makeEditable(second.id, { title: 'qweqeweq', content: '', design: {} });
  assert.deepEqual(service.pptxSource(second.id), { file: 'Prayer.pptx', slideNo: 2 });

  const done = await service.layersFromFile(second.id, 'C:/Downloads/Prayer.pptx');
  assert.deepEqual(done.layers.boxes.map((b) => b.text), ['PRAYER TO TAKE AUTHORITY', 'IN THE NAME OF JESUS']);
  assert.equal(service.get(first.id).layers.boxes[0].text, 'REGULAR PRAYER', 'the other slide from the file is taken apart too');
  assert.equal(service.get(other.id).layers, null);
});

test('a different file is refused, and reading again replaces the old backgrounds', async () => {
  const wrong = setupOldImport([{ background: Buffer.from('1'), boxes: [] }]);
  const [slide] = wrong.service.list();
  await assert.rejects(() => wrong.service.layersFromFile(slide.id, 'x.pptx'), /has 1 slides, but Prayer.pptx had 2/);
  assert.equal(wrong.service.get(slide.id).layers, null);

  const twice = setupOldImport([0, 1].map(() => ({ background: Buffer.from('x'), boxes: [] })));
  const [a] = twice.service.list();
  await twice.service.layersFromFile(a.id, 'Prayer.pptx');
  await twice.service.layersFromFile(a.id, 'Prayer.pptx');
  assert.deepEqual(twice.removed.sort(), [BG(1), BG(2)]);
  assert.equal(twice.service.get(a.id).layers.background, `apcc-media://wb/${BG(3)}`);
});
