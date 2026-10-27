import { parseArgs } from 'util'
import { runSetup, sandboxDown } from '../services/runtime.js'

export async function setupCommand(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs({
    args: argv,
    options: { lang: { type: 'string', default: 'ts,py' } },
    allowPositionals: true,
  })
  const langs = (parsed.values.lang ?? 'ts,py').split(',').map(item => item.trim()).filter(Boolean)
  await runSetup(langs)
  console.log('Sandbox image and SearXNG are ready.')
}

export async function sandboxDownCommand(all: boolean): Promise<void> {
  console.log(await sandboxDown(all))
}

function isDirect(): boolean {
  const entry = process.argv[1] ?? ''
  return entry.endsWith('setup.ts') || entry.endsWith('setup.js')
}

if (isDirect()) {
  setupCommand().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
