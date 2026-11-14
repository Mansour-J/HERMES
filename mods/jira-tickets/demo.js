// Made-up tickets for screenshots (layout prop `demo: true`), in the shapes the column keeps:
// tickets by group, and each ticket's plan, checklist and PRs. Nothing here is fetched or saved.

const at = (minutesAgo) => Date.now() - minutesAgo * 60000;
const browse = (key) => `https://olympus.atlassian.net/browse/${key}`;
const ticket = (key, summary, type, status, category, parent, updated, priority = "Medium") => ({
  key,
  url: browse(key),
  summary,
  status,
  category,
  type,
  priority,
  parent,
  updated: at(updated),
});

export const DEMO_GROUPS = {
  sprint: [
    ticket("OLY-142", "Add idempotency keys to payment webhooks", "Story", "In Progress", "indeterminate", "Payments reliability", 8, "High"),
    ticket("OLY-131", "Retry failed settlement exports", "Bug", "In Review", "indeterminate", "Payments reliability", 50, "High"),
    ticket("OLY-150", "Dark mode for the dashboard", "Story", "In Progress", "indeterminate", "Customer dashboard", 95),
  ],
  added: [ticket("OLY-160", "Export statements as CSV", "Story", "To Do", "new", "Customer dashboard", 240)],
  next: [ticket("OLY-171", "Rate-limit the public API", "Task", "To Do", "new", "Platform hardening", 900)],
  backlog: [
    ticket("OLY-118", "Tighten S3 bucket policies", "Task", "Done", "done", "Platform hardening", 600),
    ticket("OLY-99", "Flaky login redirect on Safari", "Bug", "Blocked", "new", null, 3000, "Low"),
  ],
};
export const DEMO_ADDED = ["OLY-160"];

const notes = (key, plan, checklist, done = 0, open = 0, work = 0) => ({
  plans: plan ? [`/demo/${key}-plan.md`] : [],
  checklists: checklist ? [`/demo/${key}-checklist.md`] : [],
  done,
  open,
  work,
});
const ghPr = (repo, number, state, ci, draft = false) => ({ repo, number, state, ci, draft, url: `https://github.com/${repo}/pull/${number}` });

export const DEMO_PROGRESS = {
  "OLY-142": { notes: notes("OLY-142", true, true, 9, 1, 0), prs: [ghPr("olympus/ledger-api", 482, "OPEN", "PENDING")] },
  "OLY-131": { notes: notes("OLY-131", true, true, 4, 3, 2), prs: [ghPr("olympus/ledger-api", 479, "OPEN", "FAILURE", true)] },
  "OLY-150": { notes: notes("OLY-150", true, true, 3, 4, 3), prs: [] },
  "OLY-160": { notes: notes("OLY-160", false, false), prs: [] },
  "OLY-171": { notes: notes("OLY-171", true, false), prs: [] },
  "OLY-118": { notes: notes("OLY-118", true, true, 6, 0, 0), prs: [ghPr("olympus/infra", 88, "MERGED", "SUCCESS")] },
  "OLY-99": { notes: notes("OLY-99", false, false), prs: [] },
};

// Which tickets show open in the screenshots.
export const DEMO_OPEN = ["OLY-142", "OLY-131"];
export const DEMO_FETCHED_AT = at(12);
