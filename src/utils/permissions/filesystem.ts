import { existsSync, realpathSync } from 'fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { getCwd, getOriginalCwd } from '../state.js'

// In-memory storage for file permissions that resets each session
// Sets of allowed directories for read and write operations
const readFileAllowedDirectories: Set<string> = new Set()
const writeFileAllowedDirectories: Set<string> = new Set()

/**
 * Ensures a path is absolute by resolving it relative to cwd if necessary
 * @param path The path to normalize
 * @returns Absolute path
 */
export function toAbsolutePath(path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(getCwd(), path)
}

export function canonicalPath(input: string): string {
  const absolute = toAbsolutePath(input)
  const missing: string[] = []
  let current = absolute
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) break
    missing.unshift(basename(current))
    current = parent
  }
  let resolved = current
  try {
    if (existsSync(current)) resolved = realpathSync(current)
  } catch {
    resolved = current
  }
  return missing.length ? join(resolved, ...missing) : resolved
}

export function isPathInside(root: string, candidate: string): boolean {
  const base = canonicalPath(root)
  const target = canonicalPath(candidate)
  const rel = relative(base, target)
  if (rel === '') return true
  if (rel === '..' || rel.startsWith(`..${sep}`)) return false
  return !isAbsolute(rel)
}

/**
 * Ensures a path is in the original cwd path
 * @param directory The directory path to normalize
 * @returns Absolute path
 */
export function pathInOriginalCwd(path: string): boolean {
  return isPathInside(getOriginalCwd(), path)
}

/**
 * Check if read permission exists for the specified directory
 * @param directory The directory to check permission for
 * @returns true if read permission exists, false otherwise
 */
export function hasReadPermission(directory: string): boolean {
  const absolutePath = canonicalPath(directory)

  for (const allowedPath of readFileAllowedDirectories) {
    if (isPathInside(allowedPath, absolutePath)) return true
  }
  return false
}

/**
 * Check if write permission exists for the specified directory
 * @param directory The directory to check permission for
 * @returns true if write permission exists, false otherwise
 */
export function hasWritePermission(directory: string): boolean {
  const absolutePath = canonicalPath(directory)

  for (const allowedPath of writeFileAllowedDirectories) {
    if (isPathInside(allowedPath, absolutePath)) return true
  }
  return false
}

/**
 * Save read permission for a directory
 * @param directory The directory to grant read permission for
 */
function saveReadPermission(directory: string): void {
  const absolutePath = canonicalPath(directory)

  for (const allowedPath of [...readFileAllowedDirectories]) {
    if (allowedPath !== absolutePath && isPathInside(absolutePath, allowedPath)) {
      readFileAllowedDirectories.delete(allowedPath)
    }
  }
  readFileAllowedDirectories.add(absolutePath)
}

export const saveReadPermissionForTest = saveReadPermission

/**
 * Grants read permission for the original project directory.
 * This is useful for initializing read access to the project root.
 */
export function grantReadPermissionForOriginalDir(): void {
  const originalProjectDir = getOriginalCwd()
  saveReadPermission(originalProjectDir)
}

/**
 * Save write permission for a directory
 * @param directory The directory to grant write permission for
 */
function saveWritePermission(directory: string): void {
  const absolutePath = canonicalPath(directory)

  for (const allowedPath of [...writeFileAllowedDirectories]) {
    if (allowedPath !== absolutePath && isPathInside(absolutePath, allowedPath)) {
      writeFileAllowedDirectories.delete(allowedPath)
    }
  }
  writeFileAllowedDirectories.add(absolutePath)
}

export function grantWritePermissionForPath(filePath: string): void {
  saveWritePermission(filePath)
}

/**
 * Grants write permission for the original project directory.
 * This is useful for initializing write access to the project root.
 */
export function grantWritePermissionForOriginalDir(): void {
  const originalProjectDir = getOriginalCwd()
  saveWritePermission(originalProjectDir)
}

// For testing purposes
export function clearFilePermissions(): void {
  readFileAllowedDirectories.clear()
  writeFileAllowedDirectories.clear()
}
