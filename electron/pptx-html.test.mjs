// Tests that the built-in PowerPoint renderer follows PowerPoint's inheritance (slide -> layout -> master -> theme): positions, theme
// colours with modifiers, font sizes, bullets, backgrounds, tables, and slide order and visibility.
// Run with: node --test electron/pptx-html.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildDeckHtml, parseXml, slideParts } from './pptx-html.js';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (items) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;

const THEME = `<a:theme ${NS}><a:themeElements><a:clrScheme name="t"><a:dk1><a:srgbClr val="111111"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="222222"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="FF0000"/></a:accent1><a:accent2><a:srgbClr val="00FF00"/></a:accent2><a:accent3><a:srgbClr val="0000FF"/></a:accent3><a:accent4><a:srgbClr val="888888"/></a:accent4><a:accent5><a:srgbClr val="888888"/></a:accent5><a:accent6><a:srgbClr val="888888"/></a:accent6><a:hlink><a:srgbClr val="0000EE"/></a:hlink><a:folHlink><a:srgbClr val="551A8B"/></a:folHlink></a:clrScheme><a:fontScheme name="f"><a:majorFont><a:latin typeface="Major Face"/></a:majorFont><a:minorFont><a:latin typeface="Minor Face"/></a:minorFont></a:fontScheme><a:fmtScheme name="x"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const MASTER = `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFDE7"/></a:solidFill></p:bgPr></p:bg><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="7315200" cy="914400"/></a:xfrm></p:spPr></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="1600200"/><a:ext cx="7315200" cy="3200400"/></a:xfrm></p:spPr></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="4" name="Bar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="228600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></p:spPr></p:sp>
</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4000" b="1"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>
<p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900"><a:buChar char="•"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="50000"/><a:lumOff val="50000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr></p:bodyStyle></p:txStyles></p:sldMaster>`;

const LAYOUT = `<p:sldLayout ${NS}><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="228600"/><a:ext cx="8229600" cy="685800"/></a:xfrm></p:spPr></p:sp>
</p:spTree></p:cSld></p:sldLayout>`;

const slideXml = (body, attrs = '') => `<p:sld ${NS}${attrs}><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
const title = (text) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
const body = (...lines) => `<p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${lines.map((l) => `<a:p><a:r><a:t>${l}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;

async function deck(slides, { order } = {}) {
  const zip = new JSZip();
  const ids = slides.map((_, i) => i + 1);
  zip.file('ppt/presentation.xml', `<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="1" r:id="rM"/></p:sldMasterIdLst><p:sldIdLst>${(order ?? ids).map((n) => `<p:sldId id="${255 + n}" r:id="rS${n}"/>`).join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', rels([['rM', 'slideMaster', 'slideMasters/slideMaster1.xml'], ...ids.map((n) => [`rS${n}`, 'slide', `slides/slide${n}.xml`])]));
  zip.file('ppt/slideMasters/slideMaster1.xml', MASTER);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rT', 'theme', '../theme/theme1.xml']]));
  zip.file('ppt/theme/theme1.xml', THEME);
  zip.file('ppt/slideLayouts/slideLayout1.xml', LAYOUT);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rM', 'slideMaster', '../slideMasters/slideMaster1.xml']]));
  slides.forEach((xml, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, xml);
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([['rL', 'slideLayout', '../slideLayouts/slideLayout1.xml']]));
  });
  return zip;
}

const build = async (zip) => buildDeckHtml(zip, { media: async (t) => `file:///${t}` });

test('a placeholder takes its position from the layout, its style from the master, and colours from the theme', async () => {
  const { html, count, slideHeight } = await build(await deck([slideXml(title('Hello') + body('First point'))]));
  assert.equal(count, 1);
  assert.equal(slideHeight, 1080);
  // Layout title box: x=457200 EMU of 9144000 -> 96px; 8229600 wide -> 1728px.
  assert.match(html, /left:96px;top:48px;width:1728px;height:144px/);
  // Master title style: 40pt bold, accent1 (red), centred, in the theme's major font.
  assert.match(html, /font-size:calc\(106\.67px \* var\(--k\)\)/);
  assert.match(html, /font-family:'Major Face'/);
  assert.match(html, /font-weight:700/);
  assert.match(html, /color:rgba\(255,0,0,1\)/);
  assert.match(html, /text-align:center/);
  // Body: the master's body box, 28pt, grey from tx1 with lumMod/lumOff, and a bullet.
  assert.match(html, /left:192px;top:336px/);
  assert.match(html, /font-size:calc\(74\.67px/);
  assert.match(html, /color:rgba\(136,136,136,1\)/);
  assert.match(html, /•/);
});

test('the master background and its non-placeholder shapes sit under the slide', async () => {
  const { html } = await build(await deck([slideXml(title('Hi'))]));
  assert.match(html, /background:rgba\(255,253,231,1\)/);
  // The master's blue bar is drawn, 9144000 wide = 1920px, filled with accent3.
  assert.match(html, /width:1920px;height:48px/);
  assert.match(html, /fill="rgb\(0,0,255\)"/);
});

test('hidden slides are skipped, and slides follow the presentation order', async () => {
  const zip = await deck([slideXml(title('One')), slideXml(title('Two'), ' show="0"'), slideXml(title('Three'))], { order: [3, 2, 1] });
  assert.deepEqual(await slideParts(zip), ['ppt/slides/slide3.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide1.xml']);
  const { html, count } = await build(zip);
  assert.equal(count, 2);
  assert.ok(html.indexOf('Three') < html.indexOf('One'));
  assert.ok(!html.includes('Two'));
});

test('text is escaped, so markup in a slide cannot break the page', async () => {
  const { html } = await build(await deck([slideXml(title('A &lt;b&gt; &amp; &quot;C&quot;'))]));
  assert.match(html, /A &lt;b&gt; &amp; &quot;C&quot;/);
  assert.ok(!html.includes('<b>'));
});

test('a table is drawn with its cell text and widths', async () => {
  const tbl = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Tbl"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="1371600"/><a:ext cx="4572000" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="x"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid><a:gridCol w="2286000"/><a:gridCol w="2286000"/></a:tblGrid><a:tr h="457200"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Name</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Key</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  const { html } = await build(await deck([slideXml(tbl)]));
  assert.match(html, /<table/);
  assert.match(html, /<col style="width:480px">/);
  assert.match(html, />Name</);
  assert.match(html, />Key</);
});

test('the XML reader keeps attributes and decodes entities', () => {
  const root = parseXml('<a:x k="1 &amp; 2"><a:y/><a:z>t&lt;</a:z></a:x>');
  assert.equal(root.name, 'x');
  assert.equal(root.attrs.k, '1 & 2');
  assert.equal(root.kids[1].text, 't<');
});
