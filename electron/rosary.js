import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import {
  createRosaryWriter,
  MYSTERY_TYPES,
  normalizeMystery,
  normalizePrayer,
  parseBackup,
  PRAYER_KEYS,
  readAllRosary,
  ROSARY_APPROVAL_MIGRATION,
} from './rosary-backup.js';

export { MYSTERY_TYPES, PRAYER_KEYS };

const BACKUP_FILE_NAME = 'apccmma_rosary_backup.json';

/**
 * Rosary schema. Tagalog and Cebuano columns start empty: the ministry supplies the approved
 * wording, and the app falls back to English until then. Empty means "not yet translated",
 * never a placeholder.
 */
export const ROSARY_MIGRATIONS = [
  `
  CREATE TABLE rosary_mysteries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    mystery_type    TEXT NOT NULL CHECK (mystery_type IN ('joyful', 'sorrowful', 'glorious', 'luminous')),
    decade_number   INTEGER NOT NULL CHECK (decade_number BETWEEN 1 AND 5),
    title_en        TEXT NOT NULL,
    title_tl        TEXT NOT NULL DEFAULT '',
    title_ceb       TEXT NOT NULL DEFAULT '',
    meditation_en   TEXT NOT NULL,
    meditation_tl   TEXT NOT NULL DEFAULT '',
    meditation_ceb  TEXT NOT NULL DEFAULT '',
    scripture_ref   TEXT NOT NULL,
    UNIQUE (mystery_type, decade_number)
  );

  CREATE TABLE rosary_prayers (
    key       TEXT PRIMARY KEY CHECK (key IN ('creed', 'our_father', 'hail_mary', 'glory_be', 'fatima', 'hail_holy_queen')),
    text_en   TEXT NOT NULL,
    text_tl   TEXT NOT NULL DEFAULT '',
    text_ceb  TEXT NOT NULL DEFAULT ''
  );
  `,
  // Review status per language. Editing a language in Settings clears its approval until someone approves it again.
  ROSARY_APPROVAL_MIGRATION,
];

/**
 * Adds the Litany of Loreto key. SQLite cannot change a CHECK in place, so the table is copied, the same
 * way as the earlier table rebuilds. Existing prayers keep their text and approval.
 */
export const ROSARY_LITANY_MIGRATIONS = [
  `
  CREATE TABLE rosary_prayers_new (
    key       TEXT PRIMARY KEY CHECK (key IN ('creed', 'our_father', 'hail_mary', 'glory_be', 'fatima', 'hail_holy_queen', 'litany_loreto')),
    text_en   TEXT NOT NULL,
    text_tl   TEXT NOT NULL DEFAULT '',
    text_ceb  TEXT NOT NULL DEFAULT '',
    approved_en  INTEGER NOT NULL DEFAULT 0 CHECK (approved_en IN (0, 1)),
    approved_tl  INTEGER NOT NULL DEFAULT 0 CHECK (approved_tl IN (0, 1)),
    approved_ceb INTEGER NOT NULL DEFAULT 0 CHECK (approved_ceb IN (0, 1))
  );
  INSERT INTO rosary_prayers_new (key, text_en, text_tl, text_ceb, approved_en, approved_tl, approved_ceb)
    SELECT key, text_en, text_tl, text_ceb, approved_en, approved_tl, approved_ceb FROM rosary_prayers;
  DROP TABLE rosary_prayers;
  ALTER TABLE rosary_prayers_new RENAME TO rosary_prayers;
  `,
];

