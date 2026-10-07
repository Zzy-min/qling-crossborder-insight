import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'

function rejected() {
  return Object.assign(new Error('image_download_rejected'), { status: 502, reason: 'image_download' })
}

function ipv6Number(address) {
  if (isIP(address) !== 6 || address.includes('.') || address.includes('%')) return null
  const halves = address.toLowerCase().split('::')
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const parts = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left
  return parts.reduce((total, part) => (total << 16n) | BigInt(`0x${part}`), 0n)
}

export function isPublicImageAddress(address) {
  const family = isIP(address)
  if (family === 4) {
    const [first, second, third] = address.split('.').map(Number)
    if (first === 0 || first === 10 || first === 127 || first >= 224) return false
    if (first === 100 && second >= 64 && second <= 127) return false
    if (first === 169 && second === 254) return false
    if (first === 172 && second >= 16 && second <= 31) return false
    if (first === 192 && (second === 168 || (second === 0 && (third === 0 || third === 2)) || (second === 88 && third === 99))) return false
    if (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) return false
    if (first === 203 && second === 0 && third === 113) return false
    return true
  }
  const numeric = ipv6Number(address)
  if (numeric === null || numeric >> 125n !== 1n) return false
  if (numeric >> 105n === 0x20010000000000000000000000000000n >> 105n) return false
  if (numeric >> 96n === 0x20010db8000000000000000000000000n >> 96n) return false
  if (numeric >> 112n === 0x2002n) return false
  if (numeric >> 108n === 0x3fff0000000000000000000000000000n >> 108n) return false
  return true
}

function addressIdentity(address) {
  if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4) return `4:${address.slice(7)}`
  return isIP(address) === 4 ? `4:${address}` : `6:${ipv6Number(address)}`
}

function checkedUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw rejected()
  const url = new URL(value)
  const hostname = url.hostname.replace(/\.$/, '')
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || isIP(hostname.replace(/^\[|\]$/g, '')) || !hostname.includes('.') || /(^localhost$|\.localhost$|\.local$|\.internal$)/i.test(hostname)) throw rejected()
  return url
}

async function resolveWithSignal(lookup, hostname, signal) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal?.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => lookup(hostname, { all: true, verbatim: true })).then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort))
  })
}

export function createImageDownloader({ lookup = dnsLookup, request = httpsRequest } = {}) {
  return async (value, { signal } = {}) => {
    const url = checkedUrl(value)
    let addresses
    try { addresses = await resolveWithSignal(lookup, url.hostname, signal) }
    catch { if (signal?.aborted) throw signal.reason; throw rejected() }
    signal?.throwIfAborted()
    if (!Array.isArray(addresses) || !addresses.length || addresses.length > 64 || addresses.some(item => typeof item?.address !== 'string' || !isPublicImageAddress(item.address) || isIP(item.address) !== item.family)) throw rejected()
    const selected = addresses[0]
    return new Promise((resolve, reject) => {
      let outgoing
      let incoming
      const cleanup = () => signal?.removeEventListener('abort', abort)
      const abort = () => {
        outgoing?.destroy(signal.reason)
        incoming?.destroy(signal.reason)
        reject(signal.reason)
        cleanup()
      }
      try {
        outgoing = request(url, {
          method: 'GET', agent: false, family: selected.family,
          servername: url.hostname.replace(/\.$/, ''), rejectUnauthorized: true,
          headers: { Accept: 'image/png,image/jpeg,image/webp', 'Accept-Encoding': 'identity' },
          lookup: (_hostname, options, callback) => {
            if (options?.all) callback(null, [selected])
            else callback(null, selected.address, selected.family)
          },
        }, response => {
          incoming = response
          const encoding = response.headers['content-encoding']
          if (signal?.aborted) { abort(); return }
          if (!response.socket?.encrypted || response.socket.authorized !== true || addressIdentity(response.socket.remoteAddress ?? '') !== addressIdentity(selected.address) || response.statusCode !== 200 || (encoding && encoding !== 'identity')) {
            response.destroy()
            cleanup()
            reject(rejected())
            return
          }
          response.once('end', cleanup)
          response.once('close', cleanup)
          const headers = new Headers()
          if (typeof response.headers['content-type'] === 'string') headers.set('Content-Type', response.headers['content-type'])
          resolve(new Response(Readable.toWeb(response, { strategy: { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength } }), { status: 200, headers }))
        })
        outgoing.on('error', () => { cleanup(); reject(signal?.aborted ? signal.reason : rejected()) })
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
        else outgoing.end()
      } catch (error) {
        cleanup()
        outgoing?.destroy()
        incoming?.destroy()
        reject(error)
      }
    })
  }
}

export const downloadPublicImage = createImageDownloader()
