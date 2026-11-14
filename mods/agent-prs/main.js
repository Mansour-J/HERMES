// Pull requests: every open PR you authored, grouped by repository (each group folds),
// newest activity first. Each PR is a card: draft or ready, number, ticket, title, branch;
// chips for CI, comments, approvals and change requests, unresolved threads, conflicts and
// auto-merge; the pipeline as a bar of its stages (one stage per workflow), which opens
// into a list of stages and their failing checks; and what needs attention.
// One GitHub search through gh brings all of it (about 2 API points).
//
// A PR an agent in the Agents list opened or pushed to carries that agent's icon; click it
// to go to the agent. How a PR is tied to an agent: a Claude Code agent's session
// transcript records each `gh pr ...` and `git push` it ran (toolUseResult.gitOperation)
// with the folder it ran in, and the terminal's process tree leads to that session
// (~/.claude/sessions/<pid>.json). For any other agent, PR links in its terminal text.
// Ties found once stay with their terminal, so a /clear doesn't lose them.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, spaces, exec, hc, home, readTextFile, run, notify, nextCommand, theme, layout, props, settings, shared, setShared, window } from "herdr";
import { DEMO_PRS, DEMO_OPEN_REPOS, DEMO_OPEN_PIPELINES } from "./demo.js";

const ICON = (name) => `mods/agent-prs/icons/${name}.svg`;
// Herdr's own GitHub mark, for the title.
const GITHUB = "icons/gh.svg";
const CHROME = (name) => `mods/workspace-chrome/${name}.svg`;
const RAIL = 44;
// A section's height while the panel is a rail: its button, icon and count.
const RAIL_SECTION = 84;
const WIDTH = 340;
// Nothing refreshes by itself: the list, and which agents it ties to, change only when
// the person presses refresh. Until then the column shows what it last loaded, and when.
const KEEP_DAYS = 14;
const SEARCH = "is:pr is:open author:@me archived:false sort:updated-desc";
const QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number title url isDraft updatedAt headRefName reviewDecision mergeable totalCommentsCount
        autoMergeRequest { enabledAt }
        repository { nameWithOwner }
        reviewThreads(first: 50) { nodes { isResolved } }
        latestOpinionatedReviews(first: 20) { nodes { state } }
        commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
          __typename
          ... on CheckRun { name status conclusion startedAt completedAt detailsUrl
            checkSuite { workflowRun { workflow { name } } app { name } } }
          ... on StatusContext { context state createdAt targetUrl }
        } } } } } }
      }
    }
  }
}`;
const PR_URL = /https:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;
const DEFAULT_BRANCH = /^(main|master|develop|trunk)$/;
const TICKET = /\b[A-Z][A-Z0-9]+-\d+\b/g;
// Vulnerability ids look like ticket keys; they aren't.
const NOT_TICKET = /^(CVE|CWE|GHSA)-/;
const ticketIn = (text) => (text ?? "").match(TICKET)?.find((k) => !NOT_TICKET.test(k)) ?? null;
// A stage takes its most telling check's state.
const RANK = { fail: 4, running: 3, queued: 2, pass: 1, skip: 0 };

// A theme color at the given opacity (two hex digits), whatever form the theme gave it in:
// some theme colors already carry their own (#rrggbbaa), and the two multiply.
function alpha(color, aa) {
  if (typeof color !== "string" || !color.startsWith("#")) return color;
  let hex = color.slice(1);
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
  const own = hex.length === 8 ? parseInt(hex.slice(6), 16) : 255;
  const a = Math.round((own * parseInt(aa, 16)) / 255);
  return `#${hex.slice(0, 6)}${a.toString(16).padStart(2, "0")}`;
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The layout node this copy sits in. Its width says rail or list, as the left sidebar's does,
// so dragging its edge narrow folds it too.
const nodeId = () => props()?.node ?? "prs";
// Whether this section is refreshing, for the panel bar's Refresh all (mods/hermes): it
// spins while any section does. Shared, so every mod sees it.
const busyKey = () => `${nodeId()}.busy.agent-prs`;
const tellBusy = (busy) => {
  if (shared(busyKey()) !== busy) setShared(busyKey(), busy);
};
const width = () => find(layout(), nodeId())?.size?.px;
const narrow = () => (width() ?? Infinity) < 160;
// When the layout frames this node itself (a border on it), the mod draws no card of its own.
const framed = () => Boolean(find(layout(), nodeId())?.border);

