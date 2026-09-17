# Visual proof

This skill is for the **CI author** action. Local Cursor agents should not add
`## Visual proof` on `gh pr create` or `gh pr edit`. Capturing screenshots is
not this skill.

## What triggers it

The caller’s `visual-proof-author` workflow runs this action when a same-repo
PR is **opened** or marked **ready for review**, and only if `## Visual proof`
is still missing. Capture is a separate `visual-proof-shots` action after
`playground-preview`.

## Environment

The proof target is the PR’s **playground-preview** deployment in the calling
repo (Elementor or Elementor Pro), not a local site.

Login: `admin` / `password`. Landing page is `/wp-admin`.

If the bug cannot be shown on that Playground, use `#skip_proof`.

## When to fill vs skip

**Fill** (Broken + Where / Steps / Pass / Fail):

- Jira type `Bug` or `Editor Bug` (or a clear regression fix)
- User-visible **editor** UI (panel, canvas, navigator, Style / Content)
- Can be shown on this repo’s Playground

**`#skip_proof`** + one sentence:

- Story / Task / feature
- No editor UI
- Needs a plugin Playground does not install
- Docs or CI

## Rules

1. Write **Steps** the actor can click: short, visible labels, stay in the editor.
2. Visible in-app labels only. No file paths, no GitHub, no workflow names.
3. Do not act out the bug. Playground has the **fixed** zip. Put the old
   behaviour in `**Broken:**`, then show the fixed path.

## PR body

Order: Summary → Test plan → Visual proof → Jira.

### Editor bug

```markdown
## Visual proof
**Broken:** <one sentence: what used to happen in the editor>
**Where:** <editor path using visible labels>
**Steps:** <happy path on this PR’s Playground>
**Pass:** <fixed editor behaviour visible>
**Fail:** <bug still visible>
```

### Skip

```markdown
## Visual proof
#skip_proof
<One sentence why this cannot be shown on this repo’s Playground editor.>
```
