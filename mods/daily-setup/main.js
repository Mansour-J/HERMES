// Daily: the start-of-day setup that `daily` (~/.aws_aliases) does, as a section of the panel.
// Three steps against one AWS profile: sign in (SSO), log Docker in to ECR, and put a
// CodeArtifact token in ~/.gradle/gradle.properties for Gradle. Run them all, or one.
//
// Nothing runs or checks by itself: status is read when the person presses refresh, and
// after a run. Between checks the ECR login and the token count down from when they were
// made, since both last 12 hours.
//
// Secrets never reach this code. Each command that handles one does it inside its own shell:
// the ECR password and the CodeArtifact token are held in a shell variable and passed on by
// printf, a builtin, so neither is ever printed, passed as an argument (visible in `ps`) or
// exported. What comes back here is exit codes, file times and error text, and anything
// token-shaped is cut from error text before it's shown or saved. The token file is written
// owner-only (600).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, home, run, notify, nextCommand, theme, layout, props, shared, setShared } from "herdr";

const ICON = (name) => `mods/daily-setup/icons/${name}.svg`;
const CHROME = (name) => `mods/workspace-chrome/${name}.svg`;
const RAIL = 44;
const WIDTH = 340;
// A section's height while the panel is a rail: its button, icon and count.
const RAIL_SECTION = 84;

// The AWS profile, region, account and CodeArtifact domain come from the layout props
// (daily), which link.sh fills in from your settings file, so none of them is written here.
// Until all four are set, nothing runs.
const SETTINGS = ["profile", "region", "account", "domain"];
// Screenshots (layout prop `demo: true`): made up.
const DEMO_CONFIG = { profile: "olympus-dev", region: "us-east-1", account: "123456789012", domain: "olympus" };
const config = () => (props()?.demo ? DEMO_CONFIG : (props()?.daily ?? {}));
const unset = () => SETTINGS.filter((k) => !config()[k]);
const registry = (c) => `${c.account}.dkr.ecr.${c.region}.amazonaws.com`;
// How long an ECR login and a CodeArtifact token last.
const LASTS = 12 * 3600000;

// Each step's icon says what it sets up: AWS (a cloud: the AWS marks aren't free to use),
// Docker and Gradle (Herdr's own Simple Icons marks). A null color is the theme's text.
const STEPS = [
  { id: "sso", label: "AWS sign-in", icon: ICON("cloud"), color: "#FF9900", about: (c) => `An SSO session for ${c.profile}` },
  { id: "ecr", label: "ECR login", icon: "icons/docker.svg", color: "#2496ED", about: (c) => `Docker logged in to ${registry(c)}` },
  { id: "codeartifact", label: "CodeArtifact token", icon: "icons/gradle.svg", color: null, about: (c) => `A token for the ${c.domain} domain in ~/.gradle/gradle.properties` },
];
// The title's sunrise.
const SUNRISE = "#F5B83D";

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

// The layout node this copy sits in. Its width says rail or list.
const nodeId = () => props()?.node ?? "daily";
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
function left(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
// Anything shaped like a credential (a long run of token characters) is cut, even from an
// error message, before it's shown or saved.
const redact = (text) => String(text ?? "").replace(/[A-Za-z0-9+/=_.-]{32,}/g, "[redacted]");
// What a command said last: its error, or its last line, redacted and kept short.
const lastLine = (r) =>
  redact(
    `${r.stderr ?? ""}\n${r.stdout ?? ""}`
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^WARNING!|password will be stored|credential helper|docs\.docker\.com/i.test(l))
      .pop() ?? `exited ${r.code}`,
  ).slice(0, 200);

// Signed in to AWS for the profile: one STS call, nothing changed. Only its exit status
// comes back; the identity it prints is dropped in the shell.
const signedIn = (c) =>
  exec("sh", ["-c", 'aws sts get-caller-identity --profile "$1" --no-cli-pager > /dev/null 2>&1', "sts", c.profile], { timeout: 30000 })
    .then((r) => r.code === 0)
    .catch(() => false);

// Stops a sign-in this window started and is still waiting on, say when the browser side
// failed and nothing will ever come back. Only an `aws sso login` for this profile whose
// parent is Herdr: this shell is Herdr's child too, so $PPID is Herdr. A sign-in run in a
// terminal is never touched. True when one was stopped.
const stopSignIn = (c) =>
  exec("sh", ["-c", 'pkill -TERM -P "$PPID" -f "aws sso login --profile $1\\$"', "cancel", c.profile], { timeout: 10000 })
    .then((r) => r.code === 0)
    .catch(() => false);

