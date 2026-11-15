// Made-up PRs for screenshots (layout prop `demo: true`): GitHub-shaped, so they go
// through the same shaping as real ones. Nothing here is fetched or saved.

const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();

// Made-up workflow run ids, one per workflow (Re-run failed uses them).
const RUN_IDS = { Build: 9101, Test: 9102, "Deploy preview": 9103 };

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
    checkSuite: { workflowRun: { databaseId: RUN_IDS[workflow] ?? 9000, workflow: { name: workflow } } },
  };
}

function pr(repo, number, title, branch, { draft = false, checks = [], approvals = 0, rejections = 0, comments = 0, threads = 0, conflicts = false, automerge = false, review = null, updated = 30, state = "BLOCKED", permission = "WRITE" } = {}) {
  const mergeState = draft ? "DRAFT" : conflicts ? "DIRTY" : state;
  return {
    url: `https://github.com/${repo}/pull/${number}`,
    number,
    title,
    isDraft: draft,
    headRefName: branch,
    baseRefName: "main",
    state: "OPEN",
    // GitHub's merge state and what it lets you do: what the card's buttons offer.
    mergeStateStatus: mergeState,
    viewerCanEnableAutoMerge: permission !== "READ" && mergeState === "BLOCKED" && !automerge,
    viewerCanDisableAutoMerge: automerge,
    viewerCanUpdateBranch: permission !== "READ",
    viewerCanClose: true,
    repository: { nameWithOwner: repo, viewerPermission: permission, viewerDefaultMergeMethod: "SQUASH", autoMergeAllowed: true, deleteBranchOnMerge: true },
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
    state: "CLEAN",
    checks: ci([["plan", "pass", 640, 2]], [["checkov", "pass", 637, 3]], []),
  }),
  pr("olympus/infra", 91, "OLY-160 Rotate KMS keys every year", "chore/OLY-160-kms-rotation", {
    comments: 2,
    review: "REVIEW_REQUIRED",
    updated: 720,
    state: "BEHIND",
    checks: ci([["plan", "pass", 760, 2]], [["checkov", "pass", 757, 3]], []),
  }),
  // Someone else's project: GitHub calls it mergeable, but you can only read the repository.
  pr("argonaut-oss/yamlette", 311, "Keep tabs inside block scalars", "fix/block-scalar-tabs", {
    approvals: 1,
    comments: 4,
    review: "APPROVED",
    updated: 1500,
    state: "CLEAN",
    permission: "READ",
    checks: ci([["test (node 20)", "pass", 1530, 4], ["test (node 22)", "pass", 1530, 4]], [], []),
  }),
];

// Which repositories and stage lists show open in the screenshots. The layout prop `demo` is
// `true` for the usual scene, or a scene's name here.
export const DEMO_SCENES = {
  // CI: checks running, and a draft whose failing check shows in its stage list.
  default: { repos: ["olympus/ledger-api"], pipelines: ["https://github.com/olympus/ledger-api/pull/479"] },
  // Merging: ready to merge, behind and waiting for approval, and someone else's repository.
  merge: { repos: ["olympus/infra", "argonaut-oss/yamlette"], pipelines: [] },
};
