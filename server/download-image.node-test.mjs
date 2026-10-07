import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { createImageDownloader, isPublicImageAddress } from './download-image.mjs'
import { createApiServer } from './app.mjs'

const publicAddress = { address: '93.184.215.14', family: 4 }
const raster = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])

function transport({ status = 200, remoteAddress = publicAddress.address, authorized = true, encoding, hanging = false } = {}) {
  const state = { options: null, url: null, destroyed: false, incoming: null }
  state.request = (url, options, callback) => {
    state.url = url; state.options = options
    const outgoing = new EventEmitter()
    outgoing.end = () => {
      queueMicrotask(() => {
        const incoming = hanging ? new Readable({ read() {} }) : Readable.from([raster])
        incoming.statusCode = status
        incoming.headers = { 'content-type': 'image/png', ...(encoding ? { 'content-encoding': encoding } : {}) }
        incoming.socket = { remoteAddress, authorized, encrypted: true }
        state.incoming = incoming
        callback(incoming)
      })
    }
    outgoing.destroy = reason => { state.destroyed = true; if (reason) queueMicrotask(() => outgoing.emit('error', reason)) }
    return outgoing
  }
  return state
}

test('address filter rejects private, loopback, shared, link-local, documentation and transition ranges', () => {
  for (const address of ['0.0.0.0', '10.2.3.4', '127.0.0.1', '100.64.0.1', '100.127.255.255', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '192.0.0.9', '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.19.255.255', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fe80::1', 'fe80::1%lo', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2001::1', '2001:1ff::1', '2001:db8::1', '2002:7f00:1::1', '3fff::1', '3fff:fff::1', 'not-an-address']) {
    assert.equal(isPublicImageAddress(address), false, address)
  }
  for (const address of ['93.184.215.14', '8.8.8.8', '100.63.255.255', '100.128.0.1', '172.15.255.255', '172.32.0.1', '2606:4700:4700::1111', '2400:3200::1']) assert.equal(isPublicImageAddress(address), true, address)
})

test('DNS mixed-public/private or malformed answers fail before any network connection', async () => {
  for (const answers of [[publicAddress, { address: '127.0.0.1', family: 4 }], [{ address: '169.254.169.254', family: 4 }], [{ address: '::ffff:192.168.1.1', family: 6 }], [{ address: publicAddress.address, family: 6 }], [null], [{}], [], Array(65).fill(publicAddress)]) {
    let connected = false
    const download = createImageDownloader({ lookup: async () => answers, request: () => { connected = true } })
    await assert.rejects(download('https://cdn.example/image'), /image_download_rejected/)
    assert.equal(connected, false)
  }
})

test('URL restrictions are enforced even when downloader is used directly', async () => {
  let resolved = false
  const download = createImageDownloader({ lookup: async () => { resolved = true; return [publicAddress] } })
  for (const url of ['http://cdn.example/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://user:password@cdn.example/a', 'https://cdn.example:8443/a', 'https://localhost./a', 'https://cdn.local./a', 'https://metadata.internal/a', 'https://printer/a']) await assert.rejects(download(url))
  assert.equal(resolved, false)
})

test('connect lookup stays pinned after DNS changes, preserves TLS hostname and never sends credentials', async () => {
  let resolutions = 0; const wire = transport()
  const download = createImageDownloader({ lookup: async () => { resolutions += 1; return resolutions === 1 ? [publicAddress] : [{ address: '127.0.0.1', family: 4 }] }, request: wire.request })
  const response = await download('https://cdn.example/concept.png?asset=synthetic')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), raster)
  assert.equal(resolutions, 1)
  assert.equal(wire.url.hostname, 'cdn.example')
  assert.equal(wire.options.servername, 'cdn.example')
  assert.equal(wire.options.rejectUnauthorized, true)
  assert.equal(wire.options.agent, false)
  assert.equal(wire.options.headers.Authorization, undefined)
  assert.equal(wire.options.headers.Cookie, undefined)
  for (const all of [false, true]) {
    wire.options.lookup('cdn.example', { all }, (error, result, family) => {
      assert.equal(error, null)
      assert.deepEqual(result, all ? [publicAddress] : publicAddress.address)
      if (!all) assert.equal(family, 4)
    })
  }
  assert.equal(resolutions, 1)
})

