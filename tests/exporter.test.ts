import { describe, it, expect } from 'vitest'
import { exportPlaybook, type ExportContext } from '../src/engine/exporter'
import type { EditorNode, EditorEdge } from '../src/types/editor'
import type { Question } from '../src/types/runtime'

// ============================================================================
// Fixture helpers (fake editor graph, no live Rete instance needed)
// ============================================================================

function question(id: string, extra: Partial<Question> = {}): Question {
  return { id, type: 'textzeile', label: `Question ${id}`, ...extra }
}

function makeNodes(...questions: Question[]): Map<string, EditorNode> {
  const nodes = new Map<string, EditorNode>()
  nodes.set('__start__', { id: '__start__', type: 'start', data: null, position: { x: 0, y: 0 } })
  nodes.set('__end__', { id: '__end__', type: 'end', data: null, position: { x: 500, y: 0 } })
  let y = 0
  for (const q of questions) {
    nodes.set(q.id, { id: q.id, type: 'question', data: q, position: { x: 100, y: (y += 100) } })
  }
  return nodes
}

function edge(
  source: string,
  target: string,
  type: EditorEdge['type'] = 'default',
  extra: Partial<EditorEdge> = {}
): EditorEdge {
  return {
    id: `${type}:${source}->${target}`,
    source,
    sourcePort: 'out',
    target,
    targetPort: 'in',
    type,
    ...extra,
  }
}

function makeContext(overrides: Partial<ExportContext> = {}): ExportContext {
  return {
    nodes: makeNodes(),
    edges: [],
    meta: { id: 'unit-test-playbook', version: '1' },
    i18n: { defaultLocale: 'de-DE', supported: ['de-DE', 'en-US'] },
    form: { title: { 'de-DE': 'Testformular', 'en-US': 'Test form' } },
    runtime: {},
    variables: [],
    calculation: {},
    flow: { end: 'submit', routingPriority: 'options-first' },
    version: '1',
    schemaId: '',
    schemaHash: '',
    ...overrides,
  }
}

/** Export and parse the emitted JSON document. */
function exportParsed(context: ExportContext) {
  const result = exportPlaybook(context)
  expect(result.success).toBe(true)
  expect(result.errors).toEqual([])
  return JSON.parse(result.json!)
}

// ============================================================================
// Hand-rolled contract validator (subset of docs/playbook-schema.json)
// ============================================================================

const QUESTION_TYPES = new Set(['textzeile', 'textbox', 'select', 'checkbox', 'int', 'date', 'info'])

/**
 * Checks the documented playbook contract: required top-level keys, meta
 * patterns, locale consistency, flow sentinel, question shape and referential
 * integrity of navigation targets.
 */
