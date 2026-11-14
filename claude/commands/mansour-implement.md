---
description: Implement the fix, continue the implementation checklist, and update the checklist for a ticket.
argument-hint: <ticket-id>
---

# Ticket

{{arguments1}}

The implementation plan is located at:

- `{{settings.work.notes}}/plans/{{arguments1}}.md`

The implementation checklist is located at:

- `{{settings.work.notes}}/{{arguments1}}.md`

## Repository selection

Before implementing, choose which repositories are in scope:

1. List the available repositories by enumerating the git repositories under `{{settings.work.repos}}` (each immediate subdirectory that contains a `.git` folder).
2. Present them to me as a **multi-select** list using the `AskUserQuestion` tool so I can pick one or more. If there are more repositories than a single multi-select question allows, split them across multiple questions (all with `multiSelect: true`).
3. Wait for my selection. Treat only the repositories I select as in scope for this implementation.
4. Do not begin implementing until I have made a selection.

{{settings.commands.implement_note}}

## Instructions

Before making changes:

- Read and understand both the implementation plan and checklist.
- Use any relevant Claude Code skills for the technologies and tasks involved.
- Follow the existing architecture, coding style, conventions, and established patterns in the codebase.
- Do **not** make assumptions. If required information is unavailable or ambiguous, ask for clarification instead of guessing.
- Prefer minimal, focused changes that satisfy the requirements.
- Reuse existing implementations where appropriate rather than introducing new patterns.

### Outstanding questions

If the implementation plan or checklist contains unresolved questions, assumptions, TODOs requiring clarification, or blockers:

1. Stop implementation.
2. Present **all** outstanding questions as a numbered list.
3. Wait for my response before making any implementation changes.
4. After I answer:
   - update the implementation plan with the decisions and resolved assumptions
   - update the checklist to record the resolved questions
   - remove or mark the outstanding questions as resolved
5. Continue implementation using the updated plan and checklist.

### Bug fixes (TDD)

If the work involves fixing a bug:

1. First reproduce the bug by writing or updating a failing automated test that demonstrates the issue.
2. Explain the root cause and your findings.
3. Stop and ask me to validate the failing test.
4. Wait until I confirm (for example, by saying **"proceed with the fix"**) before implementing the code change.
5. After approval, implement the fix.
6. Verify that the previously failing test now passes and that no regressions have been introduced.

### Implementation

1. Implement the required fix according to the implementation plan.
2. Continue working through the remaining checklist items in priority order until either:
   - all checklist items are complete, or
   - you encounter a new blocker.

### Validation

- Verify that the implementation satisfies the acceptance criteria.
- Run all relevant tests, linters, type checks, and validation commands where applicable.
- Fix any issues introduced by your changes.
- Ensure the solution integrates cleanly with the existing codebase.

### Checklist

Update the checklist to reflect:

- completed items
- newly completed work
- remaining work
- resolved questions
- newly discovered follow-up tasks
- blockers and recommended next steps (if any)

### Constraints

- Do **not** create a commit, push, or open a pull request **unless I explicitly ask**.
  When I do ask, follow the Pull requests section below.
- Do **not** leave the repository in a failing state.

### Final summary

Provide a summary including:

- what was implemented
- validation performed and results
- checklist items completed
- remaining work
- blockers (if any)
- risks or follow-up recommendations
- make sure to change the name of the existing claude session to the ticket name: $ARGUMENTS
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
