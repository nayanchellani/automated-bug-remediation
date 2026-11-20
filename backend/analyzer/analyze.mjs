#!/usr/bin/env node
// Static JS/TS/JSON analyzer for Triage snapshots.
//
// Usage: node analyze.mjs <rootDir>
// Prints a single JSON document to stdout:
//   { "filesAnalyzed": N, "findings": [ { file, line, column, severity, type, rule, message, snippet } ] }
//
// Safety: this script only PARSES files (Babel parser) and walks the AST.
// It never imports, requires or executes anything from the analyzed project.

import fs from 'node:fs'
import path from 'node:path'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import globals from 'globals'

const traverse = traverseModule.default || traverseModule

const MAX_FILE_BYTES = 1024 * 1024 // 1 MB per source file
const MAX_JSON_BYTES = 2 * 1024 * 1024 // 2 MB per JSON file
const MAX_FINDINGS_PER_FILE = 50
const SNIPPET_CONTEXT = 2

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.vscode', '__pycache__', '.venv'])
const SCRIPT_EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'])
// JSON files that legitimately allow comments / trailing commas
const JSON_WITH_COMMENTS = /^(ts|js)config(\..+)?\.json$|^\.eslintrc|\.jsonc$/i

// Names that are always considered defined (runtime globals + common CDN globals).
const KNOWN_GLOBALS = new Set([
  ...Object.keys(globals.builtin),
  ...Object.keys(globals.browser),
  ...Object.keys(globals.node),
  ...Object.keys(globals.commonjs),
  ...Object.keys(globals.jest),
  ...Object.keys(globals.mocha),
  'React',
  'ReactDOM',
  'Triage',
  'globalThis',
  'undefined',
  'arguments',
])

function pluginsFor(ext) {
  switch (ext) {
    case '.ts':
    case '.mts':
    case '.cts':
      return ['typescript']
    case '.tsx':
      return ['typescript', 'jsx']
    default:
      return ['jsx']
  }
}

function buildSnippet(lines, line) {
  if (!lines || !line || line < 1) return ''
  const start = Math.max(1, line - SNIPPET_CONTEXT)
  const end = Math.min(lines.length, line + SNIPPET_CONTEXT)
  const width = String(end).length
  const out = []
  for (let n = start; n <= end; n++) {
    const marker = n === line ? '>' : ' '
    const text = (lines[n - 1] ?? '').replace(/\r$/, '').slice(0, 200)
    out.push(`${marker} ${String(n).padStart(width, ' ')} | ${text}`)
  }
  return out.join('\n')
}

function makeFinding(file, lines, { line, column, severity, type, rule, message }) {
  return {
    file,
    line: line || 1,
    column: column || 1,
    severity,
    type,
    rule,
    message,
    snippet: buildSnippet(lines, line || 1),
  }
}

function stripLocSuffix(message) {
  return String(message).replace(/\s*\(\d+:\d+\)\s*$/, '')
}

function declaredGlobalsFromComments(comments) {
  const names = new Set()
  for (const c of comments || []) {
    const m = /^\s*(?:global|globals)\s+([^*]+?)\s*$/.exec(c.value)
    if (!m) continue
    for (const part of m[1].split(',')) {
      const name = part.trim().split(':')[0].trim()
      if (name) names.add(name)
    }
  }
  return names
}

