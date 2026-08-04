# ADR-005: Product subscription billing through Cardcom

## Status

Accepted for the closed production pilot on 2026-08-04. Merchant onboarding,
legal approval, and a production test transaction remain release gates.

## Decision

- The launch price is ILS 39 per month, including Israeli VAT. The stored price
  is 3,900 agorot; at an 18% VAT rate the display breakdown is ILS 33.05 net
  and ILS 5.95 VAT.
- Cardcom is the Israeli acquiring gateway. Payment details are collected only
  on its hosted LowProfile page. CareDesk never receives or stores a card
  number or CVV.
- Cardcom returns a reusable provider token. The API encrypts that token with
  AES-256-GCM before it reaches Postgres. The encryption key is server-only.
- A Cardcom webhook is treated as a trigger, not proof. The API retrieves the
  LowProfile result server-to-server and matches its opaque return value to a
  short-lived setup intent before saving the token.
- Monthly charges run from a protected daily job. A stable external transaction
  identifier and a unique tenant-period database constraint make retries
  idempotent. Failed charges are retried at most three times.
- Only the account owner may add or remove a payment method. Other active family
  roles may see the plan but not full token data or provider credentials.

## Sponsored pilot safety rule

All pilot subscriptions start with a 100% application-level discount and no
charging date. Saving a payment method does not start billing. Switching a
specific tenant to paid billing requires all of the following:

1. a verified saved payment method;
2. accepted versioned recurring-payment terms;
3. a customer-notice date chosen by the operator;
4. the exact acknowledgement required by `pnpm billing:activate-subscription`.

There is intentionally no bulk activation button and no automatic end date for
the 100% discount. This prevents an environment-variable change or a Cardcom
coupon expiry from silently charging the pilot cohort.

## Consequences and release gates

- Cardcom merchant credentials and webhook URLs must be installed only in the
  API project, never the browser project.
- The terms and privacy notice are product drafts until Israeli counsel and the
  merchant acquirer approve them.
- Before live customer use, run one hosted card setup and one explicitly
  authorised ILS 39 monthly charge in the merchant production environment;
  verify the receipt, webhook retry, duplicate-job behaviour, cancellation and
  token removal.
- Monitor failed collections without emailing raw provider payloads or financial
  data.
