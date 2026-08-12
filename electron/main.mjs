import { app, BrowserWindow, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { externalNavigationAction, windowOptions } from './window-policy.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function createWindow() {
  const window = new BrowserWindow(windowOptions)
  window.webContents.setWindowOpenHandler(({ url }) => {
    const result = externalNavigationAction(url)
    if (result.openExternal) void shell.openExternal(url)
    return { action: result.action }
  })
  const load = window.loadFile(join(root, 'dist', 'index.html'))
  const smokePath = process.env.QLING_DESKTOP_SMOKE_PATH
  if (smokePath) {
    void load.then(async () => {
      await writeFile(smokePath, `${JSON.stringify({ loaded: true, title: window.getTitle(), url: window.webContents.getURL() })}\n`, { encoding: 'utf8', flag: 'wx' })
      app.quit()
    }).catch(async (error) => {
      await writeFile(smokePath, `${JSON.stringify({ loaded: false, error: error instanceof Error ? error.message : String(error) })}\n`, { encoding: 'utf8', flag: 'wx' })
      app.exit(1)
    })
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