// Traditional English wording of the prayers (public-domain forms). Check the wording against the
// parish's approved text before the first public use.
const PRAYERS = [
  {
    key: 'creed',
    en: `I believe in God, the Father almighty, Creator of heaven and earth. And in Jesus Christ, his only Son, our Lord, who was conceived by the Holy Spirit, born of the Virgin Mary, suffered under Pontius Pilate, was crucified, died, and was buried. He descended into hell; on the third day he rose again from the dead; he ascended into heaven, and is seated at the right hand of God the Father almighty; from there he will come to judge the living and the dead. I believe in the Holy Spirit, the holy Catholic Church, the communion of saints, the forgiveness of sins, the resurrection of the body, and life everlasting. Amen.`,
  },
  // The litany's text is supplied by the ministry. Empty until then, so the deck asks for it rather than showing a guess.
  { key: 'litany_loreto', en: '' },
  {
    key: 'our_father',
    en: `Our Father, who art in heaven, hallowed be thy name; thy kingdom come; thy will be done on earth as it is in heaven. Give us this day our daily bread; and forgive us our trespasses as we forgive those who trespass against us; and lead us not into temptation, but deliver us from evil. Amen.`,
  },
  {
    key: 'hail_mary',
    en: `Hail Mary, full of grace, the Lord is with thee. Blessed art thou among women, and blessed is the fruit of thy womb, Jesus. Holy Mary, Mother of God, pray for us sinners, now and at the hour of our death. Amen.`,
  },
  {
    key: 'glory_be',
    en: `Glory be to the Father, and to the Son, and to the Holy Spirit. As it was in the beginning, is now, and ever shall be, world without end. Amen.`,
  },
  {
    key: 'fatima',
    en: `O my Jesus, forgive us our sins, save us from the fires of hell, lead all souls to heaven, especially those in most need of thy mercy. Amen.`,
  },
  {
    key: 'hail_holy_queen',
    en: `Hail, holy Queen, Mother of mercy, our life, our sweetness, and our hope. To thee do we cry, poor banished children of Eve; to thee do we send up our sighs, mourning and weeping in this valley of tears. Turn then, most gracious advocate, thine eyes of mercy toward us; and after this our exile, show unto us the blessed fruit of thy womb, Jesus. O clement, O loving, O sweet Virgin Mary. Pray for us, O holy Mother of God, that we may be made worthy of the promises of Christ. Amen.`,
  },
];

