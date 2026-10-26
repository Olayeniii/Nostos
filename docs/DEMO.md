# Demo guide

Open with the outcome: a shielded payment was confirmed on mainnet, followed by a confirmed partial refund using the route supplied with that payment.

## Walkthrough

1. Show the existing receipt: 0.001 ZEC paid, 0.0005 ZEC refunded. Explain that "partially refunded" means half of the original payment was returned. The network fee is separate.
2. Show the matching merchant record and its payment, fulfillment and refund states. Fulfillment is merchant-reported; it is not inferred from chain confirmation.
3. Show payment-link creation and explain the customer's address, amount and exact memo review. Do not fund another payment for the recording.
4. Show how a customer requests a refund from the existing receipt and how the merchant reviews it. Explain these controls without submitting another request or signing another refund on the confirmed record.
5. Close on the value: the customer does not create an account or supply another refund address later.

Use the actual interface and existing saved records. Any illustrative animation must be identified as an explanation, not presented as a recording of a wallet transaction.

## Privacy explanation

The return route is a validated shielded receiving destination inside the original encrypted payment memo. It grants no spending authority. The merchant and service can read it for refund processing. An address alone does not disclose wallet balances or history, but reuse and service records can create links. The dedicated merchant account's full viewing key gives the service broader visibility into that account.

NOSTOS does not claim operator blindness, payer identity verification, ownership proof for the return route, or protection from all timing and network correlations. See [security](SECURITY_BOUNDARY.md).

## Recording and evidence

Keep real receiving addresses, memo contents, account emails, receipt capabilities, viewing keys, credentials and wallet exports out of the public video. Do not publish the private transaction references from the operator session. Preserve the unredacted records privately.

A public transaction ID alone does not reveal or prove a shielded amount or recipient. The current result and its provenance are summarized in [build status](BUILD_STATUS.md). Older testnet fixtures remain separately labeled in [historical evidence](../scripts/evidence/README.md).

Confirm the organizer's current video length and submission fields before export. Do not label a submission complete without its confirmation receipt.
