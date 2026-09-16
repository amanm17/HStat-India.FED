import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'

const ROOT = process.argv[2]
const PORT = Number(process.argv[3] || 4178)

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  let path = join(ROOT, decodeURIComponent(url.pathname))

  try {
    const info = await stat(path)
    if (info.isDirectory()) path = join(path, 'index.html')
  } catch {
    // SPA fallback, exactly as the Worker does for unknown paths - but never
    // for an asset request, so a genuinely missing JSON 404s like it should.
    if (extname(url.pathname)) {
      res.writeHead(404).end('not found')
      return
    }
    path = join(ROOT, 'index.html')
  }

  try {
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(PORT, () => console.log(`serving ${ROOT} on ${PORT}`))