// When a file was last written, if it holds the given line; 0 otherwise. grep -q reads the
// file in its own process and prints nothing: only the file's time comes back.
const writtenWith = (file, pattern) =>
  exec("sh", ["-c", 'grep -q -- "$2" "$1" 2>/dev/null && stat -c %Y "$1"', "check", file, pattern])
    .then((r) => (r.code === 0 ? Number(r.stdout.trim()) * 1000 || 0 : 0))
    .catch(() => 0);

// The ECR password goes from aws to docker inside this shell: held in a variable, handed to
// docker on its stdin by printf (a builtin, so never an argument). Docker isn't run at all
// unless AWS gave a password, so an AWS error is the error shown.
const ECR = `set -eu
password=$(aws ecr get-login-password --region "$1" --profile "$2")
[ -n "$password" ] || { echo "ECR returned no password" >&2; exit 1; }
printf '%s' "$password" | docker login --username AWS --password-stdin "$3" > /dev/null`;

// Writes a fresh CodeArtifact token into gradle.properties, as `daily` does, more carefully:
// nothing is written unless a token came back; the new file is built beside the old one,
// owner-only, and swapped in whole, so it's never half-written or readable by others; a
// link to the file stays a link. Other lines are kept as they were.
const CODEARTIFACT = `set -eu
umask 077
token=$(aws codeartifact get-authorization-token --domain "$1" --domain-owner "$2" --profile "$3" --output text --query authorizationToken)
[ -n "$token" ] || { echo "CodeArtifact returned no token" >&2; exit 1; }
mkdir -p "$HOME/.gradle"
file=$(readlink -f "$HOME/.gradle/gradle.properties")
tmp=$(mktemp "$(dirname "$file")/.gradle.properties.XXXXXX")
trap 'rm -f "$tmp"' EXIT
if [ -f "$file" ]; then grep -v 'CODEARTIFACT_AUTH_TOKEN' "$file" > "$tmp" || true; fi
printf 'CODEARTIFACT_AUTH_TOKEN=%s\\n' "$token" >> "$tmp"
chmod 600 "$tmp"
mv -f "$tmp" "$file"
trap - EXIT`;

