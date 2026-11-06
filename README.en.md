---
description: "One role preset per agent-team member for dsh, plus a role settings tab and a read-only team chat tab."
kind: "package-reference"
---

<!-- 中文版：[README.md](README.md) -->

# dsh-agent-team-roles

Give every member of a dsh agent team its own **role**: each role is a separate, selectable agent
preset, plus two session tabs — "Roles" for settings and "Chat" for the team message flow. It only
extends public interfaces; not a byte of dsh itself is patched.

## What it does

| Capability | In one line |
| --- | --- |
| A role is a preset | Each role registers as its own preset, listed next to the built-in `standard` / `cordis` / `ptc` / `minimal` |
| Switch-based settings | Filter, "only rows this role changed", whole-category tri-state switches, collapsible groups; one gesture becomes one batched request |
| Reference, never invent | A role's capability rows come from the presets the deployment has **right now**; a role only flips switches on existing rows |
| Skills per role | Skill rows and their order are stored per role and assembled on the host side once |
| Model per role | Each role can set its own provider / model / reasoning effort; leave empty to follow the template |
| MCP switches | Off means that role's agent cannot see that MCP server's tools (a visibility filter, not another connection) |
| Team switch and member binding | `set-team` starts the team runtime; `bindMembers` binds a new member to the role of the same name |
| "Chat" tab | One message flow across the whole team without switching sessions; read-only projection, no external database |
| `@member` dispatch | The Lead sees every member; `@name` delivers straight to that member; task-board changes wake the Lead |

## Install

```powershell
dsh plugin --profile web add github:StarSpacePX/dsh-agent-team-roles
```

Then **restart dsh**. New host-side code only exists in a new process; hot reload covers the client
side only.

This command installs the plugin into the profile and **adds it to `dsh.profile.bundles`** for you
(no need to edit the profile's `package.json` by hand). When installing from a git URL, pnpm blocks
install-time build scripts by default; the error prints the `allowBuilds` entry to put into
`<DSH_HOME>/profiles/web/pnpm-workspace.yaml`. Copy it, then run the command again.

For local development you can install the directory directly:

```powershell
dsh plugin --profile web add link:D:/path/to/dsh-agent-team-roles
```

To check the install: does `GET /state` contain a `team` section? If yes, the host side runs the new
code.

## Quick start

1. Open the "**Roles**" tab in the session tab bar.
2. Turn on "**Enable agent team**". This selects the team bundle and turns on member binding at once.
   Both steps report either "applied" or "saved, takes effect after restarting dsh".
3. Click "**New role**". It starts from the deployment's current preset; use the capability table to
   switch tools / skills / MCP. Role ids get the `team-` prefix by default.
4. Assign that preset to a member. The "Chat" tab then shows the team message flow.

## Configuration

All of it lives in the profile's `cordis.patch.yml`, under `config:`:

| Key | Default | Meaning |
| --- | --- | --- |
| `dir` | `null` | Role data directory; empty means `<DSH_HOME>/agent-team-roles` |
| `prefix` | `"team-"` | Preset id prefix for new roles, so they cannot collide with built-in presets |
| `bindMembers` | `false` | Force member binding on; **restart dsh after changing it** |
| `home` | `null` | dsh data root; usually leave empty — `DSH_HOME` or `~/.dsh` is used |

```yaml
# <DSH_HOME>/profiles/web/cordis.patch.yml
config:
  prefix: team-
  bindMembers: false
```

Details: [docs/配置项.md](docs/配置项.md) (Chinese).

## Data and uninstall

- Everything lives in `<DSH_HOME>/agent-team-roles/`: `roles.json` as the index, plus one
  `<id>/role.json` and `<id>/AGENTS.md` per role.
- The plugin does **not** touch the dsh package, shipped presets, or `~/.dsh/settings.yaml`.
- **Uninstalling keeps the data.** To wipe it: remove the plugin, restart dsh, then delete the
  `agent-team-roles/` directory.
- Backup is a copy of that directory; restore puts it back and restarts dsh.

## Docs

All reference pages live in [`docs/`](docs/README.md) (Chinese); its index lists them. The three you
will actually need: [配置项](docs/配置项.md) (configuration), [启用与成员绑定](docs/启用与成员绑定.md)
(team switch and member binding), [日志](docs/日志.md) (logging).

## Limits

- **A failed member creation keeps its name forever.** That is a dsh limitation; the plugin cannot
  fix it. Create one member at a time, and do not retry with a renamed member after a failure.
- **The "Chat" tab is read-only.** To send something, use `@member` or a tool.
- **Changes to stored config need a dsh restart**; interface changes only need a page refresh.
- The settings panel only flips switches — there is no per-row config editor. Hover a row name to
  see that row's config.

## Development

```powershell
npm test              # full test suite
npm run test:drift    # build-artifact consistency only
npm run build:client  # rebuild lib/client.js after editing src/client/**
npm run accept:live   # live acceptance probe
```

## License

[MIT](LICENSE).
