import type { Elements } from 'claude-code'

import type { AskRequest, OpenQuestion, Suggestion } from '../types'

// The question form, drawn in a terminal pane: every question at once, a rule between them, a notes
// field, and one Submit. An open question has a framed answer field; a choice question its options,
// then an "Other" field; a yes-no question a Yes and a No.
// The form itself has no border or padding: the pane draws its own frame.
//
// Each call's questions are a section of the form: while a form is open, a later call's questions
// are added to it as a section of their own, under its title, and one Submit answers them all.

export type CardActions = {
  /** Sets question `index` of section `section`; `entered` when Enter set it, which counts toward the field's key. */
  setAnswer: (section: number, index: number, value: string, entered?: boolean) => void
  /** Picks option `label` of question `index` in section `section`, or unpicks it if picked. */
  togglePick: (section: number, index: number, label: string) => void
  /** Sets the "Other comments or notes" field, as `setAnswer` does. */
  setNotes: (value: string, entered?: boolean) => void
  /** Moves the focus ring to the field drawn under `key`. */
  focusAnswer: (key: string) => void
  /** Submits every section; `notes` is the notes field's text where Enter there submits. */
  submit: (notes?: string) => void
}

/** What the form draws: the open calls' requests, oldest first, and the notes field they share. */
export type FormModel = { requests: AskRequest[]; notes: string; notesEnters: number }

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Input' | 'Markdown'>

/** A section of the form: its request, its place, and the prefix of every key drawn in it. */
type At = { request: AskRequest; section: number; p: string }

export const NOTES_LABEL = 'Other comments or notes'

const YES_NO = ['Yes', 'No'] as const

/** The rule drawn between questions, and before the notes field. */
const RULE = '─'
/** The rule drawn between sections. */
const SECTION_RULE = '═'

export function questionCard(els: Els, form: FormModel, act: CardActions, columns: number) {
  const { Box, Text, Button } = els
  const { requests } = form
  const isPiled = requests.length > 1
  const total = requests.reduce((sum, r) => sum + r.questions.length, 0)
  const answered = requests.reduce((sum, r) => sum + r.questions.filter((_, i) => isAnswered(r, i)).length, 0)
  const title = (!isPiled && requests[0]?.title) || (total > 1 ? 'Claude has questions' : 'Claude has a question')
  const rule = (key: string, mark = RULE) => (
    <Text key={key} dimColor wrap="truncate">
      {mark.repeat(Math.max(1, columns))}
    </Text>
  )
  return (
    <Box key="card" flexDirection="column" gap={1}>
      <Box key="title-row" flexDirection="row" gap={2}>
        <Box key="title" flexGrow={1} flexShrink={1}>
          <Text bold wrap="truncate">
            {title}
          </Text>
        </Box>
        {total > 1 && <Text dimColor>{`${answered} of ${total} answered`}</Text>}
      </Box>
      {requests.flatMap((request, section) => {
        const at = atSection(form, section)
        return [
          ...(section > 0 ? [rule(`section-rule-${section}`, SECTION_RULE)] : []),
          ...(isPiled ? [sectionHead(els, at)] : []),
          ...request.questions.flatMap((_, i) => [
            ...(i > 0 ? [rule(`${at.p}rule-${i}`)] : []),
            questionBlock(els, at, act, i, {
              autoFocus: section === 0 && i === 0,
              onEnter: () => act.focusAnswer(nextKey(form, section, i)),
              enterLabel: 'next',
            }),
          ]),
        ]
      })}
      {rule('rule-notes')}
      {notesBlock(els, form, act)}
      <Box key="form-footer" flexDirection="row" justifyContent="center" gap={2}>
        <Button key="submit" label="Submit answers" variant="primary" onPress={() => act.submit()} />
      </Box>
    </Box>
  )
}

