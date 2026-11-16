// HERMES: the panel's mark at the top of its column, and Refresh all, a chip in the window's
// bottom bar.
//
// Where it sits, by layout props:
// - neither: the bar at the top of the panel's column (`node`: that column's id). The HERMES
//   mark, or just the logo while the column is a rail.
// - `bar: true`: the Refresh chip in the bottom bar (`panel`: the column whose sections it
//   refreshes). A click opens the popup.
// - `popup: true`: that popup (opened by the chip): REFRESH ALL, and auto-refresh, a checkbox
//   and how often.
// The chip does the refreshing and keeps the setting; the popup sends it commands.
//
// Refresh all presses every section's own refresh: it sends `<mod>.refresh` to each mod in
// the column (Daily's is its check), and to any mod elsewhere in the layout that names this
// column as its panel (layout prop `panel`, like the Daily and Claude usage chips). So each
// section's ↻ spins as it would on its own click, and the chip spins until the last of them
// is done. Each section says whether it's refreshing in shared state (`<column>.busy.<mod>`);
// this mod only reads that.
//
// Auto-refresh is off unless turned on in the popup. On, the chip does a Refresh all every
// 1 min to 5 h (as set there), counted from the last one, pressed or not. If Herdr was closed
// past a run, it catches up once, soon after it opens. The setting is kept in shared state
// (`hermes.auto`), so it holds across restarts. Off, nothing refreshes by itself: every
// refresh in the panel runs only when pressed.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, Checkbox, Slider, SliderTrack, SliderIndicator, SliderThumb, SliderState } from "gpui-base";
import { run, nextCommand, openOverlay, closeOverlay, theme, layout, props, settings, shared, setShared } from "herdr";

const MOD = "hermes";
const ICON = (name) => `mods/hermes/icons/${name}.svg`;
const CHROME = (name) => `mods/workspace-chrome/${name}.svg`;
const LOGO = "mods/hermes/logo.svg";

// How often auto-refresh may run, in minutes: 1 min to 5 h.
const MIN_EVERY = 1;
const MAX_EVERY = 300;
// How often the chip looks at the clock while auto-refresh is on, and how long it waits after
// Herdr starts before its first look (so every section is listening by then).
const TICK = 15000;
const SETTLE = 20000;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const inBar = () => Boolean(props()?.bar);
const isPopup = () => Boolean(props()?.popup);
const demo = () => Boolean(props()?.demo);
// The layout node the top bar sits in: the panel's column. Its width says rail or bar.
const nodeId = () => props()?.node ?? "hermes";
// The column whose sections Refresh all refreshes: the chip names it as its panel.
const column = () => props()?.panel ?? nodeId();
const width = () => find(layout(), nodeId())?.size?.px;
const narrow = () => (width() ?? Infinity) < 160;
// When the layout frames this node itself (a border on it), the mod draws no card of its own.
const framed = () => Boolean(find(layout(), nodeId())?.border);

// Every block in the layout.
const blocks = (node) => (node?.type === "block" ? [node] : (node?.children ?? []).flatMap(blocks));
// The other sections in the column, by mod, in their order, then the mods elsewhere that
// name this column as their panel.
const sections = () => {
  const inColumn = (find(layout(), column())?.children ?? []).map((c) => c.content?.mod);
  const elsewhere = blocks(layout()).filter((b) => b.content?.props?.panel === column()).map((b) => b.content.mod);
  return [...new Set([...inColumn, ...elsewhere].filter((m) => m && m !== MOD))];
};
const refreshing = () => sections().filter((m) => shared(`${column()}.busy.${m}`) === true);

// The open popup's id, or when the last one closed.
const POPUP_KEY = "hermes.popup";
// What the chip knows (when the last Refresh all was), for the popup; the demo's apart.
const stateKey = () => `hermes.${demo() ? "demo" : "live"}`;
// Auto-refresh: { on, every (minutes), since (when it was turned on) }. The demo's is apart,
// so a screenshot never touches the real one.
const autoKey = () => `hermes.auto${demo() ? ".demo" : ""}`;
const DEMO_AUTO = { on: true, every: 30, since: 0 };

const clampEvery = (m) => Math.min(MAX_EVERY, Math.max(MIN_EVERY, Math.round(Number(m) || 30)));
// A slider's minutes, rounded the way a person would say them: to the minute up to an hour,
// to 5 min up to 3 h, then to 15 min.
function nice(m) {
  const v = clampEvery(m);
  const step = v <= 60 ? 1 : v <= 180 ? 5 : 15;
  return clampEvery(Math.round(v / step) * step);
}
// The setting as shared. The chip keeps its own copy (this.auto) and writes it through: a
// value just shared may not read back until the next turn.
function readAuto() {
  const a = shared(autoKey());
  return { on: a?.on === true, every: clampEvery(a?.every ?? 30), since: Number(a?.since) || 0 };
}

