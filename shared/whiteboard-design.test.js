// Tests the Whiteboard design's background picture: only the app's own pictures are accepted, and every setting stays in range.
// Run with: node --test shared/whiteboard-design.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TEXT_BOXES, sanitizeSlideDesign, sanitizeTextBox, SLIDE_DESIGN_DEFAULTS, TEXT_BOX_DEFAULTS } from './whiteboard.js';

test('a design starts with no background picture, filling the slide, a little dimmed', () => {
  const d = sanitizeSlideDesign({});
  assert.equal(d.bgImage, null);
  assert.equal(d.bgFit, 'cover');
  assert.equal(d.bgDim, SLIDE_DESIGN_DEFAULTS.bgDim);
});

test('a Media Library picture and a PowerPoint slide picture are accepted', () => {
  assert.equal(sanitizeSlideDesign({ bgImage: 'apcc-media://media/12' }).bgImage, 'apcc-media://media/12');
  assert.equal(sanitizeSlideDesign({ bgImage: 'apcc-media://slide/7' }).bgImage, 'apcc-media://slide/7');
});

test('any other address is dropped, so a slide cannot point outside the app', () => {
  for (const bad of ['https://example.com/a.png', 'file:///C:/secret.png', 'apcc-media://thumb/3', 'apcc-media://media/12/../x', "apcc-media://media/1');alert(1)", 'apcc-media://media/', 42, {}]) {
    assert.equal(sanitizeSlideDesign({ bgImage: bad }).bgImage, null, String(bad));
  }
});

test('fit and darkening stay within what the editor offers', () => {
  assert.equal(sanitizeSlideDesign({ bgFit: 'tile' }).bgFit, 'cover');
  assert.equal(sanitizeSlideDesign({ bgFit: 'stretch' }).bgFit, 'stretch');
  assert.equal(sanitizeSlideDesign({ bgFit: 'contain' }).bgFit, 'contain');
  assert.equal(sanitizeSlideDesign({ bgDim: 500 }).bgDim, 85);
  assert.equal(sanitizeSlideDesign({ bgDim: -5 }).bgDim, 0);
  assert.equal(sanitizeSlideDesign({ bgDim: 'abc' }).bgDim, SLIDE_DESIGN_DEFAULTS.bgDim);
});

test("a PowerPoint slide's background without its words is accepted, and only by its generated file name", () => {
  const ok = 'apcc-media://wb/0f8fad5b-d9cb-469f-a165-70867728950e.jpg';
  assert.equal(sanitizeSlideDesign({ bgImage: ok }).bgImage, ok);
  for (const bad of ['apcc-media://wb/../secret.jpg', 'apcc-media://wb/x.jpg', 'apcc-media://wb/0f8fad5b-d9cb-469f-a165-70867728950e.png']) {
    assert.equal(sanitizeSlideDesign({ bgImage: bad }).bgImage, null, bad);
  }
});

test('a design starts with no text boxes, and keeps the ones given, up to the limit', () => {
  assert.deepEqual(sanitizeSlideDesign({}).boxes, []);
  assert.deepEqual(sanitizeSlideDesign({ boxes: 'x' }).boxes, []);
  const many = Array.from({ length: MAX_TEXT_BOXES + 5 }, (_, i) => ({ text: `Box ${i}` }));
  const boxes = sanitizeSlideDesign({ boxes: many }).boxes;
  assert.equal(boxes.length, MAX_TEXT_BOXES);
  assert.equal(boxes[3].text, 'Box 3');
});

test('a text box keeps its words, place and look, and anything out of range is brought back', () => {
  const box = sanitizeTextBox({ text: 'IN THE NAME OF JESUS', x: 10.123, y: 30, w: 80, h: 40, size: 66.5, font: 'Calibri Light', color: '#ffcc00', bold: true, italic: true, underline: true, align: 'center', valign: 'bottom', rot: 15 });
  assert.deepEqual(box, { text: 'IN THE NAME OF JESUS', x: 10.12, y: 30, w: 80, h: 40, size: 66.5, font: 'Calibri Light', color: '#FFCC00', bold: true, italic: true, underline: true, align: 'center', valign: 'bottom', rot: 15 });
  const wild = sanitizeTextBox({ x: 500, y: -500, w: 0, h: 900, size: 9999, font: "Arial'; color:red", color: 'red', align: 'up', valign: 'side', rot: 'x', bold: 'yes' });
  assert.equal(wild.x, 99, 'a box cannot leave the slide on the right');
  assert.equal(wild.w, 1);
  assert.equal(wild.h, 100);
  assert.equal(wild.y, -99, 'a box keeps a little of itself on the slide');
  assert.equal(wild.size, 300);
  assert.equal(wild.font, TEXT_BOX_DEFAULTS.font, 'a font name that could break out of CSS is refused');
  assert.equal(wild.color, TEXT_BOX_DEFAULTS.color);
  assert.equal(wild.align, TEXT_BOX_DEFAULTS.align);
  assert.equal(wild.valign, TEXT_BOX_DEFAULTS.valign);
  assert.equal(wild.rot, 0);
  assert.equal(wild.bold, false);
  assert.deepEqual(sanitizeTextBox(null), { ...TEXT_BOX_DEFAULTS, text: '' }, 'a box with no words stays empty');
});
