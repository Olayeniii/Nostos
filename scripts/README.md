# Scripts

Build, deployment, inspection and maintenance tools. The [project README](../README.md) covers the product; the [documentation index](../docs/README.md) covers the implementation.

| Directory                       | Purpose                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `lightclient`                   | Selected native SDK observer, broker, fixtures, build/package tools and encrypted backups |
| `web`                           | Web deployments, read-only inspectors, refund recovery and fixture UI checks              |
| `quality`                       | Local build cleanup and current-file secret scanning                                      |
| `evidence`                      | Redacted historical testnet evidence with original provenance                             |
| `observer`                      | Earlier Zallet/Zaino observer implementation retained for compatibility and inspection    |
| `shielded-spike`                | Original controlled testnet payment/refund proof                                          |
| `payment-intake`, `refund-core` | Legacy hosted testnet intake and refund commands                                          |
| `ui`                            | Responsive UI fixture checks                                                              |

The deployed installations and tests reference existing script paths. They are retained rather than moved during submission cleanup. A file's presence does not mean it is the selected mainnet backend.

The `scripts/web/*review.py` recipes contain exact revisions, binary hashes and installation paths. They target specific installations and refuse unexpected state. Historical installers are not general setup commands for newer deployments. Their private settings and retained runtime directories are part of the release state.

Read-only inspection, build, installation, recovery application and wallet signing are separate operations. Local development does not require running any send or deployment command.