// The twenty mysteries. English titles, meditations (short, written for this app) and the scripture
// each mystery is traditionally read from.
const MYSTERIES = [
  { type: 'joyful', decade: 1, title: 'The Annunciation', ref: 'Luke 1:26-38', meditation: 'The angel Gabriel greets Mary, and she says yes to God’s plan. Ask for humility and an open heart.' },
  { type: 'joyful', decade: 2, title: 'The Visitation', ref: 'Luke 1:39-56', meditation: 'Mary goes in haste to help Elizabeth. Ask for the grace of charity toward our neighbor.' },
  { type: 'joyful', decade: 3, title: 'The Nativity', ref: 'Luke 2:1-20', meditation: 'Jesus is born in Bethlehem, poor and humble. Ask for the grace of detachment from the things of the world.' },
  { type: 'joyful', decade: 4, title: 'The Presentation', ref: 'Luke 2:22-38', meditation: 'Mary and Joseph present Jesus in the Temple. Ask for the grace of obedience.' },
  { type: 'joyful', decade: 5, title: 'The Finding in the Temple', ref: 'Luke 2:41-50', meditation: 'After three days Mary and Joseph find the child Jesus in the Temple. Ask for the grace to seek God above all.' },

  { type: 'sorrowful', decade: 1, title: 'The Agony in the Garden', ref: 'Matthew 26:36-46', meditation: 'Jesus prays in Gethsemane: “Not my will, but yours.” Ask for the grace of contrition.' },
  { type: 'sorrowful', decade: 2, title: 'The Scourging at the Pillar', ref: 'Matthew 27:26', meditation: 'Jesus is scourged for our sins. Ask for the grace of purity.' },
  { type: 'sorrowful', decade: 3, title: 'The Crowning with Thorns', ref: 'Matthew 27:27-31', meditation: 'Jesus is mocked and crowned with thorns. Ask for the grace of moral courage.' },
  { type: 'sorrowful', decade: 4, title: 'The Carrying of the Cross', ref: 'John 19:17', meditation: 'Jesus carries his cross to Calvary. Ask for the grace of patience in our trials.' },
  { type: 'sorrowful', decade: 5, title: 'The Crucifixion', ref: 'Luke 23:33-46', meditation: 'Jesus dies for the salvation of the world. Ask for the grace of final perseverance.' },

  { type: 'glorious', decade: 1, title: 'The Resurrection', ref: 'Matthew 28:1-10', meditation: 'Christ is risen, and death has no power over him. Ask for the grace of faith.' },
  { type: 'glorious', decade: 2, title: 'The Ascension', ref: 'Acts 1:6-11', meditation: 'Jesus ascends to the Father and promises to be with us always. Ask for the grace of hope.' },
  { type: 'glorious', decade: 3, title: 'The Descent of the Holy Spirit', ref: 'Acts 2:1-4', meditation: 'The Spirit comes upon the apostles and Mary at Pentecost. Ask for the gifts of the Holy Spirit.' },
  { type: 'glorious', decade: 4, title: 'The Assumption of Mary', ref: 'Revelation 12:1', meditation: 'Mary is taken, body and soul, into heavenly glory. Ask for the grace of a holy death.' },
  { type: 'glorious', decade: 5, title: 'The Coronation of Mary', ref: 'Revelation 12:1', meditation: 'Mary is crowned Queen of heaven and earth. Ask for the grace of devotion to her.' },

  { type: 'luminous', decade: 1, title: 'The Baptism of Jesus in the Jordan', ref: 'Matthew 3:13-17', meditation: 'Jesus is baptized by John, and the Father declares him his beloved Son. Ask for openness to the Holy Spirit.' },
  { type: 'luminous', decade: 2, title: 'The Wedding Feast at Cana', ref: 'John 2:1-12', meditation: 'At Mary’s request Jesus performs his first sign. Ask for the grace to do whatever he tells us.' },
  { type: 'luminous', decade: 3, title: 'The Proclamation of the Kingdom', ref: 'Mark 1:14-15', meditation: 'Jesus calls all to repentance and belief in the Gospel. Ask for the grace of conversion.' },
  { type: 'luminous', decade: 4, title: 'The Transfiguration', ref: 'Matthew 17:1-8', meditation: 'Jesus is transfigured before Peter, James and John. Ask for the grace of a desire for holiness.' },
  { type: 'luminous', decade: 5, title: 'The Institution of the Eucharist', ref: 'Luke 22:14-20', meditation: 'Jesus gives himself to us in the Eucharist. Ask for a deeper love for the Mass.' },
];

/**
 * Approved Tagalog and Cebuano wording goes here, keyed like the seed above. Left empty: the
 * ministry supplies the text, and the app shows English until it arrives.
 * Mystery keys are `type:decade`, for example 'joyful:1'.
 */
