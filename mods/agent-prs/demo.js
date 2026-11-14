// Made-up PRs for screenshots (layout prop `demo: true`): GitHub-shaped, so they go
// through the same shaping as real ones. Nothing here is fetched or saved.

const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();

// One check run: its workflow (the stage), and where it stands.
function run(workflow, name, state, startedMin, tookMin) {
  const done = state === "pass" || state === "fail";
  return {
    __typename: "CheckRun",
    name,
    status: done ? "COMPLETED" : state === "running" ? "IN_PROGRESS" : "QUEUED",
    conclusion: state === "pass" ? "SUCCESS" : state === "fail" ? "FAILURE" : null,
    startedAt: state === "queued" ? null : at(startedMin),
    completedAt: done ? at(startedMin - tookMin) : null,
    detailsUrl: "https://github.com/olympus",
    checkSuite: { workflowRun: { workflow: { name: workflow } } },
  };
}

function pr(repo, number, title, branch, { draft = false, checks = [], approvals = 0, rejections = 0, comments = 0, threads = 0, conflicts = false, automerge = false, review = null, updated = 30 } = {}) {
  return {
    url: `https://github.com/${repo}/pull/${number}`,
    number,
    title,
    isDraft: draft,
    headRefName: branch,
    repository: { nameWithOwner: repo },
    reviewDecision: review,
    latestOpinionatedReviews: { nodes: [...Array(approvals).fill({ state: "APPROVED" }), ...Array(rejections).fill({ state: "CHANGES_REQUESTED" })] },
    totalCommentsCount: comments,
    reviewThreads: { nodes: Array.from({ length: threads }, () => ({ isResolved: false })) },
    mergeable: conflicts ? "CONFLICTING" : "MERGEABLE",
    autoMergeRequest: automerge ? {} : null,
    updatedAt: at(updated),
    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: checks } } } }] },
  };
}

const ci = (build, test, deploy) => [
  ...build.map(([n, s, a, b]) => run("Build", n, s, a, b)),
  ...test.map(([n, s, a, b]) => run("Test", n, s, a, b)),
  ...deploy.map(([n, s, a, b]) => run("Deploy preview", n, s, a, b)),
];

export const DEMO_PRS = [
  pr("olympus/ledger-api", 482, "OLY-142 Add idempotency keys to payment webhooks", "feat/OLY-142-idempotency", {
    approvals: 2,
    comments: 6,
    automerge: true,
    review: "APPROVED",
    updated: 8,
    checks: ci(
      [["compile", "pass", 14, 3], ["lint", "pass", 14, 1], ["docker image", "pass", 13, 4]],
      [["unit", "pass", 10, 4], ["integration", "running", 9, 0], ["contract", "running", 9, 0], ["e2e", "queued", 0, 0]],
      [["preview", "queued", 0, 0]],
    ),
  }),
  pr("olympus/ledger-api", 479, "OLY-131 Retry failed settlement exports", "fix/OLY-131-settlement-retry", {
    draft: true,
    rejections: 1,
    comments: 3,
    threads: 2,
    review: "CHANGES_REQUESTED",
    updated: 50,
    checks: ci([["compile", "pass", 70, 3], ["lint", "pass", 70, 1]], [["unit", "pass", 66, 5], ["integration", "fail", 66, 9]], []),
  }),
  pr("olympus/web-portal", 1207, "OLY-150 Dark mode for the dashboard", "feat/OLY-150-dark-mode", {
    comments: 1,
    review: "REVIEW_REQUIRED",
    updated: 95,
    checks: ci([["build", "pass", 120, 6]], [["unit", "pass", 113, 4], ["visual", "pass", 113, 7]], [["preview", "pass", 105, 3]]),
  }),
  pr("olympus/web-portal", 1199, "Bump vite from 5.4 to 6.0", "deps/vite-6", {
    conflicts: true,
    updated: 300,
    checks: ci([["build", "pass", 320, 6]], [["unit", "pass", 313, 4]], []),
  }),
  pr("olympus/infra", 88, "OLY-118 Tighten S3 bucket policies", "chore/OLY-118-s3-policies", {
    approvals: 1,
    review: "APPROVED",
    updated: 600,
    checks: ci([["plan", "pass", 640, 2]], [["checkov", "pass", 637, 3]], []),
  }),
];

// Which repositories and stage lists show open in the screenshots.
export const DEMO_OPEN_REPOS = ["olympus/ledger-api"];
export const DEMO_OPEN_PIPELINES = ["https://github.com/olympus/ledger-api/pull/479"];
