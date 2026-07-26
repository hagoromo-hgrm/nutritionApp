import { mkdir, writeFile } from 'node:fs/promises'
import { URL, fileURLToPath } from 'node:url'

const serverDirectory = fileURLToPath(new URL('../dist/server/', import.meta.url))
const workerPath = fileURLToPath(new URL('../dist/server/index.js', import.meta.url))

const workerSource = `const worker = {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request)
    if (
      request.method !== 'GET'
      || response.status !== 404
      || !request.headers.get('accept')?.includes('text/html')
    ) {
      return response
    }

    const fallbackUrl = new URL('/index.html', request.url)
    return env.ASSETS.fetch(new Request(fallbackUrl, request))
  },
}

export default worker
`

await mkdir(serverDirectory, { recursive: true })
await writeFile(workerPath, workerSource, 'utf8')
