export const windowOptions = {
  width: 1440,
  height: 960,
  minWidth: 1024,
  minHeight: 720,
  backgroundColor: '#f4f1ea',
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
}

export function externalNavigationAction(url) {
  return { openExternal: url.startsWith('https://'), action: 'deny' }
}