// Folds the panel to a rail and back. A column's sections shrink to their summaries while
// folded, so they sit together at the top, and get their heights back when it opens.
function toggle() {
  const id = nodeId();
  const node = find(layout(), id);
  if (!node) return;
  const sections = node.type === "column" ? node.children ?? [] : [];
  if (!narrow()) {
    setShared(`${id}.width`, width());
    setShared(`${id}.sections`, Object.fromEntries(sections.map((c) => [c.id, c.size ?? null])));
    run("layout.resize", { id, px: RAIL });
    for (const c of sections) run("layout.resize", { id: c.id, px: RAIL_SECTION });
  } else {
    run("layout.resize", { id, px: Math.max(240, Number(shared(`${id}.width`)) || WIDTH) });
    const before = shared(`${id}.sections`) ?? {};
    for (const c of sections) {
      const size = before[c.id];
      if (size?.px) run("layout.resize", { id: c.id, px: size.px });
      else if (size?.weight) run("layout.resize", { id: c.id, weight: size.weight });
    }
    setShared(`${id}.sections`, null);
  }
}

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));

const lines = (text) => (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
const canonical = (url) => (url ?? "").match(/https:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+\/pull\/\d+/)?.[0];
const keyOf = (r) => (r.url ? canonical(r.url) : r.number ? `${r.cwd}#${r.number}` : r.branch ? `${r.cwd}@${r.branch}` : null);
const short = (repo) => (repo ?? "").split("/").pop();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// "owner/repo" from a remote's URL (https or ssh), lowercased for matching.
const repoFromRemote = (url) => (url ?? "").trim().match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/)?.[1]?.toLowerCase() ?? null;

// Each ref once, its latest sighting kept; "created" sticks once seen.
function mergeRefs(...lists) {
  const byKey = new Map();
  for (const r of lists.flat()) {
    const k = keyOf(r);
    if (!k) continue;
    const had = byKey.get(k);
    const created = Boolean(had?.created || r.created);
    byKey.set(k, !had || (r.at ?? 0) > (had.at ?? 0) ? { ...r, created } : { ...had, created });
  }
  return [...byKey.values()];
}

// The PRs and pushed branches in transcript lines that carry a gitOperation.
function gitRefs(text) {
  const refs = [];
  for (const line of (text ?? "").split("\n")) {
    if (!line.includes('"gitOperation"')) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const g = d?.toolUseResult?.gitOperation;
    if (!g) continue;
    const at = Date.parse(d.timestamp) || Date.now();
    const created = g.pr?.action === "created";
    if (canonical(g.pr?.url)) refs.push({ url: canonical(g.pr.url), at, created });
    else if (g.pr?.number && d.cwd) refs.push({ number: g.pr.number, cwd: d.cwd, at, created });
    if (g.push?.branch && d.cwd && !DEFAULT_BRANCH.test(g.push.branch)) refs.push({ branch: g.push.branch, cwd: d.cwd, at });
  }
  return refs;
}

