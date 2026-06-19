# Liskat

Play [Skat](https://en.wikipedia.org/wiki/Skat_(card_game)) online, for free.

Inspired by [lichess](https://lichess.org)'s philosophy — free, open, ad-free,
no bots — but built fresh for Skat rather than forked, since Skat (3-player,
hidden-hand, trick-taking with bidding) shares almost no game model with chess.

## Architecture

A TypeScript monorepo, separating pure rules from transport and UI — the one
idea most worth borrowing from lichess.

| Package            | Role                                                              | Status |
| ------------------ | ---------------------------------------------------------------- | ------ |
| `packages/engine`  | Pure Skat rules: cards, bidding, trick resolution, scoring        | ✅ started |
| `packages/server`  | Authoritative game server + matchmaking lobby (WebSocket)         | planned |
| `packages/client`  | Web UI: the table, the cards (SVG)                                | planned |

The engine has **zero dependencies** and runs on Node's built-in test runner
and type stripping — no build step.

```bash
cd packages/engine && npm test
```

## Game formats (planned)

- Quick rounds (e.g. 3 deals)
- Full session (e.g. 9 deals)
- Race to a target score (e.g. first to 1000)

## License

AGPL-3.0-or-later, matching lichess.
