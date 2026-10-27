const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('apcc', {
  getState: () => ipcRenderer.invoke('live:get'),
  dispatch: (action) => ipcRenderer.send('live:dispatch', action),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('live:state', handler);
    return () => ipcRenderer.removeListener('live:state', handler);
  },
  open: (target) => ipcRenderer.invoke('launch:open', target),

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
    pickBackground: (lang) => ipcRenderer.invoke('announcements:pickBackground', lang),
    discardBackground: (name) => ipcRenderer.invoke('announcements:discardBackground', name),
    createTextSlides: (folderId, pages, backgroundName, style) =>
      ipcRenderer.invoke('announcements:createTextSlides', folderId, pages, backgroundName, style),
  },

  lyrics: {
    listHymns: (filter) => ipcRenderer.invoke('lyrics:listHymns', filter),
    getHymn: (id) => ipcRenderer.invoke('lyrics:getHymn', id),
    createHymn: (input) => ipcRenderer.invoke('lyrics:createHymn', input),
    deleteHymn: (id) => ipcRenderer.invoke('lyrics:deleteHymn', id),
    editHymn: (id, input) => ipcRenderer.invoke('lyrics:editHymn', id, input),
    listSetlists: () => ipcRenderer.invoke('lyrics:listSetlists'),
    createSetlist: (input) => ipcRenderer.invoke('lyrics:createSetlist', input),
    deleteSetlist: (id) => ipcRenderer.invoke('lyrics:deleteSetlist', id),
    getSetlist: (id) => ipcRenderer.invoke('lyrics:getSetlist', id),
    saveSetlist: (id, hymnIds) => ipcRenderer.invoke('lyrics:saveSetlist', id, hymnIds),
    setStyle: (id, style) => ipcRenderer.invoke('lyrics:setStyle', id, style),
    importFile: () => ipcRenderer.invoke('lyrics:importFile'),
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
    remove: (id) => ipcRenderer.invoke('notes:delete', id),
  },
  displays: {
    list: () => ipcRenderer.invoke('display:list'),
    identify: () => ipcRenderer.invoke('display:identify'),
  },

  projector: {
    save: (patch) => ipcRenderer.invoke('projector:save', patch),
  },

  welcome: {
    save: (patch) => ipcRenderer.invoke('welcome:save', patch),
  },

  lowerThird: {
    save: (patch) => ipcRenderer.invoke('lowerThird:save', patch),
    info: () => ipcRenderer.invoke('lowerThird:info'),
  },

  cloud: {
    status: () => ipcRenderer.invoke('cloud:status'),
    link: (code, label) => ipcRenderer.invoke('cloud:link', { code, label }),
    unlink: () => ipcRenderer.invoke('cloud:unlink'),
    createWebUser: ({ username, displayName, role }) => ipcRenderer.invoke('cloud:create-web-user', { username, displayName, role }),
    defaultLabel: () => ipcRenderer.invoke('cloud:defaultLabel'),
  },

  remoteView: {
    get: () => ipcRenderer.invoke('remoteView:get'),
    save: (patch) => ipcRenderer.invoke('remoteView:save', patch),
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
    remove: (id) => ipcRenderer.invoke('whiteboard:delete', id),
    reorder: (ids) => ipcRenderer.invoke('whiteboard:reorder', ids),
    importPowerPoint: () => ipcRenderer.invoke('whiteboard:importPowerPoint'),
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
