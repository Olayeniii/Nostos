# Customer wallet and light-client review

The existing two-wallet Zallet testnet path remains the accepted transaction proof. This review does not change the adapter or expand scope.

| Option                        | Source-supported capability                                                                                              | NOSTOS implication and remaining check                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Zallet customer wallet        | Existing G1/G4 project evidence proves memo payment and shielded receipt.                                                | Continue controlled testnet proof with the current isolated wallet.                                                                                                                                          |
| Native Android SDK            | Official SDK sends/receives shielded transactions, supports testnet/mainnet, and uses lightwalletd.                      | A future native customer path is feasible. Exact memo bytes and fresh shielded destination generation must be tested with the selected release.                                                              |
| Native iOS SDK                | Official light-client docs list the Swift SDK for wallet functions.                                                      | Separate native integration work, outside this patch.                                                                                                                                                        |
| ZODL Android reference wallet | Official setup lists testnet build variants. Official support says shielded sends can include a recipient-readable memo. | Candidate for an independent customer demo. Confirm testnet binary availability, supported shielded pool, full NOSTOS payload preservation, and fresh return address behavior before claiming compatibility. |
| Browser WASM sample           | The linked light-client page identifies a 2019 demo that is not actively maintained.                                     | This is not evidence of supported browser shielded-wallet integration. Do not build around it.                                                                                                               |

Lightwalletd provides chain information to light clients; it is not a browser wallet or a replacement for customer signing. Preserve the working Zebra/Zallet/Zaino environment. Do not install another node to resolve UI request failures.

ZIPs and librustzcash inform protocol and native wallet implementation. They do not by themselves prove browser wallet support. NEAR Intents adds a separate settlement scope and is not needed for private refunds of shielded Zcash payments.

## Official sources reviewed

- <https://zcash.readthedocs.io/en/latest/rtd_pages/lightclient_support.html>
- <https://github.com/zcash/zcash-android-wallet-sdk>
- <https://github.com/zodl-inc/zodl-android/blob/main/docs/Setup.md>
- <https://support.zodl.com/article/41-using-the-zcash-memo-field>
