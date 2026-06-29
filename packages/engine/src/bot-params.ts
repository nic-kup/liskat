// Tunable weights for the heuristic bot (see bot.ts). Everything the bot used to
// hard-code as a magic number lives here instead, as a flat record of numbers so
// it can be perturbed by the evolution harness (experiments/, gitignored) and the
// winning weights pasted back into DEFAULT_PARAMS.
//
// Bidding decisions are linear scores: each game type sums a few hand features
// times their weights and is bid when the score clears that game's threshold.
// Play decisions are simple thresholds the same scoring touches. None of this
// needs to be integral; the comparisons are all `>=`, so evolved floats work.

export interface BotParams {
  // --- Suit game: bid when (trump*trumps + sideAce*sideAces + jack*jacks +
  //     void*sideVoids + ten*sideTens) >= threshold. (Jacks are also trumps, so
  //     `jack` is an extra nudge on top of their trump count.)
  suitTrump: number;
  suitSideAce: number;
  suitJack: number;
  suitVoid: number; // a side suit we hold no plain card in (can ruff it)
  suitTen: number; // a ten in a side suit
  suitThreshold: number;

  // --- Suit HAND game: play the dealt 10 cards closed (decline the skat) when
  //     (handTop*topRun + handTrumps*trumps) >= handThreshold. `topRun` is the
  //     number of guaranteed top tricks in the SIDE suits: the unbroken run from
  //     the top, an ace (1) or an ace and ten together (2), but never a ten
  //     without its ace. Only strong, top-heavy hands should risk the closed game.
  suitHandTop: number;
  suitHandTrumps: number;
  suitHandThreshold: number;

  // --- Grand: bid when (jack*jacks + ace*aces + clubJack*hasClubJack) >= threshold.
  grandJack: number;
  grandAce: number;
  grandClubJack: number;
  grandThreshold: number;

  // --- Null: only with no ace; counts of low cards (7/8/9) gate the two rungs.
  nullHandMinLows: number; // >= this -> play null hand (closed, no skat)
  nullMinLows: number; // >= this -> play null taking the skat

  // --- Auction position: when both opponents have already passed (we're sure to
  // get the contract uncontested), lower the suit/grand bidding bar by this much,
  // so a marginal hand we'd otherwise pass becomes worth a cheap, free game.
  passedPriorBonus: number;

  // --- Speculative pickup: during the auction (only), lower the suit/grand bar by
  // this much for EVERY hand, modelling the expected lift from the two skat cards
  // we'll pick up. Lets a borderline hand bid on the chance the skat improves it;
  // not applied when declaring (by then the real cards are known, so we bid those
  // honestly). Stacks additively with passedPriorBonus.
  skatBidBonus: number;

  // --- Play: declarer, suit/grand.
  declarerPullTrumpsMinOut: number; // keep leading trumps while this many or more are still out; below it, switch to cashing
  declarerCashSafeOnly: number; // > 0.5: when cashing a side master, skip suits an opponent can ruff (don't feed an ace to a ruff)
  // When following a side suit it could ruff, the declarer "breaks in" (spends a
  // trump to take the trick) when it is last to play, OR when this linear score
  // clears zero. The features: points already in the trick, trumps left in hand,
  // total cards left in hand, and high side cards (A/10) held; plus a bias.
  declRuffValue: number;
  declRuffTrumps: number;
  declRuffHand: number;
  declRuffSideHigh: number;
  declRuffBias: number;

  // --- Play: defender, suit/grand.
  defenderLeadHonour: number; // > 0.5: when partner sits behind the declarer, lead a K/Q up to them instead of a dead low card
  defenderCashMaster: number; // > 0.5: on lead, cash any card that has become the master of its suit (and can't be ruffed), not just aces
  defenderSafeLead: number; // > 0.5: when shedding a low card, avoid a suit the declarer is void in and could ruff (else any low card; sometimes forcing a ruff is better)
  // Whether to spend a trump to beat the declarer, scored like the declarer's ruff
  // (trick value, own trumps, cards left, high side cards) plus a term for being
  // last to play, where a ruff is safe from an over-ruff; breaks in when >= 0.
  defBreakValue: number;
  defBreakTrumps: number;
  defBreakHand: number;
  defBreakSideHigh: number;
  defBreakLast: number;
  defBreakBias: number;