async function processTree() {
  const r = await exec("ps", ["-eo", "pid=,ppid="]);
  const kids = new Map();
  for (const line of lines(r.stdout)) {
    const [pid, ppid] = line.split(/\s+/).map(Number);
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  return kids;
}

function descendants(pid, kids) {
  const out = [];
  const queue = [pid];
  while (queue.length && out.length < 2000) {
    for (const k of kids.get(queue.shift()) ?? []) {
      out.push(k);
      queue.push(k);
    }
  }
  return out;
}

async function pool(items, n, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

// --- checks and stages -----------------------------------------------------------

function checkState(c) {
  if (c.__typename === "StatusContext") return { SUCCESS: "pass", FAILURE: "fail", ERROR: "fail", PENDING: "running", EXPECTED: "queued" }[c.state] ?? "queued";
  if (c.status !== "COMPLETED") return c.status === "IN_PROGRESS" ? "running" : "queued";
  if (c.conclusion === "SUCCESS") return "pass";
  if (["SKIPPED", "NEUTRAL", "STALE"].includes(c.conclusion)) return "skip";
  return "fail";
}

function checkOf(c) {
  const status = c.__typename === "StatusContext";
  return {
    name: status ? c.context : c.name,
    stage: status ? c.context : c.checkSuite?.workflowRun?.workflow?.name ?? c.checkSuite?.app?.name ?? "Checks",
    state: checkState(c),
    started: Date.parse(status ? c.createdAt : c.startedAt) || 0,
    finished: Date.parse(c.completedAt) || 0,
    url: (status ? c.targetUrl : c.detailsUrl) || null,
  };
}

// One stage per workflow, in the order they started; skipped ones last.
function stagesOf(checks) {
  const by = new Map();
  for (const c of checks) {
    if (!by.has(c.stage)) by.set(c.stage, []);
    by.get(c.stage).push(c);
  }
  const stages = [...by].map(([name, all]) => {
    const counted = all.filter((c) => c.state !== "skip");
    const state = counted.length ? counted.reduce((m, c) => (RANK[c.state] > RANK[m] ? c.state : m), "pass") : "skip";
    const starts = all.map((c) => c.started).filter(Boolean);
    const ends = all.map((c) => c.finished).filter(Boolean);
    return {
      name,
      checks: all,
      state,
      total: counted.length,
      done: counted.filter((c) => c.state === "pass" || c.state === "fail").length,
      started: starts.length ? Math.min(...starts) : 0,
      finished: ends.length ? Math.max(...ends) : 0,
    };
  });
  return stages.sort((a, b) => (a.state === "skip") - (b.state === "skip") || (a.started || Infinity) - (b.started || Infinity));
}

function totals(checks) {
  const t = { pass: 0, fail: 0, running: 0, queued: 0, total: 0 };
  for (const c of checks) {
    if (c.state === "skip") continue;
    t[c.state]++;
    t.total++;
  }
  return t;
}

function shape(n) {
  const checks = (n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []).filter(Boolean).map(checkOf);
  const reviews = (n.latestOpinionatedReviews?.nodes ?? []).map((r) => r?.state);
  return {
    url: n.url,
    number: n.number,
    title: n.title,
    repo: n.repository?.nameWithOwner ?? "",
    draft: Boolean(n.isDraft),
    branch: n.headRefName ?? "",
    ticket: ticketIn(n.title) ?? ticketIn(n.headRefName),
    review: n.reviewDecision || null,
    approvals: reviews.filter((s) => s === "APPROVED").length,
    rejections: reviews.filter((s) => s === "CHANGES_REQUESTED").length,
    comments: n.totalCommentsCount ?? 0,
    unresolved: (n.reviewThreads?.nodes ?? []).filter((x) => x && !x.isResolved).length,
    conflicts: n.mergeable === "CONFLICTING",
    automerge: Boolean(n.autoMergeRequest),
    updated: Date.parse(n.updatedAt) || 0,
    checks: totals(checks),
    stages: stagesOf(checks),
  };
}

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function took(ms) {
  if (!(ms > 0)) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// What a link is, for the toast: a PR as repo#n, a ticket by its key, a file by its name.
function linkName(url) {
  if (url.startsWith("/")) return url.split("/").pop();
  const pr = url.match(/\/([^/]+)\/pull\/(\d+)/);
  if (pr) return `${pr[1]}#${pr[2]}`;
  return url.match(/\/browse\/([A-Za-z0-9-]+)/)?.[1] ?? "the link";
}

// Hands a link to the system's opener and says how it went. On GNOME the browser takes the
// tab in its existing window without coming to the front (one app can't raise another),
// so a quiet success looks like nothing happened: the toast says where it went.
function openUrl(url) {
  const platform = window()?.platform;
  const [cmd, args] = platform === "macos" ? ["open", [url]] : platform === "windows" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  const web = /^https?:/.test(url);
  const failed = (why) => notify({ title: `Couldn't open ${linkName(url)}`, body: why, level: "error" });
  exec(cmd, args, { timeout: 30000 })
    .then((r) => {
      if (r.code !== 0) return failed((r.stderr ?? "").split("\n").find((l) => l.trim()) ?? `${cmd} exited ${r.code}`);
      notify({ title: `Opened ${linkName(url)}`, body: web ? "It's in your browser, which may stay behind this window." : undefined, level: "info" });
    })
    .catch((e) => failed(String(e?.message ?? e)));
}

// As the Agents list shows them.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
function label(a, tabs) {
  const tab = tabs.get(a.tab);
  const title = clean(a.title);
  const isPath = /^[~/]/.test((a.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = title && !isPath && title !== a.program?.name && title.toLowerCase() !== a.program?.key;
  const detail = tab?.named ? tab.name : telling ? title : a.tab_name;
  return [a.space_name, detail].filter(Boolean).join(" · ");
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function agentStatus(t, s) {
  if (s === "working") return svg(CHROME("spinner")).size(10).flex_none().text_color(t.working).spin(900);
  if (s === "blocked") return div().size(12).flex_none().rounded(3).bg(alpha(t.blocked, "26")).text_size(9.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  if (s === "idle") return div().size(6).mx(2).flex_none().rounded(3).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(6).mx(2).flex_none().rounded(3).bg(s === "done" ? t.done : t.dim);
}

const stateColor = (t, s) => ({ pass: t.ansi2, fail: t.ansi1, running: t.working, queued: t.dim, skip: t.dim })[s] ?? t.dim;
const prState = (p) => (p.checks.fail ? "fail" : p.checks.running ? "running" : p.checks.queued ? "queued" : p.checks.total ? "pass" : "skip");

export default class AgentPrs extends View {
  init(_props, cx) {
    this.prs = load("open-prs-v3", []); // your open PRs, as GitHub last answered
    this.prsAt = load("prs-at", 0); // when that was
    this.store = load("refs", {}); // terminal (address@created) -> { refs, seen }
    this.byAgent = new Map(Object.entries(load("by-agent", {}))); // agent address -> refs
    this.repoOf = new Map(Object.entries(load("repos", {}))); // folder -> owner/repo (lowercase) or null
    // Every repository starts collapsed: only the ones opened since this copy started are
    // open, and that isn't kept, so a restart (or a new repository) begins collapsed again.
    this.openRepos = new Set();
    localStorage.removeItem("folded-repos");
    this.openPipelines = new Set(); // PR urls whose stage list is open
    this.scanning = false;
    this.fetching = false;
    this.spinning = false;
    tellBusy(false);
    this.problem = null;
    // Screenshots (layout prop `demo: true`): made-up data, and nothing runs.
    if (props()?.demo) {
      this.prs = DEMO_PRS.map(shape);
      this.prsAt = Date.now() - 4 * 60000;
      this.byAgent = new Map();
      this.openRepos = new Set(DEMO_OPEN_REPOS);
      this.openPipelines = new Set(DEMO_OPEN_PIPELINES);
    }
    // `agent-prs.refresh` and `.toggle` (keys.json, or `herdr-app do`) are the buttons.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "refresh") this.refreshNow(cx);
        if (command === "toggle") toggle();
      }
    });
  }

  refreshNow(cx) {
    if (props()?.demo) return;
    this.spinning = true;
    tellBusy(true);
    this.scan(cx);
    this.fetch(cx);
    cx.notify();
  }

  // Your open PRs: one GitHub search.
  fetch(cx) {
    if (this.fetching) return;
    this.fetching = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("gh", ["api", "graphql", "-f", `query=${QUERY}`, "-f", `q=${SEARCH}`], { timeout: 60000 });
        if (r.code !== 0) {
          this.problem = /auth login|not logged in|authenticat/i.test(r.stderr)
            ? "gh isn't signed in. Run `gh auth login`, then refresh."
            : `GitHub didn't answer: ${lines(r.stderr)[0] ?? `gh exited ${r.code}`}`;
          return;
        }
        const nodes = JSON.parse(r.stdout)?.data?.search?.nodes ?? [];
        this.prs = nodes.filter((n) => n?.url).map(shape);
        this.problem = null;
        this.prsAt = Date.now();
        save("open-prs-v3", this.prs);
        save("prs-at", this.prsAt);
      } catch (e) {
        this.problem = `The GitHub CLI (gh) couldn't run: ${e?.message ?? e}`;
      } finally {
        this.fetching = false;
        this.spinning = this.scanning;
        tellBusy(this.spinning);
        cx.notify();
      }
    });
  }

  // Which agents opened or pushed which PRs.
  scan(cx) {
    if (this.scanning) return;
    this.scanning = true;
    cx.spawn(async (cx) => {
      try {
        await this.collect();
      } catch {}
      this.scanning = false;
      this.spinning = this.fetching;
      tellBusy(this.spinning);
      cx.notify();
    });
  }

  // The Agents list's agents, and the sub-agents under them (they count as their top agent).
  roster() {
    const listed = agents();
    const all = terminals();
    const byAddr = new Map(all.map((t) => [t.address, t]));
    const roots = new Set(listed.map((a) => a.address));
    const out = listed.map((a) => ({ address: a.address, root: a.address }));
    for (const t of all) {
      if (t.state !== "live" || roots.has(t.address) || !t.parent) continue;
      let p = t.parent;
      for (let hops = 0; p && !roots.has(p) && hops < 10; hops++) p = byAddr.get(p)?.parent;
      if (roots.has(p)) out.push({ address: t.address, root: p });
    }
    return out;
  }

  async collect() {
    const roster = this.roster();
    const sessions = `${home()}/.claude/sessions`;
    const [kids, pids] = await Promise.all([
      processTree().catch(() => new Map()),
      exec("ls", ["-1", sessions])
        .then((r) => new Set(lines(r.stdout).map((f) => /^(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number)))
        .catch(() => new Set()),
    ]);
    const now = Date.now();
    const byAgent = new Map();
    await Promise.all(roster.map(async ({ address, root }) => {
      let id = address;
      let kept = [];
      let seenNow = [];
      try {
        const got = await hc(["get", address, "--json"]);
        const term = got.code === 0 ? JSON.parse(got.stdout) : null;
        if (term?.created_ms) id = `${address}@${term.created_ms}`;
        const session = term && !address.includes("/") ? await this.session(term, kids, pids, sessions) : null;
        const found = session ? await this.sessionRefs(session) : null;
        // Only what a transcript recorded is kept; links on screen come and go with the text.
        if (found) kept = found;
        else seenNow = await this.textRefs(address);
      } catch {}
      const merged = mergeRefs(this.store[id]?.refs ?? [], kept);
      this.store[id] = { refs: merged, seen: now };
      byAgent.set(root, mergeRefs(byAgent.get(root) ?? [], merged, seenNow));
    }));
    for (const [id, s] of Object.entries(this.store)) if (now - (s.seen ?? 0) > KEEP_DAYS * 86400000) delete this.store[id];

    // The repo of each folder a number or branch was recorded in.
    const folders = [...new Set([...byAgent.values()].flat().filter((r) => !r.url && r.cwd).map((r) => r.cwd))].filter((f) => !this.repoOf.has(f));
    await pool(folders, 4, async (folder) => {
      try {
        const r = await exec("git", ["-C", folder, "remote", "get-url", "origin"]);
        this.repoOf.set(folder, r.code === 0 ? repoFromRemote(r.stdout) : null);
      } catch {
        this.repoOf.set(folder, null);
      }
    });

    this.byAgent = byAgent;
    save("refs", this.store);
    save("by-agent", Object.fromEntries(byAgent));
    save("repos", Object.fromEntries(this.repoOf));
  }

  // The Claude Code session running in this terminal, if any.
  async session(term, kids, pids, dir) {
    const order = [term.foreground?.pid, ...descendants(term.pid, kids)].filter((p) => pids.has(p));
    for (const pid of order) {
      const text = await readTextFile(`${dir}/${pid}.json`).catch(() => null);
      let s = null;
      try {
        s = JSON.parse(text ?? "null");
      } catch {}
      if (s?.sessionId && s?.cwd) return { id: s.sessionId, cwd: s.cwd };
    }
    return null;
  }

  // The session's transcript and its subagents' transcripts; null when none is found.
  async sessionRefs(session) {
    const root = `${home()}/.claude/projects`;
    const look = (where, depth) =>
      exec("find", [where, "-maxdepth", String(depth), "-name", "*.jsonl", "-path", `*${session.id}*`])
        .then((r) => lines(r.stdout))
        .catch(() => []);
    let files = await look(`${root}/${session.cwd.replace(/[^A-Za-z0-9]/g, "-")}`, 3);
    if (!files.length) files = await look(root, 4);
    if (!files.length) return null;
    const r = await exec("grep", ["-hF", '"gitOperation":{', ...files]);
    return gitRefs(r.stdout);
  }

  async textRefs(address) {
    const r = await hc(["read", address, "--lines", "5000"]);
    return [...new Set(r.stdout.match(PR_URL) ?? [])].map((url) => ({ url, at: 0 }));
  }

  // The agents tied to a PR, the one that opened it first.
  agentsFor(pr, listed) {
    const url = pr.url.toLowerCase();
    const repo = pr.repo.toLowerCase();
    const found = new Map();
    for (const [address, refs] of this.byAgent) {
      for (const r of refs) {
        const repoThere = r.cwd ? this.repoOf.get(r.cwd) : null;
        const hit = r.url
          ? r.url.toLowerCase() === url
          : repoThere === repo && (r.number ? r.number === pr.number : r.branch === pr.branch);
        if (hit) found.set(address, Boolean(found.get(address) || r.created));
      }
    }
    return [...found]
      .map(([address, created]) => ({ agent: listed.get(address), created }))
      .filter((x) => x.agent)
      .sort((a, b) => Number(b.created) - Number(a.created));
  }

  // --- drawing ---------------------------------------------------------------------

  button(t, id, path, tip, action, spin = false) {
    const glyph = svg(path).size(13);
    return div()
      .id(id)
      .size(24)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(6)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_click(action)
      .child(spin ? glyph.spin(900) : glyph);
  }

  // A small status pill: a glyph (or a dot) and a few words.
  chip(t, id, color, glyph, text, tip) {
    return h_flex()
      .id(`chip-${id}`)
      .flex_none()
      .h(18)
      .px(5)
      .gap(4)
      .items_center()
      .rounded(4)
      .border_1()
      .border_color(alpha(color, "55"))
      .bg(alpha(color, "14"))
      .text_color(color)
      .text_size(10)
      .font_semibold()
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .child(glyph ?? div().size(6).rounded(3).bg(color))
      .child(text);
  }

  stateGlyph(t, state, size = 11) {
    const color = stateColor(t, state);
    if (state === "running") return svg(CHROME("spinner")).size(size - 1).flex_none().text_color(color).spin(900);
    if (state === "pass") return svg(CHROME("check")).size(size).flex_none().text_color(color);
    if (state === "fail") return svg(CHROME("x")).size(size).flex_none().text_color(color);
    if (state === "queued") return div().size(size - 4).mx(2).flex_none().rounded(size).border(1.5).border_color(color);
    return svg(CHROME("minus")).size(size).flex_none().text_color(color);
  }

  // An agent's icon on a PR: click to go to the agent.
  agentChip(t, p, { agent, created }, tabs) {
    const pic = icon(agent.program, 13, t.foreground);
    return h_flex()
      .id(`pr-agent-${p.repo}-${p.number}-${agent.address}`)
      .flex_none()
      .h(20)
      .px(4)
      .gap(3)
      .items_center()
      .rounded(5)
      .cursor_pointer()
      .hover((s) => s.bg(t.raised))
      .tooltip(`${created ? "Opened by" : "Worked on by"} ${label(agent, tabs)}. Click to go to the agent.`)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run("pane.focus", { pane: agent.pane });
      })
      .child(pic ?? div().text_size(10).text_color(t.muted).child(agent.program?.name ?? "agent"))
      .child(agentStatus(t, agent.status));
  }

  chips(t, p) {
    const c = p.checks;
    const out = [];
    const k = `${p.repo}-${p.number}`;
    if (c.fail) out.push(this.chip(t, `${k}-ci`, t.ansi1, null, `CI ${c.fail} FAILED`));
    else if (c.running || c.queued) out.push(this.chip(t, `${k}-ci`, t.working, null, `CI ${c.pass + c.fail}/${c.total}`, `${c.running} running, ${c.queued} queued`));
    else if (c.total) out.push(this.chip(t, `${k}-ci`, t.ansi2, null, "CI PASSED"));
    else out.push(this.chip(t, `${k}-ci`, t.dim, null, "NO CI"));
    out.push(this.chip(t, `${k}-comments`, p.comments ? t.muted : t.dim, svg(ICON("comment")).size(10), String(p.comments), plural(p.comments, "comment")));
    if (p.approvals) out.push(this.chip(t, `${k}-approved`, t.ansi2, svg(ICON("approved")).size(10), String(p.approvals), plural(p.approvals, "approval")));
    if (p.rejections) out.push(this.chip(t, `${k}-rejected`, t.ansi1, svg(ICON("rejected")).size(10), String(p.rejections), plural(p.rejections, "change request")));
    if (!p.approvals && !p.rejections && p.review === "REVIEW_REQUIRED") out.push(this.chip(t, `${k}-review`, t.dim, null, "NEEDS REVIEW"));
    if (p.unresolved) out.push(this.chip(t, `${k}-threads`, t.blocked, svg(ICON("threads")).size(10), `THREADS ${p.unresolved}`, plural(p.unresolved, "unresolved thread")));
    if (p.conflicts) out.push(this.chip(t, `${k}-conflicts`, t.ansi1, null, "CONFLICTS", "Merge conflicts with the base branch"));
    if (p.automerge) out.push(this.chip(t, `${k}-automerge`, t.ansi5, svg(ICON("automerge")).size(10), "AUTOMERGE"));
    return out;
  }

  // The pipeline: one segment per stage, sized by its checks, each check a slice in its color.
  pipeline(t, p) {
    const shown = p.stages.filter((s) => s.state !== "skip");
    const c = p.checks;
    const open = this.openPipelines.has(p.url);
    const summary = [
      c.fail ? `${c.fail} failing` : null,
      c.running ? `${c.running} running` : null,
      c.queued ? `${c.queued} queued` : null,
      `${c.pass + c.fail}/${c.total} done`,
    ].filter(Boolean).join(" · ");
    return v_flex()
      .gap(4)
      .child(
        h_flex()
          .w_full()
          .h(6)
          .gap(4)
          .children(
            shown.map((s, i) =>
              h_flex()
                .id(`stage-${p.repo}-${p.number}-${i}`)
                .flex_grow(Math.max(1, s.total))
                .h_full()
                .rounded(2)
                .overflow_hidden()
                .tooltip(`${s.name} · ${s.done}/${s.total} done${s.state === "fail" ? " · failing" : s.state === "running" ? " · running" : ""}`)
                .children(
                  s.checks
                    .filter((k) => k.state !== "skip")
                    .map((k) =>
                      div()
                        .flex_1()
                        .h_full()
                        .bg(k.state === "queued" ? t.input : stateColor(t, k.state))
                        .when(k.state === "running", (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1100 })),
                    ),
                ),
            ),
          ),
      )
      .child(
        h_flex()
          .id(`pipe-${p.repo}-${p.number}`)
          .gap(6)
          .items_center()
          .text_size(11)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            open ? this.openPipelines.delete(p.url) : this.openPipelines.add(p.url);
            cx.notify();
          })
          .child(div().flex_1().min_w(0).truncate().child(`${plural(shown.length, "stage")} · ${summary}`))
          .child(div().flex_none().child(open ? "hide stages" : "show stages"))
          .child(svg(CHROME(`chevron-${open ? "down" : "right"}`)).size(10).flex_none()),
      )
      .when(open, (el) => el.child(this.stageList(t, p)));
  }

  stageList(t, p) {
    const now = Date.now();
    return v_flex()
      .gap(2)
      .pt(2)
      .font_family(settings().font_family ?? "JetBrains Mono")
      .text_size(11)
      .children(
        p.stages.flatMap((s, i) => {
          const span = s.started && s.finished ? took(s.finished - s.started) : "";
          const when =
            s.state === "running" ? `running${s.started ? ` ${took(now - s.started)}` : ""}`
            : s.state === "queued" ? "queued"
            : s.state === "skip" ? "skipped"
            : `${s.state === "fail" ? "failed" : "passed"}${span ? ` ${span}` : ""}`;
          const row = h_flex()
            .gap(6)
            .items_center()
            .child(this.stateGlyph(t, s.state))
            .child(div().flex_1().min_w(0).truncate().text_color(s.state === "skip" ? t.dim : t.foreground).child(s.name))
            .when(s.total > 0, (el) => el.child(div().flex_none().text_color(t.dim).child(`${s.done}/${s.total}`)))
            .child(div().flex_none().text_color(stateColor(t, s.state)).child(when));
          const failing = s.checks.filter((k) => k.state === "fail" || k.state === "running");
          return [
            row,
            ...failing.map((k, j) =>
              h_flex()
                .id(`check-${p.repo}-${p.number}-${i}-${j}`)
                .pl(17)
                .gap(6)
                .items_center()
                .text_color(stateColor(t, k.state))
                .when(Boolean(k.url), (el) =>
                  el.cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Open this check's logs").on_click((_e, cx) => {
                    cx.stop_propagation();
                    openUrl(k.url);
                  }),
                )
                .child(this.stateGlyph(t, k.state, 10))
                .child(div().flex_1().min_w(0).truncate().child(k.name)),
            ),
          ];
        }),
      );
  }

  // What stands between this PR and merging, in one line.
  attention(t, p) {
    const parts = [
      p.checks.fail ? plural(p.checks.fail, "failing check") : null,
      p.rejections ? plural(p.rejections, "change request") : null,
      p.unresolved ? plural(p.unresolved, "unresolved thread") : null,
      p.conflicts ? "merge conflicts with the base branch" : null,
    ].filter(Boolean);
    if (!parts.length) return null;
    return h_flex()
      .gap(6)
      .px(7)
      .py(4)
      .items_center()
      .rounded(5)
      .border_1()
      .border_color(alpha(t.blocked, "66"))
      .bg(alpha(t.blocked, "12"))
      .text_size(11)
      .text_color(t.blocked)
      .child(svg(ICON("alert")).size(12).flex_none())
      .child(div().flex_1().min_w(0).child(parts.join(" · ")));
  }

  card(t, p, owners, tabs) {
    const alert = this.attention(t, p);
    return v_flex()
      .id(`pr-${p.repo}-${p.number}`)
      .flex_none()
      .mx(4)
      .mb(6)
      .p(9)
      .gap(5)
      .rounded(8)
      .border_1()
      .border_color(t.border)
      .cursor_pointer()
      .hover((s) => s.border_color(t.input).bg(alpha(t.hover, "60")))
      .tooltip(`${p.title} · click to open on GitHub`)
      .on_click(() => openUrl(p.url))
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .text_size(11.5)
          .child(
            div()
              .flex_none()
              .h(17)
              .px(5)
              .flex()
              .items_center()
              .rounded(4)
              .border_1()
              .border_color(p.draft ? t.dim : t.ansi2)
              .text_color(p.draft ? t.muted : t.ansi2)
              .text_size(9.5)
              .font_bold()
              .child(p.draft ? "DRAFT" : "READY"),
          )
          .child(div().flex_none().font_semibold().text_color(t.foreground).child(`#${p.number}`))
          .when(Boolean(p.ticket), (el) => el.child(div().flex_none().font_semibold().text_color(t.accent).child(p.ticket)))
          .child(div().flex_1())
          .children(owners.map((o) => this.agentChip(t, p, o, tabs)))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(p.updated))),
      )
      .child(div().text_size(13).font_medium().text_color(t.foreground).truncate().child(p.title))
      .child(
        h_flex()
          .gap(5)
          .items_center()
          .text_size(11)
          .text_color(t.dim)
          .child(svg(CHROME("git-branch")).size(11).flex_none())
          .child(div().flex_1().min_w(0).truncate().font_family(settings().font_family ?? "JetBrains Mono").child(p.branch)),
      )
      .child(h_flex().flex_wrap().gap(4).children(this.chips(t, p)))
      .when(p.stages.some((s) => s.state !== "skip"), (el) => el.child(this.pipeline(t, p)))
      .when(Boolean(alert), (el) => el.child(alert));
  }

  repoHeader(t, repo, prs) {
    const folded = !this.openRepos.has(repo);
    const failing = prs.filter((p) => p.checks.fail).length;
    const running = prs.some((p) => p.checks.running || p.checks.queued);
    const [owner, name] = repo.includes("/") ? [repo.split("/")[0], short(repo)] : ["", repo];
    return h_flex()
      .id(`repo-${repo}`)
      .h(30)
      .mx(4)
      .mt(4)
      .px(6)
      .flex_none()
      .gap(6)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        folded ? this.openRepos.add(repo) : this.openRepos.delete(repo);
        cx.notify();
      })
      .child(svg(CHROME(`chevron-${folded ? "right" : "down"}`)).size(11).flex_none().text_color(t.dim))
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .items_center()
          .child(div().flex_none().text_size(12).text_color(t.dim).child(owner ? `${owner}/` : ""))
          .child(div().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(name)),
      )
      .when(failing > 0, (el) => el.child(h_flex().flex_none().gap(3).items_center().text_size(11).text_color(t.ansi1).tooltip(`${plural(failing, "PR")} with failing checks`).id(`repo-fail-${repo}`).child(svg(CHROME("x")).size(10)).child(String(failing))))
      .when(running, (el) => el.child(svg(CHROME("spinner")).size(10).flex_none().text_color(t.working).spin(900)))
      .child(div().flex_none().h(18).px(6).flex().items_center().rounded(9).bg(t.raised).text_size(10.5).text_color(t.muted).child(String(prs.length)));
  }

  rail(t, prs) {
    return v_flex()
      .id("agent-prs")
      .size_full()
      .min_h(0)
      .when(!framed(), (el) => el.rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border))
      .items_center()
      .py(6)
      .gap(2)
      .child(this.button(t, "expand", CHROME("panel-right"), "Expand", toggle))
      .child(
        v_flex()
          .id("rail-count")
          .items_center()
          .gap(2)
          .py(4)
          .text_size(11)
          .text_color(t.dim)
          .tooltip(`${prs.length} open PR${prs.length === 1 ? "" : "s"}`)
          .child(svg(ICON("pr-open")).size(14).text_color(t.muted))
          .child(String(prs.length)),
      );
  }

  render(cx) {
    const t = theme();
    const prs = this.prs;
    if (narrow()) return this.rail(t, prs);

    const listed = new Map(agents().map((a) => [a.address, a]));
    const tabs = new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, tab]));
    // Repositories in the order their newest PR moved.
    const repos = new Map();
    for (const p of prs) {
      if (!repos.has(p.repo)) repos.set(p.repo, []);
      repos.get(p.repo).push(p);
    }
    const rows = [...repos].flatMap(([repo, list]) => [
      this.repoHeader(t, repo, list),
      ...(!this.openRepos.has(repo) ? [] : list.map((p) => this.card(t, p, this.agentsFor(p, listed), tabs))),
    ]);
    const withAgents = prs.filter((p) => this.agentsFor(p, listed).length).length;
    const allFolded = [...repos.keys()].every((r) => !this.openRepos.has(r));
    const note = (text, color = t.dim) => div().px(14).py(8).text_size(12).text_color(color).child(text);

    return v_flex()
      .id("agent-prs")
      .size_full()
      .min_h(0)
      .when(!framed(), (el) => el.rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border))
      .text_color(t.foreground)
      .text_size(13)
      .child(
        h_flex()
          .h(40)
          .pl(14)
          .pr(8)
          .flex_none()
          .gap(6)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .child(svg(GITHUB).size(13).flex_none().text_color(t.foreground))
          .child(div().font_medium().child("Pull requests"))
          .child(
            div()
              .id("pr-count")
              .text_size(11.5)
              .text_color(t.dim)
              .tooltip(`${plural(repos.size, "repository", "repositories")} · ${withAgents} tied to an agent in your Agents list`)
              .child(this.prsAt ? `${prs.length} open · ${ago(this.prsAt)}` : prs.length ? `${prs.length} open` : "not loaded yet"),
          )
          .child(div().flex_1())
          .child(
            this.button(t, "fold-all", CHROME(allFolded ? "chevron-right" : "chevron-down"), allFolded ? "Expand all repositories" : "Collapse all repositories", (_e, cx) => {
              this.openRepos = allFolded ? new Set(repos.keys()) : new Set();
              cx.notify();
            }),
          )
          .child(this.button(t, "refresh", ICON("refresh"), this.prsAt ? `Loaded ${ago(this.prsAt)}. Refresh now` : "Load your open PRs", (_e, cx) => this.refreshNow(cx), this.spinning))
          .child(this.button(t, "collapse", CHROME("panel-right"), "Collapse", toggle)),
      )
      .when(Boolean(this.problem), (el) => el.child(note(this.problem, t.blocked)))
      .when(!prs.length && this.fetching, (el) => el.child(note("Looking for your open PRs…")))
      .when(!prs.length && !this.fetching && !this.problem && !this.prsAt, (el) => el.child(note("Press ↻ to load your open PRs.")))
      .when(!prs.length && !this.fetching && !this.problem && Boolean(this.prsAt), (el) => el.child(note("You have no open PRs.")))
      .child(v_flex().id("pr-list").flex_1().min_h(0).px(2).py(4).overflow_y_scrollbar().mode("always").children(rows));
  }
}
