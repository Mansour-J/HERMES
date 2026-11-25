# Herder customizations

"The Herder" is the Herdr app (`herdr-app`). This repo holds my mods and layout for it, plus the Claude Code commands `/mansour-plan` and `/mansour-implement` (`claude/commands/`) and my rules for every Claude Code session (`claude/global.md`, linked as `~/.claude/CLAUDE.md`). `~/.config/herdr-app` and `~/.claude` link to them: see README.md.

- Herdr's manual is `~/.config/herdr-app/AGENTS.md`. The APIs are `herdr.d.ts` and `gpui-kit.d.ts` there. Read them; don't edit them.
- Edit the files here, never in `~/.config/herdr-app` or `~/.claude/commands`. After saving anything, run `./link.sh`: Herdr only reloads when its own folder changes, and re-linking is what changes it. The layout, the commands and `claude/global.md` are templates it fills in from `~/.config/hermes/settings.json`, so a command edit needs it too.
- This repo is public. Nothing of mine goes in it: an AWS account, a Jira site, a work folder, a repository or ticket name goes in the settings file (shape: `settings.example.json`) and reaches a layout or command as `{{settings.<name>}}`; a mod gets it as a layout prop. Mods hold no default for any of them.
- Check each mod you touch with `herdr-app check mods/<name>`, then `herdr-app status` for errors. Use `herdr-app shot` to see the window.
- Nothing refreshes by itself unless I tick auto-refresh in the bottom bar's Refresh popup (mods/hermes; off until ticked, interval 1 min to 5 h). That is the only timer. Otherwise network and model calls happen only when I press ↻ or REFRESH ALL. Don't add other timers or fetches on start.
- Theme colors can be `#rrggbbaa`. Use the mods' `alpha()` helper; never append hex to a color.
- Each mod has a demo mode (layout prop `demo: true`, data in its `demo.js` or a few lines in `init`) for the README screenshots: made-up data, nothing runs. Pull requests also takes a scene's name (`demo: "merge"`, see its `demo.js`). Keep demo data made up, never real repos, PRs or tickets, and keep it in step when a mod's data shape changes. See README "Screenshots".
