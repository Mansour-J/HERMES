// Jira: the tickets assigned to you in the current sprint, the next one and the backlog,
// with their status. Collapses to a rail.
//
// Reads Jira through the Atlassian connector your Claude account already has: each
// refresh is one short headless Claude run (`claude -p`, a small model) that makes the
// three searches. The tickets are read from the tool results themselves (stream-json),
// so what shows is Jira's own data, not the model's retelling of it.
// A ticket an agent's tab or space is named after shows that agent; click it to go there.
//
// Each ticket has a four-stage progress bar: plan (plans/<KEY>.md from /mansour-plan),
// implementation (its checklist, ticked off by /mansour-implement), PR raised and PR
// merged (your PRs whose title or branch names the ticket, one GitHub search). Like the
// tickets, it's read only when the person presses refresh.
//
// Under it, Plan and Implement run /mansour-plan and /mansour-implement for the ticket: in
// the ticket's agent when it has one (a tab named after the ticket) and it's free, else in
// a new Claude tab named after the ticket (layout props: space, workdir, agent).

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, spaces, exec, home, readTextFile, run, notify, nextCommand, theme, layout, props, shared, setShared, window } from "herdr";
import { DEMO_GROUPS, DEMO_ADDED, DEMO_PROGRESS, DEMO_OPEN, DEMO_FETCHED_AT } from "./demo.js";