function analyzeScript(relPath, source, ext) {
  const findings = []
  const lines = source.split('\n')
  const make = (f) => findings.push(makeFinding(relPath, lines, f))

  let ast
  try {
    ast = parse(source, {
      sourceType: 'unambiguous',
      plugins: pluginsFor(ext),
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowUndeclaredExports: true,
    })
  } catch (err) {
    make({
      line: err.loc?.line,
      column: (err.loc?.column ?? 0) + 1,
      severity: 'error',
      type: 'syntax',
      rule: 'syntax-error',
      message: stripLocSuffix(err.message),
    })
    return findings
  }

  // Recoverable syntax errors (e.g. duplicate declarations)
  for (const err of ast.errors || []) {
    make({
      line: err.loc?.line,
      column: (err.loc?.column ?? 0) + 1,
      severity: 'error',
      type: 'syntax',
      rule: 'syntax-error',
      message: stripLocSuffix(err.message),
    })
  }

  const declared = declaredGlobalsFromComments(ast.comments)

  try {
    traverse(ast, {
      ReferencedIdentifier(p) {
        const node = p.node
        const name = node.name
        if (!name || KNOWN_GLOBALS.has(name) || declared.has(name)) return
        // Skip TypeScript type positions (type names are not value references)
        const parentType = p.parent?.type || ''
        if (parentType.startsWith('TS')) return
        // `typeof x` is safe for undeclared x
        if (parentType === 'UnaryExpression' && p.parent.operator === 'typeof') return
        if (p.scope.hasBinding(name)) return
        make({
          line: node.loc?.start.line,
          column: (node.loc?.start.column ?? 0) + 1,
          severity: 'warning',
          type: 'lint',
          rule: 'no-undef',
          message: `'${name}' is not defined`,
        })
      },
      'Program|BlockStatement|StaticBlock'(p) {
        reportUnreachable(p.node.body, make)
      },
      SwitchCase(p) {
        reportUnreachable(p.node.consequent, make)
      },
    })
  } catch {
    // Scope analysis can throw on partially recovered ASTs. Syntax findings still stand.
  }

  return findings
}

function reportUnreachable(statements, make) {
  if (!Array.isArray(statements)) return
  for (let i = 0; i < statements.length - 1; i++) {
    const t = statements[i].type
    if (t === 'ReturnStatement' || t === 'ThrowStatement' || t === 'BreakStatement' || t === 'ContinueStatement') {
      const next = statements.slice(i + 1).find((s) => s.type !== 'FunctionDeclaration' && s.type !== 'EmptyStatement')
      if (next) {
        make({
          line: next.loc?.start.line,
          column: (next.loc?.start.column ?? 0) + 1,
          severity: 'warning',
          type: 'lint',
          rule: 'no-unreachable',
          message: 'Unreachable code',
        })
      }
      break
    }
  }
}

function analyzeJson(relPath, source) {
  const text = source.replace(/^﻿/, '')
  const lines = text.split('\n')
  try {
    JSON.parse(text)
    return []
  } catch (err) {
    const msg = String(err.message)
    let line = 1
    let column = 1
    const lc = /\(line (\d+) column (\d+)\)/.exec(msg)
    const pos = /position (\d+)/.exec(msg)
    if (lc) {
      line = Number(lc[1])
      column = Number(lc[2])
    } else if (pos) {
      const before = text.slice(0, Number(pos[1]))
      const parts = before.split('\n')
      line = parts.length
      column = parts[parts.length - 1].length + 1
    }
    return [
      makeFinding(relPath, lines, {
        line,
        column,
        severity: 'error',
        type: 'syntax',
        rule: 'json-parse-error',
        message: msg.replace(/\s*\(line \d+ column \d+\)/, ''),
      }),
    ]
  }
}

function* walk(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      yield* walk(full)
    } else if (entry.isFile()) {
      yield full
    }
  }
}

function main() {
  const root = process.argv[2]
  if (!root || !fs.existsSync(root)) {
    console.error('usage: node analyze.mjs <rootDir>')
    process.exit(2)
  }
  const absRoot = path.resolve(root)

  const findings = []
  let filesAnalyzed = 0

  for (const full of walk(absRoot)) {
    const rel = path.relative(absRoot, full).split(path.sep).join('/')
    const base = path.basename(full)
    const ext = path.extname(full).toLowerCase()

    const isScript = SCRIPT_EXTS.has(ext) && !/\.min\.[cm]?js$/i.test(base)
    const isJson = ext === '.json' && !JSON_WITH_COMMENTS.test(base) && base !== 'package-lock.json'
    if (!isScript && !isJson) continue

    let stat
    try {
      stat = fs.statSync(full)
    } catch {
      continue
    }
    if (stat.size > (isJson ? MAX_JSON_BYTES : MAX_FILE_BYTES)) continue

    let source
    try {
      source = fs.readFileSync(full, 'utf-8')
    } catch {
      continue
    }

    filesAnalyzed++
    const fileFindings = isJson ? analyzeJson(rel, source) : analyzeScript(rel, source, ext)
    findings.push(...fileFindings.slice(0, MAX_FINDINGS_PER_FILE))
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column)
  process.stdout.write(JSON.stringify({ filesAnalyzed, findings }))
}

main()
