import { describe, expect, test } from 'claude-code/testing'

import type { AskRequest } from '../types'

import { format, formatLater, formOptions, parseQuestions, pendingText, questionToolDescription, requestKey, togglePick, toolRowSummary } from './question-form'

// The test runner has timers; the es2023 lib the mod is typed with does not declare them.
declare const setTimeout: (fn: (value?: unknown) => void, ms: number) => unknown

const TOOL = 'mcp__cc-better-questions__ask-user-question'
const WAIT_TOOL = 'mcp__cc-better-questions__wait-for-answers'
const CAUTION = 'Read the answers carefully'

const base = { status: 'submitted' as const, notes: '', isBlocking: true, picks: [] as string[][] }

describe('helpers', () => {
  test('parseQuestions requires an id and a question, and keeps the optional fields', () => {
    expect(parseQuestions([])).toBe('questions must hold at least one question')
    expect(parseQuestions([{ question: 'Name?' }])).toBe('question 1: id is required (Q1, Q2, ...)')
    expect(parseQuestions([{ id: 'Q1', question: ' ' }])).toBe('question 1: question is required')
    expect(parseQuestions([{ id: 'Q1', question: 'A?' }, { id: 'Q1', question: 'B?' }])).toBe('question 2: id Q1 is used twice')
    expect(parseQuestions([{ id: ' Q1 ', question: 'Name?', context: '**Why** it matters', placeholder: 'atlas', extra: 1 }])).toEqual([
      { id: 'Q1', kind: 'open', question: 'Name?', context: '**Why** it matters', placeholder: 'atlas' },
    ])
  })

  test('parseQuestions checks each kind has what it needs, and nothing of another kind', () => {
    const options = [{ label: ' Small ' }, { label: 'Large', description: ' More room ', recommended: true }]
    expect(parseQuestions([{ id: 'Q1', kind: 'choice', question: 'Size?', options, multiSelect: true }])).toEqual([
      { id: 'Q1', kind: 'choice', question: 'Size?', options: [{ label: 'Small' }, { label: 'Large', description: 'More room', recommended: true }], multiSelect: true },
    ])
    expect(parseQuestions([{ id: 'Q1', kind: 'yes-no', question: 'Ship?', placeholder: 'x' }])).toEqual([{ id: 'Q1', kind: 'yes-no', question: 'Ship?' }])
    expect(parseQuestions([{ id: 'Q1', kind: 'pick', question: 'A?' }])).toBe('question 1: kind must be open, choice or yes-no')
    expect(parseQuestions([{ id: 'Q1', kind: 'choice', question: 'A?', options: [{ label: 'x' }] }])).toBe('question 1: a choice question needs options: two or more')
    expect(parseQuestions([{ id: 'Q1', kind: 'choice', question: 'A?', options: [{ label: 'x' }, { label: 'x ' }] }])).toBe('question 1: option 2: label x is used twice')
    expect(parseQuestions([{ id: 'Q1', kind: 'choice', question: 'A?', options: [{ label: 'x', recommended: true }, { label: 'y', recommended: true }] }])).toBe(
      'question 1: only one option may be recommended',
    )
    expect(parseQuestions([{ id: 'Q1', question: 'A?', options: [{ label: 'x' }, { label: 'y' }] }])).toBe('question 1: options are for choice questions; set kind to "choice"')
    expect(parseQuestions([{ id: 'Q1', kind: 'yes-no', question: 'A?', multiSelect: true }])).toBe('question 1: multiSelect is for choice questions')
    expect(parseQuestions([{ id: 'Q1', kind: 'choice', question: 'A?', options: [{ label: 'x' }, { label: 'y' }], suggestions: [{ text: 'x' }] }])).toBe(
      'question 1: suggestions are for open questions; a choice question lists options',
    )
  })

  test('togglePick: one pick for a single choice, clearing its Other answer; several, in order, for a multi-select', () => {
    const single = { id: 'Q1', kind: 'choice' as const, question: 'Size?', options: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }
    const multi = { ...single, id: 'Q2', multiSelect: true as const }
    let r: AskRequest = { ...base, questions: [single, multi], answers: ['huge', 'also XL'], picks: [[], []] }
    r = togglePick(r, 0, 'M')
    expect(r.picks[0]).toEqual(['M'])
    expect(r.answers[0]).toBe('')
    expect(togglePick(r, 0, 'S').picks[0]).toEqual(['S'])
    expect(togglePick(r, 0, 'M').picks[0]).toEqual([])
    r = togglePick(togglePick(r, 1, 'L'), 1, 'S')
    expect(r.picks[1]).toEqual(['S', 'L'])
    expect(r.answers[1]).toBe('also XL')
    expect(togglePick(r, 1, 'S').picks[1]).toEqual(['L'])
  })

  test('parseQuestions keeps suggestions, puts the recommended one first, and allows only one', () => {
    expect(parseQuestions([{ id: 'Q1', question: 'Name?', suggestions: [{ text: 'Orbit' }, { text: ' Atlas ', recommended: true }, { text: 'Nova', recommended: false }] }])).toEqual([
      { id: 'Q1', kind: 'open', question: 'Name?', suggestions: [{ text: 'Atlas', recommended: true }, { text: 'Orbit' }, { text: 'Nova' }] },
    ])
    expect(parseQuestions([{ id: 'Q1', question: 'A?' }, { id: 'Q2', question: 'B?', suggestions: [{ text: 'x', recommended: true }, { text: 'y', recommended: true }] }])).toBe(
      'question 2: only one suggestion may be recommended',
    )
  })

  test('requestKey is a valid id', () => {
    expect(requestKey('toolu_01AbC/xyz')).toBe('qf-toolu_01AbCxyz')
  })

  test('formOptions defaults to blocking', () => {
    expect(formOptions({})).toEqual({ isBlocking: true, hasWaitTool: false, disablesAskUserQuestion: true })
    expect(formOptions({ blocking: false, disableAskUserQuestion: false })).toEqual({
      isBlocking: false,
      hasWaitTool: true,
      disablesAskUserQuestion: false,
    })
  })

  test('wait-for-answers is there only where calls do not wait, and disableWaitForAnswers leaves it out', () => {
    expect(formOptions({ blocking: false }).hasWaitTool).toBe(true)
    expect(formOptions({ blocking: false, disableWaitForAnswers: true }).hasWaitTool).toBe(false)
    expect(formOptions({ blocking: true, disableWaitForAnswers: false }).hasWaitTool).toBe(false)
    expect(questionToolDescription(formOptions({ blocking: false }))).toContain(`call ${WAIT_TOOL} to wait for them`)
    expect(questionToolDescription(formOptions({ blocking: false, disableWaitForAnswers: true }))).not.toContain(WAIT_TOOL)
    expect(questionToolDescription(formOptions({}))).not.toContain(WAIT_TOOL)
    const request = { ...base, questions: [{ id: 'Q1', kind: 'open' as const, question: 'Foo?' }], answers: [''], picks: [[]] }
    expect(pendingText(request, { hasWaitTool: true })).toContain(`call ${WAIT_TOOL}`)
    expect(pendingText(request)).not.toContain(WAIT_TOOL)
    expect(pendingText(request, { isPiled: true })).toStartWith('Questions added to the form already open (Q1)')
  })

  test('format names each answer by its id, then the notes', () => {
    const questions = [{ id: 'Q1', kind: 'open' as const, question: 'Name?', suggestions: [{ text: 'Atlas' }] }, { id: 'Q2', kind: 'open' as const, question: 'Why?' }]
    expect(format({ ...base, questions, answers: ['Atlas', ''] })).toBe(
      `The user answered 1 of 2 questions:\n\n**Q1**\n> Atlas (suggested)\n\n**Q2**\n> (no answer)\n\n${CAUTION} — they may request clarification, changes, or that you not proceed — and follow what they actually say.`,
    )
    expect(format({ ...base, questions, answers: ['Orbit', 'two\n\nlines'], notes: 'Ship it' })).toContain(
      'The user answered 2 of 2 questions, with notes:\n\n**Q1**\n> Orbit\n\n**Q2**\n> two\n>\n> lines\n\n**Other comments or notes**\n> Ship it\n\n',
    )
    expect(format({ ...base, questions, answers: ['', ''], notes: 'Only a note' })).toContain('answered 0 of 2 questions, with notes')
    expect(format({ ...base, questions, answers: ['', ''] })).toBe('The user submitted the form without answering any question.')
    expect(format({ ...base, status: 'cancelled', questions, answers: ['x', ''] })).toContain('dismissed')
  })

  test('format gives picks by label: a list for a multi-select, a typed answer as Other', () => {
    const options = [{ label: 'S' }, { label: 'M' }]
    const questions = [
      { id: 'Q1', kind: 'choice' as const, question: 'Size?', options },
      { id: 'Q2', kind: 'choice' as const, question: 'Sizes?', options, multiSelect: true as const },
      { id: 'Q3', kind: 'yes-no' as const, question: 'Ship?' },
      { id: 'Q4', kind: 'choice' as const, question: 'Size?', options },
    ]
    expect(format({ ...base, questions, answers: ['', 'XL', '', ''], picks: [['M'], ['S', 'M'], ['No'], []] })).toContain(
      'The user answered 3 of 4 questions:\n\n**Q1**\n> M\n\n**Q2**\n> - S\n> - M\n> Other: XL\n\n**Q3**\n> No\n\n**Q4**\n> (no answer)\n\n',
    )
    expect(format({ ...base, questions: [questions[0]!], answers: ['Huge'], picks: [[]] })).toContain('**Q1**\n> Other: Huge\n')
  })

  test('formatLater frames the answers as a reply to the earlier form', () => {
    const request = { ...base, title: 'Setup', questions: [{ id: 'Q1', kind: 'open' as const, question: 'Name?' }], answers: ['Atlas'], picks: [[]] }
    expect(formatLater([request])).toStartWith('Answers to the question form you showed earlier ("Setup") (Q1):\n\nThe user answered 1 of 1 question:\n\n**Q1**\n> Atlas')
    expect(formatLater([{ ...request, status: 'cancelled' }])).toStartWith('The user dismissed the question form you showed earlier ("Setup") (Q1) without answering.')
  })

  test('formatLater gives several forms answered together a section each, the notes once', () => {
    const one = { ...base, title: 'Foo', questions: [{ id: 'Q1', kind: 'open' as const, question: 'Marco?' }], answers: ['Polo'], picks: [[]], notes: 'Lorem ipsum' }
    const two = { ...base, questions: [{ id: 'Q1', kind: 'yes-no' as const, question: 'Bar?' }], answers: [''], picks: [['Yes']], notes: 'Lorem ipsum' }
    const text = formatLater([one, two])
    expect(text).toStartWith('Answers to the 2 question forms you showed earlier, which the user answered together in one form:\n\n')
    expect(text).toContain('### Form 1 ("Foo"): Q1\n\nThe user answered 1 of 1 question:\n\n**Q1**\n> Polo\n\n### Form 2: Q1\n\nThe user answered 1 of 1 question:\n\n**Q1**\n> Yes\n\n**Other comments or notes**\n> Lorem ipsum\n\n')
    expect(text).toEndWith(`${CAUTION} — they may request clarification, changes, or that you not proceed — and follow what they actually say.`)
    expect(formatLater([{ ...one, status: 'cancelled' }, { ...two, status: 'cancelled' }])).toStartWith('The user dismissed the 2 question forms you showed earlier without answering.')
  })

  test("toolRowSummary says what the call asked, never the whole input", () => {
    expect(toolRowSummary({ questions: [{ id: 'Q1', question: 'A long question?', context: 'x'.repeat(500) }, { id: 'Q2', question: 'B?' }] })).toBe('2 questions (Q1, Q2)')
    expect(toolRowSummary({ title: 'Setup', questions: [{ question: 'A?' }] })).toBe('Setup · 1 question (Q1)')
    expect(toolRowSummary(undefined)).toBe('0 questions')
  })
})