/** A section's heading, drawn only where the form holds several: its call's title, or its place. */
function sectionHead(els: Els, at: At) {
  const { Box, Text } = els
  return (
    <Box key={`${at.p}section-head`} flexDirection="row" gap={2}>
      <Text bold color="magenta" wrap="truncate">
        {at.request.title ?? `Questions ${at.section + 1}`}
      </Text>
    </Box>
  )
}

/** About how many terminal rows the form takes, for the pane's `rows` when it is seated inline above the prompt. */
export function cardRows(requests: AskRequest[], columns = 80): number {
  const lines = (text: string) => text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(20, columns))), 0)
  const field = 3
  const answerRows = (q: OpenQuestion) =>
    q.kind === 'yes-no'
      ? 1
      : q.kind === 'choice'
        ? (q.options ?? []).reduce((sum, o) => sum + 1 + (o.description ? lines(o.description) : 0), 0) + (q.multiSelect ? 1 : 0) + field
        : field + (q.suggestions?.length ?? 0)
  const blockRows = (q: OpenQuestion) => lines(`${q.id}  ${q.question}`) + (q.context ? lines(q.context) : 0) + answerRows(q) + (q.suggestions?.length ? 2 : 1)
  const questions = requests.flatMap(r => r.questions)
  const blocks = questions.reduce((sum, q) => sum + blockRows(q), 0)
  // Several sections: each one's heading, and a rule before each after the first, with the gaps after them.
  const sections = requests.length > 1 ? requests.length * 2 + (requests.length - 1) * 2 : 0
  // The title, each rule (one between questions, one before the notes) and the gaps around them, the notes, Submit.
  return 1 + 1 + blocks + questions.length * 2 + sections + (1 + field) + 1 + 1
}

type BlockOptions = { autoFocus: boolean; onEnter: () => void; enterLabel: string }

/** Whether question `index` has an answer: text, or a pick. */
export function isAnswered(request: AskRequest, index: number): boolean {
  return Boolean(request.answers[index]?.trim()) || (request.picks[index]?.length ?? 0) > 0
}

/** One question: its id and text, its long-form context, then how it is answered. */
function questionBlock(els: Els, at: At, act: CardActions, index: number, options: BlockOptions) {
  const { Box, Text, Markdown } = els
  const q = at.request.questions[index]!
  const k = `${at.p}question-${index}`
  return (
    <Box key={k} flexDirection="column" gap={1}>
      <Box key={`${k}-text`} flexDirection="column" gap={1}>
        <Box key={`${k}-head`} flexDirection="row" gap={2}>
          <Text color="cyan" bold>
            {q.id}
          </Text>
          <Box key={`${k}-question`} flexGrow={1} flexShrink={1}>
            <Text bold>{q.question}</Text>
          </Box>
        </Box>
        {q.context && <Markdown key={`${k}-context`} text={q.context} />}
      </Box>
      {q.kind === 'yes-no' ? yesNo(els, at, act, index, options) : q.kind === 'choice' ? choiceList(els, at, act, index, options) : openAnswer(els, at, act, index, options)}
    </Box>
  )
}

/** An open question's framed answer field, and its suggestions. */
function openAnswer(els: Els, at: At, act: CardActions, index: number, options: BlockOptions) {
  const { Box } = els
  const q = at.request.questions[index]!
  const answer = at.request.answers[index] ?? ''
  return (
    <Box key={`${at.p}question-${index}-answer`} flexDirection="column">
      {textField(els, at, act, index, options, q.placeholder ?? 'Type your answer…')}
      {q.suggestions && suggestionList(els, at, q.suggestions, index, answer, act)}
    </Box>
  )
}

/** The field that holds question `index`'s text; Enter there moves on. */
function textField(els: Els, at: At, act: CardActions, index: number, options: BlockOptions, placeholder: string) {
  return field(els, {
    key: fieldKey(at, index),
    placeholder,
    value: at.request.answers[index] ?? '',
    submitLabel: options.enterLabel,
    autoFocus: options.autoFocus,
    onInput: value => act.setAnswer(at.section, index, value),
    onSubmit: value => {
      act.setAnswer(at.section, index, value, true)
      options.onEnter()
    },
  })
}

