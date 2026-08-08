import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importPlaybook } from '../src/engine/importer'

const template = (name: string) =>
  readFileSync(resolve(__dirname, '../template_playbooks', name), 'utf8')

describe('importPlaybook', () => {
  it('rejects invalid JSON with a clear error', () => {
    const result = importPlaybook('{ not json')
    expect(result.success).toBe(false)
    expect(result.errors[0]).toMatch(/Invalid JSON/)
  })

  it('rejects oversized input', () => {
    const big = '"' + 'x'.repeat(2 * 1024 * 1024 + 10) + '"'
    const result = importPlaybook(big)
    expect(result.success).toBe(false)
    expect(result.errors[0]).toMatch(/File size exceeds/)
  })

  it('rejects structurally invalid playbooks', () => {
    const result = importPlaybook(JSON.stringify({ foo: 'bar' }))
    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('imports the blank template without errors', () => {
    const result = importPlaybook(template('01-blank.json'))
    expect(result.errors).toEqual([])
    expect(result.success).toBe(true)
  })

  it('imports the Kronberg demo template without errors', () => {
    const result = importPlaybook(template('02-kronberg-demo.json'))
    expect(result.errors).toEqual([])
    expect(result.success).toBe(true)
    expect(result.state?.nodes.size ?? 0).toBeGreaterThan(2)
  })
})