export default class DailySetup extends View {
  init(_props, cx) {
    // Each step's last known state: { state: "ok" | "off" | "failed", at, note }.
    this.steps = load("steps", {});
    this.checkedAt = load("checked-at", 0);
    this.running = new Set();
    this.checking = false;
    this.cancelled = false;
    // Screenshots (layout prop `demo: true`): made-up data, and nothing runs.
    if (props()?.demo) {
      const at = Date.now() - 137 * 60000;
      this.steps = { sso: { state: "ok" }, ecr: { state: "ok", at }, codeartifact: { state: "ok", at } };
      this.checkedAt = Date.now() - 3 * 60000;
    }
    // `daily-setup.run`, `.cancel`, `.check` and `.toggle` (keys.json, or `herdr-app do`) are
    // the buttons.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "run") this.runAll(cx);
        if (command === "cancel") this.cancel(cx);
        if (command === "check") this.check(cx);
        if (command === "toggle") toggle();
      }
    });
  }

  // Reads where each step stands: an STS call, and two files' times.
  check(cx) {
    if (this.checking || this.running.size || props()?.demo || unset().length) return;
    this.checking = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const c = config();
      const [sso, ecr, token] = await Promise.all([
        signedIn(c),
        writtenWith(`${home()}/.docker/config.json`, registry(c)),
        writtenWith(`${home()}/.gradle/gradle.properties`, "^CODEARTIFACT_AUTH_TOKEN="),
      ]);
      this.steps = {
        sso: { state: sso ? "ok" : "off" },
        ecr: { state: ecr ? "ok" : "off", at: ecr },
        codeartifact: { state: token ? "ok" : "off", at: token },
      };
      this.checkedAt = Date.now();
      save("steps", this.steps);
      save("checked-at", this.checkedAt);
      this.checking = false;
      cx.notify();
    });
  }

  async runStep(id) {
    const c = config();
    if (id === "sso") {
      if (await signedIn(c)) return { ok: true };
      // Opens the browser to approve, and waits up to ten minutes for that, or until Cancel.
      // What it prints (the sign-in link) is dropped; only an error comes back.
      const r = await exec("sh", ["-c", 'exec aws sso login --profile "$1" < /dev/null > /dev/null', "sso", c.profile], { timeout: 600000 });
      if (r.code !== 0 && this.cancelled) return { ok: false, cancelled: true };
      return r.code === 0 && (await signedIn(c)) ? { ok: true } : { ok: false, note: lastLine(r) };
    }
    if (id === "ecr") {
      const r = await exec("sh", ["-c", ECR, "ecr", c.region, c.profile, registry(c)], { timeout: 120000 });
      return r.code === 0 ? { ok: true } : { ok: false, note: lastLine(r) };
    }
    const r = await exec("sh", ["-c", CODEARTIFACT, "codeartifact", c.domain, c.account, c.profile], { timeout: 120000 });
    return r.code === 0 ? { ok: true } : { ok: false, note: lastLine(r) };
  }

  async doStep(id, cx) {
    if (id === "sso") this.cancelled = false;
    this.running.add(id);
    cx.notify();
    let result;
    try {
      result = await this.runStep(id);
    } catch (e) {
      result = id === "sso" && this.cancelled ? { ok: false, cancelled: true } : { ok: false, note: redact(e?.message ?? e).slice(0, 200) };
    }
    this.running.delete(id);
    // A cancelled sign-in leaves you signed out, which is no failure.
    this.steps[id] = result.ok
      ? { state: "ok", at: Date.now() }
      : result.cancelled
        ? { state: "off" }
        : { ...(this.steps[id] ?? {}), state: "failed", note: result.note };
    this.checkedAt = Date.now();
    save("steps", this.steps);
    save("checked-at", this.checkedAt);
    cx.notify();
    return result.ok;
  }

  // One step; ECR and CodeArtifact need the sign-in, so it comes first when it's gone.
  runOne(id, cx) {
    if (this.running.size || props()?.demo || unset().length) return;
    cx.spawn(async (cx) => {
      if (id !== "sso" && !(await this.doStep("sso", cx))) return this.blocked([id], cx);
      await this.doStep(id, cx);
    });
  }

  // All of `daily`: sign in, then ECR and CodeArtifact side by side.
  runAll(cx) {
    if (this.running.size || props()?.demo || unset().length) return;
    cx.spawn(async (cx) => {
      if (!(await this.doStep("sso", cx))) return this.blocked(["ecr", "codeartifact"], cx);
      const [ecr, token] = await Promise.all([this.doStep("ecr", cx), this.doStep("codeartifact", cx)]);
      notify(
        ecr && token
          ? { title: "Daily setup done", body: "Signed in, Docker logged in to ECR, CodeArtifact token written.", level: "success" }
          : { title: "Daily setup didn't finish", body: "See the Daily section for the step that failed.", level: "error" },
      );
    });
  }

  // Stops the sign-in that's waiting: the run it belongs to stops there too.
  cancel(cx) {
    this.cancelled = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const stopped = await stopSignIn(config());
      if (!stopped && !this.running.has("sso")) notify({ title: "No AWS sign-in to cancel", body: "None that this window started is waiting.", level: "info" });
      cx.notify();
    });
  }

  blocked(ids, cx) {
    // Cancelled: nothing failed, so the steps that waited on the sign-in keep their state.
    if (this.cancelled) return cx.notify();
    for (const id of ids) this.steps[id] = { ...(this.steps[id] ?? {}), state: "failed", note: "needs the AWS sign-in" };
    save("steps", this.steps);
    notify({ title: "AWS sign-in didn't complete", body: this.steps.sso?.note ?? "", level: "error" });
    cx.notify();
  }

  // Where a step stands now: its glyph state and a few words.
  view(id) {
    const s = this.steps[id] ?? {};
    if (this.running.has(id)) return { state: "running", text: id === "sso" ? (this.cancelled ? "cancelling…" : "approve in browser…") : "running…" };
    if (s.state === "failed") return { state: "fail", text: s.note ?? "failed" };
    if (id === "sso") return s.state === "ok" ? { state: "pass", text: "signed in" } : s.state === "off" ? { state: "off", text: "signed out" } : { state: "unknown", text: "not checked" };
    if (!s.at) return s.state === "off" ? { state: "off", text: "not set up" } : { state: "unknown", text: "not checked" };
    const rest = s.at + LASTS - Date.now();
    return rest > 0 ? { state: "pass", text: `${left(rest)} left` } : { state: "off", text: `expired ${ago(s.at + LASTS)}` };
  }

  color(t, state) {
    return { pass: t.ansi2, fail: t.ansi1, running: t.working, off: t.working }[state] ?? t.dim;
  }

  glyph(t, state) {
    const color = this.color(t, state);
    if (state === "running") return svg(CHROME("spinner")).size(10).flex_none().text_color(color).spin(900);
    if (state === "pass") return svg(CHROME("check")).size(11).flex_none().text_color(color);
    if (state === "fail") return svg(CHROME("x")).size(11).flex_none().text_color(color);
    if (state === "off") return div().size(7).mx(2).flex_none().rounded(4).bg(color);
    return div().size(7).mx(2).flex_none().rounded(4).border(1.5).border_color(color);
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

  stepRow(t, step) {
    const v = this.view(step.id);
    const busy = this.running.size > 0;
    return h_flex()
      .h(24)
      .px(14)
      .gap(8)
      .items_center()
      .child(this.glyph(t, v.state))
      .child(svg(step.icon).size(13).flex_none().text_color(step.color ?? t.foreground))
      .child(div().flex_none().text_color(t.foreground).child(step.label))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(11.5).text_color(this.color(t, v.state)).child(v.text))
      .child(
        div()
          .id(`run-${step.id}`)
          .size(20)
          .flex_none()
          .flex()
          .items_center()
          .justify_center()
          .rounded(5)
          .text_color(busy ? t.border : t.dim)
          .when(!busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
          .tooltip(`${step.about(config())}. Run just this step${step.id === "sso" ? "" : " (signing in first if needed)"}.`)
          .on_click((_e, cx) => this.runOne(step.id, cx))
          .child(svg(ICON("play")).size(9)),
      );
  }

  summary(t) {
    if (unset().length) return ["not set up", t.dim];
    const views = STEPS.map((s) => this.view(s.id));
    if (this.running.size) return ["running…", t.working];
    if (views.some((v) => v.state === "fail")) return ["a step failed", t.ansi1];
    if (views.every((v) => v.state === "pass")) return ["all set", t.ansi2];
    if (views.every((v) => v.state === "unknown")) return ["not checked yet", t.dim];
    return ["needs a run", t.working];
  }

  rail(t) {
    const ok = STEPS.filter((s) => this.view(s.id).state === "pass").length;
    const [word, color] = this.summary(t);
    return v_flex()
      .id("daily-setup")
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
          .tooltip(`Daily setup: ${word}`)
          .child(svg(ICON("sunrise")).size(14).text_color(color))
          .child(`${ok}/${STEPS.length}`),
      );
  }

  render(cx) {
    const t = theme();
    if (narrow()) return this.rail(t);
    const [word, color] = this.summary(t);
    const missing = unset();
    const busy = this.running.size > 0 || missing.length > 0;
    return v_flex()
      .id("daily-setup")
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
          .child(svg(ICON("sunrise")).size(13).flex_none().text_color(SUNRISE))
          .child(div().font_medium().child("Daily"))
          .child(div().text_size(11.5).text_color(color).child(word))
          .child(div().flex_1())
          .when(this.running.has("sso"), (el) =>
            el.child(
              h_flex()
                .id("cancel-sign-in")
                .flex_none()
                .h(22)
                .px(8)
                .gap(5)
                .items_center()
                .rounded(5)
                .border_1()
                .border_color(t.border)
                .text_size(10.5)
                .font_semibold()
                .text_color(this.cancelled ? t.dim : t.muted)
                .when(!this.cancelled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
                .tooltip("Stop waiting for the AWS sign-in: if it failed or was closed in the browser, nothing will come back. Then run again.")
                .on_click((_e, cx) => {
                  if (!this.cancelled) this.cancel(cx);
                })
                .child(svg(CHROME("x")).size(9))
                .child("CANCEL"),
            ),
          )
          .when(!this.running.has("sso"), (el) =>
            el.child(
              h_flex()
                .id("run-daily")
                .flex_none()
                .h(22)
                .px(8)
                .gap(5)
                .items_center()
                .rounded(5)
                .border_1()
                .border_color(busy ? t.border : t.accent)
                .when(!busy, (el) => el.bg(alpha(t.accent, "14")).cursor_pointer().hover((s) => s.bg(alpha(t.accent, "26"))))
                .text_size(10.5)
                .font_semibold()
                .text_color(busy ? t.dim : t.accent)
                .tooltip(missing.length ? "Set up Daily first: see below." : `Everything \`daily\` does: AWS sign-in (${config().profile}), then the ECR login and the CodeArtifact token.`)
                .on_click((_e, cx) => this.runAll(cx))
                .child(svg(ICON("play")).size(8))
                .child("RUN DAILY"),
            ),
          )
          .child(
            this.button(
              t,
              "check",
              ICON("refresh"),
              this.checkedAt ? `Checked ${ago(this.checkedAt)}. Check now` : "Check where each step stands",
              (_e, cx) => this.check(cx),
              this.checking,
            ),
          )
          .child(this.button(t, "collapse", CHROME("panel-right"), "Collapse", toggle)),
      )
      .when(missing.length > 0, (el) =>
        el.child(
          div()
            .px(14)
            .pt(8)
            .text_size(11)
            .text_color(t.working)
            .child(`Set aws.${missing.map((k) => (k === "domain" ? "codeartifact_domain" : k)).join(", aws.")} in ~/.config/hermes/settings.json, then run ./link.sh.`),
        ),
      )
      .when(!missing.length, (el) => el.child(v_flex().py(4).children(STEPS.map((s) => this.stepRow(t, s)))))
      .when(this.running.has("sso"), (el) =>
        el.child(div().px(14).pb(6).text_size(11).text_color(t.working).child("Approve the AWS sign-in in your browser; it may open behind this window. If it failed there, press Cancel and run again.")),
      );
  }
}