const ICON = (name) => `mods/jira-tickets/icons/${name}.svg`;
// The title's Jira mark (Simple Icons, CC0), in Jira's blue.
const JIRA_BLUE = "#2684FF";
const CHROME = (name) => `mods/workspace-chrome/${name}.svg`;
const RAIL = 44;
// A section's height while the panel is a rail: its button, icon and count.
const RAIL_SECTION = 84;
const WIDTH = 320;
// Nothing refreshes by itself: each lookup is a model call, made only when the person
// presses refresh, or Refresh all presses it (by hand, or on the timer the person may tick
// in its popup: mods/hermes). Until then the column shows what it last loaded, and when.
const SEARCH_TOOL = "mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql";
const FIELDS = ["summary", "status", "issuetype", "priority", "parent", "updated"];
const ME = "assignee = currentUser()";
const GROUPS = [
  { id: "sprint", label: "Current sprint", jql: `${ME} AND sprint in openSprints() AND sprint not in futureSprints() ORDER BY Rank ASC` },
  { id: "next", label: "Next sprint", jql: `${ME} AND sprint in futureSprints() AND statusCategory != Done ORDER BY Rank ASC` },
  // openSprints() covers future sprints too, so these are the tickets in no sprint to come.
  { id: "backlog", label: "Backlog", jql: `${ME} AND statusCategory != Done AND (sprint is EMPTY OR sprint not in openSprints()) ORDER BY Rank ASC` },
];
// Tickets added by hand: any ticket, assigned to anyone. One search covers all of them.
const ADDED = { id: "added", label: "Added" };
const addedSearch = (keys) => ({ ...ADDED, jql: `key in (${keys.join(", ")}) ORDER BY updated DESC` });
// The order the groups are drawn in.
const SHOWN = [GROUPS[0], ADDED, GROUPS[1], GROUPS[2]];
// A ticket key, typed (any case) or inside a pasted Jira link.
const KEY = /\b([A-Za-z][A-Za-z0-9]+-\d+)\b/;
// Within a group: what's moving, then what's waiting, then what's done.
const CATEGORY_ORDER = { indeterminate: 0, new: 1, done: 2 };
const TYPE_ICON = [
  [/bug|defect/i, "bug"],
  [/sub-?task/i, "subtask"],
  [/story/i, "story"],
  [/epic/i, "epic"],
  [/task|chore|spike/i, "task"],
];
// Your Jira site, where /mansour-plan and /mansour-implement leave their files, and where a
// new agent for a ticket starts (its space, folder and program) come from the layout props:
// site, notes, space, workdir, agent. link.sh fills them in from your settings file, so none
// of them is written here. Without a site there's nothing to look up.
const AGENT_ARGV = ["claude"];
const NOTES = (h) => `${h}/notes`;
const NO_SITE = "No Jira site is set. Put yours in ~/.config/hermes/settings.json (jira.site), then run ./link.sh.";
// A checklist's open items that don't hold implementation up: they come after the code is
// written (verification, review, deploy, follow-ups) or are open questions and notes.
const AFTER_CODE = /follow|risk|manual|verif|review|deploy|\bops\b|clean-?up|wrap|^pr\b|pull request|merge|release|decision|question|status|regression|\bqa\b|sign-?off/i;
const NOT_WORK = /\(optional\)|^\W*follow-?up|needs a human|after (the )?merge|mark ready|when asked/i;
const PR_NODES = "nodes { ... on PullRequest { number url title state isDraft headRefName repository { nameWithOwner } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } }";
const escapeRe = (s) => s.replace(/[^A-Za-z0-9]/g, "\\$&");
// The key on its own: ABC-48 is not ABC-4888.
const keyRe = (key) => new RegExp(`(^|[^A-Za-z0-9])${escapeRe(key)}([^0-9]|$)`, "i");
const lines = (text) => (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

// How far a checklist is: ticked, open, and open items that are still implementation.
function checklistProgress(text) {
  const c = { done: 0, open: 0, work: 0 };
  let heading = "";
  for (const line of (text ?? "").split("\n")) {
    const h = line.match(/^#{1,6}\s+(.*)/);
    if (h) {
      heading = h[1];
      continue;
    }
    const m = line.match(/^\s*[-*+]\s+\[([ xX])\]\s*(.*)/);
    if (!m) continue;
    if (m[1] !== " ") c.done++;
    else {
      c.open++;
      if (!AFTER_CODE.test(heading) && !NOT_WORK.test(m[2])) c.work++;
    }
  }
  return c;
}

// The four stages of a ticket, from what the last refresh found.
function stagesOf(progress) {
  const notes = progress?.notes;
  const live = (progress?.prs ?? []).filter((x) => x.state !== "CLOSED");
  const open = live.filter((x) => x.state === "OPEN");
  const failing = open.filter((x) => x.ci === "FAILURE" || x.ci === "ERROR");
  return {
    plan: notes?.plans?.length ? "done" : "none",
    impl: !notes?.checklists?.length ? "none" : notes.done > 0 && notes.work === 0 ? "done" : "partial",
    pr: !live.length ? "none" : failing.length ? "failed" : "raised",
    live,
    open,
    failing,
    merged: live.filter((x) => x.state === "MERGED"),
  };
}

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

// The layout node this copy sits in; its width says rail or list.
const nodeId = () => props()?.node ?? "jira";
// Whether this section is refreshing, for Refresh all (mods/hermes): it
// spins while any section does. Shared, so every mod sees it.
const busyKey = () => `${nodeId()}.busy.jira-tickets`;
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

// Stored under a version: what the acli-based build stored (a "fetched" time set even
// by failed tries) must not pass for a lookup this build made.
const STORE = "mcp1";
function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(`${STORE}.${key}`) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
const save = (key, value) => localStorage.setItem(`${STORE}.${key}`, JSON.stringify(value));
const squash = (s) => (s ?? "").replace(/\s+/g, " ").trim();

const nameOf = (v) => (typeof v === "string" ? v : v?.name ?? "");
function guessCategory(status) {
  if (/done|closed|resolved|complete/i.test(status)) return "done";
  if (/to ?do|open|backlog|new|blocked/i.test(status)) return "new";
  return "indeterminate";
}

function shape(i) {
  const f = i.fields ?? i;
  const status = nameOf(f.status);
  return {
    key: i.key ?? f.key,
    url: i.webUrl ?? null,
    summary: f.summary ?? "",
    status,
    category: f.status?.statusCategory?.key ?? guessCategory(status),
    type: nameOf(f.issuetype),
    priority: nameOf(f.priority),
    parent: f.parent?.fields?.summary ?? f.parent?.summary ?? null,
    updated: Date.parse(f.updated) || 0,
  };
}

function issuesOf(text) {
  const data = JSON.parse(text?.trim() || "[]");
  const list = Array.isArray(data) ? data : Array.isArray(data.issues) ? data.issues : data.issues?.nodes ?? data.nodes ?? [];
  return list.map(shape).filter((t) => t.key);
}

function prompt(site, searches) {
  const calls = searches.map((g, i) => `${i + 1}. ${JSON.stringify(g.jql)}`).join("\n");
  return [
    `Load ${SEARCH_TOOL} with ToolSearch if it isn't loaded. Then call it ${searches.length} time${searches.length === 1 ? "" : "s"}${searches.length === 1 ? "" : " in parallel"},`,
    `each with cloudId "${site}", fields ${JSON.stringify(FIELDS)}, maxResults 50 and responseContentFormat "markdown",`,
    `with exactly one of these JQL strings each, copied verbatim:`,
    calls,
    `Do nothing else. When the calls have returned, reply with the single word: done`,
  ].join("\n");
}

// One headless Claude run. stdin is closed: `claude -p` otherwise waits on it.
function askClaude(site, searches) {
  const dir = `${home()}/.cache/herdr-jira`;
  return exec(
    "sh",
    [
      "-c",
      'mkdir -p "$0" && cd "$0" && exec claude "$@" < /dev/null',
      dir,
      "-p",
      prompt(site, searches),
      "--model",
      "haiku",
      "--effort",
      "low",
      "--allowedTools",
      SEARCH_TOOL,
      "--no-session-persistence",
      "--output-format",
      "stream-json",
      "--verbose",
    ],
    { timeout: 180000 },
  );
}

// The searches' own results, by JQL, out of the run's event stream.
function readStream(stdout) {
  const jqlOf = new Map();
  const byJql = new Map();
  const errors = [];
  let result = null;
  for (const line of (stdout ?? "").split("\n")) {
    if (!line.trim()) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    const content = m.message?.content ?? [];
    if (m.type === "assistant") {
      for (const c of content) if (c.type === "tool_use" && c.name === SEARCH_TOOL) jqlOf.set(c.id, squash(c.input?.jql));
    } else if (m.type === "user") {
      for (const c of content) {
        if (c.type !== "tool_result" || !jqlOf.has(c.tool_use_id)) continue;
        const text = typeof c.content === "string" ? c.content : (c.content ?? []).map((x) => x.text ?? "").join("");
        if (c.is_error) {
          errors.push(text);
          continue;
        }
        try {
          byJql.set(jqlOf.get(c.tool_use_id), issuesOf(text));
        } catch {
          errors.push(text.slice(0, 200));
        }
      }
    } else if (m.type === "result") {
      result = m;
    }
  }
  return { byJql, errors, result };
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

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

const typeIcon = (type) => TYPE_ICON.find(([re]) => re.test(type))?.[1] ?? "other";
function typeColor(t, type) {
  const icon = typeIcon(type);
  return { bug: t.ansi1, story: t.ansi2, epic: t.ansi5, task: t.ansi4, subtask: t.ansi4 }[icon] ?? t.dim;
}
function statusColor(t, ticket) {
  if (/block|hold|impediment/i.test(ticket.status)) return t.blocked;
  return { indeterminate: t.ansi4, done: t.ansi2 }[ticket.category] ?? t.muted;
}

// The agent whose tab, space or title names this ticket.
function agentFor(key, list) {
  const re = new RegExp(`(^|[^A-Za-z0-9])${key.replace(/[^A-Za-z0-9]/g, "\\$&")}([^0-9]|$)`, "i");
  return list.find((a) => re.test(a.tab_name ?? "") || re.test(a.space_name ?? "") || re.test(a.title ?? ""));
}

function agentStatus(t, s) {
  if (s === "working") return svg(CHROME("spinner")).size(11).flex_none().text_color(t.working).spin(900);
  if (s === "blocked") return div().size(13).flex_none().rounded(4).bg(alpha(t.blocked, "26")).text_size(10).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  if (s === "idle") return div().size(7).mx(2).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(7).mx(2).flex_none().rounded(4).bg(s === "done" ? t.done : t.dim);
}

function programIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class JiraTickets extends View {
  init(_props, cx) {
    // The last answer, so the column has something to show the moment Herdr starts.
    this.groups = load("groups", {}); // group id -> tickets
    this.fetchedAt = load("fetchedAt", 0);
    this.tookMs = load("tookMs", 0);
    this.folded = new Set(load("folded", []));
    // Like the PR column's repositories, every ticket starts collapsed to one line: only the
    // ones opened since this copy started are open, and that isn't kept.
    this.openTickets = new Set();
    this.progress = load("progress", {}); // ticket key -> { notes, prs }
    this.added = load("added", []); // keys added by hand
    this.addNote = null;
    this.input = InputState.new({ placeholder: "Add a ticket: ABC-123, or paste its link" });
    this.input.on("submit", (_e, cx) => this.addTicket(cx));
    this.input.on("focus", (_e, cx) => {
      this.typing = true;
      cx.notify();
    });
    this.input.on("blur", (_e, cx) => {
      this.typing = false;
      cx.notify();
    });
    this.busy = false;
    tellBusy(false);
    this.problem = null;
    // Screenshots (layout prop `demo: true`): made-up data, and nothing runs.
    if (props()?.demo) {
      this.groups = DEMO_GROUPS;
      this.added = DEMO_ADDED;
      this.progress = DEMO_PROGRESS;
      this.fetchedAt = DEMO_FETCHED_AT;
      this.openTickets = new Set(DEMO_OPEN);
      this.folded = new Set();
    }
    // `jira-tickets.refresh`, `.toggle`, `.expand-all`, `.collapse-all`, `.add <key>` and
    // `.remove <key>` (keys.json, or `herdr-app do`) do what the buttons and the add field do.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "refresh") this.refresh(cx);
        if (command === "toggle") toggle();
        if (command === "expand-all" || command === "collapse-all") this.foldAll(command === "expand-all", cx);
        const [verb, ...rest] = command.split(/[\s:]+/);
        if (verb === "add") this.addTicket(cx, rest.join(" "));
        if (verb === "remove" && KEY.test(rest.join(" "))) this.removeTicket(rest.join(" ").match(KEY)[1].toUpperCase(), cx);
      }
    });
  }

  site() {
    return props()?.site;
  }

  refresh(cx) {
    if (this.busy || props()?.demo) return;
    this.busy = true;
    tellBusy(true);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await this.loadTickets(this.searches(), true);
      } catch (e) {
        this.problem = `Couldn't start the Jira lookup: ${e?.message ?? e}`;
      }
      cx.notify();
      try {
        await this.loadProgress();
      } catch (e) {
        this.progressProblem = `Couldn't read the tickets' progress: ${e?.message ?? e}`;
      }
      this.busy = false;
      tellBusy(false);
      cx.notify();
    });
  }

  // Everything a refresh looks up: the three groups of yours, and the tickets added by hand.
  searches() {
    return this.added.length ? [...GROUPS, addedSearch(this.added)] : GROUPS;
  }

  // Runs the searches in one short Claude run; each that answers replaces its group. A full
  // refresh also stamps the time. Answers whether any search came back.
  async loadTickets(searches, full) {
    if (!this.site()) {
      this.problem = NO_SITE;
      return false;
    }
    const started = Date.now();
    const r = await askClaude(this.site(), searches);
    if (r.code === 127 || /claude: (command )?not found/.test(r.stderr)) {
      this.problem = "Claude Code (`claude`) isn't on the PATH Herdr runs programs with.";
      return false;
    }
    const { byJql, errors, result } = readStream(r.stdout);
    const groups = { ...this.groups };
    const missed = [];
    for (const g of searches) {
      const tickets = byJql.get(squash(g.jql));
      if (!tickets) {
        missed.push(g.label);
        continue;
      }
      groups[g.id] = tickets
        .map((ticket, rank) => ({ ...ticket, rank }))
        .sort((x, y) => (CATEGORY_ORDER[x.category] ?? 1) - (CATEGORY_ORDER[y.category] ?? 1) || x.rank - y.rank);
    }
    if (missed.length === searches.length) {
      const said = errors[0] ?? result?.result ?? r.stderr ?? "";
      this.problem = /auth|connect|not found|unavailable/i.test(said)
        ? "Couldn't reach Jira through Claude's Atlassian connector. Check it's connected in Claude (Settings → Connectors)."
        : `Couldn't read Jira this time${said.trim() ? `: ${squash(said).slice(0, 160)}` : "."}`;
      return false;
    }
    this.groups = groups;
    this.problem = missed.length ? `Couldn't refresh ${missed.join(" and ")} this time; showing the last known.` : null;
    save("groups", groups);
    if (full) {
      this.fetchedAt = Date.now();
      this.tookMs = Date.now() - started;
      save("fetchedAt", this.fetchedAt);
      save("tookMs", this.tookMs);
    }
    return true;
  }

  // Adds a ticket by its key (or a pasted link) and looks it up straight away: the person
  // asked for it. A key Jira doesn't know, or that this account can't see, isn't kept.
  addTicket(cx, typed = this.input.value()) {
    const key = (typed ?? "").match(KEY)?.[1]?.toUpperCase();
    if (!key) {
      this.addNote = "Type a ticket key, like ABC-123.";
      return cx.notify();
    }
    const here = SHOWN.find((g) => (this.groups[g.id] ?? []).some((x) => x.key === key) && (g.id !== "added" || this.added.includes(key)));
    if (here) {
      this.addNote = `${key} is already here, in ${here.label}.`;
      this.input.set_value("");
      return cx.notify();
    }
    if (this.busy) {
      this.addNote = "Wait for the lookup that's running to finish.";
      return cx.notify();
    }
    this.added = [...this.added, key];
    this.folded.delete(ADDED.id);
    this.input.set_value("");
    this.addNote = `Looking up ${key}…`;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const answered = await this.loadTickets([addedSearch(this.added)], false);
        const found = (this.groups[ADDED.id] ?? []).some((x) => x.key === key);
        if (found) {
          this.addNote = null;
          // Added to be worked on, so it shows open, its Plan button in reach.
          this.openTickets.add(key);
          save("added", this.added);
          cx.notify();
          await this.loadProgress();
        } else {
          this.added = this.added.filter((k) => k !== key);
          this.addNote = answered ? `${key} wasn't found in Jira, or this account can't see it.` : `Couldn't look up ${key}.`;
        }
      } catch (e) {
        this.added = this.added.filter((k) => k !== key);
        this.addNote = `Couldn't look up ${key}: ${e?.message ?? e}`;
      }
      this.busy = false;
      cx.notify();
    });
  }

  removeTicket(key, cx) {
    this.added = this.added.filter((k) => k !== key);
    this.groups[ADDED.id] = (this.groups[ADDED.id] ?? []).filter((x) => x.key !== key);
    save("added", this.added);
    save("groups", this.groups);
    cx.notify();
  }

  notesDir() {
    return props()?.notes || NOTES(home());
  }

  // Plans, checklists and PRs for every ticket shown.
  async loadProgress() {
    const keys = [...new Set(Object.values(this.groups).flat().map((x) => x.key))];
    if (!keys.length) return;
    this.progressProblem = null;
    const [notes, prs] = await Promise.all([
      this.ticketNotes(keys).catch((e) => {
        this.progressProblem = `Couldn't read the plans and checklists: ${e?.message ?? e}`;
        return null;
      }),
      this.ticketPrs(keys).catch((e) => {
        this.progressProblem = `Couldn't read the tickets' PRs from GitHub: ${e?.message ?? e}`;
        return null;
      }),
    ]);
    const progress = {};
    for (const k of keys) {
      const had = this.progress[k] ?? {};
      progress[k] = { notes: notes ? notes[k] : had.notes, prs: prs ? prs[k] ?? [] : had.prs };
    }
    this.progress = progress;
    this.progressAt = Date.now();
    save("progress", progress);
  }

  async ticketNotes(keys) {
    const dir = this.notesDir();
    const list = (d) =>
      exec("ls", ["-1", d])
        .then((r) => (r.code === 0 ? lines(r.stdout).filter((n) => n.endsWith(".md")) : []))
        .catch(() => []);
    const [plans, checklists, top] = await Promise.all([list(`${dir}/plans`), list(`${dir}/checklists`), list(dir)]);
    const out = {};
    for (const k of keys) {
      // A file is the ticket's when its name starts with the key: ABC-123.md, ABC-123-steps.md.
      const fileRe = new RegExp(`^${escapeRe(k)}(?![0-9])`, "i");
      const mine = (names, d) => names.filter((n) => fileRe.test(n)).map((n) => `${d}/${n}`);
      const planFiles = mine(plans, `${dir}/plans`);
      const checkFiles = [...mine(checklists, `${dir}/checklists`), ...mine(top, dir)];
      const total = { done: 0, open: 0, work: 0 };
      for (const f of checkFiles) {
        const c = checklistProgress(await readTextFile(f).catch(() => null));
        total.done += c.done;
        total.open += c.open;
        total.work += c.work;
      }
      out[k] = { plans: planFiles, checklists: checkFiles, ...total };
    }
    return out;
  }

  // Your PRs naming each ticket, open, merged or closed: one search per ticket, in one query.
  async ticketPrs(keys) {
    const out = {};
    for (let i = 0; i < keys.length; i += 25) {
      const batch = keys.slice(i, i + 25);
      const query = `query {\n${batch
        .map((k, j) => `t${j}: search(query: ${JSON.stringify(`is:pr author:@me "${k}" in:title`)}, type: ISSUE, first: 20) { ${PR_NODES} }`)
        .join("\n")}\n}`;
      const r = await exec("gh", ["api", "graphql", "-f", `query=${query}`], { timeout: 60000 });
      if (r.code !== 0) throw new Error(lines(r.stderr)[0] ?? `gh exited ${r.code}`);
      const data = JSON.parse(r.stdout)?.data ?? {};
      batch.forEach((k, j) => {
        const re = keyRe(k);
        out[k] = (data[`t${j}`]?.nodes ?? [])
          .filter((n) => n?.url && (re.test(n.title ?? "") || re.test(n.headRefName ?? "")))
          .map((n) => ({
            url: n.url,
            number: n.number,
            repo: n.repository?.nameWithOwner ?? "",
            state: n.state,
            draft: Boolean(n.isDraft),
            ci: n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
          }));
      });
    }
    return out;
  }

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

  lozenge(t, ticket) {
    const color = statusColor(t, ticket);
    return div()
      .flex_none()
      .h(17)
      .px(5)
      .flex()
      .items_center()
      .rounded(4)
      .bg(alpha(color, "22"))
      .text_color(color)
      .text_size(10)
      .font_semibold()
      .child(ticket.status.toUpperCase());
  }

  // Plan · implementation · PR · merged, with the furthest stage named beside it. Compact, it's
  // a short bar alone, for a collapsed ticket's line.
  progressBar(t, ticket, compact = false) {
    const progress = this.progress[ticket.key];
    const st = stagesOf(progress);
    const grey = t.input;
    const notes = progress?.notes;
    const prName = (x) => `${x.repo.split("/").pop()}#${x.number}`;
    const prLine = (x) =>
      `${prName(x)} ${x.state === "MERGED" ? "merged" : x.draft ? "draft" : "open"}${x.state === "OPEN" ? `, CI ${{ SUCCESS: "passing", FAILURE: "failing", ERROR: "failing", PENDING: "running", EXPECTED: "waiting" }[x.ci] ?? "none"}` : ""}`;
    const segment = (id, color, tip, url, slices) =>
      div()
        .id(`tk-${ticket.key}-${id}`)
        .flex_1()
        .py(3)
        .cursor_pointer()
        .tooltip(tip)
        .on_click((_e, cx) => {
          cx.stop_propagation();
          if (url) openUrl(url);
        })
        .child(
          slices
            ? h_flex().h(5).gap(1).rounded(3).overflow_hidden().children(slices.map((c) => div().flex_1().h_full().bg(c)))
            : div().h(5).rounded(3).bg(color),
        );

    const plan = segment(
      "plan",
      st.plan === "done" ? t.ansi2 : grey,
      st.plan === "done" ? `Plan written: ${notes.plans.map((f) => f.split("/").pop()).join(", ")}. Click to open.` : `No plan yet. Plan (/mansour-plan) writes one.`,
      notes?.plans?.[0],
    );
    const total = (notes?.done ?? 0) + (notes?.open ?? 0);
    const impl = segment(
      "impl",
      st.impl === "done" ? t.ansi2 : st.impl === "partial" ? t.working : grey,
      st.impl === "none"
        ? "No checklist yet."
        : st.impl === "done"
          ? `Implemented: ${notes.done}/${total} checklist items ticked${notes.open ? `; the ${notes.open} left are verification, review or follow-ups` : ""}. Click to open.`
          : `Implementing: ${notes.done}/${total} checklist items ticked, ${notes.work} still to build. Click to open.`,
      notes?.checklists?.[0],
    );
    const pr = segment(
      "pr",
      st.pr === "failed" ? t.ansi1 : st.pr === "raised" ? t.ansi4 : grey,
      st.live.length ? `${st.failing.length ? "CI failing. " : ""}${st.live.map(prLine).join(" · ")}. Click to open.` : "No PR yet.",
      (st.failing[0] ?? st.open[0] ?? st.live[0])?.url,
    );
    const merged = segment(
      "merged",
      grey,
      st.live.length ? `${st.merged.length} of ${st.live.length} PR${st.live.length === 1 ? "" : "s"} merged.` : "Nothing merged yet.",
      (st.merged[0] ?? st.live[0])?.url,
      st.live.length > 1 ? st.live.map((x) => (x.state === "MERGED" ? t.ansi5 : grey)) : [st.merged.length ? t.ansi5 : grey],
    );
    if (compact) return h_flex().flex_none().w(52).gap(2).items_center().child(plan).child(impl).child(pr).child(merged);

    const [word, color] = !progress
      ? ["not checked", t.dim]
      : st.live.length && st.merged.length === st.live.length
        ? ["Merged", t.ansi5]
        : st.merged.length
          ? [`${st.merged.length}/${st.live.length} merged`, t.ansi5]
          : st.pr === "failed"
            ? ["CI failing", t.ansi1]
            : st.pr === "raised"
              ? [st.open.length > 1 ? `${st.open.length} PRs open` : "PR open", t.ansi4]
              : st.impl === "done"
                ? ["Implemented", t.ansi2]
                : st.impl === "partial"
                  ? ["Implementing", t.working]
                  : st.plan === "done"
                    ? ["Planned", t.ansi2]
                    : ["Not started", t.dim];
    return h_flex()
      .min_w(0)
      .gap(8)
      .items_center()
      .child(h_flex().flex_1().min_w(0).gap(3).items_center().child(plan).child(impl).child(pr).child(merged))
      .child(div().flex_none().w(78).text_right().text_size(10.5).font_medium().text_color(color).child(word));
  }

  // Runs a command for a ticket: in its agent when it has one and that agent is free, else
  // in a new Claude tab named after the ticket.
  runCommand(ticket, command) {
    const text = `/${command} ${ticket.key}`;
    const agent = agentFor(ticket.key, agents());
    if (agent) {
      if (agent.status === "working" || agent.status === "blocked") {
        notify({
          title: `${ticket.key}'s agent is ${agent.status === "working" ? "busy" : "waiting on you"}`,
          body: `${text} wasn't sent. Taking you there.`,
          level: "warning",
        });
        run("pane.focus", { pane: agent.pane });
        return;
      }
      // hc send won't type into an agent's open dialog, and waits out a half-typed prompt.
      exec("hc", ["send", agent.address, text], { timeout: 20000 })
        .then((r) => {
          if (r.code !== 0) return notify({ title: `Couldn't send ${text}`, body: (r.stderr || r.stdout).trim().split("\n")[0], level: "error" });
          run("pane.focus", { pane: agent.pane });
          notify({ title: `Sent ${text}`, body: `To ${agent.space_name} · ${agent.tab_name}.`, level: "info" });
        })
        .catch((e) => notify({ title: `Couldn't send ${text}`, body: String(e?.message ?? e), level: "error" }));
      return;
    }
    const want = props()?.space;
    const space = spaces().find((x) => x.name === want);
    run("tab.new", {
      name: ticket.key,
      ...(space ? { space: space.id } : {}),
      folder: props()?.workdir || home(),
      argv: props()?.agent ?? AGENT_ARGV,
      task: text,
    });
    notify({ title: `Started ${text}`, body: `In a new Claude tab named ${ticket.key}${space ? ` in ${space.name}` : ""}.`, level: "info" });
  }

  actions(t, ticket, agent) {
    const progress = this.progress[ticket.key];
    const st = stagesOf(progress);
    // The step that comes next stands out.
    const next = !progress ? null : st.plan === "none" ? "plan" : st.impl !== "done" ? "implement" : null;
    const busy = agent && (agent.status === "working" || agent.status === "blocked");
    const where = agent
      ? busy
        ? `Its agent (${agent.tab_name}) is ${agent.status === "working" ? "busy" : "waiting on you"}: this takes you there instead.`
        : `Runs in its agent (${agent.space_name} · ${agent.tab_name}).`
      : `Opens a new Claude tab named ${ticket.key}.`;
    // A step that's done has its button turned off: shown with a tick, it runs nothing.
    const button = (id, label, command, about, done, doneAbout) => {
      const lead = !done && next === id;
      return h_flex()
        .id(`tk-${ticket.key}-${id}`)
        .flex_none()
        .h(20)
        .px(7)
        .gap(5)
        .items_center()
        .rounded(5)
        .border_1()
        .border_color(lead ? t.accent : t.border)
        .when(lead, (el) => el.bg(alpha(t.accent, "14")))
        .text_size(10)
        .font_semibold()
        .text_color(done ? t.dim : lead ? t.accent : t.muted)
        .when(done, (el) => el.opacity(0.6))
        .when(!done, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .tooltip(done ? doneAbout : `/${command} ${ticket.key}: ${about} ${where}`)
        .on_click((_e, cx) => {
          // Swallowed either way, so a click on a button never opens the ticket.
          cx.stop_propagation();
          if (!done) this.runCommand(ticket, command);
        })
        .child(done ? svg(CHROME("check")).size(9).flex_none() : svg(ICON("play")).size(8).flex_none())
        .child(label);
    };
    const notes = progress?.notes;
    const total = (notes?.done ?? 0) + (notes?.open ?? 0);
    return h_flex()
      .gap(6)
      .items_center()
      .child(
        button(
          "plan",
          "PLAN",
          "mansour-plan",
          "investigate the ticket and write its plan and checklist.",
          st.plan === "done",
          `Planned: ${(notes?.plans ?? []).map((f) => f.split("/").pop()).join(", ")}. Done, so this is off.`,
        ),
      )
      .child(
        button(
          "implement",
          "IMPLEMENT",
          "mansour-implement",
          st.plan === "none" ? "there's no plan yet, so plan first." : "work through the checklist.",
          st.impl === "done",
          `Implemented: ${notes?.done ?? 0}/${total} checklist items ticked. Done, so this is off.`,
        ),
      );
  }

  urlOf(ticket) {
    return ticket.url ?? `https://${this.site()}/browse/${ticket.key}`;
  }

  // A ticket is one line (key, summary, a short progress bar) until its chevron opens it:
  // then its status, epic, agent, full progress bar and buttons show too.
  ticketRow(t, ticket, list, removable = false) {
    const done = ticket.category === "done";
    const open = this.openTickets.has(ticket.key);
    const agent = agentFor(ticket.key, list);
    const fold = div()
      .id(`tk-${ticket.key}-fold`)
      .size(18)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(4)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.raised).text_color(t.foreground))
      .tooltip(open ? "Collapse" : "Expand: status, epic, progress and buttons")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        open ? this.openTickets.delete(ticket.key) : this.openTickets.add(ticket.key);
        cx.notify();
      })
      .child(svg(CHROME(`chevron-${open ? "down" : "right"}`)).size(10));
    return h_flex()
      .id(`tk-${ticket.key}`)
      .pl(2)
      .pr(6)
      .py(open ? 6 : 3)
      .flex_none()
      .gap(5)
      .items_start()
      .rounded(7)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip([ticket.status, ticket.type, ticket.priority || "no priority", ticket.updated ? `updated ${ago(ticket.updated)}` : null, "click to open"].filter(Boolean).join(" · "))
      .on_click(() => openUrl(this.urlOf(ticket)))
      .child(fold)
      .child(svg(ICON(typeIcon(ticket.type))).size(14).mt(2).flex_none().text_color(typeColor(t, ticket.type)))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .ml(4)
          .gap(3)
          .child(
            h_flex()
              .min_h(18)
              .min_w(0)
              .gap(6)
              .items_center()
              .child(div().flex_none().text_size(11.5).font_medium().text_color(t.muted).child(ticket.key))
              .child(div().flex_1().min_w(0).truncate().text_color(done ? t.muted : t.foreground).child(ticket.summary))
              .when(!open && Boolean(agent), (el) => el.child(agentStatus(t, agent.status)))
              .when(!open, (el) => el.child(this.progressBar(t, ticket, true)))
              .when(open && removable, (el) =>
                el.child(
                  div()
                    .id(`tk-${ticket.key}-remove`)
                    .flex_none()
                    .size(16)
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(4)
                    .text_color(t.dim)
                    .cursor_pointer()
                    .hover((s) => s.bg(t.hover).text_color(t.foreground))
                    .tooltip(`Remove ${ticket.key} from Added. Nothing in Jira changes.`)
                    .on_click((_e, cx) => {
                      cx.stop_propagation();
                      this.removeTicket(ticket.key, cx);
                    })
                    .child(svg(CHROME("x")).size(10)),
                ),
              ),
          )
          .when(open, (el) => this.ticketDetails(t, ticket, agent, el)),
      );
  }

  // What an open ticket shows under its first line.
  ticketDetails(t, ticket, agent, el) {
    const agentPic = agent ? programIcon(agent.program, 12, t.foreground) : null;
    return el
      .child(
        h_flex()
          .min_w(0)
          .gap(7)
          .items_center()
          .text_size(11.5)
          .text_color(t.dim)
          .child(this.lozenge(t, ticket))
          .child(div().flex_1().min_w(0).truncate().child(ticket.parent ?? ""))
          .when(Boolean(agent), (el) =>
            el.child(
              h_flex()
                .id(`tk-agent-${ticket.key}`)
                .flex_none()
                .h(18)
                .px(4)
                .gap(4)
                .items_center()
                .rounded(5)
                .hover((s) => s.bg(t.raised))
                .tooltip(`An agent is on this: ${agent.space_name} · ${agent.tab_name}. Click to go there.`)
                .on_click((_e, cx) => {
                  cx.stop_propagation();
                  run("pane.focus", { pane: agent.pane });
                })
                .when(Boolean(agentPic), (el) => el.child(agentPic))
                .child(agentStatus(t, agent.status)),
            ),
          ),
      )
      .child(this.progressBar(t, ticket))
      .child(this.actions(t, ticket, agent));
  }

  groupHeader(t, g, tickets) {
    const folded = this.folded.has(g.id);
    const open = tickets.filter((x) => x.category !== "done").length;
    // Drawn like the PR column's repository headers.
    return h_flex()
      .id(`grp-${g.id}`)
      .h(30)
      .mt(4)
      .px(6)
      .flex_none()
      .gap(6)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        folded ? this.folded.delete(g.id) : this.folded.add(g.id);
        save("folded", [...this.folded]);
        cx.notify();
      })
      .child(svg(CHROME(`chevron-${folded ? "right" : "down"}`)).size(11).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(g.label))
      .child(
        div()
          .flex_none()
          .h(18)
          .px(6)
          .flex()
          .items_center()
          .rounded(9)
          .bg(t.raised)
          .text_size(10.5)
          .text_color(t.muted)
          .child(open === tickets.length ? String(tickets.length) : `${open} of ${tickets.length} open`),
      );
  }

  rail(t, open) {
    return v_flex()
      .id("jira-tickets")
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
          .tooltip(`${open.length} open ticket${open.length === 1 ? "" : "s"}`)
          .child(svg(ICON("ticket")).size(14).text_color(t.muted))
          .child(String(open.length)),
      );
  }

  // Type a key, or paste a link, and press Enter (or ADD).
  addRow(t) {
    return h_flex()
      .px(10)
      .py(6)
      .gap(6)
      .flex_none()
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(
        div()
          .id("add-ticket")
          .flex_1()
          .min_w(0)
          .h(26)
          .px(8)
          .flex()
          .items_center()
          .rounded(6)
          .border_1()
          .border_color(this.typing ? t.accent : t.border)
          .cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)),
      )
      .child(
        h_flex()
          .id("add-ticket-go")
          .flex_none()
          .h(26)
          .px(9)
          .items_center()
          .rounded(6)
          .border_1()
          .border_color(t.border)
          .text_size(10.5)
          .font_semibold()
          .text_color(t.muted)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Add the ticket and look it up. It doesn't have to be assigned to you, and nothing in Jira changes.")
          .on_click((_e, cx) => this.addTicket(cx))
          .child("ADD"),
      );
  }

  // Each group with the tickets it shows. A ticket added by hand that's since been assigned
  // to you shows once, in its own group.
  lists() {
    const assigned = new Set(GROUPS.flatMap((g) => (this.groups[g.id] ?? []).map((x) => x.key)));
    return SHOWN.map((g) => ({
      g,
      tickets: (this.groups[g.id] ?? []).filter((x) => g.id !== ADDED.id || (this.added.includes(x.key) && !assigned.has(x.key))),
    }));
  }

  // Expand all opens every group and every ticket; collapse all folds the tickets back to one
  // line each, leaving the groups open so the list still shows.
  foldAll(expand, cx) {
    if (expand) {
      this.openTickets = new Set(this.lists().flatMap(({ tickets }) => tickets.map((x) => x.key)));
      this.folded = new Set();
      save("folded", []);
    } else this.openTickets = new Set();
    cx.notify();
  }

  render(cx) {
    const t = theme();
    const list = agents();
    const all = this.lists();
    const open = [...new Map(all.flatMap((x) => x.tickets).filter((x) => x.category !== "done").map((x) => [x.key, x])).values()];
    if (narrow()) return this.rail(t, open);

    const shown = all.filter((x) => x.tickets.length);
    const rows = shown.flatMap(({ g, tickets }) => [
      this.groupHeader(t, g, tickets),
      ...(this.folded.has(g.id) ? [] : tickets.map((ticket) => this.ticketRow(t, ticket, list, g.id === ADDED.id))),
    ]);
    const keys = shown.flatMap(({ tickets }) => tickets.map((x) => x.key));
    const allFolded = keys.every((k) => !this.openTickets.has(k)) || shown.every(({ g }) => this.folded.has(g.id));
    const note = (text, color = t.dim) => div().px(14).py(8).text_size(12).text_color(color).child(text);
    const updated = this.fetchedAt ? `Updated ${ago(this.fetchedAt)}${this.tookMs ? ` (took ${Math.round(this.tookMs / 1000)}s)` : ""}. ` : "";

    return v_flex()
      .id("jira-tickets")
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
          .child(svg(ICON("jira")).size(13).flex_none().text_color(JIRA_BLUE))
          .child(div().font_medium().child("Jira"))
          .child(div().text_size(11.5).text_color(t.dim).child(this.fetchedAt ? `${open.length} open · ${ago(this.fetchedAt)}` : "not loaded yet"))
          .child(div().flex_1())
          .when(keys.length > 0, (el) =>
            el.child(this.button(t, "fold-all", CHROME(allFolded ? "chevron-right" : "chevron-down"), allFolded ? "Expand all tickets" : "Collapse all tickets", (_e, cx) => this.foldAll(allFolded, cx))),
          )
          .child(this.button(t, "refresh", ICON("refresh"), `${updated}Refresh now (a short Claude run)`, (_e, cx) => this.refresh(cx), this.busy))
          .child(this.button(t, "collapse", CHROME("panel-right"), "Collapse", toggle)),
      )
      .child(this.addRow(t))
      .when(Boolean(this.addNote), (el) => el.child(note(this.addNote, /wasn't|Couldn't|Type a|Wait/.test(this.addNote ?? "") ? t.blocked : t.dim)))
      .when(Boolean(this.problem), (el) => el.child(note(this.problem, t.blocked)))
      .when(Boolean(this.progressProblem), (el) => el.child(note(this.progressProblem, t.blocked)))
      .when(!shown.length && this.busy, (el) => el.child(note("Asking Jira for your tickets…")))
      .when(!shown.length && !this.busy && !this.fetchedAt && !this.problem, (el) => el.child(note("Press ↻ to load your tickets.")))
      .when(!shown.length && !this.busy && Boolean(this.fetchedAt) && !this.problem, (el) =>
        el.child(note("Nothing assigned to you in the current sprint or the backlog.")),
      )
      .child(v_flex().id("jira-list").flex_1().min_h(0).px(6).pb(8).overflow_y_scrollbar().mode("always").children(rows));
  }
}
