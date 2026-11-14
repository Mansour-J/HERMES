// The panel's bar: the HERMES mark and Refresh all, at the top of the panel's column.
//
// Refresh all presses every section's own refresh: it sends `<mod>.refresh` to each mod in
// the column (Daily's is its check), so each section's ↻ spins as it would on its own click,
// and this button spins until the last of them is done. Each section says whether it's
// refreshing in shared state (`<column>.busy.<mod>`); this mod only reads that.
//
// Like every refresh in the panel, it runs only when pressed.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, nextCommand, theme, layout, props, shared } from "herdr";

const MOD = "hermes";
const ICON = (name) => `mods/hermes/icons/${name}.svg`;
const LOGO = "mods/hermes/logo.svg";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The layout node this copy sits in: the panel's column. Its width says rail or bar.
const nodeId = () => props()?.node ?? "hermes";
const width = () => find(layout(), nodeId())?.size?.px;
const narrow = () => (width() ?? Infinity) < 160;
// When the layout frames this node itself (a border on it), the mod draws no card of its own.
const framed = () => Boolean(find(layout(), nodeId())?.border);

// The other sections in the column, by mod, in their order.
const sections = () => [...new Set((find(layout(), nodeId())?.children ?? []).map((c) => c.content?.mod).filter((m) => m && m !== MOD))];
const refreshing = () => sections().filter((m) => shared(`${nodeId()}.busy.${m}`) === true);

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

export default class Hermes extends View {
  init(_props, cx) {
    this.lastAll = load("last-all", 0);
    // `hermes.refresh` (keys.json, or `herdr-app do`) is the button.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "refresh") this.refreshAll(cx);
      }
    });
  }

  refreshAll(cx) {
    // Screenshots (layout prop `demo: true`): nothing runs.
    if (props()?.demo || refreshing().length) return;
    for (const m of sections()) run(`${m}.refresh`);
    this.lastAll = Date.now();
    save("last-all", this.lastAll);
    cx.notify();
  }

  tip(busy) {
    if (busy.length) return `Refreshing ${busy.length} of ${sections().length} sections…`;
    const last = this.lastAll ? ` Last done ${ago(this.lastAll)}.` : "";
    return `Refresh every section at once: Daily's check, Claude usage, pull requests and Jira (a short Claude run). Each section's own ↻ still refreshes just that one.${last}`;
  }

  rail(t, busy) {
    const glyph = svg(ICON("refresh")).size(13);
    return v_flex()
      .id("hermes")
      .size_full()
      .min_h(0)
      .when(!framed(), (el) => el.rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border))
      .items_center()
      .py(8)
      .gap(6)
      .child(image(LOGO).size(18).flex_none())
      .child(
        div()
          .id("refresh-all")
          .size(24)
          .flex_none()
          .flex()
          .items_center()
          .justify_center()
          .rounded(6)
          .text_color(busy.length ? t.accent : t.dim)
          .when(!busy.length, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
          .tooltip(this.tip(busy))
          .on_click((_e, cx) => this.refreshAll(cx))
          .child(busy.length ? glyph.spin(900) : glyph),
      );
  }

  render(cx) {
    const t = theme();
    const busy = refreshing();
    if (narrow()) return this.rail(t, busy);
    const glyph = svg(ICON("refresh")).size(10);
    return h_flex()
      .id("hermes")
      .size_full()
      .min_h(0)
      .when(!framed(), (el) => el.rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border))
      .pl(14)
      .pr(8)
      .gap(8)
      .items_center()
      .child(image(LOGO).size(16).flex_none())
      .child(div().text_size(11.5).font_semibold().text_color(t.muted).child("HERMES"))
      .child(div().flex_1())
      .child(
        h_flex()
          .id("refresh-all")
          .flex_none()
          .h(22)
          .px(8)
          .gap(5)
          .items_center()
          .rounded(5)
          .border_1()
          .border_color(busy.length ? t.accent : t.border)
          .text_size(10.5)
          .font_semibold()
          .text_color(busy.length ? t.accent : t.muted)
          .when(!busy.length, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
          .tooltip(this.tip(busy))
          .on_click((_e, cx) => this.refreshAll(cx))
          .child(busy.length ? glyph.spin(900) : glyph)
          .child(busy.length ? "REFRESHING…" : "REFRESH ALL"),
      );
  }
}
