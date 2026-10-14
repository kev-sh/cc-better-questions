/** A likely answer the agent offers, listed under the field. */
export type Suggestion = {
  text: string
  /** The agent's pick; at most one per question, and listed first. */
  recommended?: true
}

/** One of a choice question's fixed options. */
export type ChoiceOption = {
  label: string
  /** A short line drawn dim under the label. */
  description?: string
  /** The agent's pick; at most one per question. */
  recommended?: true
}

/**
 * How a question is answered: `open`, free text (the default and the preferred kind); `choice`, a pick
 * among fixed options (several with `multiSelect`), with an "Other" field for an answer outside them;
 * `yes-no`, Yes or No.
 */
export type QuestionKind = 'open' | 'choice' | 'yes-no'

export type OpenQuestion = {
  /** The agent's short id for the question (`Q1`): drawn beside it, and naming its answer in the result. */
  id: string
  kind: QuestionKind
  /** The question itself. */
  question: string
  /** Long-form context, markdown: background, clarifications, tradeoffs. */
  context?: string
  /** The text field's example answer: an open question's field, or a choice question's "Other" field. */
  placeholder?: string
  /** An open question's likely answers. */
  suggestions?: Suggestion[]
  /** A choice question's options, in the agent's order. */
  options?: ChoiceOption[]
  /** A choice question that takes several options. */
  multiSelect?: true
}

export type AskRequest = {
  status: 'open' | 'submitted' | 'cancelled'
  title?: string
  questions: OpenQuestion[]
  /** Each question's text: an open question's answer, a choice question's "Other" field; unused for yes-no. */
  answers: string[]
  /** Each question's picked options, by label (`Yes` or `No` for yes-no); empty for an open question. */
  picks: string[][]
  /** The "Other comments or notes" field the form shares (FormNotes), copied in when the form ends. */
  notes: string
  /** True while the tool call waits for the form; false, the answers are sent as a prompt once it ends. */
  isBlocking: boolean
  /** True when the pane could not be seated when the call opened it: the status line says to type /questions. */
  isUnplaced?: true
  /**
   * How many times Enter was pressed in each question's field, by index. The terminal empties a field
   * after Enter until it is drawn under a new key, so the count is part of the field's key.
   */
  enters?: number[]
}

/**
 * The "Other comments or notes" field: one for the whole form, however many calls' questions it holds.
 * `enters` counts Enter presses in it, as AskRequest's `enters` does.
 */
export type FormNotes = { text: string; enters: number }

declare module 'claude-code' {
  interface PluginState {
    'cc-better-questions': {
      requests: Record<string, AskRequest>
      notes: FormNotes
    }
  }
}