// 90 → "1 h 30 min"; short, 90 → "1h30".
function minutes(m) {
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${m} min`;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}
function short(m) {
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${m}m`;
  return rest ? `${h}h${String(rest).padStart(2, "0")}` : `${h}h`;
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
function within(ms) {
  const m = Math.ceil((ms - Date.now()) / 60000);
  if (m <= 0) return "any moment";
  return `in ${minutes(m)}`;
}

// The chip's block, and how wide the blocks after it in its row are: where its popup stands.
function chipPlace() {
  const walk = (node) => {
    const kids = node?.children ?? [];
    const i = kids.findIndex((c) => c.content?.mod === MOD && c.content?.props?.bar);
    if (i >= 0) return { right: kids.slice(i + 1).reduce((sum, c) => sum + (c.size?.px ?? 0), 0), width: kids[i].size?.px ?? 110 };
    for (const c of kids) {
      const found = walk(c);
      if (found) return found;
    }
    return null;
  };
  return walk(layout()) ?? { right: 0, width: 110 };
}

export default class Hermes extends View {
  init(_props, cx) {
    // The popup's slider holds the interval while it's dragged; letting go saves it.
    if (isPopup()) {
      this.slider = SliderState.new({ min: MIN_EVERY, max: MAX_EVERY, step: 1, scale: "logarithmic", value: readAuto().every });
      this.slider.on("change", (_v, cx) => cx.notify());
      this.slider.on("release", (v) => {
        const every = nice(v);
        this.slider.set_value(every);
        run(`hermes.every:${every}`);
      });
      // A change made while it's open (a key, or `herdr-app do hermes.every:<minutes>`) moves
      // the knob too. The chip does the rest.
      cx.spawn(async (cx) => {
        for (;;) {
          const [name, arg] = String(await nextCommand()).split(":");
          if (name === "every" && arg) {
            this.slider.set_value(nice(arg));
            cx.notify();
          }
        }
      });
      return;
    }
    // The top bar only draws the mark.
    if (!inBar()) return;
    setShared(POPUP_KEY, null);
    this.lastAll = load("last-all", 0);
    this.auto = readAuto();
    // Screenshots (layout prop `demo: true`): made up, and nothing runs.
    if (demo()) {
      this.auto = DEMO_AUTO;
      setShared(autoKey(), DEMO_AUTO);
      this.lastAll = Date.now() - 18 * 60000;
    }
    this.publish();
    this.watch(cx);
    // `hermes.refresh`, `.open` (the popup), `.auto` (`:on`, `:off`, or the other way) and
    // `.every:<minutes>` are the controls, for keys.json or `herdr-app do`.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = String(await nextCommand());
        const [name, arg] = command.split(":");
        if (name === "refresh") this.refreshAll(cx);
        if (name === "open") this.togglePopup();
        if (name === "auto") this.setOn(arg === "on" ? true : arg === "off" ? false : !this.auto.on, cx);
        if (name === "every" && arg) this.setEvery(arg, cx);
      }
    });
  }

  // What the chip knows, shared for the popup.
  publish() {
    setShared(stateKey(), { lastAll: this.lastAll });
  }

  // When the next automatic Refresh all is due: an interval after the last one, or after
  // auto-refresh was turned on, whichever is later.
  dueAt(a = this.auto) {
    return Math.max(this.lastAll ?? 0, a.since) + a.every * 60000;
  }

  // While auto-refresh is on, looks at the clock every few seconds and refreshes when one is
  // due (or a little later, if a section is still busy with its own). Off, it stops: it's
  // started again when turned on.
  watch(cx) {
    if (demo() || this.watching || !this.auto.on) return;
    this.watching = true;
    const first = this.started ? TICK : SETTLE;
    this.started = true;
    cx.spawn(
      async (cx) => {
        await cx.sleep(first);
        while (this.auto.on) {
          if (Date.now() >= this.dueAt()) this.refreshAll(cx);
          cx.notify();
          await cx.sleep(TICK);
        }
        this.watching = false;
      },
      { owner: this },
    );
  }

  setAuto(next, cx) {
    this.auto = { ...this.auto, ...next };
    setShared(autoKey(), this.auto);
    this.watch(cx);
    cx.notify();
  }

  setOn(on, cx) {
    this.setAuto({ on, since: on ? Date.now() : 0 }, cx);
  }

  setEvery(m, cx) {
    this.setAuto({ every: nice(m) }, cx);
  }

  refreshAll(cx) {
    // Screenshots: nothing runs.
    if (demo() || refreshing().length) return;
    for (const m of sections()) run(`${m}.refresh`);
    this.lastAll = Date.now();
    save("last-all", this.lastAll);
    this.publish();
    cx.notify();
  }

  // The chip's popup, standing on the bottom bar over the chip. Closed by Esc, a click beside
  // it, or the chip.
  openPopup() {
    const width = 360;
    const height = 264;
    // Where it goes is in the window's own pixels; its size is in Herdr's, which zoom.
    const zoom = Number(settings()?.zoom) || 1;
    const v = window.viewport_size?.();
    const chip = chipPlace();
    const middle = v?.width - (chip.right + chip.width / 2) * zoom;
    const at = v?.width
      ? {
          x: Math.min(Math.max(8, middle - (width / 2) * zoom), v.width - (width + 8) * zoom),
          y: Math.max(8, v.height - ((this.barHeight ?? 28) + height + 6) * zoom),
        }
      : undefined;
    const id = openOverlay({ mod: MOD, kind: "popup", width, height, ...(at ? { at } : {}), props: { popup: true, height, panel: column(), demo: demo() } });
    setShared(POPUP_KEY, { id });
  }

  togglePopup() {
    const p = shared(POPUP_KEY);
    if (p?.id) {
      closeOverlay(p.id);
      setShared(POPUP_KEY, { closedAt: Date.now() });
    } else if (!(p?.closedAt && Date.now() - p.closedAt < 400)) {
      // (A click on the chip while the popup is open closes it on the way: don't reopen it.)
      this.openPopup();
    }
  }

  async close() {
    if (isPopup()) setShared(POPUP_KEY, { closedAt: Date.now() });
  }

  lastAllNow() {
    return isPopup() ? Number(shared(stateKey())?.lastAll) || 0 : this.lastAll;
  }

  tip(busy) {
    if (busy.length) return `Refreshing ${busy.length} of ${sections().length} sections…`;
    const a = this.auto;
    const last = this.lastAll ? ` Last done ${ago(this.lastAll)}.` : "";
    const when = a.on ? ` Auto-refresh every ${minutes(a.every)}, next ${within(this.dueAt(a))}.` : " Auto-refresh is off.";
    return `Refresh all.${last}${when} Click to refresh now or set how often.`;
  }

  // The chip in the bottom bar: ↻ and "Refresh", and how often when auto-refresh is on.
  chip(t) {
    const busy = refreshing();
    const a = this.auto;
    const open = Boolean(shared(POPUP_KEY)?.id);
    const glyph = svg(ICON("refresh")).size(11).flex_none().text_color(busy.length ? t.accent : t.dim);
    return h_flex()
      .id("hermes")
      .on_size_change((size) => {
        this.barHeight = size.height;
      })
      .size_full()
      .justify_end()
      .items_center()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(11.8)
      .child(
        h_flex()
          .id("refresh-chip")
          .h(20)
          .px(7)
          .gap(6)
          .items_center()
          .rounded(5)
          .text_color(open ? t.foreground : t.muted)
          .when(open, (el) => el.bg(t.hover))
          .cursor_pointer()
          .hover((st) => st.bg(t.hover).text_color(t.foreground))
          .tooltip(this.tip(busy))
          .on_click(() => this.togglePopup())
          .child(busy.length ? glyph.spin(900) : glyph)
          .child("Refresh")
          .when(a.on, (el) =>
            el.child(
              h_flex()
                .gap(3)
                .items_center()
                .font_medium()
                .text_color(t.accent)
                .child(svg(CHROME("clock")).size(10).flex_none())
                .child(short(a.every)),
            ),
          ),
      );
  }

  // A checkbox, drawn: a box, ticked when on.
  checkbox(t, on, onChange) {
    return Checkbox.new("auto-on")
      .checked(on)
      .on_change((checked) => onChange(checked))
      .flex()
      .items_center()
      .gap(8)
      .cursor_pointer()
      .child(
        div()
          .size(15)
          .flex_none()
          .flex()
          .items_center()
          .justify_center()
          .rounded(4)
          .border_1()
          .border_color(on ? t.accent : t.input ?? t.border)
          .when(on, (el) => el.bg(t.accent).text_color(t.accent_foreground ?? t.background))
          .when(on, (el) => el.child(svg(CHROME("check")).size(11))),
      )
      .child(div().text_color(t.foreground).child("Refresh automatically"));
  }

  every(t, on) {
    const s = this.slider;
    return Slider.new(s).child(
      SliderTrack.new(s)
        .flex()
        .items_center()
        .h(20)
        .w_full()
        .cursor_pointer()
        .child(
          SliderIndicator.new(s)
            .relative()
            .w_full()
            .h(4)
            .rounded(2)
            .bg(t.border)
            .range_style((fill) => fill.rounded(2).bg(on ? t.accent : t.dim))
            .child(SliderThumb.new(s).size(14).rounded(7).bg(on ? t.accent : t.muted).border_2().border_color(t.popover ?? t.background).ml(-7).mt(-5)),
        ),
    );
  }

  popup(t) {
    const busy = refreshing();
    const a = readAuto();
    const lastAll = this.lastAllNow();
    const every = nice(this.slider?.value() ?? a.every);
    const dueAt = Math.max(lastAll, a.since) + a.every * 60000;
    const glyph = svg(ICON("refresh")).size(11).flex_none();
    const label = (text) => div().text_size(10.5).font_semibold().text_color(t.dim).child(text);
    return v_flex()
      .id("hermes")
      // A popup is as tall as what's in it, so it's given its height.
      .h(props()?.height ?? 264)
      .bg(t.popover ?? t.background)
      .text_color(t.foreground)
      .text_size(13)
      .child(
        h_flex()
          .h(40)
          .px(14)
          .flex_none()
          .gap(7)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .child(image(LOGO).size(14).flex_none())
          .child(div().font_medium().child("Refresh all"))
          .child(div().text_size(11.5).text_color(t.dim).child(lastAll ? `last done ${ago(lastAll)}` : "not done yet")),
      )
      .child(
        v_flex()
          .px(14)
          .pt(12)
          .pb(12)
          .gap(8)
          .flex_none()
          .border_b(1)
          .border_color(t.border)
          .child(
            h_flex()
              .id("refresh-all")
              .flex_none()
              .h(28)
              .gap(6)
              .justify_center()
              .items_center()
              .rounded(6)
              .text_size(11)
              .font_semibold()
              .when(!busy.length, (el) =>
                el
                  .bg(t.solid ?? t.accent)
                  .text_color(t.solid_foreground ?? t.accent_foreground)
                  .cursor_pointer()
                  .hover((s) => s.opacity(0.9)),
              )
              .when(busy.length > 0, (el) => el.border_1().border_color(t.accent).text_color(t.accent).cursor_not_allowed())
              .on_click(() => !busy.length && run("hermes.refresh"))
              .child(busy.length ? glyph.spin(900) : glyph)
              .child(busy.length ? `REFRESHING… ${sections().length - busy.length} of ${sections().length} done` : "REFRESH ALL"),
          )
          .child(
            div()
              .text_size(11.5)
              .text_color(t.dim)
              .child("Presses each section's ↻: Daily's check, pull requests, Jira (a short Claude run) and Claude usage."),
          ),
      )
      .child(
        v_flex()
          .px(14)
          .pt(12)
          .pb(12)
          .gap(6)
          .flex_1()
          .child(
            h_flex()
              .items_center()
              .child(this.checkbox(t, a.on, (on) => run(`hermes.auto:${on ? "on" : "off"}`)))
              .child(div().flex_1())
              .when(a.on, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(`next ${within(dueAt)}`))),
          )
          .child(
            h_flex()
              .pt(4)
              .gap(5)
              .items_baseline()
              .text_color(a.on ? t.foreground : t.muted)
              .child(label("EVERY"))
              .child(div().font_medium().child(minutes(every))),
          )
          .child(this.every(t, a.on))
          .child(
            h_flex()
              .text_size(10.5)
              .text_color(t.dim)
              .child(minutes(MIN_EVERY))
              .child(div().flex_1())
              .child(minutes(MAX_EVERY)),
          ),
      );
  }

  render(cx) {
    const t = theme();
    if (inBar()) return this.chip(t);
    if (isPopup()) return this.popup(t);
    const card = (el) => (framed() ? el : el.rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border));
    if (narrow())
      return card(v_flex().id("hermes").size_full().min_h(0).items_center().justify_center()).child(image(LOGO).size(18).flex_none());
    return card(h_flex().id("hermes").size_full().min_h(0))
      .pl(14)
      .pr(8)
      .gap(8)
      .items_center()
      .child(image(LOGO).size(16).flex_none())
      .child(div().text_size(11.5).font_semibold().text_color(t.muted).child("HERMES"));
  }
}
