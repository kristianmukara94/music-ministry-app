// Sample data for the Web Planner, phase 1. Every page reads its data from here, so phase 2 can replace this one file
// with calls to the cloud sync API. Song titles, categories, languages and keys only: no lyrics and no Bible text.

/** The laptop's sync state, shown in the sidebar and on the Plans page. */
export const SYNC = {
  title: 'Laptop synced',
  when: '2 min ago',
  account: 'Church account',
};


/**
 * The song list from the church laptop: [title, category, language, key]. The Songs page shows all of them; the Mass
 * editor offers the ones in the step's category.
 */
// The same names the church laptop files songs under (shared/mass-flow.js). A test keeps the two lists equal.
export const SONG_CATEGORIES = [
  'Entrance Procession', 'Kyrie', 'Gloria', 'Responsorial Psalm', 'Gospel Acclamation', 'Preparation of the Gifts',
  'Holy, Holy, Holy', 'Memorial Acclamation', 'Great Amen', 'Our Father', 'Lamb of God', 'Communion Procession',
  'Thanksgiving', 'Recessional',
];
export const LANGUAGES = ['English', 'Tagalog', 'Cebuano'];
export const LANGUAGE_CODE = { English: 'EN', Tagalog: 'TL', Cebuano: 'CEB' };
export const SONGS_SYNCED = 'Synced 2 min ago';

export const SONGS = [
  ['Praise to the Lord, the Almighty', 'Entrance Procession', 'English', 'D'],
  ['Be Thou My Vision', 'Entrance Procession', 'English', 'Eb'],
  ['Tipunon Kita', 'Entrance Procession', 'Cebuano', 'G'],
  ['Lord, have mercy (Mass setting)', 'Kyrie', 'English', 'G'],
  ['Gloria (Mass setting)', 'Gloria', 'English', 'C'],
  ['Psalm 24 setting', 'Responsorial Psalm', 'English', 'F'],
  ['Alleluia, alleluia', 'Gospel Acclamation', 'English', 'C'],
  ['Aleluya', 'Gospel Acclamation', 'Tagalog', 'D'],
  ['Take my life and let it be', 'Preparation of the Gifts', 'English', 'G'],
  ['Holy, Holy, Holy (Mass setting)', 'Holy, Holy, Holy', 'English', 'D'],
  ['Christ has died (Mass setting)', 'Memorial Acclamation', 'English', 'Am'],
  ['Great Amen (Mass setting)', 'Great Amen', 'English', 'D'],
  ['Our Father (chant)', 'Our Father', 'English', 'G'],
  ['Ama Namin', 'Our Father', 'Tagalog', 'F'],
  ['Lamb of God (Mass setting)', 'Lamb of God', 'English', 'C'],
  ['I am the Bread of Life', 'Communion Procession', 'English', 'Bb'],
  ['Taste and see', 'Communion Procession', 'English', 'E'],
  ['Tinapay sa Kinabuhi', 'Communion Procession', 'Cebuano', 'D'],
  ['Now thank we all our God', 'Thanksgiving', 'English', 'F'],
  ['For All the Saints', 'Recessional', 'English', 'Bb'],
  ['Hail, Holy Queen enthroned above', 'Recessional', 'English', 'D'],
  ['Lord, I lift your name on high', '', 'English', 'G'],
  ['Our God is an awesome God', '', 'English', 'E'],
  ['Be still and know', '', 'English', 'A'],
];

/**
 * The Mass plan being edited. Each row: [n, name, kind, song category, value, source, optional, hint].
 * `kind` is 'song', 'reading' or 'rite'. `source` is 'list' (chosen from the song list) or 'text' (a typed note).
 * Readings hold a reference only, never the text.
 */
export const MASS_PLAN = {
  eyebrow: 'MASS PLAN · SUNDAY 1 NOVEMBER 2026 · SOLEMNITY',
  title: 'All Saints, Sunday Mass',
  status: 'Saved · laptop pulls it on next sync',
  firstSelected: 10,
  sections: [
    { title: 'I · INTRODUCTORY RITES', rows: [
      [1, 'Entrance Procession', 'song', 'Entrance Procession', 'Praise to the Lord, the Almighty', 'list', false, ''],
      [2, 'Greeting', 'rite'],
      [3, 'Penitential Act', 'rite'],
      [4, 'Kyrie', 'song', 'Kyrie', 'Lord, have mercy (Mass setting)', 'text', false, ''],
      [5, 'Gloria', 'song', 'Gloria', 'Gloria (Mass setting)', 'list', false, 'When prescribed'],
      [6, 'Collect / Opening Prayer', 'rite'],
    ] },
    { title: 'II · LITURGY OF THE WORD', rows: [
      [7, 'First Reading', 'reading', '', 'Revelation 7:2-4, 9-14', 'text', false, ''],
      [8, 'Responsorial Psalm', 'song', 'Responsorial Psalm', 'Psalm 24 (sung response)', 'text', false, ''],
      [9, 'Second Reading', 'reading', '', '1 John 3:1-3', 'text', false, 'Sundays and solemnities'],
      [10, 'Gospel Acclamation (Alleluia)', 'song', 'Gospel Acclamation', '', '', false, ''],
      [11, 'Gospel Reading', 'reading', '', 'Matthew 5:1-12a', 'text', false, ''],
      [12, 'Homily', 'rite'],
      [13, 'Profession of Faith (Creed)', 'rite'],
      [14, 'Prayer of the Faithful', 'rite'],
    ] },
    { title: 'III · LITURGY OF THE EUCHARIST', rows: [
      [15, 'Preparation of the Gifts / Offertory', 'song', 'Preparation of the Gifts', '', '', false, ''],
      [16, 'Prayer over the Offerings', 'rite'],
      [17, 'Preface', 'rite'],
      [18, 'Holy, Holy, Holy (Sanctus)', 'song', 'Holy, Holy, Holy', 'Holy, Holy, Holy (Mass setting)', 'list', false, ''],
      [19, 'Eucharistic Prayer', 'rite'],
      [20, 'Memorial Acclamation', 'song', 'Memorial Acclamation', 'Christ has died (Mass setting)', 'list', false, ''],
      [21, 'Great Amen', 'song', 'Great Amen', '', '', false, ''],
    ] },
    { title: 'IV · COMMUNION RITE', rows: [
      [22, 'Our Father', 'song', 'Our Father', '', '', true, 'If sung'],
      [23, 'Sign of Peace', 'rite'],
      [24, 'Lamb of God (Agnus Dei)', 'song', 'Lamb of God', 'Lamb of God (Mass setting)', 'list', false, ''],
      [25, 'Communion Procession', 'song', 'Communion Procession', 'I am the Bread of Life', 'list', false, ''],
      [26, 'Thanksgiving / Meditation', 'song', 'Thanksgiving', '', '', true, 'Optional'],
      [27, 'Prayer after Communion', 'rite'],
    ] },
    { title: 'V · CONCLUDING RITES', rows: [
      [28, 'Announcements', 'rite', '', '', '', true, 'If needed'],
      [29, 'Final Blessing', 'rite'],
      [30, 'Dismissal', 'rite'],
      [31, 'Recessional / Closing Song', 'song', 'Recessional', 'For All the Saints', 'list', false, ''],
    ] },
  ],
};

