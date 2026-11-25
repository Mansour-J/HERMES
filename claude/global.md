<!-- ~/.claude/CLAUDE.md is made by link.sh from claude/global.md in herder-customizations. Edit it there, then run ./link.sh. -->

## Pull requests

When raising a PR in any repository, however it was asked for (the ticket commands, an ad-hoc
"raise a PR for X", a CI fix, a dependency bump):

- Create it as a **draft** unless I explicitly ask for a ready-for-review PR.
- **No PR body. Draft or non-draft, no exceptions.** Pass `--body ""` to `gh pr create`. Do not
  fill in the repo's pull request template, and do not substitute a "short" body. This holds even
  when the change looks like it needs explaining - a CI break, a security pin, a subtle fix, a
  non-obvious root cause. It does not need explaining in the PR.
- **No PR comments.** Do not post review comments, summary comments, or follow-up comments on the PR.
- The title carries the whole message. In the repositories under `{{settings.work.repos}}`, follow
  {{settings.work.commit_style}}.
- Let the code speak for itself. A ticket's context belongs in its plan and checklist under
  `{{settings.work.notes}}/`, not in the PR.
- Keep the commit message short too - a one-line conventional-commit subject is usually enough.
- Prefer several small PRs that can merge independently over one large one. Split shared
  plumbing (feature-toggle enum values, scope grants, config) into its own PR so it can merge first.
- `gh pr edit` can fail on repos with GitHub Projects (classic) enabled. If it errors with a
  GraphQL `projectCards` deprecation message, the edit did **not** apply - verify with
  `gh api repos/<owner>/<repo>/pulls/<n> --jq .body` and patch via
  `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> --input <file.json>` instead.
- GitHub cannot delete a PR. If asked to delete/recreate one, close it and open a new one from the
  same branch, and say plainly that it was closed rather than deleted.

## Be non-verbose, always

This applies to everything, not just PRs: PR titles and bodies, commit messages, chat replies,
checklists, and plan updates.

- Answer with the result. Skip the preamble, the restatement of what I asked, and the recap of what
  you just did when it is already visible in the diff or the tool output.
- No summary tables, no "What was breaking / The change / Why this is safe" section headers, no
  bulleted victory laps at the end of a task.
- Evidence over narration: a version number, a file path, a run ID, a one-line verdict. If I want
  the reasoning I will ask for it.
- Commit messages: a one-line conventional-commit subject is usually enough. Add a body only when
  the *why* genuinely cannot be inferred, and keep it to a couple of lines.
- Prefer a few sentences over a few paragraphs. If a reply is getting long, that is the signal to
  cut it, not to add headings.
