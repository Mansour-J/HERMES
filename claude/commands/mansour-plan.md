---
description: Read a Jira ticket, investigate it, and write its plan and checklist.
argument-hint: <ticket key or link> [extra guidance]
disable-model-invocation: true
---

# Ticket

Arguments: $ARGUMENTS

The ticket's key, `KEY` below, is the first word of the arguments, in capitals. From a link, it's the key at its end (`…/browse/ABC-123` gives `ABC-123`). Anything after the first word is extra guidance from me for this run. If there are no arguments, or the first word holds no key like `ABC-123`, ask me for the ticket and wait.

Investigate `KEY` (https://{{settings.jira.site}}/browse/KEY) and write its plan and checklist. Change no code. The only files you write are the plan, the checklist, and what installing or building needs in the worktrees.

## Existing plan and checklist

Before anything else, look for an existing plan or checklist for `KEY` in:

- `{{settings.work.notes}}/plans/`
- `{{settings.work.notes}}/checklists/`
- `{{settings.work.notes}}/`

That is, a file named `KEY.md`, or whose name starts with `KEY` followed by something other than a digit (so `ABC-1230` is never taken for `ABC-123`).

If any exist, list their paths and ask me with `AskUserQuestion` (single choice) what to do:

- **Replace**: investigate again and overwrite them with the new plan and checklist. The old files stay until the new ones are written.
- **Delete**: delete them now, then investigate from scratch.
- **Keep**: leave them as they are and stop. Do not investigate.

Wait for my answer. Delete only the files you listed, and only if I chose Delete.

## Read the ticket

Read the ticket with the Atlassian tools: its summary, description, acceptance criteria, status, comments, sub-tasks, parent, linked issues, and the pages and PRs it links to (read the ones that bear on the work). If the Atlassian tools aren't connected, stop and tell me.

## Work already started

Look for work on this ticket that's already there:

- **PRs:** `gh search prs '"KEY"' --owner <owner> --json repository,number,title,state,isDraft,url`, once for each owner in the `origin` remotes of the repositories under `{{settings.work.repos}}`. Add the PRs the ticket links to.
- **Branches:** in each repository under `{{settings.work.repos}}`, `git -C <repo> branch -a --ignore-case --list '*KEY*'` (as of its last fetch). Skip names where `KEY` is followed by a digit.
- **Worktrees:** `{{settings.work.worktrees}}/KEY/`.

List what you found, one line each, or say there's none. Plan on top of it: build on that work, don't redo or contradict it.

## Repository selection

{{settings.commands.plan_note}}

Choose the repositories in scope. If my extra guidance names them, use those and don't ask. Otherwise:

1. List the git repositories under `{{settings.work.repos}}` (each immediate subdirectory that contains a `.git` folder).
2. Pick the likely ones, from the ticket, the work already started, the notes above, and a quick search of the repositories for the ticket's terms (class, table, endpoint, page or message names).
3. Ask me with one `AskUserQuestion` (`multiSelect: true`): the likely repositories as options, likeliest first, each with a one-line reason. I'll name any others under Other. If more than 4 look likely, use a second question.
4. Wait for my answer. Only the repositories I choose are in scope.

## Worktree on the latest default branch

Investigate in a git worktree of the ticket's own, never in my checkouts. They may hold other work: don't switch, pull, stash, reset or edit anything in `{{settings.work.repos}}/<repo>`. In each selected repository:

1. Run `git -C {{settings.work.repos}}/<repo> fetch origin`, then find the default branch (master or main) with `git symbolic-ref --short refs/remotes/origin/HEAD` (run `git remote set-head origin --auto` first if that fails).
2. The worktree is `{{settings.work.worktrees}}/KEY/<repo>`:
   - None yet: `git -C {{settings.work.repos}}/<repo> worktree add --detach {{settings.work.worktrees}}/KEY/<repo> origin/<default>`. If git says the path is registered but missing, run `git worktree prune` and try again.
   - Already there, detached and clean (an earlier plan): run `git switch --detach origin/<default>` in it.
   - Already there, on a branch or with uncommitted changes (implementation has started): leave it as it is and say so in one line. Investigate there, using `git diff origin/<default>` to tell what's already done from what's on the default branch.
3. List each repository's worktree path and the commit of `origin/<default>` you're investigating against (`git rev-parse --short=10 origin/<default>`), one line each. The plan records these commits.
4. Read, search and run code only in the worktrees, with absolute paths or `git -C`. A new worktree has no ignored files (`node_modules`, build output, local `.env`): install or build in it only if the investigation needs to run something.

## Data: non-production, read-only

Reading the ticket, its linked pages and GitHub is fine. This section is about the systems the code runs on. Only read their data when the investigation needs it, and then:

- **Non-production only.** Dev, test and other non-production environments, accounts, profiles, databases and endpoints. Never production. If you can't tell whether something is production, treat it as production: don't touch it, and ask me.
- **Read only.** No change of any kind: no `INSERT`, `UPDATE`, `DELETE`, `MERGE` or DDL; no `aws` create, put, update, delete, modify, start, stop or invoke calls; no `POST`, `PUT`, `PATCH` or `DELETE` requests; no deploys, messages on queues, flag or config changes; no Jira or Confluence edits, transitions or comments. Use describe, list, get and `SELECT`.
- This holds for changes you would undo afterwards, too.

## Investigation

- Back every finding with evidence: a `file:line`, a query and its result, a log line. Say which findings you couldn't verify.
- Don't fill gaps with guesses. Each assumption goes under Open questions, with what it would change.
- Find the nearest existing example of each change in the code, and follow it.
- Work out the edge cases, the dependencies (other repositories, the database, other teams' services, config, feature toggles) and what else the change could affect.
- For a bug: find the root cause, and the failing test that would show it.
- Split the work into changes that can each be a PR and merge on its own, small ones first. Shared plumbing (feature-toggle values, scope grants, config) is a change of its own, so it can merge first.

## Plan

Write `{{settings.work.notes}}/plans/KEY.md` in this shape:

```markdown
# KEY: <ticket summary>

https://{{settings.jira.site}}/browse/KEY · planned <YYYY-MM-DD> · against <repo> `<commit>`, <repo> `<commit>`

## Problem
## Acceptance criteria
## Work already started
## Root cause
## Affected repositories
## Existing patterns
## Approach
## Tests
## Validation
## Risks
## Open questions
```

- **Problem:** what's wrong or wanted, in a few sentences.
- **Acceptance criteria:** quoted from the ticket. If it has none, write the ones you'd test against, marked as yours, and ask about them under Open questions.
- **Work already started:** the PRs, branches and worktrees found, or "None."
- **Root cause:** for a bug, with `file:line`. Otherwise, what in the code has to change, and why.
- **Affected repositories:** one line each, `- <repo>: <why>`. `/mansour-implement` takes its repositories from this list.
- **Existing patterns:** the code to follow, with `file:line`.
- **Approach:** one subsection per change, numbered as in the checklist: what changes and where, and the title of its PR ({{settings.work.commit_style}}).
- **Tests:** what to add or change. For a bug, the failing test to write first: where it goes, and what it asserts.
- **Validation:** how to show it works beyond the tests, in non-production only.
- **Risks:** what could break, and for whom.
- **Open questions:** numbered, assumptions included, or "None."

## Checklist

Write `{{settings.work.notes}}/checklists/KEY.md`. The Jira panel's progress bar reads it. It counts the `- [ ]` and `- [x]` items, and treats items under a heading with words like verification, review, deploy, merge, question or follow-up as work for after the code. So keep to this shape:

```markdown
# KEY: <ticket summary>

## Implementation

### Change 1 · <repo>

- [ ] <task, naming the file or module>
- [ ] <the test that proves it>

### Change 2 · <repo>

- [ ] …

## Verification

- [ ] <each acceptance criterion, and how it's checked>
- [ ] Tests, linters and type checks pass in each repository

## Open questions

- [ ] <question>

## Follow-ups

- [ ] <work this ticket turned up but doesn't cover>
```

- Every task is a checkbox, small enough to finish in one go, in the order to do them.
- Keep Implementation's sub-headings to the change's number and repository. Other words there can make the bar count their items as after-the-code work.
- For a bug, the first item of the change that fixes it is the failing test.
- With no open questions or follow-ups, write "None." under the heading, not a checkbox.

## When you're done

Reply with the two file paths, one line on the approach, and the open questions, numbered.
