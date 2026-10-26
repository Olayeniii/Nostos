# Deployment

## Public mainnet

The public mainnet application uses external wallet signing and a separate SDK observer. Its product data, encryption key, observer credentials and broker are separate from the older hosted testnet installation. Web source is mounted read-only, with runtime storage outside the checkout.

`scripts/web/publish-reviewed-mainnet.py` publishes the reviewed application at the configured HTTPS origin. `scripts/web/update-public-ui.py` builds a replacement web release using the existing mainnet environment and storage. It checks health and financial records after switching, with rollback to the previous web container on failure. Neither script signs transactions or changes the observer.

These scripts target a specific installation. Exact source revisions, container names, binary hashes, mounts and archived paths are part of their checks. They refuse unexpected state rather than serving as general setup commands. Runtime credentials and product keys stay outside the repository. A merge and a successful deployment are separate events.

## Legacy testnet auto-deployer

The VPS timer checks its configured `origin/main` every five minutes. It requires a clean checkout on `main` and a fast-forward update, then uses the isolated release builder. The live container stays up during the build; the candidate is checked on loopback before switching web traffic. The previous container remains available for rollback. Zebra and wallet services are not restarted.

An unchanged healthy release is skipped. A failed revision is held until a later commit or a manual retry. Repository write access can therefore change future deployment inputs.

```sh
cd ~/nostos/repo
git pull --ff-only
sudo python3 scripts/web/install-auto-deploy.py
sudo systemctl start nostos-auto-deploy.service
```

Manual rollback requires the timer to be paused and any active deployment to finish. A rollback release must support the current ledger. Restoring an older database after a broadcast can lose transaction state.

## Release isolation

Build containers have no live wallet mounts or spending keys. Wallet RPC remains on loopback. Public builds retain exact origin and session checks. Revision-bound installers preserve the prior container and storage for recovery.

Current release details are in [project status](BUILD_STATUS.md).
