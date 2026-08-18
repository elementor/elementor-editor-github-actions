# Post-release smoke

Mirrors Core [`plugin-upgrade-test.yml`](https://github.com/elementor/elementor/blob/main/.github/workflows/plugin-upgrade-test.yml):

1. Start wp-env with **current wordpress.org** Elementor (not the new zip).
2. Import a heading page (same idea as `setup.sh` + heading template).
3. `wp plugin install <released-zip> --force`.
4. Playwright: frontend heading still says `Test title`, edit that page, create a new page, canvas iframe loads.

This is not Core elements-regression screenshots. It only checks that the **published** zip upgrades a current `.org` site and the editor boots.

The `Post-Release Check` workflow in this repo wires the steps. Do not add this suite to Core/Pro PR CI.
