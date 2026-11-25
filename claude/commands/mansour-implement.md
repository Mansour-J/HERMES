---
description: Implement a Jira ticket from its plan and checklist, on the ticket's branch in a worktree.
argument-hint: <ticket key or link> [extra guidance]
disable-model-invocation: true
---

# Ticket

Arguments: $ARGUMENTS

The ticket's key, `KEY` below, is the first word of the arguments, in capitals. From a link, it's the key at its end (`…/browse/ABC-123` gives `ABC-123`). Anything after the first word is extra guidance from me for this run. If there are no arguments, or the first word holds no key like `ABC-123`, ask me for the ticket and wait.

Implement `KEY` (https://{{settings.jira.site}}/browse/KEY) from its plan and checklist:

- Plan: `{{settings.work.notes}}/plans/KEY.md`
- Checklist: `{{settings.work.notes}}/checklists/KEY.md` (older ones: `{{settings.work.notes}}/KEY.md`)

If either is missing, stop and tell me to run `/mansour-plan KEY` first.

## Read the ticket again

Read the ticket with the Atlassian tools, and compare it with the plan's date. Say what's newer and bears on the work (a comment, a change to the description or acceptance criteria, a new link), one line each. If it changes what to build, stop and tell me. With my OK, update the plan and checklist before changing code.

## Repositories

{{settings.commands.implement_note}}

Take the repositories from the plan's "Affected repositories", plus any that already have a worktree under `{{settings.work.worktrees}}/KEY/`. If my extra guidance names repositories, use those instead. Confirm with one `AskUserQuestion` (single choice): **Use these** (name them), or **Change** (I'll say which). Wait for my answer. Only those repositories are in scope.

If the plan names no repositories (an older plan), list the git repositories under `{{settings.work.repos}}` (each immediate subdirectory that contains a `.git` folder) and ask with `AskUserQuestion` (`multiSelect: true`), the likeliest from the plan first, each with a one-line reason.

## Worktree on the ticket's branch

Implement on the ticket's own branch, in a git worktree of the ticket's own, never in my checkouts. They may hold other work: don't switch, pull, stash, reset or edit anything in `{{settings.work.repos}}/<repo>`, unless that checkout already has this ticket's branch (step 3). In each repository:

1. Run `git -C {{settings.work.repos}}/<repo> fetch origin`, then find the default branch (master or main) with `git symbolic-ref --short refs/remotes/origin/HEAD` (run `git remote set-head origin --auto` first if that fails).
2. The ticket's branches are the ones whose name has `KEY` not followed by a digit, in any case, local or on `origin`. If there's more than one, ask me with `AskUserQuestion` which to work on, or whether to start a new one.
3. If the ticket's branch is already checked out somewhere (`git worktree list --porcelain`, the main checkout included), work there. Its uncommitted changes are this ticket's work in progress: keep them.
4. Otherwise use `{{settings.work.worktrees}}/KEY/<repo>`, the worktree `/mansour-plan` makes:
   - Already there: it must be clean. If it isn't, stop and tell me the files. Then, in it, `git switch <branch>`, or for a new branch `git switch --no-track -c <type>/KEY-<short-description> origin/<default>`.
   - None yet: `git -C {{settings.work.repos}}/<repo> worktree add <path> <branch>`, or for a new branch `git -C {{settings.work.repos}}/<repo> worktree add --no-track -b <type>/KEY-<short-description> <path> origin/<default>`. If git says the path is registered but missing, run `git worktree prune` and try again.

   Name a new branch the way the repository names its branches, if it has a convention. Keep `KEY` in it.
5. A ticket branch that's behind `origin/<default>` must be brought level first. If it has never been pushed and has no uncommitted changes, rebase it onto `origin/<default>`. Otherwise ask me whether to rebase or merge (a pushed branch needs a force-push after a rebase). Never force-push without asking.
6. Never commit to, or implement on, the default branch itself.
7. List each repository's worktree path and branch in one line, then read, edit, build and test only there, with absolute paths or `git -C`.

A new worktree has none of the ignored files a checkout builds up (`node_modules`, build output, local config such as `.env`):

- Install dependencies in it the way the repository does (its README, CI or lockfile) before building or testing.
- If the work needs an ignored local file from the main checkout, copy it and name it in one line. Never commit it.
- Its folder has the repository's name, so `docker compose` there runs the same project (containers, volumes) as the main checkout.
- Don't remove worktrees, this one or any other. I clean them up.