// Mystery titles in Tagalog and Cebuano. These are drafts in traditional Filipino Catholic usage. Check each
// against the parish's approved rosary booklet before the first public use. Meditations and prayer bodies are
// left empty on purpose: the app shows English for those until the approved wording is added here.
const MYSTERY_TRANSLATIONS = {
  "joyful:1": { titleTl: "Ang Pagbabalita", titleCeb: "Ang Pagpahibalo", meditationTl: "Ipinahayag ng Anghel Gabriel kay Maria ang plano ng Diyos. Hilingin ang kababaang-loob.", meditationCeb: "Gipahibalo sa Anghel Gabriel ngadto kang Maria ang plano sa Dios. Pangayo og kaubsanon ug bukas nga kasingkasing." },
  "joyful:2": { titleTl: "Ang Pagdalaw", titleCeb: "Ang Pagduaw", meditationTl: "Dinalaw ni Maria si Elisabet at tinulungan ito. Hilingin ang biyaya ng pag-ibig sa kapwa.", meditationCeb: "Giduaw ni Maria si Isabel ug gitabangan siya. Pangayo ang grasya sa paghigugma sa silingan." },
  "joyful:3": { titleTl: "Ang Pagsilang ng Ating Panginoon", titleCeb: "Ang Pagkatawo ni Jesus", meditationTl: "Isinilang si Hesus sa Betlehem, mahirap at mapagpakumbaba. Hilingin ang biyaya ng pagtalikod sa mga bagay ng mundo.", meditationCeb: "Natawo si Jesus sa Betlehem, kabos ug mapaubsanon. Pangayo ang grasya sa pagbiya sa mga butang sa kalibotan." },
  "joyful:4": { titleTl: "Ang Paghahain sa Templo", titleCeb: "Ang Paghalad sa Templo", meditationTl: "Inihahandog nina Maria at Jose si Hesus sa Templo. Hilingin ang biyaya ng pagsunod.", meditationCeb: "Gihalad ni Maria ug Jose si Jesus sa Templo. Pangayo ang grasya sa pagkamasinugtanon." },
  "joyful:5": { titleTl: "Ang Pagkatagpo kay Hesus sa Templo", titleCeb: "Ang Pagkaplag kang Jesus sa Templo", meditationTl: "Pagkaraan ng tatlong araw, natagpuan nina Maria at Jose si Hesus sa Templo. Hilingin ang paghahanap sa Diyos higit sa lahat.", meditationCeb: "Human sa tulo ka adlaw, nakaplag sila Maria ug Jose kang Jesus sa Templo. Pangayo ang grasya sa pagpangita sa Dios labaw sa tanan." },
  "sorrowful:1": { titleTl: "Ang Panalangin sa Halamanan", titleCeb: "Ang Pag-ampo sa Halamanan", meditationTl: "Nanalangin si Hesus sa Getsemani: ‘Hindi ang aking kalooban, kundi ang sa iyo.’ Hilingin ang biyaya ng pagsisisi.", meditationCeb: "Nagpangadye si Jesus sa Getsemani: ‘Dili ang akong kabubut-on, kondili ang imo.’ Pangayo ang grasya sa pagbasol." },
  "sorrowful:2": { titleTl: "Ang Paghahagupit sa Tali", titleCeb: "Ang Paghampak sa Tali", meditationTl: "Hinagupit si Hesus dahil sa ating mga kasalanan. Hilingin ang biyaya ng kalinisan ng puso.", meditationCeb: "Gihampak si Jesus tungod sa atong mga sala. Pangayo ang grasya sa kaputli sa kasingkasing." },
  "sorrowful:3": { titleTl: "Ang Pagpuputong ng Koronang Tinik", titleCeb: "Ang Pagkorona sa Tunok", meditationTl: "Inuyam at kinoronahan ng tinik si Hesus. Hilingin ang biyaya ng tapang ng loob.", meditationCeb: "Giyawyaw ug gikoronahan ug tunok si Jesus. Pangayo ang grasya sa maisug nga kasingkasing." },
  "sorrowful:4": { titleTl: "Ang Pagpapas-an ng Krus", titleCeb: "Ang Pagpapas-an sa Krus", meditationTl: "Pinasan ni Hesus ang krus patungong Kalbaryo. Hilingin ang biyaya ng pagtitiis sa mga pagsubok.", meditationCeb: "Gipasan ni Jesus ang krus padulong sa Kalbaryo. Pangayo ang grasya sa pagtugot sa mga pagsulay." },
  "sorrowful:5": { titleTl: "Ang Pagpapako at Pagkamatay sa Krus", titleCeb: "Ang Paglansang ug Pagkabugto sa Krus", meditationTl: "Namatay si Hesus para sa kaligtasan ng mundo. Hilingin ang biyaya ng pagtitiyaga hanggang wakas.", meditationCeb: "Namatay si Jesus alang sa kaluwasan sa kalibotan. Pangayo ang grasya sa paglahutay hangtod sa katapusan." },
  "glorious:1": { titleTl: "Ang Pagkabuhay na Muli", titleCeb: "Ang Pagkabanhaw", meditationTl: "Muling nabuhay si Kristo, at wala nang kapangyarihan ang kamatayan sa kanya. Hilingin ang biyaya ng pananampalataya.", meditationCeb: "Mibanhaw si Kristo, ug wala nay gahom ang kamatayon kaniya. Pangayo ang grasya sa pagtuo." },
  "glorious:2": { titleTl: "Ang Pag-akyat sa Langit", titleCeb: "Ang Pag-saka sa Langit", meditationTl: "Umakyat si Hesus sa Ama at nangakong sasa atin palagi. Hilingin ang biyaya ng pag-asa.", meditationCeb: "Misaka si Jesus ngadto sa Amahan ug nisaad nga magauban kanato kanunay. Pangayo ang grasya sa paglaum." },
  "glorious:3": { titleTl: "Ang Pagbaba ng Espiritu Santo", titleCeb: "Ang Pagkunsad sa Espiritu Santo", meditationTl: "Bumaba ang Espiritu Santo sa mga apostol at kay Maria sa Pentekostes. Hilingin ang mga kaloob ng Espiritu Santo.", meditationCeb: "Mikunsad ang Espiritu Santo sa mga apostoles ug kang Maria sa Pentecostes. Pangayo ang mga kaloob sa Espiritu Santo." },
  "glorious:4": { titleTl: "Ang Pag-akyat sa Langit ng Mahal na Birhen", titleCeb: "Ang Pagdala sa Birhen sa Langit", meditationTl: "Dinala si Maria sa langit, katawan at kaluluwa. Hilingin ang biyaya ng mabuting kamatayan.", meditationCeb: "Gidala si Maria sa langit, lawas ug kalag. Pangayo ang grasya sa maayong kamatayon." },
  "glorious:5": { titleTl: "Ang Pagpuputong ng Korona sa Mahal na Birhen", titleCeb: "Ang Pagkorona sa Birhen Maria", meditationTl: "Kinoronahan si Maria bilang Reyna ng langit at lupa. Hilingin ang biyaya ng debosyon sa kanya.", meditationCeb: "Gikoronahan si Maria isip Reyna sa langit ug yuta. Pangayo ang grasya sa debosyon kaniya." },
  "luminous:1": { titleTl: "Ang Binyag sa Ilog Jordan", titleCeb: "Ang Pagbunyag sa Jordan", meditationTl: "Binyagan ni Juan si Hesus sa Ilog Jordan, at tinawag siya ng Ama na kanyang Anak. Hilingin ang bukas na puso sa Espiritu Santo.", meditationCeb: "Gibunyagan ni Juan si Jesus sa Suba sa Jordan, ug gitawag siya sa Amahan nga iyang Anak. Pangayo ang bukas nga kasingkasing sa Espiritu Santo." },
  "luminous:2": { titleTl: "Ang Kasalan sa Cana", titleCeb: "Ang Kasal sa Cana", meditationTl: "Sa hiling ni Maria, ginawa ni Hesus ang una niyang tanda. Hilingin ang biyaya na gawin ang lahat ng sasabihin niya.", meditationCeb: "Sa paghangyo ni Maria, gihimo ni Jesus ang iyang unang timaan. Pangayo ang grasya sa pagbuhat sa tanan nga iyang isulti." },
  "luminous:3": { titleTl: "Ang Panawagan sa Pagsisi", titleCeb: "Ang Pagproklama sa Gingharian", meditationTl: "Tinawag ni Hesus ang lahat sa pagsisisi at pananampalataya sa Ebanghelyo. Hilingin ang biyaya ng pagbabagong-loob.", meditationCeb: "Gitawag ni Jesus ang tanan sa pagbasol ug pagtuo sa Ebanghelyo. Pangayo ang grasya sa pagbag-o." },
  "luminous:4": { titleTl: "Ang Pagbabagong-anyo", titleCeb: "Ang Pag-usab sa Anyo", meditationTl: "Nagbagong-anyo si Hesus sa harap nina Pedro, Santiago at Juan. Hilingin ang pagnanais ng kabanalan.", meditationCeb: "Nagbag-o ang iyang dagway sa atubangan ni Pedro, Santiago ug Juan. Pangayo ang tinguha sa pagkabalaan." },
  "luminous:5": { titleTl: "Ang Pagtatag ng Banal na Eukaristiya", titleCeb: "Ang Pagtukod sa Eukaristiya", meditationTl: "Ibinibigay ni Hesus ang sarili niya sa atin sa Eukaristiya. Hilingin ang mas malalim na pagmamahal sa Misa.", meditationCeb: "Gihatag ni Jesus ang iyang kaugalingon kanato sa Eukaristiya. Pangayo ang mas lawom nga gugma sa Misa." },
};

