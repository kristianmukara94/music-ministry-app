// Stand-ins for the Electron exports the tests never call. Loading a module needs the names; running it does not.
const nothing = () => undefined;
export const ipcMain = { handle: nothing, on: nothing };
export const app = { getPath: nothing, getVersion: () => '0.0.0', on: nothing };
export const dialog = { showOpenDialog: nothing, showSaveDialog: nothing };
export const BrowserWindow = class {};
export const Menu = { setApplicationMenu: nothing, buildFromTemplate: nothing };
export const screen = { getAllDisplays: () => [], getPrimaryDisplay: nothing };
export const shell = { openExternal: nothing };
export const net = { request: nothing };
export const protocol = { registerSchemesAsPrivileged: nothing, handle: nothing };
export const nativeImage = { createFromPath: nothing };
export const session = { defaultSession: {} };
export const nativeTheme = { on: nothing };