  // --- Play: null (declarer must LOSE every trick). On lead, lead a low card from a
  // short/safe suit: score = nullLeadRank*rank + nullLeadLen*suitLen, lowest leads.
  // When void in the led suit and free to discard, shed a high card from a short
  // suit: score = nullDiscardRank*rank - nullDiscardLen*suitLen, highest discarded.
  // (Following the led suit always plays the highest card that still ducks.)
  nullLeadRank: number;
  nullLeadLen: number;
  nullDiscardRank: number;
  nullDiscardLen: number;

  // --- Experimental card-play model (bot-play-score.ts). When scorePlay > 0.5 the
  // bot replaces the branchy play heuristic above with a linear per-card scoring
  // model whose weights live in playW (four role-specific vectors). Default OFF, so
  // production plays exactly as before until an evolved playW is validated and
  // shipped. The bidding/declaring genes are unaffected either way.
  scorePlay?: number;
  playW?: import('./bot-play-score.ts').PlayWeights;

  // --- Monte-Carlo contract selection (bot-mc.ts). When > 0, the bot picks its
  // game/bid by simulating each candidate contract this many times per determinized
  // world and choosing the best expected points, instead of the linear bidding
  // formula above (the suit*/grand*/null* thresholds, passedPriorBonus, skatBidBonus,
  // suitHand* genes are then unused). Card play is unaffected. Higher = less noisy but
  // slower (~tens of ms per decision at 32). 0/undefined keeps the formula bidder.
  mcBidK?: number;

  // --- When > 0, the MC bid-evaluation playouts (bot-mc.ts) lay the skat away with the
  // LEARNED scored discard (playW.discSuit/discNull) instead of the cheap heuristic, so
  // the simulated win rate matches how the bot will ACTUALLY play. With a strong learned
  // discard the heuristic-discard playouts under-rate hands and the bot under-bids; this
  // aligns the estimate with reality. 0/undefined keeps the heuristic in playouts.
  mcScoredDiscard?: number;

  // --- When > 0, the MC bidder holds the auction up to the highest VALUE among ALL +EV
  // games, not just its single best-EV game, and at declare time picks the best-EV +EV
  // game that covers the won bid. So a bid pushed past the best game doesn't make the bot
  // drop another game it would still profitably play (e.g. keep a +EV grand alive once the
  // bid passes a higher-EV but lower-value suit). 0/undefined keeps the best-game ceiling.
  mcAnyPositiveEV?: number;

  // --- When > 0, the declarer RE-EVALUATES the contract after taking the skat using all
  // 12 known cards (bot-mc.ts mcEvaluateHand12), instead of the bid-time 10-card estimate.
  // The two skat cards can change which game is best; this declares the one the actual
  // hand supports. Only affects the declare step (once per game), not bidding.
  mcPostSkat?: number;

  // --- When > 0, the MC EV uses the MEAN REALIZED game value across playouts (won? value
  // : -2*value, with schneider/schwarz baked into value) instead of P(win)*BASE -
  // P(loss)*2*BASE. Accounts for win/loss MAGNITUDE -- strong hands that often win with
  // schneider, and losses that get schneidered against. The bid ceiling stays at base
  // value. 0/undefined keeps the base-value EV.
  mcRichEV?: number;

  // --- When > 0, the MC bidder treats a closed HAND game (declining the skat for +1
  // multiplier) as just another candidate alongside the skat games: it estimates the hand
  // game's EV from the 10-card hand and plays it only when that EV beats every skat game.
  // Because only +EV candidates lift the ceiling, the bot bids up to a hand value only when
  // the hand game is genuinely makeable -- it never overbids reaching for the multiplier.
  // 0/undefined -> always take the skat (hand games off).
  mcHandGame?: number;

