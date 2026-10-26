# Deployment

## Existing testnet auto-deployer

The VPS timer checks its configured `origin/main` every five minutes. It requires a clean checkout on `main` and a fast-forward update, then uses the isolated release builder. The live container stays up during the build; the candidate is checked on loopback before switching web traffic. The previous container is retained for failed-switch rollback. Zebra and wallet services are not restarted.

An unchanged healthy release is skipped. A failed revision is held until a later commit or a deliberate manual retry. Repository write access is therefore also authority to change future deployment inputs; restrict it accordingly.

```sh
cd ~/nostos/repo
git pull --ff-only
sudo python3 scripts/web/install-auto-deploy.py
sudo systemctl start nostos-auto-deploy.service
```

These are operator setup commands, not part of local development. Keep runtime configuration, product keys and wallet credentials outside the repository. A successful GitHub merge is not proof that deployment completed.

Before a manual rollback, pause `nostos-auto-deploy.timer` and wait for any active deployment to finish. Use a release compatible with the current refund ledger. Never restore an old database snapshot after a broadcast.

## Separate mainnet preview

The tested mainnet SDK preview uses separate application data, product key, observer credentials, broker and loopback web port. It does not inherit hosted signer configuration or repurpose testnet wallets. Its web source is mounted read-only; runtime product storage is separate.

The `scripts/web/*review.py` installers are revision-bound operator recipes for an existing private installation. They verify source, binary hashes, expected containers and mounts, retain prior state and stop on mismatches. They are not generic public production setup commands. Preserve their dependencies and archived source paths when maintaining a deployed installation.

The final reviewed preview update restores normal observer verification, removes its temporary operator configuration and preserves existing financial records. New deployment success must still be checked from the installer output and the actual runtime. See [build status](BUILD_STATUS.md).

The public HTTPS origin and judge access path need their own release verification. A private loopback preview is not automatically public when its source is merged. Never expose wallet RPC, copy private preview credentials into a public build or weaken origin/session checks to publish it.
