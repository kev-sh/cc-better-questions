# cc-better-questions

## Install

In Claude Code, run:

```
/plugin install cc-better-questions --marketplace kev-sh/cc-better-questions
```

Or from a shell:

```sh
claude plugin install cc-better-questions --marketplace kev-sh/cc-better-questions
```

## Settings

Change these in `/config`, or in `settings.json`:

```json
{
  "pluginConfigs": {
    "cc-better-questions": {
      "options": {
        "blocking": true,
        "disableWaitForAnswers": false,
        "disableAskUserQuestion": true
      }
    }
  }
}
```

| Setting | Default | What it does |
| --- | --- | --- |
| `blocking` | `true` | `true`: Claude waits for your answers. `false`: Claude keeps working and gets your answers when you submit or close the form. Questions Claude asks while the form is open are added to it, and you answer them all with one Submit. |
| `disableWaitForAnswers` | `false` | Only when `blocking` is `false`. `false`: once Claude has nothing else to do, it can wait for your answers before it ends its turn. `true`: it ends its turn instead, and gets your answers in a message when you submit. |
| `disableAskUserQuestion` | `true` | Turns off the built-in AskUserQuestion tool, so every question uses this form. It stays on when no terminal is attached, since the form can't be answered there. |