  // --- When > 0 (requires mcHandGame), a closed hand game also evaluates announcing schneider
  // and schwarz, REUSING the same rollouts (no extra sims): each rollout's realized schneider/
  // schwarz outcome is tallied and the announcement with the best mean signed value is declared.
  // Conservative -- game selection still ranks on the non-announced EV, and announcing only when
  // even win-focused rollouts deliver it often. 0/undefined -> never announce.
  mcAnnounce?: number;
}

// Tuned by self-play evolution (experiments/, gitignored): 300 bots, tables of 3,
// 48 deals each, Seeger-Fabian selection, ~300 generations, fresh random init with
// a hall of fame, using perfect memory of the public play record (bot-memory.ts).
// The champion is chosen by a two-stage benchmark against a FIXED production genome
// (cheap 480-deal screen, then a 6000-deal confirm) and then validated on a disjoint
// 40k-deal head-to-head before shipping (experiments/ab-skat.ts) -- this genome wins
// by ~+0.5 pts/deal over the prior shipped bot across four independent deal seeds,
// at a ~75% declarer win rate (it bids a bit more, but profitably). The gains are in
// PLAY, not bidding: declarerCashSafeOnly is on (don't feed a master to a ruff), the
// defensive break-in (defBreak*, defenderLeadHonour) is more active, and the bid bar
// relaxes more once both opponents pass (passedPriorBonus).
//
// Two levers added earlier (suit HAND game suitHand*, and skatBidBonus -- relax the
// bid bar for the expected skat lift) are kept wired so future runs can use them,
// but this champion left both effectively OFF (hand-game threshold very high,
// skatBidBonus ~0): its play-weight gains outweighed what those levers bought. To
// bid more often at some cost in win rate, lower suitThreshold / grandThreshold.
export const DEFAULT_PARAMS: BotParams = {
  suitTrump: 1.132,
  suitSideAce: 0.826,
  suitJack: 0.194,
  suitVoid: 0.324,
  suitTen: 0.18,
  suitThreshold: 7.416,

  suitHandTop: 0.454,
  suitHandTrumps: 0.808,
  suitHandThreshold: 15.834, // very high -> hand games effectively off for this genome

  grandJack: 0.68,
  grandAce: 0.902,
  grandClubJack: 0.834,
  grandThreshold: 4.362,

  // Null bidding: no ace and >= 8 low cards. Lowered from ~9.16/9.78 once the scored
  // null-declarer play (playW.nullDecl) made null biddable: out-of-sample, null wins
  // ~74% at 8 final lows (well above the ~57% break-even), and enabling it nets
  // +0.03..+0.05 pts/deal across seeds while the bot now actually plays some nulls.
  nullHandMinLows: 8,
  nullMinLows: 8,

  passedPriorBonus: 0.459,
  skatBidBonus: 0.051, // negligible; speculative bidding stays effectively off

  declarerPullTrumpsMinOut: 1,
  declarerCashSafeOnly: 0.834,
  declRuffValue: -0.001,
  declRuffTrumps: -0.004,
  declRuffHand: -0.048,
  declRuffSideHigh: 0.455,
  declRuffBias: 4.425,

  defenderLeadHonour: 0.607,
  defenderCashMaster: 0.487,
  defenderSafeLead: 0, // A/B'd below; 0 = current behaviour (no ruff-avoidance steering)
  defBreakValue: 0.054,
  defBreakTrumps: 0.84,
  defBreakHand: 0.189,
  defBreakSideHigh: 0.09,
  defBreakLast: 0.799,
  defBreakBias: 0.447,

  // Null-play weights are hand-tuned (this genome almost never bids null, so the
  // general search gives them no signal); a dedicated null-focused run can refine
  // them. Lead low from a short suit; discard high from a short suit.
  nullLeadRank: 1,
  nullLeadLen: 0.3,
  nullDiscardRank: 1,
  nullDiscardLen: 0.3,

  // Linear card-play model (bot-play-score.ts), ON. Each legal card is scored by a
  // weighted feature vector and the best is played; suitDecl/suitDef cover suit &
  // grand play (declarer / defender). Evolved by experiments/evolve-play.ts with the
  // bidding frozen. This is the ITERATION-4 genome: the feature set added the split
  // features lead_len_trump/lead_len_side (the overloaded lead_len, validated by the
  // defender split -3.48 -> trump -1.86 / side +1.72) and win_ruff_last. Validated
  // head-to-head vs the iteration-3 genome across five 30k-deal seeds at +0.31 pts/deal
  // avg (all positive), on top of iteration-3's +2.4 over the original heuristic.
  // nullDecl is kept from the null-focused run (NOT from this general run, where null
  // is never bid and the weights drift); see bot.ts -- null DECLARER uses nullDecl,
  // null DEFENDER stays on the heuristic.
  // Monte-Carlo contract selection (bot-mc.ts): ON. Picks the game by simulated EV
  // rather than the linear formula above -- worth ~+5 pts/deal head-to-head vs the
  // formula bidder (fixes the high-value-suit bias, finds profitable grands/nulls).
  // The suit*/grand*/null bidding genes above are now inert in production (kept for
  // the formula bidder, used when mcBidK is 0, e.g. the evolution harnesses).
  mcBidK: 32,

  // Hold the auction up to the most valuable +EV game (not just the single best-EV game)
  // and declare the best-EV game that covers the won bid -- never drop a game we'd still
  // profitably play. Correctness fix; ~neutral on average (paired MC A/B +0.50/-0.32/+0.15
  // across 3 seeds, pooled +0.11 -- the bid-between-two-+EV-games case is rare) but strictly
  // right in the cases it fires.
  mcAnyPositiveEV: 1,

  // MC bid playouts lay the skat away with the learned discard, so the simulated win
  // rate matches actual play. Without it the bidder under-rated hands and passed too
  // many; turning it on declares ~65% more (the now-winnable hands the better discard
  // unlocked) for +4.7 pts/deal vs the heuristic-discard bidder, validated by a paired
  // MC A/B across three seeds (+5.35/+4.65/+4.13). Pairs with the learned discard above.
  mcScoredDiscard: 1,

  // Re-evaluate the contract after taking the skat using all 12 known cards instead of
  // the bid-time 10-card estimate -- the two skat cards can flip which game is best, so
  // declare the one the actual hand supports. +0.86 pts/deal, paired MC A/B across three
  // seeds (+0.80/+0.30/+1.49). The declared game rarely changes, but re-declaring the
  // right one when it does is worth it. Only runs at declare time (once per game).
  mcPostSkat: 1,

  // EV uses the mean REALIZED game value across playouts (schneider/schwarz included)
  // instead of P(win)*base - P(loss)*2*base, so the bidder accounts for win/loss
  // MAGNITUDE (strong hands that win with schneider, losses schneidered against), not
  // just win rate. +0.53 pts/deal, paired MC A/B across three seeds (+0.39/+0.43/+0.77);
  // bid volume barely moves, so the gain is purely better game choice.
  mcRichEV: 1,

  // Treat a closed HAND game (decline the skat for +1 multiplier) as just another candidate
  // in the MC EV comparison: estimate its EV from the 10-card hand and play it only when it
  // beats every skat game. Because only +EV candidates lift the bid ceiling, the bot bids up
  // to a hand value only when the hand game is genuinely makeable -- it never overbids for the
  // multiplier. Paired MC A/B (full bidder, on vs off): +0.28 pts/deal (an earlier small run
  // read +1.16; the larger run firmed it down), 83-84% win rate on the hand games it plays, so
  // not overbidding. ~34% of declarations become hand games in self-play -- a big behavioural
  // shift; self-play likely over-rewards it since bot defenders punish a closed hand less than
  // a human would, so the real-game value may be smaller. Was hardcoded off (always take skat).
  mcHandGame: 1,

  // Announce schneider/schwarz on a hand game when the same rollouts judge it the best EV.
  // Paired MC A/B vs off: +0.047 pts/deal (neutral, within noise); fires rarely (~0.7% of
  // declarations) and won every announced game in the sample (4/4) -- a conservative, low-risk
  // capability rather than a points source. Reuses the hand-game rollouts (no extra sims).
  mcAnnounce: 1,

  scorePlay: 1,
  // Play weights. DECLARER (suitDecl, grandDecl) and the discard (discSuit, discNull) were
  // RE-LEARNED by GA search on the real-game arena (experiments/train-relearn.ts: lone scored
  // bot vs two frozen production bots, formula bidder so no play->bid feedback). The search
  // found a clear DECLARER improvement -- worth ~+0.38 pts/deal on the bidding-isolated FORMULA
  // paired A/B vs the prior production (4 seeds +0.76/+0.30/+0.39/+0.07, all in the declarer
  // role; grandDecl is now a SEPARATE grand-declarer vector, previously a suit fallback).
  // DEFENDER (suitDef, grandDef) and null vectors are KEPT from the prior hand-tuned production:
  // the search did NOT improve defender play (its searched defender weights were flat-to-slightly
  // -negative on the A/B), so per "take the better one" the existing defender weights stay --
  // which also preserves the validated overtake_partner (idx 32) and lead_dead_master (idx 33)
  // fixes. suitDef still ends -2.5, -6, -6 (lead_ruff_highpts, overtake_partner, lead_dead_master).
  playW: {
    suitDecl: [1.308543, -1.949084, -4.885638, 4.905055, 1.149042, 0.411017, 3.875155, 1.121729, -0.438159, 1.691516, -2.566437, 1.166505, 0.273881, 1.621428, -0.499651, -1.795083, -0.905148, 3.390503, -3.594902, -0.216665, 0.49171, 2.771156, -1.271242, 0.814301, -0.293116, -0.162628, -0.494069, 0.010716, -0.094207, 0, -0.283527, -0.053788, 0, 0.817863],
    suitDef: [0.487751, -2.929059, -4.843112, 0.045809, 3.734863, 1.758428, -0.393533, 2.356083, 3.496064, 1.72923, -2.521181, -0.76086, 3.451897, 2.18019, -2.193521, 4.296792, -1.873368, 1.763556, -3.16899, 1.072616, 0.321555, 2.853362, 0.191685, -0.28744, -1.860952, 1.716749, -3.150405, 0, 0, 0, 0, -2.5, -6, -6],
    // PER-SEAT suit-defender vectors (GA search, experiments/train-defseat.ts: candidate
    // plays BOTH defenders vs a frozen prod declarer in the defender-PAIR arena). The two
    // defender seats want different play -- "before" sits just before the declarer (declarer+2),
    // "after" just after (declarer+1). Out-of-sample: +1.378 def-pts/deal in the pair arena
    // (both seats contribute, mildly super-additive) and +0.331 pts/defended-game in the solo
    // arena (bot + prod partner, no regression). chooseCardScored picks by seat; suitDef remains
    // the fallback (grand defence still uses grandDef->suitDef, unchanged).
    suitDefBefore: [0.856805, -2.047421, -4.281955, -0.681485, 4.081644, 2.022325, 0.290523, 0.87508, 3.188111, 1.357145, -3.437605, -1.451945, 5.427514, 0.314839, -2.497298, 2.574131, -2.733883, 2.330435, -4.129293, 0.844515, 1.657758, 2.751045, 0.858692, -0.863814, -4.623798, 2.107144, -2.277035, -0.224743, -0.46029, -0.882816, -0.361428, -2.720481, -5.204327, -4.230272],
    suitDefAfter: [-1.536555, -5.340962, -3.561946, 0.562318, 2.111379, 1.029225, -3.363873, 3.045146, 4.611165, 0.0314, -2.444869, -0.130063, 3.124972, 1.471018, -1.209487, 4.092023, -3.221664, 3.546189, -4.071049, 0.153609, -1.832771, 2.380737, 0.758947, -0.119783, -1.534457, 1.28647, -3.320998, -0.051506, 0.570121, 0.413947, 0.309014, -2.070785, -5.94728, -4.756048],
    grandDecl: [1.645909, -2.483149, -4.936745, 4.987506, 1.242564, 0.896389, 4.039699, 1.300281, 0.391092, 2.041361, -2.760466, 1.374567, -0.0314, 1.452362, -0.484694, -2.204918, -0.343821, 3.886154, -4.627031, 1.649609, -1.321752, 2.514468, -1.557942, 0.415492, -0.519832, 0.451429, -0.548377, 0.169945, -0.086565, 0, -0.218796, -1.206072, 0, 0],
    grandDef: [0.487751, -2.929059, -4.843112, 0.045809, 3.734863, 1.758428, -0.393533, 2.356083, 3.496064, 1.72923, -2.521181, -0.76086, 3.451897, 2.18019, -2.193521, 4.296792, -1.873368, 1.763556, -3.16899, 1.072616, 0.321555, 2.853362, 0.191685, -0.28744, -1.860952, 1.716749, -3.150405, 0, 0, 0, 0, -2.5, -6, -6],
    // PER-SEAT GRAND defenders (GA search, experiments/train-defseat-grand.ts -- same
    // defender-pair arena, suit defenders frozen). Out-of-sample: +0.524 def-pts/deal pair
    // (mostly the after-seat) and +0.179 pts/defended-game solo, no regression. Selected by
    // seat in chooseCardScored; grandDef -> suitDef remains the fallback when absent.
    grandDefBefore: [1.005628, -2.921422, -5.809566, -1.530458, 1.726516, 0.869575, 0.16158, 3.929011, 3.365928, 2.460164, -3.788555, 0.715282, 4.127682, 1.076829, -2.517215, 4.126264, -0.362159, 0.964999, -4.762175, 0.596416, -0.449427, 1.090677, -0.34725, 1.20096, -1.541022, 3.201657, -2.046321, -1.444422, 0.76587, -0.319015, 0.317684, -2.117133, -3.595301, -4.713769],
    grandDefAfter: [-0.459003, -3.22455, -4.091614, -0.398831, 2.483113, 0.587633, -0.429594, 3.584728, 2.824764, 1.27944, -2.558825, -0.145025, 2.924367, 1.481008, -2.451887, 2.624487, -0.960045, 1.847016, -3.579404, 3.746974, -0.493055, 4.193719, 0.561519, 0.772557, -1.676068, 2.77946, -3.410146, 0.229589, -1.685514, -1.429614, -0.408149, -1.928722, -5.171424, -6],
    nullDecl: [-1.670991, 3.95427, -0.443455, -3.641406, -0.766451, 1.166043, -1.716698],
    nullDef: [-0.152611, -4.254485, -3.534734, -2.60709, 3.369348, -0.969604, -2.879463],
    discSuit: [-0.133363, -4.291359, -5.21138, 0.238447, 1.228396, 0.88801],
    discNull: [2.958071, 1.253295, 1.701583, -1.346473],
  },
};

// The order/identity of the tunable genes, for the evolution harness. Keeping it
// here (next to the interface) means a new gene is added in exactly one place.
export const PARAM_KEYS: (keyof BotParams)[] = [
  'suitTrump',
  'suitSideAce',
  'suitJack',
  'suitVoid',
  'suitTen',
  'suitThreshold',
  'suitHandTop',
  'suitHandTrumps',
  'suitHandThreshold',
  'grandJack',
  'grandAce',
  'grandClubJack',
  'grandThreshold',
  'nullHandMinLows',
  'nullMinLows',
  'passedPriorBonus',
  'skatBidBonus',
  'declarerPullTrumpsMinOut',
  'declarerCashSafeOnly',
  'declRuffValue',
  'declRuffTrumps',
  'declRuffHand',
  'declRuffSideHigh',
  'declRuffBias',
  'defenderLeadHonour',
  'defenderCashMaster',
  'defenderSafeLead',
  'defBreakValue',
  'defBreakTrumps',
  'defBreakHand',
  'defBreakSideHigh',
  'defBreakLast',
  'defBreakBias',
  'nullLeadRank',
  'nullLeadLen',
  'nullDiscardRank',
  'nullDiscardLen',
];
