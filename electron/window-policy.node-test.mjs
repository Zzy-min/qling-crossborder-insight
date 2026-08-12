import test from 'node:test'
import assert from 'node:assert/strict'
import { externalNavigationAction, windowOptions } from './window-policy.mjs'

test('desktop renderer remains isolated and sandboxed', () => {
  assert.deepEqual(windowOptions.webPreferences, {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  })
})

test('all new windows are denied and only HTTPS may open externally', () => {
  assert.deepEqual(externalNavigationAction('https://example.com'), { openExternal: true, action: 'deny' })
  assert.deepEqual(externalNavigationAction('http://example.com'), { openExternal: false, action: 'deny' })
  assert.deepEqual(externalNavigationAction('file:///C:/secret.txt'), { openExternal: false, action: 'deny' })
})
