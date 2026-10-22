import fs from 'node:fs'
import path from 'node:path'

// Join and read catalog paths only through here. Next's output file tracing
// treats a path.join it can partly evaluate in server code as a file reference
// and globs the project for it into .next/standalone (the whole-project-trace
// warning); it doesn't follow these parameters across the module boundary.

export function catalogPath(...parts: string[]): string {
  return path.join(...parts)
}

export function exists(file: string): boolean {
  return fs.existsSync(file)
}

export function readText(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

export function listDir(dir: string): fs.Dirent[] {
  return fs.readdirSync(dir, { withFileTypes: true })
}