// Prayer bodies are not added here. The prayer names are in rosary-i18n.js, and the bodies follow
// the parish's approved wording.
// Cebuano prayers, entered from the screenshots of the Basilica Minore del Sto. Nino de Cebu prayer pages
// that the parish provided. The Basilica has given permission for their use in this app. Text is as published,
// except the stray "l" after the first line of O Jesus Ko, which was left out.
const PRAYER_TRANSLATIONS = {
  our_father: { ceb: "Amahan namo nga anaa sa mga langit\nPagdaygon ang imong ngalan\nUmabot kanamo ang imong gingharian\nMatuman ang imong pagbuot\nDinhi sa yuta maingon sa langit\nAng kalan-on namo sa matag adlaw\nIhatag kanamo karon adlawa\nUg pasayloa kami sa among mga sala\nIngon nga nagapasaylo kami sa mga nakasala kanamo\nUg dili mo kami itugyan sa panulay\nHinunua luwasa kami sa dautan.\nAmen." },
  hail_mary: { ceb: "Maghimaya ka Maria, puno ka sa grasya.\nAng Ginoong Dios maanaa kanimo.\nBulahan ikaw sa babaeng tanan,\nug bulahan man usab ang bunga sa tiyan mo nga si Hesus.\n\nSanta Maria Inahan ka sa Dios,\nig-ampo mo kaming makasasala. Karon\nug sa oras sa among igkamatay.\nAmen." },
  glory_be: { ceb: "Himaya sa Amahan,\nug sa Anak,\nug sa Espiritu Santo.\n\nMaingon sa sinugdan, karon ug sa gihapon,\nug sa mga katuigan nga walay katapusan.\nAmen." },
  fatima: { ceb: "Oh! Hesus ko pasaylo-a kami sa among mga sala,\nuwasa kami sa kalayo sa impyerno\nog dad-a ang tanang mga kalag sa purgatoryo ngadto sa langit\nhilabi na gayud kadtong mga nanginahanglan sa imong kalo-oy ug panabang.\nAmen." },
  hail_holy_queen: { ceb: "Maghimaya ka Rayna, Inahan sa kaluoy ug kinabuhi,\nKinatam-is ikaw ang gi-lauman namo, Maghimaya Ka!\nNagapanawag kami kanimo,\nKaming mga hininginlang anak ni Eba,\nNagapanghupaw kami, Nanag-agulou, nanagpanghilak,\nDinhi niining walog nga luhaan.\nDad-a ang among mag-alampo,\nipakita mo kanamo kanang imong ga mata nga maloloy-on\nKon tapos na kining paghingilin ipakita mo kanamo\nAng imong Anak nga si Hesus,\nAng Mahal nga Bunga sa tiyan mo.\nAy maaghop!, Ay maluluy-on,\nAy matam-is nga Birhen Maria!" },
  creed: { ceb: "Nagatoo ako sa Dios nga Amahan,\nMakagagahum sa tanan.\nMagbubuhat sa Langit og sa Yuta.\nNagatoo ako kang Jesukristo\niyang bugtong anak nga atong Ginoo,\ngipanamkon siya sa lalang sa\nEspiritu Santo, Ug Natawo gikan ni Maria nga\nUlay, Gisakit siya sa sugo ni Poncio Pilato,\nGilansang sa krus, Namatay ug Gilubong. Miadto\nsiya sa mga Nangamatay ug sa ikatolo ka adlaw\nnabanhaw siya. Misaka sa Langit, ug nagalingkod\nsa too sa Dios Amahan, Makagagahum sa tanan.\nGikan Didto Mobalik siya aron Paghukom sa mga\nBuhi ug sa mga Minatay. Nagatoo ako sa Espiritu\nSanto. Sa santos ug Katoliko nga Simbahan, sa\nPanag-ambit sa mga Santos, sa Kapasayloan sa\nmga sala, ug sa Pagkabanhaw sa Lawas ug sa\nKinabuhing Walay Katapusan.\n\nAmen." },
};

