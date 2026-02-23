const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function collectJsFiles(rootDir) {
  const files = []
  const stack = [rootDir]

  while (stack.length > 0) {
    const current = stack.pop()
    const entries = fs.readdirSync(current, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (entry.isFile() && fullPath.endsWith('.js')) {
        files.push(fullPath)
      }
    }
  }

  return files.sort()
}

function main() {
  const root = path.resolve(__dirname, '..')
  const srcRoot = path.join(root, 'src')
  const files = collectJsFiles(srcRoot)
  let failed = false

  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
      stdio: 'inherit'
    })
    if (result.status !== 0) {
      failed = true
      break
    }
  }

  if (failed) {
    process.exit(1)
  }
}

main()
