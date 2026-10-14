import type { Register } from 'claude-code'

import {
  formOptions,
  QUESTION_TOOL_NAME,
  QUESTION_TOOL_SCHEMA,
  QUESTIONS_COMMAND,
  questionToolDescription,
  registerQuestionForm,
  WAIT_TOOL_DESCRIPTION,
  WAIT_TOOL_NAME,
  WAIT_TOOL_SCHEMA,
} from './question-form'

// The ask-user-question tool and its form (question-form.tsx), and, where calls do not wait for the
// form, the wait-for-answers tool. `options` are the manifest's userConfig values; a change of them
// reloads the module.
export const register: Register = (on, options) => {
  const form = formOptions(options)
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: QUESTION_TOOL_NAME, description: questionToolDescription(form), inputSchema: QUESTION_TOOL_SCHEMA, isDeferred: false })
    if (form.hasWaitTool) await $.tool.register({ name: WAIT_TOOL_NAME, description: WAIT_TOOL_DESCRIPTION, inputSchema: WAIT_TOOL_SCHEMA, isDeferred: false })
    await $.command.register({ name: QUESTIONS_COMMAND, description: 'Open the question form Claude is waiting on' })
    return next(e)
  })

  registerQuestionForm(on, form)
}
