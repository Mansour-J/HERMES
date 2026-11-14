// Claude: how much of my Claude plan's limits I've used, as /usage shows it: the five-hour
// session, the week across all models, and any model's own weekly limit.
//
// Read with Claude Code's own usage request (the SDK's get_usage, meant for usage meters):
// `claude -p` starts, is asked that one thing on its stdin, answers and exits. No prompt is
// sent, so no model runs and nothing is spent. The login stays inside Claude Code: this mod
// never reads a token or calls an API itself, and the answer holds no credentials.
//
// Nothing refreshes by itself: press ↻. Between checks the reset times count down, and a
// window that has reset since is shown as such.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, home, run, nextCommand, theme, layout, props, shared, setShared } from "herdr";

const ICON = (name) => `mods/claude-usage/icons/${name}.svg`;
const CHROME = (name) => `mods/workspace-chrome/${name}.svg`;
// Herdr's own Claude icon.
const CLAUDE = "icons/claude.svg";
const CLAUDE_ORANGE = "#D97757";
const RAIL = 44;
const WIDTH = 340;
// A section's height while the panel is a rail: its button, icon and count.
const RAIL_SECTION = 84;

// The one request: plan limits only. skip_behaviors spares Claude Code a scan of a week of
// transcripts that this section doesn't show.
const REQUEST = JSON.stringify({ type: "control_request", request_id: "usage", request: { subtype: "get_usage", skip_behaviors: true } });

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The layout node this copy sits in. Its width says rail or list.
const nodeId = () => props()?.node ?? "claude-usage";
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

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}
// How long until a time: "2h 14m", "6d 8h".
function until(ms) {
  const m = Math.max(0, Math.ceil(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// One headless Claude Code run that's asked for usage and nothing else. Its stdin is the one
// request, then closed, so it exits once it has answered.
function askUsage() {
  return exec(
    "sh",
    [
      "-c",
      'mkdir -p "$0" && cd "$0" && printf "%s\\n" "$1" | claude -p --input-format stream-json --output-format stream-json --verbose --no-session-persistence',
      `${home()}/.cache/herdr-claude-usage`,
      REQUEST,
    ],
    { timeout: 60000 },
  );
}

// The rows to show, from Claude Code's answer: its `limits`, in the server's order, or the
// older five-hour and seven-day fields when there are none.
function rowsOf(answer) {
  const rl = answer?.rate_limits ?? {};
  const limits = Array.isArray(rl.limits) && rl.limits.length
    ? rl.limits
    : [
        rl.five_hour && { kind: "session", percent: rl.five_hour.utilization, resets_at: rl.five_hour.resets_at },
        rl.seven_day && { kind: "weekly_all", percent: rl.seven_day.utilization, resets_at: rl.seven_day.resets_at },
      ].filter(Boolean);
  return limits
    .filter((l) => typeof l.percent === "number")
    .map((l) => {
      // Classified on its kind, never on a label: the label is only what's shown.
      const scope = l.scope?.model?.display_name ?? l.scope?.surface?.display_name ?? null;
      const label =
        l.kind === "session" ? "Session" : l.kind === "weekly_all" ? "Week, all models" : scope ? `${l.group === "weekly" ? "Week" : l.group === "session" ? "Session" : cap(l.group ?? "limit")}, ${scope}` : cap(String(l.kind ?? "limit").replace(/_/g, " "));
      const about =
        l.kind === "session"
          ? "The five-hour session limit."
          : l.kind === "weekly_all"
            ? "The weekly limit across all models."
            : scope
              ? `${scope}'s own ${l.group === "weekly" ? "weekly " : ""}limit.`
              : label;
      return { kind: l.kind, label, about, percent: l.percent, severity: l.severity ?? "normal", resetsAt: l.resets_at ? Date.parse(l.resets_at) || 0 : 0 };
    });
}

export default class ClaudeUsage extends View {
  init(_props, cx) {
    // The last answer, so the section has something to show the moment Herdr starts.
    this.usage = load("usage", null); // { plan, available, rows }
    this.checkedAt = load("checked-at", 0);
    this.busy = false;
    this.problem = null;
    // Screenshots (layout prop `demo: true`): made-up data, and nothing runs.
    if (props()?.demo) {
      const later = (minutes) => Date.now() + minutes * 60000;
      this.usage = {
        plan: "max",
        available: true,
        rows: [
          { kind: "session", label: "Session", about: "The five-hour session limit.", percent: 38, severity: "normal", resetsAt: later(131) },
          { kind: "weekly_all", label: "Week, all models", about: "The weekly limit across all models.", percent: 21, severity: "normal", resetsAt: later(6130) },
          { kind: "weekly_scoped", label: "Week, Fable", about: "Fable's own weekly limit.", percent: 84, severity: "normal", resetsAt: later(6130) },
        ],
      };
      this.checkedAt = Date.now() - 2 * 60000;
    }
    // `claude-usage.refresh` and `.toggle` (keys.json, or `herdr-app do`) are the buttons.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "refresh") this.refresh(cx);
        if (command === "toggle") toggle();
      }
    });
  }

  refresh(cx) {
    if (this.busy || props()?.demo) return;
    this.busy = true;
    this.problem = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await askUsage();
        let answer = null;
        for (const line of (r.stdout ?? "").split("\n")) {
          let m;
          try {
            m = JSON.parse(line);
          } catch {
            continue;
          }
          if (m?.type !== "control_response" || m.response?.request_id !== "usage") continue;
          if (m.response.subtype !== "success") throw new Error(m.response.error ?? "Claude Code couldn't read your usage.");
          answer = m.response.response;
        }
        if (!answer) {
          const said = `${r.stderr ?? ""}`.split("\n").map((l) => l.trim()).filter(Boolean).pop();
          throw new Error(said ? said.slice(0, 200) : `Claude Code didn't answer (exit ${r.code}).`);
        }
        this.usage = { plan: answer.subscription_type ?? null, available: answer.rate_limits_available !== false, rows: rowsOf(answer) };
        this.checkedAt = Date.now();
        save("usage", this.usage);
        save("checked-at", this.checkedAt);
      } catch (e) {
        this.problem = String(e?.message ?? e).slice(0, 200);
      }
      this.busy = false;
      cx.notify();
    });
  }

  // A row's color: the theme's accent while there's room, amber as it fills (or when the
  // server says so), red once it's used up.
  color(t, row) {
    if (row.percent >= 100) return t.ansi1;
    if (row.percent >= 80 || (row.severity && row.severity !== "normal")) return t.working;
    return t.accent;
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

  row(t, row) {
    const reset = row.resetsAt && row.resetsAt <= Date.now();
    const color = reset ? t.dim : this.color(t, row);
    const pct = Math.max(0, Math.min(100, row.percent));
    return h_flex()
      .id(`limit-${row.kind}-${row.label}`)
      .h(26)
      .px(14)
      .gap(8)
      .flex_none()
      .items_center()
      .tooltip(`${row.about} ${reset ? "It has reset since this was checked: press ↻." : `${Math.round(row.percent)}% used.`}`)
      .child(div().w(112).flex_none().truncate().text_size(12.5).text_color(t.foreground).child(row.label))
      .child(
        div()
          .flex_1()
          .min_w(24)
          .h(6)
          .rounded(3)
          .overflow_hidden()
          .bg(t.input)
          .child(div().h_full().w(`${reset ? 0 : pct}%`).rounded(3).bg(color)),
      )
      .child(div().w(36).flex_none().text_right().text_size(11.5).font_medium().text_color(color).child(reset ? "–" : `${Math.round(row.percent)}%`))
      .child(
        div()
          .w(78)
          .flex_none()
          .text_right()
          .text_size(11)
          .text_color(t.dim)
          .child(!row.resetsAt ? "" : reset ? "reset" : `in ${until(row.resetsAt - Date.now())}`),
      );
  }

  session() {
    return this.usage?.rows?.find((r) => r.kind === "session") ?? this.usage?.rows?.[0] ?? null;
  }

  rail(t) {
    const s = this.session();
    const reset = s?.resetsAt && s.resetsAt <= Date.now();
    return v_flex()
      .id("claude-usage")
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
          .tooltip(s && !reset ? `Claude: ${Math.round(s.percent)}% of this session used` : "Claude usage: not checked")
          .child(svg(CLAUDE).size(14).text_color(CLAUDE_ORANGE))
          .child(s && !reset ? `${Math.round(s.percent)}%` : "–"),
      );
  }

  render(cx) {
    const t = theme();
    if (narrow()) return this.rail(t);
    const rows = this.usage?.rows ?? [];
    const s = this.session();
    const fresh = s && !(s.resetsAt && s.resetsAt <= Date.now());
    const summary = !this.checkedAt ? "not checked yet" : `${fresh ? `${Math.round(s.percent)}% of session · ` : ""}${ago(this.checkedAt)}`;
    const note = (text, color = t.dim) => div().px(14).py(6).text_size(12).text_color(color).child(text);
    return v_flex()
      .id("claude-usage")
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
          .child(svg(CLAUDE).size(13).flex_none().text_color(CLAUDE_ORANGE))
          .child(div().font_medium().child("Claude"))
          .child(
            div()
              .id("usage-summary")
              .text_size(11.5)
              .text_color(t.dim)
              .tooltip(this.usage?.plan ? `Your ${cap(this.usage.plan)} plan's limits, as /usage shows them.` : "Your Claude plan's limits, as /usage shows them.")
              .child(summary),
          )
          .child(div().flex_1())
          .child(
            this.button(
              t,
              "refresh",
              ICON("refresh"),
              `${this.checkedAt ? `Checked ${ago(this.checkedAt)}. ` : ""}Check now (asks Claude Code; no model call, nothing spent)`,
              (_e, cx) => this.refresh(cx),
              this.busy,
            ),
          )
          .child(this.button(t, "collapse", CHROME("panel-right"), "Collapse", toggle)),
      )
      .when(Boolean(this.problem), (el) => el.child(note(this.problem, t.blocked)))
      .when(Boolean(this.usage) && this.usage.available === false, (el) => el.child(note("Plan limits don't apply to this login (an API key or a cloud provider).")))
      .when(!rows.length && this.busy, (el) => el.child(note("Asking Claude Code for your usage…")))
      .when(!rows.length && !this.busy && !this.usage && !this.problem, (el) => el.child(note("Press ↻ to check your Claude usage.")))
      .child(v_flex().id("usage-rows").flex_1().min_h(0).py(4).overflow_y_scrollbar().children(rows.map((r) => this.row(t, r))));
  }
}