/**
 * Seeds the rosary tables. Safe on every launch: missing rows are inserted, and an empty
 * Tagalog or Cebuano column is filled when the seed has text for it. Text already in the
 * database is never overwritten.
 */
export function seedRosary(db) {
  // English is written once and never overwritten. A Tagalog or Cebuano column is filled from
  // the slot maps below only while it is still empty, so approved wording can be added later.
  const mystery = db.prepare(`
    INSERT INTO rosary_mysteries
      (mystery_type, decade_number, title_en, title_tl, title_ceb, meditation_en, meditation_tl, meditation_ceb, scripture_ref)
    VALUES (@type, @decade, @title, @titleTl, @titleCeb, @meditation, @meditationTl, @meditationCeb, @ref)
    ON CONFLICT (mystery_type, decade_number) DO UPDATE SET
      title_tl = COALESCE(NULLIF(excluded.title_tl, ''), rosary_mysteries.title_tl),
      title_ceb = COALESCE(NULLIF(excluded.title_ceb, ''), rosary_mysteries.title_ceb),
      meditation_tl = COALESCE(NULLIF(excluded.meditation_tl, ''), rosary_mysteries.meditation_tl),
      meditation_ceb = COALESCE(NULLIF(excluded.meditation_ceb, ''), rosary_mysteries.meditation_ceb)`);
  const prayer = db.prepare(`
    INSERT INTO rosary_prayers (key, text_en, text_tl, text_ceb) VALUES (@key, @en, @tl, @ceb)
    ON CONFLICT (key) DO UPDATE SET
      text_tl = COALESCE(NULLIF(rosary_prayers.text_tl, ''), excluded.text_tl),
      text_ceb = COALESCE(NULLIF(rosary_prayers.text_ceb, ''), excluded.text_ceb)`);

  db.transaction(() => {
    for (const m of MYSTERIES) {
      const tr = MYSTERY_TRANSLATIONS[`${m.type}:${m.decade}`] ?? {};
      mystery.run({
        type: m.type, decade: m.decade, title: m.title, meditation: m.meditation, ref: m.ref,
        titleTl: tr.titleTl ?? '', titleCeb: tr.titleCeb ?? '', meditationTl: tr.meditationTl ?? '', meditationCeb: tr.meditationCeb ?? '',
      });
    }
    for (const p of PRAYERS) {
      const tr = PRAYER_TRANSLATIONS[p.key] ?? {};
      prayer.run({ key: p.key, en: p.en, tl: tr.tl ?? '', ceb: tr.ceb ?? '' });
    }
  })();
  return {
    mysteries: db.prepare('SELECT COUNT(*) AS n FROM rosary_mysteries').get().n,
    prayers: db.prepare('SELECT COUNT(*) AS n FROM rosary_prayers').get().n,
  };
}