## Has the code moved since the plan?

The plan's header names, for each repository, the commit of the default branch it was planned against. If `origin/<default>` has moved on since, run `git log --oneline <commit>..origin/<default> -- <the files the plan names>`. If any commits touch those files, list them in one line, re-check the parts of the plan they affect, and say what changed. If the plan no longer holds, stop and tell me. Skip this for an older plan without commits.

## Data: non-production, read-only

Reading the ticket, its linked pages and GitHub is fine. Changing code in the repositories, on the ticket's branch, is the job. Changing data or infrastructure anywhere is not. Only read data when the work needs it, and then:

- **Non-production only.** Dev, test and other non-production environments, accounts, profiles, databases and endpoints. Never production. If you can't tell whether something is production, treat it as production: don't touch it, and ask me.
- **Read only.** No change of any kind: no `INSERT`, `UPDATE`, `DELETE`, `MERGE` or DDL; no `aws` create, put, update, delete, modify, start, stop or invoke calls; no `POST`, `PUT`, `PATCH` or `DELETE` requests; no deploys, messages on queues, flag or config changes; no Jira or Confluence edits, transitions or comments. Use describe, list, get and `SELECT`.
- This holds for changes you would undo afterwards, too.
- Tests may write to databases and services they start themselves locally (containers, in-memory); never to a shared environment.

## Instructions

Before making changes:

- Read and understand both the plan and the checklist.
- Use any relevant Claude Code skills for the technologies and tasks involved.
- Follow the existing architecture, coding style, conventions, and established patterns in the codebase, starting with the ones the plan names.
- Do **not** make assumptions. If required information is unavailable or ambiguous, ask for clarification instead of guessing.
- Prefer minimal, focused changes that satisfy the requirements.
- Reuse existing implementations where appropriate rather than introducing new patterns.

### Outstanding questions

If the plan's or checklist's Open questions have unanswered items, or you find unresolved assumptions, TODOs needing clarification, or blockers:

1. Stop implementation.
2. Present **all** outstanding questions as a numbered list.
3. Wait for my response before making any implementation changes.
4. After I answer:
   - record the decisions in the plan, under the questions they answer
   - tick the questions in the checklist, each with its answer
5. Continue implementation using the updated plan and checklist.

### Bug fixes (TDD)

If the work involves fixing a bug:

1. First reproduce the bug by writing or updating a failing automated test that demonstrates the issue (the plan's Tests section says which).
2. Explain the root cause and your findings.
3. Stop and ask me to validate the failing test.
4. Wait until I confirm (for example, by saying **"proceed with the fix"**) before implementing the code change.
5. After approval, implement the fix.
6. Verify that the previously failing test now passes and that no regressions have been introduced.

### Implementation

1. Implement according to the plan, one change at a time, in the checklist's order.
2. Continue through the checklist until either:
   - all checklist items are complete, or
   - you encounter a new blocker.

### Validation

- Verify that the implementation satisfies the plan's acceptance criteria.
- Run all relevant tests, linters, type checks, and validation commands where applicable.
- Fix any issues introduced by your changes.
- Ensure the solution integrates cleanly with the existing codebase.

### Review your own diff

Before the summary, read each repository's whole change since its branch started: `git -C <worktree> diff $(git -C <worktree> merge-base origin/<default> HEAD)`, and `git -C <worktree> status --short` for new files. Fix what you find:

- debugging leftovers: prints, extra logging, commented-out code, focused or skipped tests
- changes the ticket doesn't need: unrelated edits, reformatting, renames
- files that must never be committed: copied local files such as `.env`, build output, anything holding a secret or token
- a TODO without a checklist item

### Checklist

Update the checklist, keeping the shape `/mansour-plan` wrote it in (checkboxes; Implementation, Verification, Open questions, Follow-ups):

- tick what's done
- add tasks found along the way under their change, and work outside the ticket under Follow-ups
- record the answers to open questions
- note a blocker as a plain line, `Blocked: <why>`, under its change

### Constraints

- Do **not** create a commit, push, or open a pull request **unless I explicitly ask**.
  When I do ask, follow my pull request rules (`~/.claude/CLAUDE.md`).
- Do **not** leave the repository in a failing state.

### Final summary

- what was implemented, with each repository's worktree path and branch
- validation performed and results
- checklist items done, and what's left
- blockers, risks and follow-ups, if any
