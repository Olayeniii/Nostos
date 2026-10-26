# Private same-account refund test

Normal product refund verification continues to reject destinations owned by the sending account. Wallet control verification always rejects self transfers.

Only the private observer worker process may opt into a test exception by setting `NOSTOS_SELF_REFUND_TEST_TXID` to one exact transaction ID. The request API has no parameter that enables it. Other transaction IDs retain the normal policy. Do not configure this setting in a public deployment. Remove it after reconciling the test.

The exception still requires a confirmed transaction, an owned input nullifier, the exact saved external receiving address, amount, memo, pool, fee cap, and unique output. The SDK classifies a receipt to the same account's external address as Incoming; this test accepts that classification only after proving the account funded the transaction. Internal change remains excluded. The native proof marks `self_refund_test: true`.

This is evidence of same-account mainnet test reconciliation, not proof of a refund between independent customer and merchant accounts. It must not be presented as that stronger result.