describe('tool', () => {
  test('refuses and hides itself where no terminal is attached', async ($, on) => {
    on('session.surfaces', () => ({ value: ['mobile'] }))
    const called = (await $.tool.call({ tool: TOOL, questions: [{ id: 'Q1', question: 'Name?' }] } as any)) as any
    expect(called.deny ?? called.text).toContain('Use AskUserQuestion instead')
    const described = await $.tool.describe({ tool: TOOL, description: 'Ask.', provider: { plugin: 'cc-better-questions', tier: 'plugin' } } as any)
    expect(described).toMatchObject({ isDeferred: true })
  })

  test('refuses questions with no id', async ($, on) => {
    on('session.surfaces', () => ({ value: ['terminal'] }))
    const called = (await $.tool.call({ tool: TOOL, questions: [{ question: 'Name?' }] } as any)) as any
    expect(called.deny ?? called.text).toContain('id is required')
  })

  test('AskUserQuestion is left alone when disableAskUserQuestion is false', { options: { disableAskUserQuestion: false } }, async ($, on) => {
    on('session.surfaces', () => ({ value: ['terminal'] }))
    on('tool.describe', (_$: unknown, e: { description: string }) => ({ description: e.description }))
    on('tool.call', { tool: 'AskUserQuestion' }, () => ({ result: { questions: [], answers: {} } }) as any)
    const called = (await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)) as any
    expect(called.deny).toBeUndefined()
    const described = await $.tool.describe({ tool: 'AskUserQuestion', description: 'Ask.', provider: { plugin: 'engine', tier: 'core' } } as any)
    expect(described).toEqual({ description: 'Ask.' })
  })

  test('AskUserQuestion is off by default while a terminal is attached, pointing to the form', async ($, on) => {
    on('session.surfaces', () => ({ value: ['terminal'] }))
    on('tool.describe', (_$: unknown, e: { description: string }) => ({ description: e.description }))
    on('tool.call', { tool: 'AskUserQuestion' }, () => ({ result: { questions: [], answers: {} } }) as any)
    const called = (await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)) as any
    expect(called.deny).toContain(TOOL)
    const described = (await $.tool.describe({ tool: 'AskUserQuestion', description: 'Ask.', provider: { plugin: 'engine', tier: 'core' } } as any)) as any
    expect(described).toMatchObject({ isDeferred: true })
    expect(described.description).toContain('turned off')
    const form = (await $.tool.describe({ tool: TOOL, description: 'Ask.', provider: { plugin: 'cc-better-questions', tier: 'plugin' } } as any)) as any
    expect(form.description).toBe('Ask.')
  })

  test('AskUserQuestion stays on where no terminal is attached', async ($, on) => {
    on('session.surfaces', () => ({ value: ['mobile'] }))
    on('tool.describe', (_$: unknown, e: { description: string }) => ({ description: e.description }))
    on('tool.call', { tool: 'AskUserQuestion' }, () => ({ result: { questions: [], answers: {} } }) as any)
    const called = (await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)) as any
    expect(called.deny).toBeUndefined()
    const described = await $.tool.describe({ tool: 'AskUserQuestion', description: 'Ask.', provider: { plugin: 'engine', tier: 'core' } } as any)
    expect(described).toEqual({ description: 'Ask.' })
  })

  test("the call's transcript row is the short name and a summary, not the input", async ($, on) => {
    const input = { questions: [{ id: 'Q1', question: 'Name?', context: 'A long description' }] }
    const props = { tool_use_id: 'toolu_1', tool: TOOL, input, isRunning: true, isErrored: false, isInterrupted: false }
    const ui = await $.ui.mount({ plugin: 'cc-better-questions', surface: 'terminal', component: 'ToolUse', requestId: 'toolu_1', props } as any)
    expect(await ui.find({ type: 'Text', text: 'ask-user-question' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1 question (Q1)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /A long description/ })).toBeUndefined()
  })
})

