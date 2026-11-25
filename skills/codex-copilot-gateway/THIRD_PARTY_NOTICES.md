# Third-party notices

The runtime patch targets `@jeffreycao/copilot-api@2.8.2`, published from
[caozhiyuan/copilot-api](https://github.com/caozhiyuan/copilot-api).
It includes upstream code context. The upstream MIT notice is preserved in
[copilot-api-MIT.txt](assets/licenses/copilot-api-MIT.txt).

The patch changes Codex-facing bare stream errors into explicit failed terminal
events and classifies known upstream connection failures. It does not fabricate
success, confer account permissions or bypass upstream safety/usage policies.

`@openai/codex`, `patch-package` and transitive dependencies are fetched through
their pinned npm lockfile, not vendored as executable installations here.
Their licenses remain applicable. The repository MIT license applies only to
material its contributors have the right to license and does not replace
third-party notices.
