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
      const deadline = Date.now() + 10000
      let rendered = null
      while (Date.now() < deadline) {
        rendered = await window.webContents.executeJavaScript(`(() => {
          const text = document.body?.innerText ?? ''
          return {
            heading: document.querySelector('h1')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
            hasOpportunityScore: text.includes('市场机会指数'),
            hasOfflineState: text.includes('未配置，保持离线模式'),
            hasEvidenceSection: text.includes('结论不是黑箱，每一步都有依据'),
          }
        })()`)
        if (rendered.heading && rendered.hasOpportunityScore && rendered.hasOfflineState && rendered.hasEvidenceSection) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      const renderReady = Boolean(rendered?.heading && rendered.hasOpportunityScore && rendered.hasOfflineState && rendered.hasEvidenceSection)
      await writeFile(smokePath, `${JSON.stringify({ loaded: true, renderReady, title: window.getTitle(), url: window.webContents.getURL(), rendered })}\n`, { encoding: 'utf8', flag: 'wx' })
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
