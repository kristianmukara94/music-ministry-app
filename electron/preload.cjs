const { contextBridge, ipcRenderer, webUtils } = require('electron');

// The sanctuary watchdog's heartbeat (electron/watchdog.js). The preload answers, not the page: it runs on the page's own thread, so a page
// stuck in a loop cannot answer, while one still loading already can. The main process only pings the projector.
ipcRenderer.on('watchdog:ping', (_event, seq) => ipcRenderer.send('watchdog:pong', seq));

contextBridge.exposeInMainWorld('apcc', {
  getState: () => ipcRenderer.invoke('live:get'),
  dispatch: (action) => ipcRenderer.send('live:dispatch', action),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('live:state', handler);
    return () => ipcRenderer.removeListener('live:state', handler);
  },
  open: (target) => ipcRenderer.invoke('launch:open', target),
  /** Runs `callback({ toggle })` when Ctrl+Shift+A is pressed in any window (see electron/hotkeys.js). Returns the unsubscribe. */
  onSanctuaryAlertHotkey: (callback) => {
    const handler = (_event, payload) => callback(payload ?? { toggle: false });
    ipcRenderer.on('sanctuary-alert:toggle-modal', handler);
    return () => ipcRenderer.removeListener('sanctuary-alert:toggle-modal', handler);
  },

  /** The sanctuary display watchdog: its status for the Go Live badge, Force Failover, and the failover page's own channel. */
  watchdog: {
    status: () => ipcRenderer.invoke('watchdog:get'),
    onStatus: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on('watchdog:status', handler);
      return () => ipcRenderer.removeListener('watchdog:status', handler);
    },
    force: (on) => ipcRenderer.invoke('watchdog:force', on),
    setMode: (mode) => ipcRenderer.invoke('watchdog:setMode', mode),
    failoverMode: () => ipcRenderer.invoke('watchdog:failoverMode'),
    onFailoverMode: (callback) => {
      const handler = (_event, mode) => callback(mode);
      ipcRenderer.on('watchdog:failover-mode', handler);
      return () => ipcRenderer.removeListener('watchdog:failover-mode', handler);
    },
    painted: (mode) => ipcRenderer.send('watchdog:failover-painted', mode),
  },

  /** The EDID lock: the projector pinned to a physical monitor on a physical GPU port (electron/edid-watchdog.js). */
  edid: {
    status: () => ipcRenderer.invoke('edid:get'),
    onStatus: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on('edid:status', handler);
      return () => ipcRenderer.removeListener('edid:status', handler);
    },
    pin: () => ipcRenderer.invoke('edid:pin'),
    unpin: () => ipcRenderer.invoke('edid:unpin'),
  },

  announcements: {
    folders: () => ipcRenderer.invoke('announcements:folders'),
    slides: (folderId) => ipcRenderer.invoke('announcements:slides', folderId),
    createFolder: (name) => ipcRenderer.invoke('announcements:createFolder', name),
    renameFolder: (id, name) => ipcRenderer.invoke('announcements:renameFolder', id, name),
    deleteFolder: (id) => ipcRenderer.invoke('announcements:deleteFolder', id),
    importSlides: (folderId, lang) => ipcRenderer.invoke('announcements:import', folderId, lang),
    importPaths: (folderId, paths) => ipcRenderer.invoke('announcements:importPaths', folderId, paths),
    reorder: (folderId, slideIds) => ipcRenderer.invoke('announcements:reorder', folderId, slideIds),
    deleteSlide: (id) => ipcRenderer.invoke('announcements:deleteSlide', id),
    moveSlides: (ids, folderId) => ipcRenderer.invoke('announcements:moveSlides', ids, folderId),
    setNotes: (id, notes) => ipcRenderer.invoke('announcements:setNotes', id, notes),
    pickBackground: (lang) => ipcRenderer.invoke('announcements:pickBackground', lang),
    discardBackground: (name) => ipcRenderer.invoke('announcements:discardBackground', name),
    createTextSlides: (folderId, pages, backgroundName, style) =>
      ipcRenderer.invoke('announcements:createTextSlides', folderId, pages, backgroundName, style),
  },

  lyrics: {
    /** Calls `callback(id)` when a song changes in any window. Returns a function that stops listening. */
    onChanged: (callback) => {
      const handler = (_event, id) => callback(id);
      ipcRenderer.on('lyrics:changed', handler);
      return () => ipcRenderer.removeListener('lyrics:changed', handler);
    },
    listHymns: (filter) => ipcRenderer.invoke('lyrics:listHymns', filter),
    getHymn: (id) => ipcRenderer.invoke('lyrics:getHymn', id),
    createHymn: (input) => ipcRenderer.invoke('lyrics:createHymn', input),
    /** Saves several songs; one result per song, in order. */
    createHymns: (inputs) => ipcRenderer.invoke('lyrics:createHymns', inputs),
    deleteHymn: (id) => ipcRenderer.invoke('lyrics:deleteHymn', id),
    listDeletedHymns: () => ipcRenderer.invoke('lyrics:listDeletedHymns'),
    undoDeleteHymn: (id) => ipcRenderer.invoke('lyrics:undoDeleteHymn', id),
    editHymn: (id, input) => ipcRenderer.invoke('lyrics:editHymn', id, input),
    editLyrics: (id, raw) => ipcRenderer.invoke('lyrics:editLyrics', id, raw),
    splitStanza: (id, index, parts) => ipcRenderer.invoke('lyrics:splitStanza', id, index, parts),
    listSetlists: () => ipcRenderer.invoke('lyrics:listSetlists'),
    createSetlist: (input) => ipcRenderer.invoke('lyrics:createSetlist', input),
    deleteSetlist: (id) => ipcRenderer.invoke('lyrics:deleteSetlist', id),
    getSetlist: (id) => ipcRenderer.invoke('lyrics:getSetlist', id),
    saveSetlist: (id, hymnIds) => ipcRenderer.invoke('lyrics:saveSetlist', id, hymnIds),
    setStyle: (id, style) => ipcRenderer.invoke('lyrics:setStyle', id, style),
    importFile: () => ipcRenderer.invoke('lyrics:importFile'),
    /** Opens the file picker for a Word or text file of many songs. Resolves to its path, or null. */
    pickBatchFile: () => ipcRenderer.invoke('lyrics:pickBatchFile'),
    /** Reads a Word or text file of many songs, as lines. */
    readBatchFile: (filePath) => ipcRenderer.invoke('lyrics:readBatchFile', filePath),
    listSongCategories: () => ipcRenderer.invoke('lyrics:listSongCategories'),
    createSongCategory: (input) => ipcRenderer.invoke('lyrics:createSongCategory', input),
    renameSongCategory: (id, input) => ipcRenderer.invoke('lyrics:renameSongCategory', id, input),
    deleteSongCategory: (id) => ipcRenderer.invoke('lyrics:deleteSongCategory', id),
  },

  lectionary: {
    getDay: (date) => ipcRenderer.invoke('lectionary:getDay', date),
    saveReading: (input) => ipcRenderer.invoke('lectionary:saveReading', input),
    clearReading: (date, readingType) => ipcRenderer.invoke('lectionary:clearReading', date, readingType),
    setSeasonInfo: (date, seasonInfo) => ipcRenderer.invoke('lectionary:setSeasonInfo', date, seasonInfo),
    overview: (from, to) => ipcRenderer.invoke('lectionary:overview', from, to),
    exportJSON: () => ipcRenderer.invoke('lectionary:exportJSON'),
    importJSON: () => ipcRenderer.invoke('lectionary:importJSON'),
  },

  rosary: {
    getMysteries: () => ipcRenderer.invoke('rosary:get-mysteries'),
    getPrayers: () => ipcRenderer.invoke('rosary:get-prayers'),
    saveMystery: (input) => ipcRenderer.invoke('rosary:saveMystery', input),
    savePrayer: (input) => ipcRenderer.invoke('rosary:savePrayer', input),
    exportJSON: () => ipcRenderer.invoke('rosary:exportJSON'),
    importJSON: () => ipcRenderer.invoke('rosary:importJSON'),
  },

  files: {
    /** The file system path of a file the operator dropped on the window. */
    pathFor: (file) => webUtils.getPathForFile(file),
  },

  bible: {
    getTranslations: () => ipcRenderer.invoke('bible:getTranslations'),
    getBooks: (translationId) => ipcRenderer.invoke('bible:getBooks', translationId),
    getChapters: (translationId, bookNumber) => ipcRenderer.invoke('bible:getChapters', translationId, bookNumber),
    getVerses: (translationId, bookNumber, chapter) => ipcRenderer.invoke('bible:getVerses', translationId, bookNumber, chapter),
    search: (input) => ipcRenderer.invoke('bible:search', input),
  },

  plans: {
    list: () => ipcRenderer.invoke('plans:list'),
    create: (input) => ipcRenderer.invoke('plans:create', input),
    deletePlan: (id) => ipcRenderer.invoke('plans:delete', id),
    get: (id) => ipcRenderer.invoke('plans:get', id),
    save: (id, items) => ipcRenderer.invoke('plans:save', id, items),
    setLanguage: (id, language) => ipcRenderer.invoke('plans:setLanguage', id, language),
    slotTitle: (id) => ipcRenderer.invoke('plans:slotTitle', id),
    setSlotTitle: (id, show) => ipcRenderer.invoke('plans:setSlotTitle', id, show),
    listTemplates: () => ipcRenderer.invoke('plans:listTemplates'),
    getTemplate: (id) => ipcRenderer.invoke('plans:getTemplate', id),
    saveTemplate: (input) => ipcRenderer.invoke('plans:saveTemplate', input),
    deleteTemplate: (id) => ipcRenderer.invoke('plans:deleteTemplate', id),
  },

  // The parish's own title for a calendar day, shown in place of its Ordo name.
  calendar: {
    getDayNotes: () => ipcRenderer.invoke('calendar:get_day_notes'),
    saveDayNote: (date, note) => ipcRenderer.invoke('calendar:save_day_note', date, note),
    deleteDayNote: (date) => ipcRenderer.invoke('calendar:delete_day_note', date),
  },

  pw: {
    listSessions: () => ipcRenderer.invoke('pw:listSessions'),
    createSession: (input) => ipcRenderer.invoke('pw:createSession', input),
    getSession: (id) => ipcRenderer.invoke('pw:getSession', id),
    saveSession: (id, input) => ipcRenderer.invoke('pw:saveSession', id, input),
    deleteSession: (id) => ipcRenderer.invoke('pw:deleteSession', id),
    listTemplates: () => ipcRenderer.invoke('pw:listTemplates'),
    saveAsTemplate: (sessionId, name) => ipcRenderer.invoke('pw:saveAsTemplate', sessionId, name),
    deleteTemplate: (id) => ipcRenderer.invoke('pw:deleteTemplate', id),
    listTags: () => ipcRenderer.invoke('pw:listTags'),
    setTag: (hymnId, segmentKey, on) => ipcRenderer.invoke('pw:setTag', hymnId, segmentKey, on),
  },

  notes: {
    list: () => ipcRenderer.invoke('notes:list'),
    get: (id) => ipcRenderer.invoke('notes:get', id),
    save: (input) => ipcRenderer.invoke('notes:save', input),
    /** Go Live's own copy of an item for `owner` (a plan or a lineup card); never changes a Liturgical Content Hub entry. */
    saveCopy: (input, owner) => ipcRenderer.invoke('notes:saveCopy', input, owner),
    remove: (id) => ipcRenderer.invoke('notes:delete', id),
    /** Runs `callback({ id, removed })` whenever a note is saved or deleted, in any window. Returns the unsubscribe. */
    onChanged: (callback) => {
      const handler = (_event, change) => callback(change);
      ipcRenderer.on('notes:changed', handler);
      return () => ipcRenderer.removeListener('notes:changed', handler);
    },
  },
  /** The parish's own words for the Holy Mass Order parts. A part with none shows the standard Missal text. */
  massOrder: {
    list: () => ipcRenderer.invoke('massOrder:list'),
    /** Saves words and titles for the languages given: { en?, tl?, ceb? }, each { text, title }, null keeping the standard one. */
    saveAll: (partId, entries) => ipcRenderer.invoke('massOrder:saveAll', partId, entries),
    /** Makes a parish item (Act of Spiritual Communion…). Resolves to its id. */
    create: (entries) => ipcRenderer.invoke('massOrder:create', entries),
    reset: (partId, lang) => ipcRenderer.invoke('massOrder:reset', partId, lang),
    /** Deletes a parish item. */
    remove: (partId) => ipcRenderer.invoke('massOrder:delete', partId),
    /** Called after any window changes the words. Returns the function that stops listening. */
    onChanged: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('massOrder:changed', handler);
      return () => ipcRenderer.removeListener('massOrder:changed', handler);
    },
  },
  displays: {
    list: () => ipcRenderer.invoke('display:list'),
    identify: () => ipcRenderer.invoke('display:identify'),
  },

  quickLive: {
    projectorOpen: () => ipcRenderer.invoke('check-projector-window'),
    logSpontaneous: (input) => ipcRenderer.invoke('log-spontaneous-song', input),
  },

  projector: {
    save: (patch) => ipcRenderer.invoke('projector:save', patch),
    openConfidenceWindow: () => ipcRenderer.invoke('projector:openConfidenceWindow'),
  },

  welcome: {
    save: (patch) => ipcRenderer.invoke('welcome:save', patch),
  },

  lowerThird: {
    save: (patch) => ipcRenderer.invoke('lowerThird:save', patch),
    info: () => ipcRenderer.invoke('lowerThird:info'),
  },

  vault: {
    status: () => ipcRenderer.invoke('vault:status'),
    setup: (passphrase) => ipcRenderer.invoke('vault:setup', { passphrase: String(passphrase ?? '') }),
    unlock: (passphrase) => ipcRenderer.invoke('vault:unlock', { passphrase: String(passphrase ?? '') }),
    lock: () => ipcRenderer.invoke('vault:lock'),
    changePassphrase: (current, next) => ipcRenderer.invoke('vault:change-passphrase', { current: String(current ?? ''), next: String(next ?? '') }),
    disable: (passphrase) => ipcRenderer.invoke('vault:disable', { passphrase: String(passphrase ?? '') }),
  },

  cloud: {
    status: () => ipcRenderer.invoke('cloud:status'),
    link: (code, label) => ipcRenderer.invoke('cloud:link', { code, label }),
    unlink: () => ipcRenderer.invoke('cloud:unlink'),
    createWebUser: ({ username, displayName, role }) => ipcRenderer.invoke('cloud:create-web-user', { username, displayName, role }),
    songsStatus: () => ipcRenderer.invoke('cloud:songs-status'),
    plansStatus: () => ipcRenderer.invoke('cloud:plans-status'),
    syncSongsNow: () => ipcRenderer.invoke('cloud:songs-sync-now'),
    saveAddress: (address) => ipcRenderer.invoke('cloud:save-address', { address: String(address ?? '') }),
    createChurchAdmin: ({ setupKey, churchName, username, displayName, deviceLabel }) =>
      ipcRenderer.invoke('cloud:create-church-admin', { setupKey, churchName, username, displayName, deviceLabel }),
    defaultLabel: () => ipcRenderer.invoke('cloud:defaultLabel'),
    renewLicense: (setupKey) => ipcRenderer.invoke('cloud:renew-license', { setupKey }),
  },

  license: {
    get: () => ipcRenderer.invoke('license:get'),
    onChanged: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on('license:changed', handler);
      return () => ipcRenderer.removeListener('license:changed', handler);
    },
  },

  remoteView: {
    get: () => ipcRenderer.invoke('remoteView:get'),
    save: (patch) => ipcRenderer.invoke('remoteView:save', patch),
    getNetworkInfo: (role) => ipcRenderer.invoke('remoteView:getNetworkInfo', role),
    disconnect: (role, ip) => ipcRenderer.invoke('remoteView:disconnect', { role, ip }),
  },

  library: {
    export: (options) => ipcRenderer.invoke('library:export', options),
    open: () => ipcRenderer.invoke('library:open'),
    import: (choices) => ipcRenderer.invoke('library:import', choices),
    cancel: () => ipcRenderer.invoke('library:cancel'),
  },

  whiteboard: {
    list: () => ipcRenderer.invoke('whiteboard:list'),
    save: (input) => ipcRenderer.invoke('whiteboard:save', input),
    get: (id) => ipcRenderer.invoke('whiteboard:get', id),
    /** Changes a PowerPoint slide into an editable slide, in place, with the text and design given. */
    makeEditable: (id, input) => ipcRenderer.invoke('whiteboard:makeEditable', id, input),
    /** Turns an edited PowerPoint slide back into its picture. */
    restorePicture: (id) => ipcRenderer.invoke('whiteboard:restorePicture', id),
    /** The PowerPoint file a slide came from, and its number there, or null. */
    pptxSource: (id) => ipcRenderer.invoke('whiteboard:pptxSource', id),
    /** Asks for that file and takes its slides apart, so their words become text boxes. Null if cancelled. */
    layersFromFile: (id) => ipcRenderer.invoke('whiteboard:layersFromFile', id),
    /** Opens the slide in its own editor window. Resolves true once a window is open or already was. */
    openEditor: (id) => ipcRenderer.invoke('whiteboard:openEditor', id),
    /** Called after any window changes a Whiteboard slide or folder. Returns the function that stops listening. */
    onChanged: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('whiteboard:changed', handler);
      return () => ipcRenderer.removeListener('whiteboard:changed', handler);
    },
    /** The editor window is being closed: write any change still waiting, then call `editorFlushed`. */
    onEditorFlush: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('editor:flush', handler);
      return () => ipcRenderer.removeListener('editor:flush', handler);
    },
    editorFlushed: () => ipcRenderer.send('editor:flushed'),
    /** Closes this editor window, after any change still waiting is saved. */
    closeEditor: () => ipcRenderer.send('editor:close'),
    remove: (id) => ipcRenderer.invoke('whiteboard:delete', id),
    removeMany: (ids) => ipcRenderer.invoke('whiteboard:deleteMany', ids),
    clearUnfiled: () => ipcRenderer.invoke('whiteboard:clearUnfiled'),
    rename: (id, title) => ipcRenderer.invoke('whiteboard:rename', id, title),
    setNotes: (id, notes) => ipcRenderer.invoke('whiteboard:setNotes', id, notes),
    reorder: (ids) => ipcRenderer.invoke('whiteboard:reorder', ids),
    folders: () => ipcRenderer.invoke('whiteboard:folders'),
    createFolder: (name) => ipcRenderer.invoke('whiteboard:createFolder', name),
    renameFolder: (id, name) => ipcRenderer.invoke('whiteboard:renameFolder', id, name),
    deleteFolder: (id) => ipcRenderer.invoke('whiteboard:deleteFolder', id),
    move: (ids, folderId) => ipcRenderer.invoke('whiteboard:move', ids, folderId),
    moveSelectedToFolder: (request) => ipcRenderer.invoke('whiteboard:moveSelectedToFolder', request),
    importPowerPoint: (folderId) => ipcRenderer.invoke('whiteboard:importPowerPoint', folderId),
    /** Called as a PowerPoint import goes on, with { currentSlide, totalSlides, percentage, statusText, ... }. Returns the function that stops listening. */
    onImportProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      ipcRenderer.on('powerpoint:import-progress', handler);
      return () => ipcRenderer.removeListener('powerpoint:import-progress', handler);
    },
  },

  media: {
    list: () => ipcRenderer.invoke('media:list'),
    importMedia: () => ipcRenderer.invoke('media:import'),
    deleteMedia: (id) => ipcRenderer.invoke('media:delete', id),
    rename: (id, name) => ipcRenderer.invoke('media:rename', id, name),
    reveal: (id) => ipcRenderer.invoke('media:reveal', id),
    /** Background events: a conversion finished (`changed`), or failed (`remux-failed`). */
    onEvent: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('media:event', handler);
      return () => ipcRenderer.removeListener('media:event', handler);
    },
  },

  thumb: {
    onJob: (callback) => {
      const handler = (_event, job) => callback(job);
      ipcRenderer.on('thumb:job', handler);
      return () => ipcRenderer.removeListener('thumb:job', handler);
    },
    finish: (result) => ipcRenderer.send('thumb:finish', result),
  },

  config: {
    get: () => ipcRenderer.invoke('config:get'),
    setLanguage: (lang) => ipcRenderer.invoke('config:setLanguage', lang),
    setTheme: (theme) => ipcRenderer.invoke('config:setTheme', theme),
    acceptEula: (registration) => ipcRenderer.invoke('config:acceptEula', registration),
    updateRegistration: (registration) => ipcRenderer.invoke('config:updateRegistration', registration),
    changeLocation: () => ipcRenderer.invoke('config:changeLocation'),
    backup: () => ipcRenderer.invoke('config:backup'),
    onMigrationProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      ipcRenderer.on('config:migrationProgress', handler);
      return () => ipcRenderer.removeListener('config:migrationProgress', handler);
    },
  },

  system: {
    health: () => ipcRenderer.invoke('system:health'),
  },

  database: {
    exportBackup: () => ipcRenderer.invoke('db:export-backup'),
    importBackup: () => ipcRenderer.invoke('db:import-backup'),
  },

  pdf: {
    onConvert: (callback) => {
      const handler = (_event, job) => callback(job);
      ipcRenderer.on('pdf:convert', handler);
      return () => ipcRenderer.removeListener('pdf:convert', handler);
    },
    finish: (result) => ipcRenderer.send('pdf:finish', result),
  },

  updates: {
    getState: () => ipcRenderer.invoke('UPDATES_GET_STATE'),
    check: () => ipcRenderer.invoke('CHECK_FOR_UPDATES'),
    /** `force` downloads even on a metered connection when the operator has chosen to pause on those. */
    download: (force = false) => ipcRenderer.invoke('START_UPDATE_DOWNLOAD', { force: force === true }),
    restart: () => ipcRenderer.invoke('RESTART_AND_INSTALL_UPDATE'),
    setChannel: (channel) => ipcRenderer.invoke('updater:set-channel', channel),
    skipVersion: (version) => ipcRenderer.invoke('updater:skip-version', version),
    remindLater: () => ipcRenderer.invoke('updater:remind-later'),
    setPauseOnMetered: (enabled) => ipcRenderer.invoke('updater:set-pause-on-metered', enabled),
    getReleaseHistory: () => ipcRenderer.invoke('updater:get-history'),
    /** Update events, as `{ channel, payload }`. The channel says what happened; the payload carries its details. */
    onEvent: (callback) => {
      const channels = [
        'UPDATE_CHECKING',
        'UPDATE_AVAILABLE',
        'UPDATE_NOT_AVAILABLE',
        'UPDATE_PROGRESS',
        'UPDATE_PAUSED',
        'UPDATE_DOWNLOADED',
        'UPDATE_ERROR',
      ];
      const handlers = channels.map((channel) => {
        const handler = (_event, payload) => callback({ channel, payload });
        ipcRenderer.on(channel, handler);
        return [channel, handler];
      });
      return () => handlers.forEach(([channel, handler]) => ipcRenderer.removeListener(channel, handler));
    },
  },
});
