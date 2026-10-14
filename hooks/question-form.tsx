import { update } from 'claude-code'
import type { EngineInterface as Engine, On, PluginOptions } from 'claude-code'

import type { AskRequest, ChoiceOption, FormNotes, OpenQuestion, QuestionKind, Suggestion } from '../types'
import { cardRows, isAnswered, NOTES_LABEL, questionCard } from './question-card'
import type { CardActions, FormModel } from './question-card'

// The `ask-user-question` tool: questions answered in a form drawn in a terminal pane
// (question-card.tsx). Open questions are the default and the preferred kind; a question may instead be
// a choice among fixed options or a yes/no, so the form can stand in for AskUserQuestion.
//
// Each call is a request of its own in $.state, but there is one form, in one pane: a call made while
// the form is open adds its questions to it as a section, and Submit (or closing the pane) ends every
// request the form holds. Each blocking call reads its own answers; the non-blocking ones' answers
// are sent together, in one prompt, or as the result of a `wait-for-answers` call waiting on them.
//
// Three settings (the manifest's userConfig, stored in settings.json under
// `pluginConfigs["cc-better-questions"].options`) shape it:
// - `blocking`: true (default) holds the tool call until the form ends, polling
//   $.process.run(['sleep', ...]), whose time does not count against the hook's 10 s budget (the API
//   has no "wait for a state change" call). false answers the call at once, and the form's answers
//   are sent to Claude as a prompt of their own once it ends.
// - `disableWaitForAnswers`: false (default) registers the `wait-for-answers` tool where `blocking` is
//   false, so Claude can wait for the answers, polling as a blocking call does, once it has no other
//   work left; true leaves it out. Where `blocking` is true it does nothing: every call waits already.
// - `disableAskUserQuestion`: true (default) turns AskUserQuestion off (deferred, and its calls
//   refused) while a terminal is attached, so every question comes through the form. With no
//   terminal the form cannot be answered, so AskUserQuestion stays on there.
//
// A pane the model's call opens is "unasked", and a terminal seats one only from 144 columns
// (110 once the person has opened it): below that the pane waits, and the status line says to
// open it with /questions, whose open is the person's own and so is seated at any width.

export const QUESTION_TOOL_NAME = 'ask-user-question'
export const WAIT_TOOL_NAME = 'wait-for-answers'
const PLUGIN = 'cc-better-questions'
const TOOL = `mcp__${PLUGIN}__${QUESTION_TOOL_NAME}`
const WAIT_TOOL = `mcp__${PLUGIN}__${WAIT_TOOL_NAME}`
const REQUEST_PREFIX = 'qf-'
/** The one pane every request is drawn in. */
const FORM_PANE = 'qf-form'
const POLL_SECONDS = '0.25'
const PANE_TITLE = 'Questions from Claude'
export const QUESTIONS_COMMAND = 'questions'
const WAITING_PANE = `Claude has questions for you: type /${QUESTIONS_COMMAND} to answer them.`

const requests = { plugin: 'cc-better-questions', key: 'requests' } as const
const notesRef = { plugin: 'cc-better-questions', key: 'notes' } as const

// What AskUserQuestion says and answers while it is off: the full name, so an agent finds the tool at once.
const ASK_TOOL = 'AskUserQuestion'
const ASK_OFF = `AskUserQuestion is turned off. Use ${TOOL} instead: it asks open, choice and yes-no questions.`

/** The form's settings, as the manifest's userConfig declares them. */
export type FormOptions = { isBlocking: boolean; hasWaitTool: boolean; disablesAskUserQuestion: boolean }

export function formOptions(options: PluginOptions): FormOptions {
  const isBlocking = options.blocking !== false
  return {
    isBlocking,
    hasWaitTool: !isBlocking && options.disableWaitForAnswers !== true,
    disablesAskUserQuestion: options.disableAskUserQuestion !== false,
  }
}

const KINDS: readonly QuestionKind[] = ['open', 'choice', 'yes-no']

// The tool calls that wait read how a request ended from these, since a $.state.get inside a
// long-running dispatch can keep returning the value it first saw.
// - How each blocking request ended, by id, for its own call.
const settled = new Map<string, AskRequest>()
// - The non-blocking requests a wait-for-answers call waits on; how each that ended did, for that call;
//   and those whose answers were sent as a prompt instead.
const awaited = new Set<string>()
const delivered = new Map<string, AskRequest>()
const sentLater = new Set<string>()

