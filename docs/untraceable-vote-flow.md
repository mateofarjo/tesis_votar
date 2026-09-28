# Untraceable Vote Flow

This project does not need a burner wallet for each vote. The voter never sends
the blockchain transaction from a personal wallet. Instead, the blockchain sees
only an anonymous signed credential and the selected candidate.

## Goal

The privacy goal is to avoid a link like this:

```text
voterId -> tokenHash -> candidate
```

The contract can already support this model because `emitirVoto` is public and
authorizes the vote with an RSA signature, not with `msg.sender`.

## Current Flow

1. The voter authenticates and completes biometric liveness off-chain.
2. The browser generates a canonical 32-byte random vote secret locally.
3. It computes `SHA-256("VOT.AR/VOTE-CREDENTIAL/v1" || token)` and blinds that
   domain-separated digest using the election authority public RSA key.
4. `/api/generar-token` checks that the authenticated voter is eligible.
5. The server signs only the blinded value.
6. The server stores that a credential was issued to that voter. For database
   compatibility it may store hashes of the blinded request values, but it does
   not store the final on-chain token hash, final signed token, candidate, or
   transaction hash.
7. The browser unblinds the signature locally and builds `tokenFirmado` from
   the 32-byte token and 256-byte signature.
8. `/api/voto` receives only `tokenFirmado` and `candidatoId`.
9. The relayer/authority wallet sends the transaction to the contract.
10. The contract reconstructs the domain-separated digest, verifies the RSA
    signature, marks the token hash as used, and increments the selected count.

## What The Blockchain Sees

The contract stores and emits:

```text
tokenHash -> candidatoId
```

It does not store the voter's account, DNI, biometric data, session ID, or app
user ID. The transaction sender is the relayer/authority wallet, shared by the
system, so it is not a voter identifier.

## What The Backend Sees

During credential issuance, the backend sees:

```text
voterId -> blindedToken
```

Because the token is blinded, the backend cannot derive the final `tokenHash`
that will appear on-chain.

During vote submission, the backend sees:

```text
tokenFirmado + candidatoId
```

The vote submission endpoint does not look up the authenticated voter and does
not join the vote to `voterId` or `voteTokenId` in audit logs.

## Why No Burner Wallet Is Needed

A burner wallet only changes the transaction sender. It does not solve the real
privacy problem if the backend can still map the voter to the token or candidate.
It can also add new traces, such as gas funding transactions.

This project uses a relayer wallet for gas and blind signatures for privacy. The
relayer wallet pays for the transaction, while the anonymous credential proves
that the vote is valid.

## Important Limitation

The on-chain event links the token hash and selected candidate. A transaction
hash can therefore let a voter demonstrate their selection to a third party.
This prototype does **not** claim coercion or vote-buying resistance; that
requires a redesigned protocol such as re-voting or encrypted ballots with
deferred opening.

The public API reserves counts and percentages until the ballot box is
`FINALIZADA`. Public-chain events remain directly observable, so this prevents
the application from amplifying partial results rather than replacing a
privacy-preserving tally protocol.

After the server blind-signs a credential, it cannot revoke that credential
without learning the final token. For that reason, the implementation issues only
one anonymous credential per voter. If a voter loses the browser session before
submitting the vote, a recovery flow would need a more advanced protocol.

The `expiresAt` value belongs to the off-chain issuance record and UI state. In
this privacy-preserving flow it is not a cryptographic on-chain expiry, because
checking expiry server-side during vote submission would require linking the
final token back to the voter-issued database record.
