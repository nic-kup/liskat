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

  // --- Softmax play randomness. When > 0, the scored play policy SAMPLES a card from
  // softmax(score / playTemp) over the legal candidates instead of taking the strict
  // argmax, so the bot varies its play (less predictable, more human-like) at a cost in
  // strength that grows with the temperature. 0/undefined = strict argmax (current
  // behaviour, byte-identical). The sample is seeded from the public+private game state,
  // so it is reproducible and replay-safe. NEVER applied inside MC rollouts (the EV
  // estimate must stay low-variance): bot-mc forces greedy play in its playouts.
  playTemp?: number;

  // --- Refinements to the softmax (all only matter when playTemp > 0):
  // playBandDelta: only cards whose score is within this much of the best score are
  //   eligible to be sampled; the softmax runs over that top band. Bounds the EV given
  //   up per decision by ~delta (in score units) and never plays a clearly-worse card.
  //   0/undefined = no band (softmax over all legal cards).
  // playTempEndgameTrick: from this trick index onward (s.trickCount), force greedy
  //   (temp -> 0). The endgame is countable/forced, so the linear model's "near-ties"
  //   there are false; randomising bleeds EV. undefined = no endgame gate.
  // playTempDefFactor: multiply the temperature by this for the DEFENDERS (declarer
  //   keeps the full temp). The defender's card-choice channel is more valuable for
  //   partner signalling than for denying the declarer, so a lower defender temp is
  //   usually right. undefined/1 = same temp for all roles; 0 = defenders play greedy.
  playBandDelta?: number;
  playTempEndgameTrick?: number;
  playTempDefFactor?: number;

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

  // Softmax play randomness, ON at a very low temperature: the scored play SAMPLES from
  // softmax(score / 0.01) instead of the strict argmax, so the bot varies its card play
  // (~2.8% of decisions differ from the argmax, only the closest near-ties) -- less
  // predictable / more human-like, with NO measurable strength cost. Paired A/B vs greedy
  // argmax, N=12000 (experiments/ab-softmax.ts): +0.10 +/- 0.17 pts/deal (statistically
  // zero, faintly positive). Higher temperatures buy more variety but cost real points
  // (T=0.10 -> -0.39; >=0.7 bits of entropy -> -1.5..-2), and banding/phase/role-gating did
  // NOT discount that (ab-softmax-cfg.ts) -- cost is ~convex in the deviation rate, so the
  // free zone is just this low-T sliver. Rollouts force greedy (bot-mc strips playTemp), so
  // the MC bidder/declarer EV estimates are unaffected. 0/undefined would restore argmax.
  playTemp: 0.01,

  // Play weights, RE-LEARNED under the shipped softmax policy (playTemp=0.01) by parallel GA
  // search (experiments/train-play2.ts + train-discgrand.ts), validated with real-game MC A/Bs:
  //  * DECLARER (suitDecl, grandDecl) + suit discard (discSuit): lone scored bot vs two frozen
  //    prod (defenders frozen, so the signal is pure declarer). Real-game MC A/B (mcBidK=32 both
  //    sides) = +2.76 +/- 0.75 pts/deal vs the prior production; held-out + role-decomposed gates
  //    passed, guardrails (overtake idx32, dead-master idx33) intact.
  //  * GRAND discard (discGrand): NEW vector split from discSuit (grand trump rules differ),
  //    trained grand-boosted; held-out +1.12 on the grand mix (small per-deal, grand is rare).
  //  * PER-SEAT DEFENDERS (suitDefBefore/After, grandDefBefore/After): best-response in the
  //    defender-PAIR arena vs the NEW declarer above. Formula-pair held-out +0.68, real-game MC
  //    pair gate +0.49 +/- 0.38 def-pts/deal (both defenders upgraded); dead-master guardrail OK.
  //  * KEPT from prior production: suitDef/grandDef (inert fallbacks), and ALL null vectors
  //    (nullDecl, nullDef, discNull) -- null is ~never bid/defended in these arenas, so their
  //    searched values are noise; the dedicated-run null weights stay.
  playW: {
    suitDecl: [0.546586, -2.043597, -5.027189, 5.310094, 1.750024, 0.659296, 3.346729, 0.923202, 0.162783, 1.712527, -2.429282, 0.858229, 0.183433, 1.634626, -0.345866, -1.359787, -0.905148, 3.081552, -3.435266, 0.013259, 0.439582, 2.764736, -1.730357, 0.794651, 0.254129, -0.229814, -1.099494, 0.389519, -0.753247, 0.374992, -0.639984, 0.219593, -0.020756, 0.854782],
    suitDef: [0.487751, -2.929059, -4.843112, 0.045809, 3.734863, 1.758428, -0.393533, 2.356083, 3.496064, 1.72923, -2.521181, -0.76086, 3.451897, 2.18019, -2.193521, 4.296792, -1.873368, 1.763556, -3.16899, 1.072616, 0.321555, 2.853362, 0.191685, -0.28744, -1.860952, 1.716749, -3.150405, 0, 0, 0, 0, -2.5, -6, -6],
    // PER-SEAT suit-defender vectors (GA search, experiments/train-defseat.ts: candidate
    // plays BOTH defenders vs a frozen prod declarer in the defender-PAIR arena). The two
    // defender seats want different play -- "before" sits just before the declarer (declarer+2),
    // "after" just after (declarer+1). Out-of-sample: +1.378 def-pts/deal in the pair arena
    // (both seats contribute, mildly super-additive) and +0.331 pts/defended-game in the solo
    // arena (bot + prod partner, no regression). chooseCardScored picks by seat; suitDef remains
    // the fallback (grand defence still uses grandDef->suitDef, unchanged).
    suitDefBefore: [-0.993393, -2.807491, -1.388044, 0.563506, 3.554725, 1.849851, 1.877632, 2.421958, 3.334848, 1.301353, -3.505213, -1.051488, 5.909185, 0.551739, -1.38333, 1.300435, -4.875635, 1.680266, -4.929765, 0.391167, 2.596232, 3.39311, 0.969311, -2.404065, -5.637028, 1.951473, -0.287771, 0.372642, 2.035584, -0.358793, -0.25119, -2.005941, -6, -1.861317, -1.192282, 0.343346, -0.163302, -0.137006, -0.924264, 0.858276, -0.922438, -0.587619, -0.845444, 1.032754, -0.672182, 0.652882, -0.215179, 0.364747, 0.5041, 1.212437, 0.907078, 1.22063, 0.823806, 0.979909, -0.084392, -0.866468, 0.199674, -0.352768, 0.072376, -0.89515, 0.335581, -1.033485, -0.706449, -0.747903, -0.291447, -0.617435, -1.24047, -0.109118, -0.812611, -1.131703, 0.151922, -0.347866, -0.12591, -0.335831, -1.41746, -0.241448, 0.502588, 0.399671, -0.760531, 0.516863, -0.873973, -0.406558, 0.240766, 1.224293, 0.264013, -1.140709, -0.581342, -0.504592, -1.011495, 0.68243, -1.070621, -0.650934, -1.207026, -0.82216, -0.615482, 1.218755, 0.324404, -1.838893, -0.1777, 1.640635, 1.085796, 0.238363, 0.06282, 1.036364, 0.051081, -0.521813],
    suitDefAfter: [-0.186643, -2.998912, -2.119367, -0.037191, 2.89476, 2.38936, -3.405468, 2.863562, 5.165908, 0.631702, -4.324553, 0.528909, 2.241396, 1.804623, -2.104224, 4.757861, -1.001894, 2.876694, -6, -1.035244, -1.922457, 4.41166, 0.452643, -2.999747, -4.191141, 0.816731, -3.069285, 0.64359, -0.090866, 0.824557, 0.21605, 0.15604, -4.764603, -5.537093, -0.308519, 0.270354, -1.706083, -0.19769, -0.567327, -1.425214, -0.35578, -1.362558, 1.036189, 0.095764, -0.391243, 0.880825, 0.095316, -1.211963, -0.079719, 0.262449, 0.0994, -1.022911, -0.845238, -0.230405, 0.429086, -0.335448, 0.317211, 0.634797, -0.585165, -1.23711, 0.244418, 0.546905, -0.272519, -0.158643, 1.582882, 0.567465, -0.15309, 0.514607, -1.440925, -2.364996, 0.433211, -0.154176, -0.309752, 1.444213, 1.096569, 0.008596, -0.580551, -0.399167, 0.271989, -0.324564, 0.116506, 0.669131, -0.289973, 1.329179, 0.117903, -0.455894, -0.233967, -0.608634, 0.559373, -0.676789, 0.328393, 0.298032, -0.120363, 0.041334, -1.136705, 0.534234, 1.181961, 1.29151, -0.029675, 0.698853, 0.604491, 1.517901, -0.292148, -0.325879, 0.114064, 0.810559],
    grandDecl: [1.686348, -2.320855, -4.536708, 4.691855, 1.220599, 0.73789, 3.056671, 0.876222, 0.146802, 2.235797, -3.254288, 1.482255, -0.0314, 1.852868, -0.310507, -2.330865, -0.6715, 4.640915, -4.999845, 1.874703, -1.438376, 2.620432, -1.961525, 1.726994, -0.548453, -0.015709, -0.7693, 0.359029, -0.210134, 0.977612, -0.218796, -0.660543, 0.513888, 0.721173],
    grandDef: [0.487751, -2.929059, -4.843112, 0.045809, 3.734863, 1.758428, -0.393533, 2.356083, 3.496064, 1.72923, -2.521181, -0.76086, 3.451897, 2.18019, -2.193521, 4.296792, -1.873368, 1.763556, -3.16899, 1.072616, 0.321555, 2.853362, 0.191685, -0.28744, -1.860952, 1.716749, -3.150405, 0, 0, 0, 0, -2.5, -6, -6],
    // PER-SEAT GRAND defenders (GA search, experiments/train-defseat-grand.ts -- same
    // defender-pair arena, suit defenders frozen). Out-of-sample: +0.524 def-pts/deal pair
    // (mostly the after-seat) and +0.179 pts/defended-game solo, no regression. Selected by
    // seat in chooseCardScored; grandDef -> suitDef remains the fallback when absent.
    grandDefBefore: [1.383949, -4.319913, -5.320769, -2.892158, 4.152729, -0.034944, 1.288017, 3.920985, 4.361511, 2.002902, -4.731488, 1.300552, 5.742788, 2.112249, -3.240144, 4.168008, -0.254115, 3.049506, -5.937807, -0.716803, -2.434157, 0.716933, -0.301482, 3.414918, -4.084675, 3.943409, 0.646755, -1.164594, -0.429798, 0.660508, -0.788213, -0.622552, -2.93111, -2.593586, 0.464424, -0.084857, 0.027321, -1.069444, -0.265892, -0.038729, 0.613932, -1.290496, -0.219499, -0.621231, -0.146051, -0.342411, -0.763579, 0.245928, 0.206519, -0.293343, 0.518914, -0.556465, -1.41504, 0.712753, -0.952071, 1.100589, -0.346033, -0.488974, -0.978568, -0.213406, -0.949545, -0.202171, 0.126611, 0.222851, -0.046695, -0.733977, -0.111655, 1.22384, 0.419269, -1.007254, -0.209826, 0.472758, 1.227354, -0.163226, -0.946457, -0.093049, 1.14006, -0.577012, -0.383709, -0.421649, -0.177442, 0.268739, 0.771906, 0.361341, 1.01329, 1.215281, 0.645939, -0.394772, 1.457983, 0.130828, 1.719496, -0.849795, -0.693734, -1.978678, -0.160078, -0.002901, -0.275132, 0.539814, 0.866426, -0.156878, -0.868308, 0.349845, -0.810519, 1.120833, 0.615736, -0.697516],
    grandDefAfter: [-0.24188, -2.304118, -3.857364, -2.220089, 2.462156, 0.114186, -0.987337, 6, 3.786376, 2.466156, -2.543024, 1.878591, 2.426473, 1.120105, -4.395834, 3.305492, -3.366774, 1.397961, -4.825966, 2.614283, 0.82169, 4.230793, 1.450076, 1.687901, -2.86188, 3.69584, -3.202744, 2.588356, -1.022668, -1.195156, -0.640286, -2.418473, -5.335742, -4.349403, 0.072335, 0.037453, -0.231572, 0.343157, -0.888634, -0.685322, 1.126587, 1.118789, 0.022248, -0.877718, 0.722074, -0.150377, -0.704152, -0.753047, 0.56348, 0.18707, 1.231768, 0.126786, 0.161728, -0.184873, -0.085336, -1.095055, -1.1854, 0.358324, -0.214356, -0.495325, -0.539071, 0.18471, -0.352528, -0.741374, 0.465477, -0.719612, 0.777468, 0.402447, 0.441813, 0.451088, -1.092164, -0.883364, 0.093323, -0.589365, 0.098647, 0.506282, 0.665105, -0.195208, -0.821661, -0.175253, 0.716536, -0.396419, 1.008945, 0.730117, -0.935315, -0.357743, -2.121681, -1.1424, 0.692264, 0.059393, 1.072339, 1.30427, 0.588996, -0.348521, -0.302638, -0.194382, -0.322799, 0.783247, 0.178085, 1.51849, 0.218906, 0.68469, 0.806924, -0.114744, 0.201342, -0.409548],
    nullDecl: [-1.670991, 3.95427, -0.443455, -3.641406, -0.766451, 1.166043, -1.716698],
    nullDef: [0.709679, -4.433433, -1.013296, -1.956988, 3.81662, -1.956819, -2.758207],
    discSuit: [-0.297596, -4.422196, -4.905627, 0.034377, 1.213613, 1.332189],
    discGrand: [-1.030075, -4.553247, -5.370312, 0.107808, 1.80254, 1.886982],
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
