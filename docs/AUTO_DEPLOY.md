# Automatic deployment

The VPS checks its existing authenticated Git origin/main every five minutes. No wallet credentials, new SSH key, webhook or GitHub runner are needed. Only trusted main commits are deployment inputs. Keep main access restricted: repository write access already permits changing the code that the operator runs.

The timer requires a clean repository on main and a fast-forward update. It invokes the existing isolated deployment helper, which runs all checks and builds before switching web containers, retains the previous release and restores it on a failed health check. Zebra and wallet services are untouched. An unchanged healthy release does nothing. A failed revision is attempted once and held until the next main commit or an explicit retry. The timer uses the VPS's existing Git authentication as the repository owner; authentication failures are not printed.

Install after pulling the commit:

```bash
cd ~/nostos/repo
git pull --ff-only
sudo python3 scripts/web/install-auto-deploy.py
sudo systemctl start nostos-auto-deploy.service
```

The service continues if Termius disconnects. Inspect it using `sudo systemctl status nostos-auto-deploy.service` and `sudo journalctl -u nostos-auto-deploy.service -n 30 --no-pager`. Build containers never receive wallet credentials or application databases. The helper does not print private runtime configuration.

Pause before any manual rollback:

```bash
sudo systemctl stop nostos-auto-deploy.timer
```

Wait for an active deployment service to finish before manual rollback. Do not restore an old database snapshot after a refund broadcast. Historical releases before the refund ledger understand only the first refund; use a compatible release for continued multi-refund operation.

To retry a held revision, first inspect its build failure, then run the normal manual deployment helper. A successful manual deployment is detected by the timer's next pass. The timer is an operator convenience, not proof of runtime privacy or customer-wallet receipt.

## Branding metadata

The social image is a fixed 1200 by 630 PNG generated from the existing logo and product copy. The tab icon uses the same mark in SVG and the Apple touch icon is PNG. They contain no payment data, route, merchant data or receipt capability. Public preview metadata is generic on private pages as well, and indexing is disabled for this testnet product. No customer receipt URL is canonicalized into social metadata.