test('IPv6 compressed/uncompressed socket identity matches the pinned public address', async () => {
  const wire = transport({ remoteAddress: '2606:4700:4700:0000:0000:0000:0000:1111' })
  const download = createImageDownloader({ lookup: async () => [{ address: '2606:4700:4700::1111', family: 6 }], request: wire.request })
  assert.deepEqual(Buffer.from(await (await download('https://cdn.example/a')).arrayBuffer()), raster)
})

test('redirects, remote socket mismatch, untrusted TLS and encoded responses are not exposed', async () => {
  for (const options of [{ status: 302 }, { remoteAddress: '127.0.0.1' }, { authorized: false }, { encoding: 'gzip' }]) {
    const wire = transport(options)
    const download = createImageDownloader({ lookup: async () => [publicAddress], request: wire.request })
    await assert.rejects(download('https://cdn.example/a'), /image_download_rejected/)
    assert.equal(wire.incoming.destroyed, true)
  }
})

test('cancellation while DNS is pending does not open a connection after late resolution', async () => {
  const controller = new AbortController(); let resolveDns; let connected = false
  const download = createImageDownloader({ lookup: () => new Promise(resolve => { resolveDns = resolve }), request: () => { connected = true } })
  const pending = download('https://cdn.example/a', { signal: controller.signal })
  await Promise.resolve()
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  resolveDns([publicAddress])
  await Promise.resolve()
  assert.equal(connected, false)
})

test('cancellation during pinned download destroys transport and rejects body reading', async () => {
  const controller = new AbortController(); const wire = transport({ hanging: true })
  const download = createImageDownloader({ lookup: async () => [publicAddress], request: wire.request })
  const response = await download('https://cdn.example/a', { signal: controller.signal })
  const reading = response.arrayBuffer()
  controller.abort()
  await assert.rejects(reading, { name: 'AbortError' })
  assert.equal(wire.destroyed, true)
  assert.equal(wire.incoming.destroyed, true)
})

test('DNS and transport errors are sanitized, completed streams tolerate later cancellation', async () => {
  const failingDns = createImageDownloader({ lookup: async () => { throw new Error('private resolver details') } })
  await assert.rejects(failingDns('https://cdn.example/a'), error => error.status === 502 && error.message === 'image_download_rejected')
  const failingTransport = createImageDownloader({ lookup: async () => [publicAddress], request: () => {
    const outgoing = new EventEmitter()
    outgoing.end = () => queueMicrotask(() => outgoing.emit('error', new Error('private TLS details')))
    return outgoing
  } })
  await assert.rejects(failingTransport('https://cdn.example/a'), error => error.status === 502 && error.message === 'image_download_rejected')
  const controller = new AbortController(); const wire = transport()
  const download = createImageDownloader({ lookup: async () => [publicAddress], request: wire.request })
  await (await download('https://cdn.example/a', { signal: controller.signal })).arrayBuffer()
  controller.abort()
  assert.equal(wire.destroyed, false)
})

test('default API download path cannot reuse the provider fetcher to reach an IP literal', async () => {
  let calls = 0
  const server = createApiServer({ apiKey: 'synthetic', fetcher: async () => { calls += 1; return new Response(JSON.stringify({ output: { choices: [{ message: { content: [{ image: 'https://127.0.0.1/private' }] } }] } })) } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/images`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Synthetic concept', reviewIds: ['SYNTHETIC'] }) })
    assert.equal(response.status, 502)
    assert.equal(calls, 1)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
