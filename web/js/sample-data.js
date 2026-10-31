// The fixed shapes the Web Planner builds on: the Mass and Praise & Worship templates, the song categories and the languages.
// Plans, songs, users and laptops come from the server. Song titles, categories, languages and keys only: no lyrics and no Bible text.

// The same names the church laptop files songs under (shared/mass-flow.js). A test keeps the two lists equal.
export const SONG_CATEGORIES = [
  'Entrance Procession', 'Kyrie', 'Gloria', 'Responsorial Psalm', 'Gospel Acclamation', 'Preparation of the Gifts',
  'Holy, Holy, Holy', 'Memorial Acclamation', 'Great Amen', 'Our Father', 'Lamb of God', 'Communion Procession',
  'Thanksgiving', 'Recessional',
];
export const LANGUAGES = ['English', 'Tagalog', 'Cebuano'];
export const LANGUAGE_CODE = { English: 'EN', Tagalog: 'TL', Cebuano: 'CEB' };

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
