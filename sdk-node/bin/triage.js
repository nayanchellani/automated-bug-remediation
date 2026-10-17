#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const archiver = require('archiver')
const ignore = require('ignore')

const MAX_ARCHIVE_SIZE = 20 * 1024 * 1024 // 20 MB

// Hard excludes that can NEVER be overridden
const HARD_EXCLUDES = [
  'node_modules/**',
  '.git/**',
  '.env*',
  '*.pem',
  '*.key',
  'id_rsa*',
  '*.p12',
  '*.pfx',
  'dist/**',
  'build/**',
  '__pycache__/**',
  '.venv/**',
  '.pytest_cache/**',
]

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const content = fs.readFileSync(filePath, 'utf-8')
  const env = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim()
      let val = trimmed.slice(idx + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      env[key] = val
    }
  }
  return env
}

async function run() {
  const rootDir = process.cwd()

  // 1. Read API Key and URL from environment or .env
  const localEnv = readEnvFile(path.join(rootDir, '.env'))
  const apiKey = process.env.TRIAGE_API_KEY || localEnv.TRIAGE_API_KEY
  const triageUrl = (process.env.TRIAGE_URL || localEnv.TRIAGE_URL || 'http://localhost:8000').replace(/\/$/, '')

  if (!apiKey) {
    console.error('\x1b[31mError:\x1b[0m TRIAGE_API_KEY is not defined in process.env or .env file.')
    console.error('Please configure your project API key before pushing.')
    process.exit(1)
  }

  console.log(`\x1b[36m->\x1b[0m Preparing project snapshot for ${path.basename(rootDir)}...`)

  // 2. Build ignore rules (.gitignore + hard excludes)
  const ig = ignore().add(HARD_EXCLUDES)
  const gitignorePath = path.join(rootDir, '.gitignore')
  if (fs.existsSync(gitignorePath)) {
    try {
      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8')
      ig.add(gitignoreContent)
    } catch (err) {
      // ignore read error
    }
  }

  // 3. Collect matching files
  function collectFiles(dir, relativeTo) {
    const results = []
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relPath = path.relative(relativeTo, fullPath).replace(/\\/g, '/')
      const testPath = entry.isDirectory() ? `${relPath}/` : relPath

      if (ig.ignores(testPath)) {
        continue
      }

      if (entry.isDirectory()) {
        results.push(...collectFiles(fullPath, relativeTo))
      } else if (entry.isFile()) {
        results.push({ fullPath, relPath })
      }
    }
    return results
  }

  const files = collectFiles(rootDir, rootDir)
  if (files.length === 0) {
    console.error('\x1b[31mError:\x1b[0m No eligible files found to archive in current directory.')
    process.exit(1)
  }

  // 4. Create in-memory zip archive
  const archive = archiver('zip', { zlib: { level: 9 } })
  const chunks = []

  archive.on('data', (chunk) => chunks.push(chunk))

  const archivePromise = new Promise((resolve, reject) => {
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    archive.on('error', (err) => reject(err))
  })

  for (const f of files) {
    archive.file(f.fullPath, { name: f.relPath })
  }
  archive.finalize()

  const zipBuffer = await archivePromise
  const sizeMb = (zipBuffer.length / (1024 * 1024)).toFixed(2)

  if (zipBuffer.length > MAX_ARCHIVE_SIZE) {
    console.error(`\x1b[31mError:\x1b[0m Project archive (${sizeMb} MB) exceeds maximum allowed size of 20 MB.`)
    process.exit(1)
  }

  console.log(`\x1b[36m->\x1b[0m Packaging complete: ${files.length} files (${sizeMb} MB). Uploading to ${triageUrl}...`)

  // 5. Upload via multipart/form-data
  const formData = new FormData()
  const blob = new Blob([zipBuffer], { type: 'application/zip' })
  formData.append('file', blob, 'project.zip')

  try {
    const uploadRes = await fetch(`${triageUrl}/snapshots`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
      },
      body: formData,
    })

    if (!uploadRes.ok) {
      const errorText = await uploadRes.text()
      console.error(`\x1b[31mUpload Failed [${uploadRes.status}]:\x1b[0m ${errorText}`)
      process.exit(1)
    }

    const data = await uploadRes.json()
    console.log(`\x1b[32m✔ Snapshot successfully uploaded!\x1b[0m`)
    console.log(`  Snapshot ID : ${data.id}`)
    console.log(`  Files Stored: ${data.file_count}`)
    console.log(`  Archive SHA : ${data.sha256.slice(0, 16)}...`)
    console.log(`\n\x1b[1mUploaded ${data.file_count} files. Open the dashboard to inspect project structure and libraries.\x1b[0m\n`)
  } catch (err) {
    console.error(`\x1b[31mNetwork Error:\x1b[0m Could not connect to Triage server at ${triageUrl}`)
    console.error(err.message)
    process.exit(1)
  }
}

run()