/**
 * A choice question's options, each a button that picks it (radio marks, or check marks for a
 * multi-select), its description dim beneath, then the "Other" field. A single pick moves on, and
 * while it holds the "Other" field is hidden and the options not picked are drawn dim; unpicking it
 * brings the field back.
 */
function choiceList(els: Els, at: At, act: CardActions, index: number, options: BlockOptions) {
  const { Box, Text, Button } = els
  const q = at.request.questions[index]!
  const picks = at.request.picks[index] ?? []
  const isSettled = !q.multiSelect && picks.length > 0
  return (
    <Box key={`${at.p}question-${index}-answer`} flexDirection="column">
      {q.multiSelect && (
        <Text key={`${at.p}choice-${index}-hint`} dimColor>
          Pick any that apply.
        </Text>
      )}
      {(q.options ?? []).map((o, j) => {
        const isPicked = picks.includes(o.label)
        const mark = q.multiSelect ? (isPicked ? '[x]' : '[ ]') : isPicked ? '(•)' : '( )'
        const label = `${mark} ${letter(j)}. ${o.label}${o.recommended ? ' (recommended)' : ''}`
        const isDim = isSettled && !isPicked
        return (
          <Box key={`${at.p}choice-row-${index}-${j}`} flexDirection="column">
            <Button
              key={choiceKey(at, index, j)}
              plain
              {...(options.autoFocus && j === 0 ? { autoFocus: true as const } : {})}
              onPress={() => {
                act.togglePick(at.section, index, o.label)
                if (!q.multiSelect && !isPicked) options.onEnter()
              }}
            >
              <Text dimColor={isDim}>{label}</Text>
            </Button>
            {o.description && (
              <Box key={`${at.p}choice-desc-${index}-${j}`} paddingLeft={7}>
                <Text dimColor>{o.description}</Text>
              </Box>
            )}
          </Box>
        )
      })}
      {!isSettled && textField(els, at, act, index, { ...options, autoFocus: false }, q.placeholder ?? 'Other: type an answer of your own…')}
    </Box>
  )
}

/** A yes-no question's Yes and No: the picked one drawn as the primary button. A pick moves on. */
function yesNo(els: Els, at: At, act: CardActions, index: number, options: BlockOptions) {
  const { Box, Button } = els
  const pick = at.request.picks[index]?.[0]
  return (
    <Box key={`${at.p}question-${index}-answer`} flexDirection="row" gap={2}>
      {YES_NO.map((label, j) => (
        <Button
          key={yesNoKey(at, index, label)}
          label={pick === label ? `${label} ✓` : label}
          {...(pick === label ? { variant: 'primary' as const } : {})}
          {...(options.autoFocus && j === 0 ? { autoFocus: true as const } : {})}
          onPress={() => {
            act.togglePick(at.section, index, label)
            if (pick !== label) options.onEnter()
          }}
        />
      ))}
    </Box>
  )
}

/** The "Other comments or notes" field, last: Enter there submits the form. */
function notesBlock(els: Els, form: FormModel, act: CardActions) {
  const { Box, Text } = els
  return (
    <Box key="notes" flexDirection="column" gap={1}>
      <Text key="notes-label" bold>
        {NOTES_LABEL}
      </Text>
      {field(els, {
        key: notesKey(form),
        placeholder: 'Optional: anything else Claude should know…',
        value: form.notes,
        submitLabel: 'submit',
        autoFocus: false,
        onInput: value => act.setNotes(value),
        onSubmit: value => {
          act.setNotes(value, true)
          act.submit(value)
        },
      })}
    </Box>
  )
}

type FieldOptions = {
  key: string
  placeholder: string
  value: string
  submitLabel: string
  autoFocus: boolean
  onInput: (value: string) => void
  onSubmit: (value: string) => void
}