// A terminal session: panes are placed, the tool's wait (sleep runs) returns at once, and the status
// line, toasts and submitted prompts are recorded.
function terminalSession(on: any) {
  const seen = { opened: [] as string[], statuses: [] as (string | undefined)[], prompts: [] as string[] }
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('ui.open', (_$: unknown, e: { id: string }) => (seen.opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.focus', () => ({}))
  on('ui.status', (_$: unknown, e: { text?: string }) => (seen.statuses.push(e.text), { value: undefined }) as any)
  on('ui.toast', () => ({ value: undefined }) as any)
  on('prompt.submit', (_$: unknown, e: { text: string }) => (seen.prompts.push(e.text), { text: e.text }) as any)
  on('tool.describe', (_$: unknown, e: { description: string }) => ({ description: e.description }))
  on('process.run', async () => (await new Promise(r => setTimeout(r, 5)), { value: { exitCode: 0, stdout: '', stderr: '' } }))
  return seen
}

async function until<T>(read: () => T | undefined | Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error('timed out')
}

const paneProps = { title: 'x', isFocused: true, bodyColumns: 80, placement: 'dock' as const, scroll: {} as any, view: {} as any }

describe('form in a pane', () => {
  test('the form shows every question by its id, with its markdown description, and submits them together', { timeoutMs: 10000 }, async ($, on) => {
    const seen = terminalSession(on)
    const questions = [
      { id: 'Q1', question: 'Name?' },
      { id: 'Q2', question: 'Why?', context: 'Some **context**' },
      { id: 'Q3', question: 'When?' },
    ]
    const call = $.tool.call({ tool: TOOL, title: 'Setup', questions } as any)
    const ui = await $.ui.mount({ plugin: 'cc-better-questions', surface: 'terminal', component: 'Pane', requestId: await until(() => seen.opened[0]), props: paneProps })
    for (const text of ['Setup', 'Q1', 'Name?', 'Q2', 'Why?', 'Q3', 'When?', '0 of 3 answered', 'Other comments or notes']) expect(await ui.find({ type: 'Text', text })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: 'Some **context**' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^─+$/ })).toBeDefined()

    await ui.input({ key: 'answer-0', text: 'Atlas', kind: 'change' })
    await ui.input({ key: 'answer-2', text: 'Friday', kind: 'change' })
    await ui.input({ key: 'notes-field', text: 'Keep it short', kind: 'change' })
    expect(await ui.find({ type: 'Text', text: '2 of 3 answered' })).toBeDefined()
    await ui.press({ key: 'submit' })
    expect(((await call) as any).result).toContain('**Q1**\n> Atlas\n\n**Q2**\n> (no answer)\n\n**Q3**\n> Friday\n\n**Other comments or notes**\n> Keep it short\n\n')
    expect(seen.prompts).toEqual([])
  })

  test('suggestions stay listed once the field holds text, their buttons drawn as dim text until it is emptied', { timeoutMs: 10000 }, async ($, on) => {
    const seen = terminalSession(on)
    const questions = [{ id: 'Q1', question: 'Name?', suggestions: [{ text: 'Orbit' }, { text: 'Atlas', recommended: true }] }, { id: 'Q2', question: 'Why?' }]
    const call = $.tool.call({ tool: TOOL, questions } as any)
    const ui = await $.ui.mount({ plugin: 'cc-better-questions', surface: 'terminal', component: 'Pane', requestId: await until(() => seen.opened[0]), props: paneProps })
    expect((await ui.find({ type: 'Button', key: 'suggest-0-0' }))?.text).toBe('A')
    for (const text of ['Atlas (recommended)', 'Orbit']) expect(await ui.find({ type: 'Text', text })).toBeDefined()

    await ui.input({ key: 'answer-0', text: 'Atl', kind: 'change' })
    expect(await ui.find({ type: 'Button', key: 'suggest-0-0' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '[ A ]' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Orbit' })).toBeDefined()

    await ui.input({ key: 'answer-0', text: '', kind: 'change' })
    await ui.press({ key: 'suggest-0-0' })
    expect((await ui.find({ type: 'Input', key: 'answer-0' }))?.text).toBe('Atlas')
    expect(await ui.find({ type: 'Text', text: 'Atlas (recommended) ✓' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'suggest-0-1' })).toBeUndefined()
    await ui.input({ key: 'answer-1', text: 'Speed' })
    await ui.input({ key: 'notes-field', text: '' })
    expect(((await call) as any).result).toContain('**Q1**\n> Atlas (suggested)\n\n**Q2**\n> Speed\n\n')
  })

  test('choice and yes-no questions are answered by picks', { timeoutMs: 10000 }, async ($, on) => {
    const seen = terminalSession(on)
    const questions = [
      { id: 'Q1', kind: 'choice', question: 'Database?', options: [{ label: 'Postgres', description: 'Managed, in the cloud', recommended: true }, { label: 'SQLite' }] },
      { id: 'Q2', kind: 'choice', question: 'Platforms?', multiSelect: true, options: [{ label: 'macOS' }, { label: 'Linux' }, { label: 'Windows' }] },
      { id: 'Q3', kind: 'yes-no', question: 'Ship today?' },
    ]
    const call = $.tool.call({ tool: TOOL, questions } as any)
    const ui = await $.ui.mount({ plugin: 'cc-better-questions', surface: 'terminal', component: 'Pane', requestId: await until(() => seen.opened[0]), props: paneProps })
    expect((await ui.find({ type: 'Button', key: 'choice-0-0' }))?.text).toBe('( ) A. Postgres (recommended)')
    expect(await ui.find({ type: 'Text', text: 'Managed, in the cloud' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Pick any that apply.' })).toBeDefined()
    expect(await ui.find({ type: 'Input', key: 'answer-0' })).toBeDefined()
    expect(await ui.find({ type: 'Input', key: 'answer-2' })).toBeUndefined()

    await ui.press({ key: 'choice-0-1' })
    expect((await ui.find({ type: 'Button', key: 'choice-0-1' }))?.text).toBe('(•) B. SQLite')
    expect(await ui.find({ type: 'Input', key: 'answer-0' })).toBeUndefined()
    await ui.press({ key: 'choice-0-1' })
    expect(await ui.find({ type: 'Input', key: 'answer-0' })).toBeDefined()
    await ui.press({ key: 'choice-0-1' })
    await ui.press({ key: 'choice-1-2' })
    await ui.press({ key: 'choice-1-0' })
    expect((await ui.find({ type: 'Button', key: 'choice-1-0' }))?.text).toBe('[x] A. macOS')
    await ui.input({ key: 'answer-1', text: 'FreeBSD', kind: 'change' })
    await ui.press({ key: 'no-2' })
    expect((await ui.find({ type: 'Button', key: 'no-2' }))?.text).toBe('No ✓')
    expect(await ui.find({ type: 'Text', text: '3 of 3 answered' })).toBeDefined()
    await ui.press({ key: 'submit' })
    expect(((await call) as any).result).toContain('**Q1**\n> SQLite\n\n**Q2**\n> - macOS\n> - Windows\n> Other: FreeBSD\n\n**Q3**\n> No\n\n')
  })

  // The terminal empties a field after Enter until it is drawn under a new key; the kit does not, so this checks the key.
  test('Enter draws the field anew with its answer and moves on; Enter in the notes submits', { timeoutMs: 10000 }, async ($, on) => {
    const seen = terminalSession(on)
    const call = $.tool.call({ tool: TOOL, questions: [{ id: 'Q1', question: 'A?' }, { id: 'Q2', question: 'B?' }] } as any)
    const ui = await $.ui.mount({ plugin: 'cc-better-questions', surface: 'terminal', component: 'Pane', requestId: await until(() => seen.opened[0]), props: paneProps })
    await ui.input({ key: 'answer-0', text: 'Testing' })
    expect((await ui.find({ type: 'Input', key: 'answer-0.1' }))?.text).toBe('Testing')
    const long = 'word '.repeat(30).trim()
    await ui.input({ key: 'answer-1', text: long })
    expect(await ui.find({ type: 'Text', text: long })).toBeUndefined()
    await ui.input({ key: 'notes-field', text: 'Done' })
    expect(((await call) as any).result).toContain(`**Q1**\n> Testing\n\n**Q2**\n> ${long}\n\n**Other comments or notes**\n> Done`)
  })

  test('a pane the terminal cannot seat waits, and /questions opens it', { timeoutMs: 10000 }, async ($, on) => {
    const opens: { id: string; placed: boolean }[] = []
    const statuses: (string | undefined)[] = []
    let isAsked = false
    on('session.surfaces', () => ({ value: ['terminal'] }))
    on('tool.describe', (_$: unknown, e: { description: string }) => ({ description: e.description }))
    on('ui.open', (_$: unknown, e: { id: string }) => {
      opens.push({ id: e.id, placed: isAsked })
      return isAsked ? { value: { isPlaced: true } } : { value: { isPlaced: false, reason: 'the terminal is 120 columns wide, under 144' } }
    })
    on('ui.close', () => ({ value: undefined }))
    on('ui.status', (_$: unknown, e: { text?: string }) => (statuses.push(e.text), { value: undefined }) as any)
    on('ui.toast', () => ({ value: undefined }) as any)
    on('process.run', async () => (await new Promise(r => setTimeout(r, 5)), { value: { exitCode: 0, stdout: '', stderr: '' } }) as any)

    expect(((await $.command.run({ command: 'questions', args: '' } as any)) as any).text).toBe('Claude has no questions waiting.')
    const call = $.tool.call({ tool: TOOL, questions: [{ id: 'Q1', question: 'Name?' }] } as any)
    const id = (await until(() => opens[0])).id
    expect(await until(() => statuses[0])).toContain('/questions')

    isAsked = true
    expect(((await $.command.run({ command: 'questions', args: '' } as any)) as any).text).toBe('Question form opened.')
    expect(opens[1]).toEqual({ id, placed: true })

    const ui = await $.ui.mount({ plugin: 'cc-better-questions', surface: 'terminal', component: 'Pane', requestId: id, props: paneProps })
    await ui.input({ key: 'answer-0', text: 'Atlas' })
    await ui.press({ key: 'submit' })
    expect(((await call) as any).result).toContain('**Q1**\n> Atlas\n')
    expect(statuses.at(-1)).toBeUndefined()
  })
})

describe('non-blocking', () => {
  test('the call returns at once, and the answers are sent as a prompt on submit', { timeoutMs: 10000, options: { blocking: false } }, async ($, on) => {
    const seen = terminalSession(on)
    const called = (await $.tool.call({ tool: TOOL, title: 'Setup', questions: [{ id: 'Q1', question: 'Name?' }] } as any)) as any
    expect(called.result).toStartWith('Form shown (Q1); the answers will arrive later')
    const ui = await $.ui.mount({ plugin: 'cc-better-questions', surface: 'terminal', component: 'Pane', requestId: seen.opened[0]!, props: paneProps })
    await ui.input({ key: 'answer-0', text: 'Atlas', kind: 'change' })
    await ui.press({ key: 'submit' })
    expect(seen.prompts).toHaveLength(1)
    expect(seen.prompts[0]).toStartWith('Answers to the question form you showed earlier ("Setup") (Q1):')
    expect(seen.prompts[0]).toContain('**Q1**\n> Atlas')
  })
})

describe('piled forms', () => {
  test('a second call adds its questions to the open form, and one Submit sends both in one prompt', { timeoutMs: 10000, options: { blocking: false } }, async ($, on) => {
    const seen = terminalSession(on)
    const first = (await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_foo', title: 'Foo', questions: [{ id: 'Q1', question: 'Marco?' }] } as any)) as any
    expect(first.result).toStartWith('Form shown (Q1)')
    const second = (await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_bar', title: 'Bar', questions: [{ id: 'Q1', kind: 'yes-no', question: 'Lorem ipsum?' }] } as any)) as any
    expect(second.result).toStartWith('Questions added to the form already open (Q1)')
    expect(new Set(seen.opened).size).toBe(1)

    const ui = await $.ui.mount({ plugin: 'cc-better-questions', surface: 'terminal', component: 'Pane', requestId: seen.opened[0]!, props: paneProps })
    for (const text of ['Claude has questions', 'Foo', 'Bar', 'Marco?', 'Lorem ipsum?', '0 of 2 answered']) expect(await ui.find({ type: 'Text', text })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^═+$/ })).toBeDefined()
    await ui.input({ key: 'answer-0', text: 'Polo', kind: 'change' })
    await ui.press({ key: 's1-yes-0' })
    expect(await ui.find({ type: 'Text', text: '2 of 2 answered' })).toBeDefined()
    await ui.input({ key: 'notes-field', text: 'Dolor sit amet' })

    expect(seen.prompts).toHaveLength(1)
    expect(seen.prompts[0]).toStartWith('Answers to the 2 question forms you showed earlier')
    expect(seen.prompts[0]).toContain('### Form 1 ("Foo"): Q1\n\nThe user answered 1 of 1 question:\n\n**Q1**\n> Polo\n\n### Form 2 ("Bar"): Q1')
    expect(seen.prompts[0]).toContain('**Q1**\n> Yes\n\n**Other comments or notes**\n> Dolor sit amet')
    expect(((await $.command.run({ command: 'questions', args: '' } as any)) as any).text).toBe('Claude has no questions waiting.')
  })

  test('blocking calls made together share the form, and each reads its own answers', { timeoutMs: 10000 }, async ($, on) => {
    const seen = terminalSession(on)
    const foo = $.tool.call({ tool: TOOL, tool_use_id: 'toolu_foo', questions: [{ id: 'Q1', question: 'Foo?' }] } as any)
    await until(() => seen.opened[0])
    const bar = $.tool.call({ tool: TOOL, tool_use_id: 'toolu_bar', questions: [{ id: 'Q1', question: 'Bar?' }] } as any)
    await until(() => seen.opened[1])
    const ui = await $.ui.mount({ plugin: 'cc-better-questions', surface: 'terminal', component: 'Pane', requestId: seen.opened[0]!, props: paneProps })
    await ui.input({ key: 'answer-0', text: 'Baz', kind: 'change' })
    await ui.input({ key: 's1-answer-0', text: 'Qux', kind: 'change' })
    await ui.press({ key: 'submit' })
    expect(((await foo) as any).result).toContain('**Q1**\n> Baz\n')
    expect(((await bar) as any).result).toContain('**Q1**\n> Qux\n')
    expect(seen.prompts).toEqual([])
  })
})

describe('wait-for-answers', () => {
  test('answers with nothing to wait for at once', { options: { blocking: false } }, async ($, on) => {
    terminalSession(on)
    expect(((await $.tool.call({ tool: WAIT_TOOL } as any)) as any).result).toBe('No question form is waiting for answers.')
  })

  test('waits for the open forms and answers with them, sending no prompt', { timeoutMs: 10000, options: { blocking: false } }, async ($, on) => {
    const seen = terminalSession(on)
    await $.tool.call({ tool: TOOL, tool_use_id: 'toolu_foo', title: 'Foo', questions: [{ id: 'Q1', question: 'Marco?' }] } as any)
    let isAnswered = false
    const wait = $.tool.call({ tool: WAIT_TOOL } as any).then(r => ((isAnswered = true), r))
    await new Promise(r => setTimeout(r, 30))
    expect(isAnswered).toBe(false)
    const ui = await $.ui.mount({ plugin: 'cc-better-questions', surface: 'terminal', component: 'Pane', requestId: seen.opened[0]!, props: paneProps })
    await ui.input({ key: 'answer-0', text: 'Polo', kind: 'change' })
    await ui.press({ key: 'submit' })
    expect(((await wait) as any).result).toStartWith('Answers to the question form you showed earlier ("Foo") (Q1):\n\nThe user answered 1 of 1 question:\n\n**Q1**\n> Polo')
    expect(seen.prompts).toEqual([])
  })
})