function contractViolations(pb: any): string[] {
  const v: string[] = []
  for (const key of ['type', 'meta', 'i18n', 'form', 'flow', 'questions']) {
    if (!(key in pb)) v.push(`missing required top-level key "${key}"`)
  }
  if (pb.type !== 'form-definition') v.push('type must be the constant "form-definition"')
  if (typeof pb.meta?.id !== 'string' || !/^[a-z0-9-]+$/.test(pb.meta.id)) {
    v.push('meta.id must match ^[a-z0-9-]+$')
  }
  if (typeof pb.meta?.version !== 'string' || !/^[0-9]+$/.test(pb.meta.version)) {
    v.push('meta.version must be a positive integer string')
  }
  const supported: string[] = Array.isArray(pb.i18n?.supported) ? pb.i18n.supported : []
  if (!supported.includes(pb.i18n?.defaultLocale)) {
    v.push('i18n.defaultLocale must be part of i18n.supported')
  }
  if (pb.flow?.end !== 'submit') v.push('flow.end must be the constant "submit"')

  const ids = new Set<string>((pb.questions ?? []).map((q: any) => q.id))
  const checkTarget = (target: unknown, where: string) => {
    if (typeof target !== 'string' || (target !== 'submit' && !ids.has(target))) {
      v.push(`${where} must reference an existing question id or "submit"`)
    }
  }
  if (typeof pb.flow?.start !== 'string') v.push('flow.start is required')
  else if (pb.flow.start !== '') checkTarget(pb.flow.start, 'flow.start')

  for (const q of pb.questions ?? []) {
    if (typeof q.id !== 'string' || q.id.length === 0) v.push('question.id must be a non-empty string')
    if (!QUESTION_TYPES.has(q.type)) v.push(`question "${q.id}" has unknown type "${q.type}"`)
    if (q.defaultNext !== undefined) checkTarget(q.defaultNext, `question "${q.id}" defaultNext`)
    const values = new Set<string>()
    for (const opt of q.options ?? []) {
      if (typeof opt.value !== 'string') v.push(`question "${q.id}" option value must be a string`)
      if (opt.label === undefined) v.push(`question "${q.id}" option is missing a label`)
      if (values.has(opt.value)) v.push(`question "${q.id}" has duplicate option value "${opt.value}"`)
      values.add(opt.value)
      if (opt.next !== undefined) checkTarget(opt.next, `question "${q.id}" option "${opt.value}" next`)
    }
    for (const action of q.actions ?? []) {
      if (action.goto !== undefined) checkTarget(action.goto, `question "${q.id}" action goto`)
    }
  }
  return v
}

// ============================================================================
// Tests
// ============================================================================