/** A text field in a rounded frame, so it reads as the place to type. */
function field(els: Els, o: FieldOptions) {
  const { Box, Input } = els
  return (
    <Box key={`${o.key}-frame`} borderStyle="round" borderDimColor flexDirection="column">
      <Input
        key={o.key}
        placeholder={o.placeholder}
        value={o.value}
        submitLabel={o.submitLabel}
        {...(o.autoFocus ? { autoFocus: true as const } : {})}
        onInput={value => o.onInput(value)}
        onSubmit={value => o.onSubmit(value)}
      />
    </Box>
  )
}

/**
 * The agent's suggestions as a lettered list under the field: while the field is empty each letter is
 * a button that fills the field, which stays editable. Once the field holds text the list stays, so
 * what the agent suggested is still in sight, but each button is drawn as dim text in its place, as if
 * disabled, until the field is emptied again; the suggestion the field holds is marked.
 */
function suggestionList(els: Els, at: At, suggestions: Suggestion[], index: number, answer: string, act: CardActions) {
  const { Box, Text, Button } = els
  const isTyped = answer.trim() !== ''
  return (
    <Box key={`${at.p}suggestions-${index}`} flexDirection="column">
      {suggestions.map((s, j) => {
        const isChosen = s.text === answer.trim()
        const text = `${s.text}${s.recommended ? ' (recommended)' : ''}${isChosen ? ' ✓' : ''}`
        const k = `${at.p}suggest-${index}-${j}`
        return (
          <Box key={`${at.p}suggestion-${index}-${j}`} flexDirection="row" gap={1}>
            {isTyped ? (
              <Text key={`${k}-off`} dimColor>{`[ ${letter(j)} ]`}</Text>
            ) : (
              <Button key={k} label={letter(j)} onPress={() => act.setAnswer(at.section, index, s.text)} />
            )}
            <Text dimColor={isTyped && !isChosen}>{text}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

/** Section `section` of the form. The first section's keys have no prefix; each later one's start `s<n>-`. */
function atSection(form: FormModel, section: number): At {
  return { request: form.requests[section]!, section, p: section === 0 ? '' : `s${section}-` }
}

/**
 * The key a question's field is drawn under. The terminal empties a field after Enter and keeps it
 * empty while it is drawn with the same key and value, so each Enter draws the field anew under a new key.
 */
function fieldKey(at: At, index: number): string {
  const enters = at.request.enters?.[index] ?? 0
  return `${at.p}answer-${index}${enters ? `.${enters}` : ''}`
}

/** The key the notes field is drawn under, as `fieldKey`. */
function notesKey(form: FormModel): string {
  return form.notesEnters ? `notes-field.${form.notesEnters}` : 'notes-field'
}

/** The key of the control after question `index` of section `section`: the next question's first, or the notes field. */
function nextKey(form: FormModel, section: number, index: number): string {
  const at = atSection(form, section)
  if (index + 1 < at.request.questions.length) return firstKey(at, index + 1)
  if (section + 1 < form.requests.length) return firstKey(atSection(form, section + 1), 0)
  return notesKey(form)
}

/** The key of question `index`'s first control, where the focus moves to it. */
function firstKey(at: At, index: number): string {
  const q = at.request.questions[index]!
  if (q.kind === 'yes-no') return yesNoKey(at, index, 'Yes')
  if (q.kind === 'choice') return choiceKey(at, index, 0)
  return fieldKey(at, index)
}

function choiceKey(at: At, index: number, j: number): string {
  return `${at.p}choice-${index}-${j}`
}

function yesNoKey(at: At, index: number, label: string): string {
  return `${at.p}${label.toLowerCase()}-${index}`
}

/** A, B, ... Z, then AA, AB, ... */
function letter(j: number): string {
  return (j >= 26 ? letter(Math.floor(j / 26) - 1) : '') + String.fromCharCode(65 + (j % 26))
}