// Kept short: the schema's field descriptions carry the details.
export function questionToolDescription({ isBlocking, hasWaitTool, disablesAskUserQuestion }: FormOptions): string {
  const waits = isBlocking ? 'and wait for the answers' : '; the call returns at once and the answers arrive later in a message of their own'
  const later = hasWaitTool
    ? `\n- Until the answers arrive, do only work that does not depend on them; once none is left, call ${WAIT_TOOL} to wait for them.`
    : '\n- Until the answers arrive, do only work that does not depend on them; if none is left, end your turn.'
  return `Ask the user questions in a form${isBlocking ? ' ' : ''}${waits}. Use it whenever you need something only the user can give: a decision, a preference, a missing fact, a clarification, or a go-ahead.${
    disablesAskUserQuestion ? ' Use it instead of AskUserQuestion.' : ''
  }

- Prefer "open" questions (the default): a free-text answer, optionally with "suggestions" the user can pick and edit. Use "choice" only when the answer must be among a few options you can list in full (the user can still type their own), and "yes-no" only for a plain confirmation.
- Ask related questions together in one call, most important first, and only ones whose answers change what you do next.
- Keep "question" to one specific sentence; put background and tradeoffs in "context".
- The user may skip questions, add notes, or dismiss the form: follow what they actually say.${
    isBlocking ? '' : `${later}\n- A call made while a form is still open adds its questions to that form, and the answers to all of them arrive together.`
  }`
}

export const WAIT_TOOL_DESCRIPTION = `Wait for the answers to the question forms you showed with ${TOOL}: the call returns once the user submits or dismisses them, with their answers. Call it only once no work that does not depend on the answers is left. Without it, the answers arrive later in a message of their own.`

export const WAIT_TOOL_SCHEMA = { type: 'object', properties: {}, additionalProperties: false }

export const QUESTION_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Optional heading above the questions.' },
    questions: {
      type: 'array',
      minItems: 1,
      description: 'The questions, in order.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Short unique id (Q1, Q2, ...); the result names each answer by it.' },
          kind: {
            type: 'string',
            enum: [...KINDS],
            description: '"open" (default, preferred): free text. "choice": pick from "options". "yes-no": Yes or No.',
          },
          question: { type: 'string', description: 'The question: one specific sentence ending in a question mark.' },
          context: { type: 'string', description: 'Optional markdown shown under the question: background, tradeoffs, what the answer decides.' },
          placeholder: { type: 'string', description: 'Optional example answer in the empty text field (open, or a choice\'s "Other").' },
          suggestions: {
            type: 'array',
            description: 'Open only: likely answers the user can pick, then edit.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                recommended: { type: 'boolean', description: 'Your pick; at most one per question.' },
              },
              required: ['text'],
              additionalProperties: false,
            },
          },
          options: {
            type: 'array',
            minItems: 2,
            description: 'Choice only, and required there: the options, in display order.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'A few words, unique in the question.' },
                description: { type: 'string', description: 'Optional: one line on what it means or implies.' },
                recommended: { type: 'boolean', description: 'Your pick; at most one per question.' },
              },
              required: ['label'],
              additionalProperties: false,
            },
          },
          multiSelect: { type: 'boolean', description: 'Choice only: allow several picks.' },
        },
        required: ['id', 'question'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
}