/**
 * The Praise & Worship session being edited. Each row: [id, name, kind, default minutes, value, hint].
 * `kind` is 'song', 'reading' (a reference only) or 'rite'. A hint of 'Optional' marks a step that may stay empty.
 */
export const PRAISE_PLAN = {
  eyebrow: 'PRAISE & WORSHIP · FRIDAY 6 NOVEMBER 2026 · 7:00 PM',
  title: 'Charismatic Prayer Night',
  status: 'Draft · not yet synced',
  targetMinutes: 90,
  sectionLabels: ['Opening', 'Word', 'Closing'],
  sections: [
    { title: 'OPENING', rows: [
      ['1', 'Welcome and opening prayer', 'rite', 5, '', 'Led by the prayer leader'],
      ['2', 'Opening praise song', 'song', 5, 'Lord, I lift your name on high', 'Fast praise'],
      ['3', 'Praise set', 'song', 10, 'Our God is an awesome God', 'Up to 3 songs'],
      ['4', 'Spontaneous praise', 'rite', 5, '', 'Open prayer, no slides'],
    ] },
    { title: 'WORD AND TEACHING', rows: [
      ['5', 'Worship song', 'song', 6, 'Be still and know', 'Slow worship'],
      ['6', 'Scripture reading', 'reading', 4, 'Psalm 63:1-8', 'Typed note'],
      ['7', 'Sharing / teaching', 'rite', 15, '', 'Speaker: to be confirmed'],
      ['8', 'Response song', 'song', 5, '', 'After the teaching'],
    ] },
    { title: 'INTERCESSION AND CLOSING', rows: [
      ['9', 'Intercessions', 'rite', 10, '', 'Prayer intentions from the floor'],
      ['10', 'Offering song', 'song', 4, 'Take my life and let it be', 'Optional'],
      ['11', 'Closing song', 'song', 5, '', 'Fast praise'],
      ['12', 'Blessing and dismissal', 'rite', 3, '', 'Led by the priest or lay leader'],
    ] },
  ],
  /** Checks the planner cannot work out from the steps. */
  fixedChecks: [
    { ok: true, text: 'Date, time and venue are set', sub: '' },
    { ok: false, text: 'Speaker is not confirmed', sub: 'Add a note on step 7' },
  ],
};

export const DEVICES = [
  { name: 'Church laptop (Operator booth)', meta: 'Windows · App 1.0.8 · Linked 12 Oct 2026', status: 'Synced 2 min ago', tone: 'ok' },
  { name: 'Ministry lead laptop', meta: 'Windows · App 1.0.7 · Linked 3 Sep 2026', status: 'Offline since Friday', tone: 'idle' },
];

export const ACTIVITY = [
  { time: 'Today 9:12', text: 'Web edit saved: All Saints, Sunday Mass', tag: 'Conflict', tone: 'warn' },
  { time: 'Today 8:58', text: 'Laptop pushed 124 song titles and categories', tag: 'Done', tone: 'ok' },
  { time: 'Yesterday', text: 'Laptop pulled Praise & Worship: Charismatic Prayer Night', tag: 'Done', tone: 'ok' },
  { time: 'Yesterday', text: 'Web edit saved: Charismatic Prayer Night', tag: 'Done', tone: 'ok' },
  { time: '19 Oct', text: 'Ministry lead laptop could not reach the server', tag: 'Retried', tone: 'idle' },
];

/** The plan edited in two places. Each version lists the songs that differ. */
export const CONFLICT = {
  count: 1,
  title: 'All Saints, Sunday Mass was edited in two places',
  detail: 'Someone changed it on the web while the laptop was offline. Choose which version to keep. The other is kept for 30 days.',
  web: { edited: 'Edited today, 9:12 AM', lines: ['Entrance: Praise to the Lord, the Almighty', 'Communion: I am the Bread of Life', 'Recessional: For All the Saints'] },
  laptop: { edited: 'Edited yesterday, 8:40 PM', lines: ['Entrance: Be Thou My Vision', 'Communion: I am the Bread of Life', 'Recessional: Hail, Holy Queen enthroned above'] },
};

/** The link code shown first. "New code" makes a fresh one in the same form. */
export const LINK_CODE = 'K7QM-4XD2';