describe('exportPlaybook', () => {
  it('exports a small linear graph to a complete playbook document', () => {
    const context = makeContext({
      nodes: makeNodes(question('q1'), question('q2')),
      edges: [edge('__start__', 'q1'), edge('q1', 'q2'), edge('q2', '__end__')],
      flow: { end: 'submit', routingPriority: 'options-first', endBehavior: { lockAnswers: true } } as any,
    })
    const parsed = exportParsed(context)

    expect(parsed.type).toBe('form-definition')
    // meta: version incremented, no title/locale in export, endBehavior stripped from flow
    expect(parsed.meta).toEqual({ id: 'unit-test-playbook', version: '2' })
    expect(parsed.flow).toEqual({ routingPriority: 'options-first', start: 'q1', end: 'submit' })
    expect(parsed.questions.map((q: any) => q.id)).toEqual(['q1', 'q2'])
    expect(parsed.questions[0].defaultNext).toBe('q2')
    expect(parsed.questions[1].defaultNext).toBe('submit')
    expect(parsed._nodePositions).toEqual({
      __start__: { x: 0, y: 0 },
      __end__: { x: 500, y: 0 },
      q1: { x: 100, y: 100 },
      q2: { x: 100, y: 200 },
    })
  })

  it('emits top-level keys in the documented order', () => {
    const context = makeContext({
      nodes: makeNodes(question('q1')),
      edges: [edge('__start__', 'q1'), edge('q1', '__end__')],
      schemaId: 'schema-1',
      schemaHash: 'hash-1',
      variables: [{ id: 'score', initial: 0 }],
      calculation: { rounding: 2 },
    })
    const parsed = exportParsed(context)

    expect(Object.keys(parsed)).toEqual([
      'type', 'meta', 'schemaId', 'schemaHash', 'i18n', 'form',
      'runtime', 'variables', 'calculation', 'flow', 'questions', '_nodePositions',
    ])
  })

  it('produces output that satisfies the documented playbook contract', () => {
    const welcome = question('welcome', { type: 'info', description: { 'de-DE': 'Hallo', 'en-US': 'Hello' } })
    const channel = question('channel', {
      type: 'select',
      required: true,
      options: [
        { id: 'opt-phone', value: 'phone', label: { 'de-DE': 'Telefon', 'en-US': 'Phone' } },
        { id: 'opt-siem', value: 'siem', label: { 'de-DE': 'SIEM-Alarm', 'en-US': 'SIEM alert' } },
      ],
    })
    const reporterName = question('reporter-name')
    const alertId = question('alert-id')
    const context = makeContext({
      nodes: makeNodes(welcome, channel, reporterName, alertId),
      edges: [
        edge('__start__', 'welcome'),
        edge('welcome', 'channel'),
        edge('channel', 'reporter-name', 'option', { optionId: 'opt-phone' }),
        edge('channel', 'alert-id', 'option', { optionId: 'opt-siem' }),
        edge('channel', 'reporter-name'),
        edge('reporter-name', '__end__'),
        edge('alert-id', '__end__'),
      ],
      variables: [{ id: 'score', initial: 0 }],
    })
    const parsed = exportParsed(context)

    expect(contractViolations(parsed)).toEqual([])
    // sanity check: the validator itself flags a broken document
    expect(contractViolations({ type: 'nope' }).length).toBeGreaterThan(0)
  })

  it('orders questions by BFS with option edges before routing edges before the default edge', () => {
    const context = makeContext({
      nodes: makeNodes(question('q1'), question('qA'), question('qB'), question('qR1'), question('qR2'), question('qD')),
      edges: [
        // deliberately scrambled insertion order
        edge('q1', 'qD', 'default'),
        edge('q1', 'qR2', 'routing', { routingIndex: 1 }),
        edge('q1', 'qB', 'option', { optionId: 'opt-b' }),
        edge('__start__', 'q1'),
        edge('q1', 'qR1', 'routing', { routingIndex: 0 }),
        edge('q1', 'qA', 'option', { optionId: 'opt-a' }),
      ],
    })
    const first = exportParsed(context)
    const second = exportParsed(context)

    expect(first.questions.map((q: any) => q.id)).toEqual(['q1', 'qA', 'qB', 'qR1', 'qR2', 'qD'])
    // deterministic: identical input yields identical order
    expect(second.questions.map((q: any) => q.id)).toEqual(first.questions.map((q: any) => q.id))
  })

  it('appends unreachable question nodes after reachable ones and reports them', () => {
    const context = makeContext({
      nodes: makeNodes(question('q1'), question('orphan')),
      edges: [edge('__start__', 'q1'), edge('q1', '__end__')],
    })
    const result = exportPlaybook(context)

    expect(result.success).toBe(true)
    expect(result.unreachableNodes).toEqual(['orphan'])
    expect(JSON.parse(result.json!).questions.map((q: any) => q.id)).toEqual(['q1', 'orphan'])
  })

  it('exports an empty graph without questions and without flow.start', () => {
    const parsed = exportParsed(makeContext())

    expect(parsed.questions).toEqual([])
    expect(parsed.flow).toEqual({ end: 'submit', routingPriority: 'options-first' })
    expect(parsed._nodePositions).toEqual({ __start__: { x: 0, y: 0 }, __end__: { x: 500, y: 0 } })
  })

  it('maps a start node wired directly to the end node to flow.start "submit"', () => {
    const parsed = exportParsed(makeContext({ edges: [edge('__start__', '__end__')] }))
    expect(parsed.flow.start).toBe('submit')
  })

  it('rewrites defaultNext from edges and drops it when no default edge exists', () => {
    const wired = makeContext({
      nodes: makeNodes(question('q1', { defaultNext: 'stale-target' }), question('q2')),
      edges: [edge('__start__', 'q1'), edge('q1', 'q2'), edge('q2', '__end__')],
    })
    const parsedWired = exportParsed(wired)
    expect(parsedWired.questions[0].defaultNext).toBe('q2')

    const dangling = makeContext({
      nodes: makeNodes(question('q1', { defaultNext: 'stale-target' })),
      edges: [edge('__start__', 'q1')],
    })
    const parsedDangling = exportParsed(dangling)
    expect('defaultNext' in parsedDangling.questions[0]).toBe(false)
  })

  it('sets option.next from option edges, removes stale next and strips editor option ids', () => {
    const q1 = question('q1', {
      type: 'select',
      options: [
        { id: 'opt-1', value: 'yes', label: { 'de-DE': 'Ja', 'en-US': 'Yes' } },
        { id: 'opt-2', value: 'no', label: { 'de-DE': 'Nein', 'en-US': 'No' }, next: 'stale-target' },
      ],
    })
    const context = makeContext({
      nodes: makeNodes(q1, question('q2')),
      edges: [
        edge('__start__', 'q1'),
        edge('q1', 'q2', 'option', { optionId: 'opt-1' }),
        edge('q1', 'q2'),
        edge('q2', '__end__'),
      ],
    })
    const parsed = exportParsed(context)

    expect(parsed.questions[0].options).toEqual([
      { value: 'yes', label: { 'de-DE': 'Ja', 'en-US': 'Yes' }, next: 'q2' },
      { value: 'no', label: { 'de-DE': 'Nein', 'en-US': 'No' } },
    ])
  })

  it('rewrites routing goto by routingIndex, keeps effect-only rules and strips when.questionId', () => {
    const q1 = question('q1', {
      actions: [
        { when: { questionId: 'q1', notEmpty: true }, goto: 'stale-target' },
        { when: { var: 'score', gte: 3 }, effects: [{ var: 'score', op: 'add', value: 1 }] },
      ],
    })
    const context = makeContext({
      nodes: makeNodes(q1, question('q2')),
      edges: [
        edge('__start__', 'q1'),
        edge('q1', '__end__', 'routing', { routingIndex: 0 }),
        edge('q1', 'q2'),
        edge('q2', '__end__'),
      ],
    })
    const parsed = exportParsed(context)

    expect(parsed.questions[0].actions).toEqual([
      { when: { notEmpty: true }, goto: 'submit' },
      { when: { var: 'score', gte: 3 }, effects: [{ var: 'score', op: 'add', value: 1 }] },
    ])
  })

  it('removes unsupported locale keys and collapses single-locale values to plain strings', () => {
    const singleLocale = makeContext({
      i18n: { defaultLocale: 'de-DE', supported: ['de-DE'] },
      nodes: makeNodes(question('q1', {
        label: { 'de-DE': 'Hallo', 'en-US': 'Hello' },
        placeholder: { 'de-DE': 'Bitte', 'fr-FR': 'SVP' },
        description: { 'fr-FR': 'Bonjour' },
      })),
      edges: [edge('__start__', 'q1'), edge('q1', '__end__')],
    })
    const q = exportParsed(singleLocale).questions[0]
    expect(q.label).toBe('Hallo')
    expect(q.placeholder).toBe('Bitte')
    expect(q.description).toBe('')

    const twoLocales = makeContext({
      nodes: makeNodes(question('q1', {
        label: { 'de-DE': 'Hallo', 'en-US': 'Hello', 'fr-FR': 'Salut' },
      })),
      edges: [edge('__start__', 'q1'), edge('q1', '__end__')],
    })
    expect(exportParsed(twoLocales).questions[0].label).toEqual({ 'de-DE': 'Hallo', 'en-US': 'Hello' })
  })

  it('strips empty effects and actions arrays from questions and options', () => {
    const q1 = question('q1', {
      type: 'select',
      effects: [],
      actions: [],
      options: [{ id: 'opt-1', value: 'yes', label: 'Yes', effects: [] }],
    })
    const context = makeContext({
      nodes: makeNodes(q1),
      edges: [edge('__start__', 'q1'), edge('q1', '__end__')],
    })
    const exported = exportParsed(context).questions[0]

    expect('effects' in exported).toBe(false)
    expect('actions' in exported).toBe(false)
    expect('effects' in exported.options[0]).toBe(false)
  })

  it('increments the playbook version and falls back to "1" for invalid versions', () => {
    const meta = { id: 'unit-test-playbook', version: '2' }
    expect(exportParsed(makeContext({ meta })).meta.version).toBe('3')
    // input context is not mutated
    expect(meta.version).toBe('2')

    expect(exportParsed(makeContext({ meta: { id: 'p', version: 'abc' } })).meta.version).toBe('1')
    expect(exportParsed(makeContext({ meta: { id: 'p' } })).meta.version).toBe('1')
  })

  it('fails without meta.id', () => {
    const result = exportPlaybook(makeContext({ meta: { id: '', version: '1' } }))

    expect(result.success).toBe(false)
    expect(result.errors).toContain('meta.id is required for export')
    expect(result.json).toBeUndefined()
    expect(result.data).toBeUndefined()
  })

  it('fails without a title but accepts a legacy meta.title', () => {
    const missing = exportPlaybook(makeContext({ form: {} }))
    expect(missing.success).toBe(false)
    expect(missing.errors).toContain('Title is required (in Form Settings)')

    const legacy = exportPlaybook(makeContext({ form: {}, meta: { id: 'p', title: 'Legacy title', version: '1' } }))
    expect(legacy.success).toBe(true)
  })

  it('fails on duplicate option values within a question', () => {
    const q1 = question('q1', {
      type: 'select',
      options: [
        { id: 'opt-1', value: 'yes', label: 'Yes' },
        { id: 'opt-2', value: 'yes', label: 'Also yes' },
      ],
    })
    const result = exportPlaybook(makeContext({
      nodes: makeNodes(q1),
      edges: [edge('__start__', 'q1'), edge('q1', '__end__')],
    }))

    expect(result.success).toBe(false)
    expect(result.errors).toContain('Question "q1": duplicate option value "yes"')
  })

  it('sanitizes the runtime block and defaults session.resume.maxAgeMinutes to 120', () => {
    const internal = makeContext({
      runtime: {
        api: { base: 'http://internal' },
        scoring: { enabled: true },
        session: { identityQuestionId: '', resume: { sameBrowserOnly: true } },
      } as any,
    })
    expect(exportParsed(internal).runtime).toEqual({ session: { resume: { maxAgeMinutes: 120 } } })

    // empty runtime still gets the resume default
    expect(exportParsed(makeContext()).runtime).toEqual({ session: { resume: { maxAgeMinutes: 120 } } })

    const configured = makeContext({
      runtime: { session: { identityQuestionId: 'q1', resume: { maxAgeMinutes: 45 } } },
    })
    expect(exportParsed(configured).runtime).toEqual({
      session: { identityQuestionId: 'q1', resume: { maxAgeMinutes: 45 } },
    })
  })

  it('strips completion.summaryEditable from the form block and drops an emptied completion', () => {
    const emptied = makeContext({ form: { title: 'T', completion: { summaryEditable: true } as any } })
    expect(exportParsed(emptied).form).toEqual({ title: 'T' })

    const kept = makeContext({ form: { title: 'T', completion: { title: 'Done', summaryEditable: true } as any } })
    expect(exportParsed(kept).form).toEqual({ title: 'T', completion: { title: 'Done' } })
  })

  it('forces calculation.onDivZero to "skip" and omits empty variables/calculation blocks', () => {
    const withBlocks = makeContext({
      calculation: { onDivZero: 'error', rounding: 3 },
      variables: [{ id: 'score', initial: 10 }],
    })
    const parsed = exportParsed(withBlocks)
    expect(parsed.calculation).toEqual({ onDivZero: 'skip', rounding: 3 })
    expect(parsed.variables).toEqual([{ id: 'score', initial: 10 }])

    const bare = exportParsed(makeContext())
    expect('calculation' in bare).toBe(false)
    expect('variables' in bare).toBe(false)
  })

  it('honors the prettyPrint option', () => {
    const context = makeContext({
      nodes: makeNodes(question('q1')),
      edges: [edge('__start__', 'q1'), edge('q1', '__end__')],
    })
    const pretty = exportPlaybook(context)
    const compact = exportPlaybook(context, { prettyPrint: false })

    expect(pretty.json).toContain('\n')
    expect(compact.json).not.toContain('\n')
    expect(JSON.parse(compact.json!)).toEqual(JSON.parse(pretty.json!))
  })
})