export function registerQuestionForm(on: On, options: FormOptions): void {
  // The person's own open, so the terminal seats the waiting form at any width.
  on('command.run', { command: QUESTIONS_COMMAND }, async $ => {
    const { value: all = {} } = await $.state.get(requests)
    const ids = openIds(all)
    if (ids.length === 0) return { text: 'Claude has no questions waiting.' }
    await $.ui.open({ id: FORM_PANE, title: PANE_TITLE, focus: true, closeOnEscape: true, holdToasts: true, rows: cardRows(ids.map(id => all[id]!)) })
    return { text: 'Question form opened.' }
  })

  // Without a terminal attached (a phone alone, a -p run) the form cannot be answered: hide the tool.
  on('tool.describe', { tool: TOOL }, async ($, e, next) =>
    (await hasTerminal($)) ? next(e) : { description: 'Unavailable here: no terminal is attached. Use AskUserQuestion instead.', isDeferred: true },
  )

  // AskUserQuestion turned off while the form can be answered; with no terminal it is the only way to ask.
  if (options.disablesAskUserQuestion) {
    on('tool.describe', { tool: ASK_TOOL }, async ($, e, next) => ((await hasTerminal($)) ? { description: ASK_OFF, isDeferred: true } : next(e)))
    on('tool.call', { tool: ASK_TOOL }, async ($, e, next) => ((await hasTerminal($)) ? { deny: ASK_OFF } : next(e))).catch(($, e, next) => next(e))
  }

  on('tool.call', { tool: new RegExp(`^${TOOL}$`) }, async ($, e, next) => {
    const { tool, tool_use_id, ...rest } = e
    const input = rest as { title?: unknown; questions?: unknown }
    const questions = parseQuestions(input.questions)
    if (typeof questions === 'string') return { deny: `Invalid input: ${questions}` }
    if (!(await hasTerminal($))) return { deny: 'The question form is answered in a terminal, and none is attached to this session. Use AskUserQuestion instead.' }

    const id = requestKey(tool_use_id)
    const title = typeof input.title === 'string' && input.title.trim() ? input.title : undefined
    const request: AskRequest = {
      status: 'open',
      ...(title && { title }),
      questions,
      answers: questions.map(() => ''),
      picks: questions.map(() => []),
      notes: '',
      isBlocking: options.isBlocking,
    }
    // The form already open, if any, takes this call's questions as a section of its own.
    let piled: AskRequest[] = []
    await update($, requests, all => {
      const added = { ...all, [id]: request }
      piled = openIds(added).map(other => added[other]!)
      return added
    })

    // Unseated (a narrow terminal), the pane waits open until /questions or a wider terminal seats it.
    const opened = await $.ui.open({ id: FORM_PANE, title: PANE_TITLE, focus: true, closeOnEscape: true, holdToasts: true, rows: cardRows(piled) })
    if (!opened.isPlaced) await edit($, id, r => ({ ...r, isUnplaced: true }))
    await refreshStatus($, WAITING_PANE)

    if (!request.isBlocking) return { result: pendingText(request, { isPiled: piled.length > 1, hasWaitTool: options.hasWaitTool }) }
    try {
      return { result: format(await waitForAnswer($, request, id, () => next.signal.aborted)) }
    } finally {
      await end($, id)
    }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${$.plugin.name}: the question form failed.` }))

  // Waits on the non-blocking requests open when it is called, polling as a blocking call does, and
  // answers with how they ended. Interrupted, it stops waiting, and what it had been handed is sent as a prompt.
  if (options.hasWaitTool) {
    on('tool.call', { tool: new RegExp(`^${WAIT_TOOL}$`) }, async ($, e, next) => {
      const { value: all = {} } = await $.state.get(requests)
      const ids = Object.keys(all).filter(id => all[id]!.status === 'open' && !all[id]!.isBlocking)
      if (ids.length === 0) return { result: 'No question form is waiting for answers.' }
      for (const id of ids) awaited.add(id)
      let isDone = false
      try {
        while (!ids.every(id => delivered.has(id) || sentLater.has(id))) {
          if (next.signal.aborted) return { result: 'Stopped waiting. The form stays open, and its answers will arrive in a message of their own.' }
          await $.process.run(['sleep', POLL_SECONDS])
        }
        isDone = true
      } finally {
        for (const id of ids) awaited.delete(id)
        if (!isDone) {
          const got = take(ids)
          if (got.length) await $.prompt.submit({ text: formatLater(got) })
        }
      }
      const got = take(ids)
      return { result: got.length ? formatLater(got) : 'The answers were already sent in a message of their own.' }
    }).catch(($, e, next) => (next.called ? next(e) : { deny: `${$.plugin.name}: waiting for the answers failed.` }))
  }

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== FORM_PANE) return next(e)
    const { value: all = {} } = await $.state.get(requests)
    const { value: notes } = await $.state.get(notesRef)
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>This question form is answered in the terminal.</Text>
    }
    const els = $.ui.resolve(e)
    const ids = openIds(all)
    if (!ids.length) {
      const { Text } = els
      const isSent = Object.values(all).some(r => r.status === 'submitted')
      return <Text dimColor>{isSent ? 'Answers sent.' : 'This question form is closed.'}</Text>
    }
    return questionCard(els, formModel(all, ids, notes), actions($, ids), e.props.bodyColumns)
  })

  // Closing the pane by hand (its close mark, or Escape) dismisses the form.
  on('ui.close', async ($, e, next) => {
    if (e.id === FORM_PANE) await settleForm($, 'cancelled', { isClosing: true })
    return next(e)
  })

  // The call's row in the transcript: the tool's short name and what it asked, never its whole input.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.tool !== TOOL) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const { isRunning, isErrored, isInterrupted } = e.props
    const bullet = isInterrupted || isErrored ? 'red' : isRunning ? undefined : 'green'
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={bullet} dimColor={!bullet}>
          ●
        </Text>
        <Text bold>{QUESTION_TOOL_NAME}</Text>
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor wrap="truncate">
            {toolRowSummary(e.props.input)}
          </Text>
        </Box>
      </Box>
    )
  })
}

/** The dim words beside the tool's name in its transcript row: the form's title or its question ids. */
export function toolRowSummary(input: unknown): string {
  const { title, questions } = (input ?? {}) as { title?: unknown; questions?: unknown }
  const list = Array.isArray(questions) ? questions : []
  const ids = list.map((q, i) => (typeof q?.id === 'string' && q.id.trim() ? q.id.trim() : `Q${i + 1}`))
  const count = `${list.length} question${list.length === 1 ? '' : 's'}`
  const what = typeof title === 'string' && title.trim() ? `${title.trim()} · ${count}` : count
  return ids.length ? `${what} (${ids.join(', ')})` : what
}

/** The open requests the form draws, oldest first. */
function openIds(all: Record<string, AskRequest>): string[] {
  return Object.keys(all).filter(id => all[id]!.status === 'open')
}

function formModel(all: Record<string, AskRequest>, ids: string[], notes: FormNotes | undefined): FormModel {
  return { requests: ids.map(id => all[id]!), notes: notes?.text ?? '', notesEnters: notes?.enters ?? 0 }
}

// The handlers a drawing of the form of requests `ids` hands its elements.
function actions($: Engine, ids: string[]): CardActions {
  const counted = (r: AskRequest, index: number) => r.questions.map((_, i) => (r.enters?.[i] ?? 0) + (i === index ? 1 : 0))
  return {
    // A single choice holds a pick or an "Other" answer, not both: typing one clears the pick.
    setAnswer: (section, index, value, entered) =>
      void edit($, ids[section]!, r => ({
        ...r,
        answers: r.answers.map((a, i) => (i === index ? value : a)),
        ...(isSingleChoice(r.questions[index]!) && value.trim() && { picks: r.picks.map((p, i) => (i === index ? [] : p)) }),
        ...(entered && { enters: counted(r, index) }),
      })),
    togglePick: (section, index, label) => void edit($, ids[section]!, r => togglePick(r, index, label)),
    setNotes: (value, entered) => void update($, notesRef, n => ({ text: value, enters: (n?.enters ?? 0) + (entered ? 1 : 0) })),
    focusAnswer: key => void $.ui.focus({ requestId: FORM_PANE, key }).catch(() => {}),
    submit: notes => void settleForm($, 'submitted', { notes }),
  }
}

async function hasTerminal($: Engine): Promise<boolean> {
  return (await $.session.surfaces()).includes('terminal')
}

/** The id a call's request is kept under. */
export function requestKey(toolUseId: string): string {
  return `${REQUEST_PREFIX}${toolUseId.replace(/[^A-Za-z0-9_-]/g, '').slice(-48)}`
}

export function parseQuestions(raw: unknown): OpenQuestion[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'questions must hold at least one question'
  const questions: OpenQuestion[] = []
  for (const [i, q] of raw.entries()) {
    const where = `question ${i + 1}`
    if (typeof q?.id !== 'string' || !q.id.trim()) return `${where}: id is required (Q1, Q2, ...)`
    const id = q.id.trim()
    if (questions.some(other => other.id === id)) return `${where}: id ${id} is used twice`
    if (typeof q.question !== 'string' || !q.question.trim()) return `${where}: question is required`
    const kind = q.kind ?? 'open'
    if (!KINDS.includes(kind)) return `${where}: kind must be open, choice or yes-no`
    if (kind !== 'open' && q.suggestions !== undefined) return `${where}: suggestions are for open questions; a choice question lists options`
    if (kind !== 'choice' && q.options !== undefined) return `${where}: options are for choice questions; set kind to "choice"`
    if (kind !== 'choice' && q.multiSelect !== undefined) return `${where}: multiSelect is for choice questions`
    if (q.multiSelect !== undefined && typeof q.multiSelect !== 'boolean') return `${where}: multiSelect must be true or false`
    const optional = (key: 'context' | 'placeholder') => (typeof q[key] === 'string' && q[key].trim() ? { [key]: q[key] as string } : {})
    const suggestions = parseSuggestions(q.suggestions)
    if (typeof suggestions === 'string') return `${where}: ${suggestions}`
    const choices = kind === 'choice' ? parseOptions(q.options) : []
    if (typeof choices === 'string') return `${where}: ${choices}`
    questions.push({
      id,
      kind,
      question: q.question,
      ...optional('context'),
      ...(kind !== 'yes-no' && optional('placeholder')),
      ...(suggestions.length && { suggestions }),
      ...(choices.length && { options: choices }),
      ...(q.multiSelect === true && { multiSelect: true as const }),
    })
  }
  return questions
}

// Kept in the agent's order: a choice's order can mean something (small, medium, large).
function parseOptions(raw: unknown): ChoiceOption[] | string {
  if (!Array.isArray(raw) || raw.length < 2) return 'a choice question needs options: two or more'
  const options: ChoiceOption[] = []
  for (const [j, o] of raw.entries()) {
    if (typeof o?.label !== 'string' || !o.label.trim()) return `option ${j + 1}: label is required`
    const label = o.label.trim()
    if (options.some(other => other.label === label)) return `option ${j + 1}: label ${label} is used twice`
    if (o.recommended !== undefined && typeof o.recommended !== 'boolean') return `option ${j + 1}: recommended must be true or false`
    const description = typeof o.description === 'string' && o.description.trim() ? o.description.trim() : undefined
    options.push({ label, ...(description && { description }), ...(o.recommended === true && { recommended: true as const }) })
  }
  if (options.filter(o => o.recommended).length > 1) return 'only one option may be recommended'
  return options
}

// The recommended suggestion moves first, so it is always listed first.
function parseSuggestions(raw: unknown): Suggestion[] | string {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return 'suggestions must be a list'
  const suggestions: Suggestion[] = []
  for (const [j, s] of raw.entries()) {
    if (typeof s?.text !== 'string' || !s.text.trim()) return `suggestion ${j + 1}: text is required`
    if (s.recommended !== undefined && typeof s.recommended !== 'boolean') return `suggestion ${j + 1}: recommended must be true or false`
    suggestions.push({ text: s.text.trim(), ...(s.recommended === true && { recommended: true as const }) })
  }
  if (suggestions.filter(s => s.recommended).length > 1) return 'only one suggestion may be recommended'
  return [...suggestions.filter(s => s.recommended), ...suggestions.filter(s => !s.recommended)]
}

function isSingleChoice(q: OpenQuestion): boolean {
  return q.kind === 'choice' && !q.multiSelect
}

/**
 * Picks or unpicks `label` on question `index`. A single choice (and a yes-no) holds one pick, and a
 * pick clears its "Other" answer; a multi-select's picks stay in the options' order.
 */
export function togglePick(request: AskRequest, index: number, label: string): AskRequest {
  const q = request.questions[index]!
  const had = request.picks[index] ?? []
  const picks = q.multiSelect
    ? (q.options ?? []).map(o => o.label).filter(l => (l === label ? !had.includes(l) : had.includes(l)))
    : had[0] === label
      ? []
      : [label]
  return {
    ...request,
    picks: request.questions.map((_, i) => (i === index ? picks : (request.picks[i] ?? []))),
    ...(isSingleChoice(q) && picks.length && { answers: request.answers.map((a, i) => (i === index ? '' : a)) }),
  }
}

/** An answer as the agent reads it, or undefined for none: a suggestion's says so, an "Other" one is labelled. */
function answerText(q: OpenQuestion, answer: string, picks: string[]): string | undefined {
  if (q.kind === 'open') return !answer ? undefined : q.suggestions?.some(s => s.text === answer) ? `${answer} (suggested)` : answer
  if (q.kind === 'yes-no') return picks[0]
  const lines = q.multiSelect ? picks.map(p => `- ${p}`) : [...picks]
  if (answer) lines.push(`Other: ${answer}`)
  return lines.length ? lines.join('\n') : undefined
}

// Changes an open form; the write redraws it.
async function edit($: Engine, id: string, change: (request: AskRequest) => AskRequest): Promise<void> {
  await update($, requests, all => {
    const request = all?.[id]
    return request && request.status === 'open' ? { ...all, [id]: change(request) } : (all ?? {})
  })
}

/**
 * Ends every open request in the form, once, as `status`, each with the notes field's text
 * (`how.notes` where Enter there submitted, else what is stored). Each blocking request's waiting call
 * reads how it ended and ends it. The non-blocking ones, whose calls have long returned, are ended
 * here: those a wait-for-answers call waits on are handed to it, and the rest sent in one prompt.
 */
async function settleForm($: Engine, status: 'submitted' | 'cancelled', how: { isClosing?: boolean; notes?: string } = {}): Promise<void> {
  const notes = how.notes ?? (await $.state.get(notesRef)).value?.text ?? ''
  let ended: [string, AskRequest][] = []
  await update($, requests, all => {
    const next = { ...all }
    ended = openIds(next).map(id => [id, { ...next[id]!, status, notes }])
    for (const [id, request] of ended) next[id] = request
    return next
  })
  if (!ended.length) return
  await update($, notesRef, () => ({ text: '', enters: 0 }))
  for (const [id, request] of ended) if (request.isBlocking && !settled.has(id)) settled.set(id, request)
  const later = ended.filter(([, request]) => !request.isBlocking)
  for (const [id] of later) await end($, id, { closePane: !how.isClosing })
  for (const [id, request] of later) if (awaited.has(id)) delivered.set(id, request)
  const prompted = later.filter(([id]) => !awaited.has(id))
  if (!prompted.length) return
  for (const [id] of prompted) sentLater.add(id)
  await $.prompt.submit({ text: formatLater(prompted.map(([, request]) => request)) })
}

/** How the requests `ids` a wait-for-answers call waited on ended, in order, taken from `delivered`. */
function take(ids: string[]): AskRequest[] {
  return ids.flatMap(id => {
    const request = delivered.get(id)
    delivered.delete(id)
    sentLater.delete(id)
    return request ? [request] : []
  })
}

async function waitForAnswer($: Engine, request: AskRequest, id: string, isAborted: () => boolean): Promise<AskRequest> {
  for (;;) {
    const ended = settled.get(id)
    if (ended) return ended
    if (isAborted()) return { ...request, status: 'cancelled' }
    await $.process.run(['sleep', POLL_SECONDS])
  }
}

/**
 * Takes an ended (or abandoned) request down: its record; the pane, once it holds no open request;
 * the notes, once no request is left; and the status line if no other form waits.
 */
async function end($: Engine, id: string, how: { closePane?: boolean } = {}): Promise<void> {
  settled.delete(id)
  let wasThere = false
  let isPaneEmpty = false
  let isLast = false
  await update($, requests, all => {
    const { [id]: gone, ...rest } = all ?? {}
    wasThere = gone !== undefined
    isPaneEmpty = openIds(rest).length === 0
    isLast = Object.keys(rest).length === 0
    return rest
  })
  if (wasThere && isPaneEmpty && how.closePane !== false) await $.ui.close({ id: FORM_PANE }).catch(() => {})
  if (isLast) await update($, notesRef, () => ({ text: '', enters: 0 }))
  await refreshStatus($)
}

/**
 * The status line while the form waits in a pane the terminal could not seat: how to reach it; or
 * nothing. `fresh` is the line for a form just opened.
 */
async function refreshStatus($: Engine, fresh?: string): Promise<void> {
  const { value: all = {} } = await $.state.get(requests)
  const open = Object.values(all).filter(r => r.status === 'open')
  const line = open.some(r => r.isUnplaced) ? WAITING_PANE : undefined
  $.ui.status(line)
  if (fresh && line === fresh) $.ui.toast(fresh)
}

/**
 * What a non-blocking call answers at once. `isPiled` where its questions joined a form already open;
 * `hasWaitTool` where wait-for-answers is there to wait with.
 */
export function pendingText({ questions }: AskRequest, how: { isPiled?: boolean; hasWaitTool?: boolean } = {}): string {
  const ids = questions.map(q => q.id).join(', ')
  const shown = how.isPiled
    ? `Questions added to the form already open (${ids}); the answers to all of its questions will arrive together, later, in a message of their own.`
    : `Form shown (${ids}); the answers will arrive later in a message of their own.`
  const until = how.hasWaitTool
    ? `Until then, do only work that does not depend on them; once none is left, call ${WAIT_TOOL} to wait for them.`
    : 'Until then, do only work that does not depend on them, or end your turn.'
  return `${shown} ${until}`
}

/** The prompt (or wait-for-answers result) the answers to non-blocking requests are sent in: one form's, or several shown together. */
export function formatLater(list: AskRequest[]): string {
  if (list.length === 1) {
    const request = list[0]!
    const which = `the question form you showed earlier${request.title ? ` ("${request.title}")` : ''} (${idList(request)})`
    if (request.status !== 'submitted') return `The user dismissed ${which} without answering. Do not act on those questions; wait for their next instruction.`
    return `Answers to ${which}:\n\n${format(request)}`
  }
  const which = `the ${list.length} question forms you showed earlier`
  if (list.every(r => r.status !== 'submitted')) return `The user dismissed ${which} without answering. Do not act on those questions; wait for their next instruction.`
  const sections = list.map((r, i) => {
    const head = `### Form ${i + 1}${r.title ? ` ("${r.title}")` : ''}: ${idList(r)}`
    if (r.status !== 'submitted') return `${head}\n\nDismissed without answers: do not act on these questions.`
    const count = r.questions.filter((_, j) => isAnswered(r, j)).length
    return `${head}\n\nThe user answered ${count} of ${r.questions.length} question${r.questions.length === 1 ? '' : 's'}:\n\n${answerBlocks(r).join('\n\n')}`
  })
  const notes = [...new Set(list.map(r => r.notes.trim()).filter(Boolean))]
  if (notes.length) sections.push(`**${NOTES_LABEL}**\n${notes.map(quote).join('\n>\n')}`)
  return `Answers to ${which}, which the user answered together in one form:\n\n${sections.join('\n\n')}\n\n${CAUTION}`
}

