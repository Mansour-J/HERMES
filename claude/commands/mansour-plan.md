Investigate and prepare a fix for ticket https://{{settings.jira.site}}/browse/**$ARGUMENTS**

## Repository selection

Before investigating, choose which repositories are in scope:

1. List the available repositories by enumerating the git repositories under `{{settings.work.repos}}` (each immediate subdirectory that contains a `.git` folder).
2. Present them to me as a **multi-select** list using the `AskUserQuestion` tool so I can pick one or more. If there are more repositories than a single multi-select question allows, split them across multiple questions (all with `multiSelect: true`).
3. Wait for my selection. Treat only the repositories I select as in scope for this investigation.
4. Do not begin investigating until I have made a selection.

{{settings.commands.plan_note}}

## Instructions

- Investigate the requirements for **$ARGUMENTS**.
- Determine which of the selected repositories are affected.
- Do not make assumptions.
- Do not commit any code.
- Check for existing patterns before proposing changes.
- Validate all findings before implementing changes.
- Document dependencies, edge cases, and potential impacts.

## Deliverables

Create:

- `{{settings.work.notes}}/plans/$ARGUMENTS.md`
- `{{settings.work.notes}}/checklists/$ARGUMENTS.md`

The plan should include:
- Problem summary
- Root cause analysis
- Affected repositories
- Existing patterns
- Implementation approach
- Validation strategy
- Risks and open questions

The checklist should contain actionable implementation tasks.

Also make sure to change the name of the existing claude session to the ticket name: $ARGUMENTS
## Pull requests

When raising a PR (any repo) - **including PRs raised outside this skill**, e.g. an ad-hoc
"raise a PR for X" request, a CI fix, or a dependency bump:

- Create it as a **draft** unless I explicitly ask for a ready-for-review PR.
- **No PR body. Draft or non-draft, no exceptions.** Pass `--body ""` to `gh pr create`. Do not
  fill in the repo's pull request template, and do not substitute a "short" body. This holds even
  when the change looks like it needs explaining - a CI break, a security pin, a subtle fix, a
  non-obvious root cause. It does not need explaining in the PR.
- **No PR comments.** Do not post review comments, summary comments, or follow-up comments on the PR.
- The title carries the whole message: follow {{settings.work.commit_style}}.
- Let the code speak for itself. Context belongs in the plan and checklist under
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
