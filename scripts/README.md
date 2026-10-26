# Scripts

These tools are not a second product entry point. Start with the [project README](../README.md) and [documentation index](../docs/README.md).

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

The `scripts/web/*review.py` recipes contain exact revisions, binary hashes and installation paths. They refuse unexpected state and must not be treated as general setup commands. Do not run historical installers against a newer deployment, delete runtime directories to satisfy a guard or expose their private settings.

Read-only inspection, build, installation, recovery application and wallet signing are separate operations. Review a script's arguments and documentation before using it. Local development does not require running any send or deployment command.