/**
 * Rosary data access: reads for the deck and the editor, saves from the editor, and JSON backup.
 * The dialogs are injected so the file handling can be tested without a window.
 */
export function createRosaryService(db, deps = {}) {
  const { showSaveDialog, showOpenDialog } = deps;
  const writer = createRosaryWriter(db);

  const mysteries = db.prepare(`
    SELECT mystery_type AS mysteryType, decade_number AS decadeNumber,
           title_en AS titleEn, title_tl AS titleTl, title_ceb AS titleCeb,
           meditation_en AS meditationEn, meditation_tl AS meditationTl, meditation_ceb AS meditationCeb,
           scripture_ref AS scriptureRef,
           approved_en AS approvedEn, approved_tl AS approvedTl, approved_ceb AS approvedCeb
    FROM rosary_mysteries
    ORDER BY CASE mystery_type WHEN 'joyful' THEN 0 WHEN 'sorrowful' THEN 1 WHEN 'glorious' THEN 2 ELSE 3 END,
             decade_number`);
  const prayers = db.prepare(`
    SELECT key, text_en AS textEn, text_tl AS textTl, text_ceb AS textCeb,
           approved_en AS approvedEn, approved_tl AS approvedTl, approved_ceb AS approvedCeb
    FROM rosary_prayers ORDER BY key`);

  const counts = () => ({
    mysteries: db.prepare('SELECT COUNT(*) AS n FROM rosary_mysteries').get().n,
    prayers: db.prepare('SELECT COUNT(*) AS n FROM rosary_prayers').get().n,
  });

  return {
    getMysteries: () => mysteries.all(),
    getPrayers: () => prayers.all(),

    /** Saves one mystery from the editor. The row is checked first, then written in one transaction. */
    saveMystery(input) {
      const row = normalizeMystery(input, 'Mystery');
      writer.write({ mysteries: [row], prayers: [] });
      return true;
    },

    /** Saves one prayer from the editor. */
    savePrayer(input) {
      const row = normalizePrayer(input, 'Prayer');
      writer.write({ mysteries: [], prayers: [row] });
      return true;
    },

    /** Asks where to save, then writes every rosary row to a JSON file. Resolves to null if cancelled. */
    async exportBackup(win) {
      const picked = await showSaveDialog(win, {
        title: 'Export rosary content',
        defaultPath: BACKUP_FILE_NAME,
        filters: [{ name: 'JSON backup', extensions: ['json'] }],
      });
      if (picked.canceled || !picked.filePath) return null;
      const backup = readAllRosary(db);
      await fs.promises.writeFile(picked.filePath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8');
      return { path: picked.filePath, mysteries: backup.rosary_mysteries.length, prayers: backup.rosary_prayers.length };
    },

    /**
     * Asks for a backup file, checks every row, then writes them all in one transaction. A file
     * with any bad row changes nothing. Resolves to null if cancelled.
     */
    async importBackup(win) {
      const picked = await showOpenDialog(win, {
        title: 'Import rosary content',
        properties: ['openFile'],
        filters: [{ name: 'JSON backup', extensions: ['json'] }],
      });
      if (picked.canceled || picked.filePaths.length === 0) return null;
      const source = picked.filePaths[0];
      let data;
      try {
        data = JSON.parse(await fs.promises.readFile(source, 'utf8'));
      } catch {
        throw new Error('This file is not valid JSON.');
      }
      const rows = parseBackup(data);
      writer.write(rows);
      return { path: source, mysteries: rows.mysteries.length, prayers: rows.prayers.length, total: counts() };
    },
  };
}

/** Registers the rosary:* IPC channels. */
export function setupRosary(db) {
  const handle = (channel, fn) =>
    ipcMain.handle(`rosary:${channel}`, (event, ...args) => fn(BrowserWindow.fromWebContents(event.sender), ...args));

  const service = createRosaryService(db, {
    showSaveDialog: (win, options) => (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options)),
    showOpenDialog: (win, options) => (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)),
  });

  handle('get-mysteries', () => service.getMysteries());
  handle('get-prayers', () => service.getPrayers());
  handle('saveMystery', (_win, input) => service.saveMystery(input));
  handle('savePrayer', (_win, input) => service.savePrayer(input));
  handle('exportJSON', (win) => service.exportBackup(win));
  handle('importJSON', (win) => service.importBackup(win));
  return service;
}