const CAUTION = 'Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.'

function idList(request: AskRequest): string {
  return request.questions.map(q => q.id).join(', ')
}

function quote(text: string): string {
  return text
    .split('\n')
    .map(line => `> ${line}`.trimEnd())
    .join('\n')
}

// Each answer under its question's id, quoted (every line of it), a blank one as "(no answer)".
function answerBlocks(request: AskRequest): string[] {
  return request.questions.map((q, i) => {
    const answer = answerText(q, request.answers[i]?.trim() ?? '', request.picks[i] ?? [])
    return `**${q.id}**\n${answer ? quote(answer) : '> (no answer)'}`
  })
}

// A summary line first, then each answer, then the notes if any; free text always gets the cautionary line after.
export function format(request: AskRequest): string {
  const { status, questions, notes } = request
  if (status !== 'submitted') return 'The user dismissed the questions. Do not proceed; wait for their next instruction.'
  const note = notes?.trim()
  const count = questions.filter((_, i) => isAnswered(request, i)).length
  if (count === 0 && !note) return 'The user submitted the form without answering any question.'
  const blocks = answerBlocks(request)
  if (note) blocks.push(`**${NOTES_LABEL}**\n${quote(note)}`)
  const summary = `The user answered ${count} of ${questions.length} question${questions.length === 1 ? '' : 's'}${note ? ', with notes' : ''}:`
  return `${summary}\n\n${blocks.join('\n\n')}\n\n${CAUTION}`
}
