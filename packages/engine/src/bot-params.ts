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

  // ARCHIVE-HARDENED (Hall of Fame): the suit/grand DECLARER (suitDecl, grandDecl, discSuit) and the
  // four PER-SEAT DEFENDERS below are the ARCHIVE-trained vectors, which SUPERSEDE the single-opponent
  // co-evo best-responses documented in the bullets that follow. WHY: alternating best-response
  // (declarer<->defender) turned out to CYCLE -- a "ladder" test (experiments/ladder.ts: the newest
  // bot vs a pool of historical champions, [new, old, old], 1002 deals each) showed the co-evo bot
  // only TIED its strongest ancestor (287b289) and LOST to 337ff64 (-3.03 Seeger/deal): the big
  // per-step gate numbers (+3.7, +6.2) were mostly co-adaptation, not absolute strength. FIX: train
  // fitness as the AVERAGE over a POOL {current, 287b289, 337ff64, 50b36d1, d64e6b9} (train-play2
  // ARCHIVE=..., WSTEP=0.2, temp 0.01), so the bot must be robust across styles rather than exploit
  // one reflection of itself. Result on the ladder: margins rose vs EVERY era (287b289 +0.09->+3.66,
  // 5fdf597 -0.05->+1.46, 337ff64 -3.03->-1.54), beats the prior deployed bot +3.79/deal head-to-head.
  // The residual 337ff64 loss (-1.54) is the MC BIDDER over-bidding grand (rolls out vs its own
  // defenders) -- a separate lever the play-weight GA can't reach. NULL vectors kept (trained apart).
  //
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
  //    LATER re-evolved AGAIN as the co-evo mirror of the declarer re-tune below (the defenders had
  //    never best-responded to that stronger declarer): finer step (WSTEP=0.2), held-out +4.87,
  //    real-game MC pair gate +6.202 +/- 0.667 def-pts/deal. This is the current per-seat defenders.
  //  * CO-EVOLUTION re-tune (suitDecl, grandDecl, discSuit): after the per-seat defenders above were
  //    re-evolved (+3.08 def-pts), the declarer had never best-responded to those STRONGER defenders.
  //    Re-ran the declarer GA (train-play2 MODE=decl) seeded from the then-current champion. Real-game
  //    MC A/B (mcBidK=32) = +3.685 +/- 0.726 pts/deal vs prior prod (+11.4 pts/declarer-deal; defender
  //    bucket +0.36 as the bidder sharpens). This closes the co-evo gap the wide-grid update opened.
  //    (A declarer `overruff_risk` feature was tried in this run and CUT -- ablation showed it
  //    contributes ~0; see [[bot-tactical-features-null]].)
  //  * NULL overhaul (nullDecl, nullDef, nullDefBefore, nullDefAfter): null play was previously
  //    untrained noise (the suit/grand arena never bids null). Trained on a dedicated FORCED-null
  //    arena (experiments/evolve-null*.ts, multi-threaded). NULL_FEATURES went 7 -> 23 (the quadratic
  //    expansion of the 7 base signals, dead lead x follow cross-terms dropped): an ablation showed
  //    the products add +4.4pp win-rate over a 7-linear retrain, so they earn their place. Forced-null
  //    DECLARER win-rate 36% -> 73% (vs the old weak defence); DEFENDER set-rate 28% -> 72%, +1.5pp
  //    more from the seat split (nullDefBefore/After, mirroring suit/grand). Then ONE co-evo step: the
  //    declarer was re-evolved against the new strong defenders (best-response), +6.8pp in the forced
  //    arena vs them (27.4% -> 34.2%). Because the MC bidder rolls null out with this play, stronger
  //    null play RAISES the bid rate: self-play null share 0.8% -> 1.7% at equilibrium (the 10.5% seen
  //    mid-way was vs the OLD weak defence), win-rate 55% -> 78%. nullDef stays as the shared fallback.
  //  * KEPT from prior production: suitDef/grandDef (inert fallbacks) and discNull (null discard, still
  //    ~never exercised in training -> noise; the dedicated-run value stays).
  playW: {
    suitDecl: [2.106625, -2.143135, -5.511854, 5.904701, 2.544347, 2.622811, 5.659965, 1.147763, 1.867324, 3.079568, -0.522484, 1.413295, -0.946597, -0.622843, 0.021579, -2.216401, 0.767853, 2.772585, -5.493696, -0.70032, -1.273833, 1.181264, -1.382946, 2.396586, 2.526777, -1.970287, -2.196836, 0.992382, -2.118073, 1.259773, 0.197012, -0.481487, -1.564503, 2.670306, -0.561756, -0.604568, -0.230738, -0.595577, -1.717441, 1.16004, 1.577998, -1.572081, 0.180199, -0.289175, 0.369576, -1.402638, -0.205697, -1.10289, -0.022536, -3.433949, 0.416926, 2.286057, 0.222631, 0.901008, -0.596499, 0.304019, 1.495434, -2.030549, -2.800345, 0.814245, -1.80191, -0.445764, -0.716077, 0.3052, 1.088369, 1.972689, -3.750404, -2.216742, -0.167761, -1.650835, -2.280119, -1.9767, 0.406231, 0.707207, -1.451309, -1.213822, 3.372512, -1.019812, -0.52124, 1.303573, -0.483257, 1.160531, -2.475902, -0.215062, 0.381658, -2.359255, 0.800905, -2.945986, 0.105609, -0.914128, 3.39476, -0.38965, -1.382223, 1.380173, 0.140427, -0.08218, 1.76802, -0.049985, 0.231323, -1.860342, -0.72412, -0.189744, 0.78066, 1.599642, 2.425105, 1.934401],
    suitDef: [0.487751, -2.929059, -4.843112, 0.045809, 3.734863, 1.758428, -0.393533, 2.356083, 3.496064, 1.72923, -2.521181, -0.76086, 3.451897, 2.18019, -2.193521, 4.296792, -1.873368, 1.763556, -3.16899, 1.072616, 0.321555, 2.853362, 0.191685, -0.28744, -1.860952, 1.716749, -3.150405, 0, 0, 0, 0, -2.5, -6, -6],
    // PER-SEAT suit-defender vectors (GA search, experiments/train-defseat.ts: candidate
    // plays BOTH defenders vs a frozen prod declarer in the defender-PAIR arena). The two
    // defender seats want different play -- "before" sits just before the declarer (declarer+2),
    // "after" just after (declarer+1). Out-of-sample: +1.378 def-pts/deal in the pair arena
    // (both seats contribute, mildly super-additive) and +0.331 pts/defended-game in the solo
    // arena (bot + prod partner, no regression). chooseCardScored picks by seat; suitDef remains
    // the fallback (grand defence still uses grandDef->suitDef, unchanged).
    suitDefBefore: [-1.61156, -3.137556, -2.599712, 3.001196, 5.788613, 2.621741, 0.927594, 1.476923, 3.075776, -1.504233, -1.317244, -1.577874, 4.163886, 0.343192, 1.478459, 0.571681, -2.964404, 4.027434, -4.25444, 1.731928, 3.576172, 2.828115, 2.808434, -2.242256, -4.563677, 3.405316, -0.563667, 0.190037, 2.08944, -0.145434, -1.461872, -2.486877, -4.957208, -2.083437, -1.635345, 0.396539, -0.585802, -0.101908, -2.058173, 0.874421, 0.275245, -0.350341, -0.834684, 0.764238, -0.687746, 2.343482, 1.132464, -1.687583, 0.762979, 3.816691, 0.847913, 2.122383, 1.680941, 1.162129, -0.750147, 0.534365, 0.004904, 0.365929, 3.122459, -2.787772, 0.190737, -3.603301, -1.546115, -0.337599, 0.617467, 1.462389, -2.296359, 0.138143, -3.02313, -1.322304, -1.286025, 0.435548, 0.926629, -2.991355, -3.514646, -1.037174, -0.063164, -0.096982, -1.713106, 2.385897, 0.01869, -2.686679, 0.351234, 1.383759, -1.243401, -0.666583, -2.066278, -1.528216, -0.637949, 1.200235, -1.892069, -0.611152, -0.957328, -2.738341, -0.147916, 2.432637, 0.280623, -0.550358, 0.418458, 0.920561, 1.268473, -0.956177, 0.09157, 2.409828, 0.237502, -1.753768],
    suitDefAfter: [0.129734, -3.275031, -3.498968, 0.783181, 1.319925, 2.438423, -2.975284, 3.888831, 5.985708, 2.082589, -4.580032, 0.560248, 1.099511, 0.924873, -2.379345, 3.440128, -1.395135, 4.362299, -5.485567, -2.249711, -2.384543, 5.371342, -0.274011, -2.882031, -3.891359, -0.311102, -2.84662, 0.277478, -0.447324, 1.857993, 0.92935, 0.393017, -4.329194, -2.333256, -0.760836, -0.039977, -1.573719, -0.352053, 1.060411, -1.045573, 0.882997, -0.545531, -0.039829, -1.148282, -0.931466, 2.151306, -0.518174, -2.511464, 0.461294, 1.754498, -0.761131, -0.214701, -2.929157, -0.041482, -0.588448, -0.463057, 0.442036, -0.756299, -0.071244, -0.608225, -1.702755, 0.764654, -0.170755, -1.354184, 3.066075, 0.924688, 1.480193, -0.953713, -0.214334, -3.055009, 1.298416, -1.860686, 0.542643, 0.72826, -1.055464, -1.372622, -1.204391, -0.803443, -0.993271, -0.314336, -0.614644, 0.702363, -0.694617, 0.671012, 0.623044, 1.78192, -1.18405, -2.507569, 2.340188, -0.394418, -0.025615, 1.441559, 0.27741, 0.226266, -0.528053, 1.091081, -0.227497, 1.341464, 0.190306, 0.863656, 2.320503, 2.176632, -1.751575, 0.546267, 1.204211, 0.566134],
    grandDecl: [1.989251, -3.695895, -5.87584, 5.129712, 1.759606, -0.216846, 2.237924, 0.059023, 1.481426, 4.681406, -3.870015, 2.328183, -1.293666, 1.335595, 0.825389, -1.613073, 0.981338, 5.385623, -5.864431, 1.018523, -3.597556, 2.502387, -1.266999, 4.507625, -0.332666, -0.099207, -2.04458, 0.348676, 1.427219, 0.561862, 0.655292, -2.508738, 0.324892, 3.111358, -1.421233, 2.27455, 0.858606, 1.269093, -0.725704, 2.30503, 0.315527, -1.892537, 0.030141, -1.107513, 0.816894, 0.249365, -1.616822, -0.615771, 0.588952, 0.283567, -1.2785, 0.106668, 1.012817, 1.637264, -1.478733, 0.200547, 1.483908, -2.090123, -0.165676, -0.592187, -1.19556, 1.976764, -0.628948, 1.998323, 1.270399, -1.083712, 0.437806, -1.196581, -3.051896, 1.721557, -1.222689, -2.703446, 0.080376, -0.435181, 2.32167, -0.865416, -2.018979, -1.221394, 0.023592, 2.919901, 0.988946, 0.066682, -0.240927, -2.663355, 1.319369, 0.579477, -2.051715, 0.222624, -2.212839, -1.261343, 1.218937, -0.376135, -1.545186, 1.856389, 0.578273, 1.482128, 0.803775, 1.397608, -0.475393, 0.579332, 1.701602, 1.146275, 1.059395, 1.399672, -0.005964, -0.018029],
    grandDef: [0.487751, -2.929059, -4.843112, 0.045809, 3.734863, 1.758428, -0.393533, 2.356083, 3.496064, 1.72923, -2.521181, -0.76086, 3.451897, 2.18019, -2.193521, 4.296792, -1.873368, 1.763556, -3.16899, 1.072616, 0.321555, 2.853362, 0.191685, -0.28744, -1.860952, 1.716749, -3.150405, 0, 0, 0, 0, -2.5, -6, -6],
    // PER-SEAT GRAND defenders (GA search, experiments/train-defseat-grand.ts -- same
    // defender-pair arena, suit defenders frozen). Out-of-sample: +0.524 def-pts/deal pair
    // (mostly the after-seat) and +0.179 pts/defended-game solo, no regression. Selected by
    // seat in chooseCardScored; grandDef -> suitDef remains the fallback when absent.
    grandDefBefore: [2.17622, -1.72019, -4.437431, -1.29977, 4.658823, 0.378858, 0.755817, 2.796142, 5.076257, 3.302224, -4.605736, 0.362336, 5.11483, 0.140838, -3.881568, 4.233726, -0.072649, 5.95313, -4.922813, 0.669359, -1.730842, 0.478868, -0.807805, 3.584542, -4.925375, 5.491775, -0.041478, -2.692965, -0.01772, -3.066268, -0.463634, -0.93352, -3.249589, -2.426721, -0.640222, -0.566675, 2.625864, -1.404385, 2.369856, -1.273378, -0.361517, -2.512241, 1.786357, -2.289788, -0.453901, -0.150025, -1.461246, -0.970767, -0.936661, -1.394749, 1.902633, -2.306475, -1.13863, 0.007464, -2.212255, 0.811017, 1.796535, 1.463705, -0.967895, -1.278752, -0.666113, 0.185411, 0.026488, 0.331442, 0.231979, 0.053954, 1.513478, 1.438221, -0.334776, -1.917341, -1.046821, 1.158505, -0.232177, -0.653135, -2.031658, -1.156961, 1.058448, -0.301788, -1.653793, 0.941989, 1.630993, -0.986368, 1.429376, 1.849287, 0.30201, 1.268348, 1.003661, -0.237311, -0.5746, 0.132314, 4.451574, -1.250265, -1.542447, -1.9462, 1.514889, -0.662523, 1.734016, 1.030799, 0.615191, -1.027146, -1.408826, -0.468964, -1.58784, 0.678522, 1.906253, 0.481816],
    grandDefAfter: [-1.110795, -1.513423, -5.751906, -3.697393, 0.723309, 0.76636, -3.227297, 4.982366, 4.512105, 2.405545, -3.377732, 2.395356, 3.246181, 2.057364, -4.104486, 4.535902, -2.837729, 4.219073, -5.004299, 2.239337, -0.718987, 5.24408, 3.610323, 1.017454, -2.747759, 3.686914, -1.735616, 3.212508, 0.31517, -1.529819, -0.313251, -3.259703, -4.885005, -3.076423, 0.012797, 0.017281, 0.185197, 1.187202, -0.944708, -1.537933, -0.032292, 1.46256, -0.638322, -0.068669, 0.604407, -1.447966, -0.302308, -1.176908, 0.916021, -0.833996, 1.075694, -0.090308, 1.104141, 1.598662, -1.16445, -1.727543, -1.899877, 1.136527, -0.409673, -0.618062, -0.904458, 0.489295, 0.103551, 0.428132, 1.666077, 0.649071, 1.116031, 2.290291, 2.068407, 0.372439, 0.570707, -1.718204, 0.592474, -1.51185, -0.487996, 0.540959, -0.986394, -0.567045, -1.17726, -1.243651, 1.542287, 0.762115, 0.592635, -0.258031, -0.21477, 0.542865, -1.723183, -1.549139, 1.119753, 2.754666, 1.544808, 1.729382, 0.480589, 0.49441, 0.172478, 0.942756, 0.856665, 2.128439, 1.823081, 1.408284, 1.150153, 0.340369, 0.248834, -0.208819, 0.829862, -1.366051],
    nullDecl: [0.703165, -3.430267, 3.769294, -1.866907, 2.578254, 2.572871, 0.559568, -2.451844, -0.723535, 2.716346, -2.690995, -1.652783, -1.814313, -2.051776, -3.272948, 1.865333, -2.997651, -0.920161, 0.313246, -2.625638, -0.462236, -2.88522, -1.764468],
    nullDef: [-3.994283, 2.306601, -2.85402, -1.307771, 0.722734, 3.330167, -3.08712, -3.060082, 2.339836, -2.302893, 2.524426, 3.52464, -2.744202, 0.531925, -3.675218, -2.146856, 2.382364, 2.299613, -3.181212, 2.967828, 2.004113, 2.733868, 1.488852],
    nullDefBefore: [-5.206794, -2.7404, -0.273122, -2.924566, 1.783727, -1.629523, -3.908306, 1.576887, -2.940898, -2.033988, 0.660685, -2.217852, 0.613548, 1.001257, -1.126525, -4.8063, -4.518528, -3.12563, -1.31536, 1.304824, 4.142075, 4.545604, 1.0036],
    nullDefAfter: [-2.660726, -1.976887, 0.482839, -4.991716, -0.778491, 1.390346, 1.892568, -2.00125, -3.172803, 1.715332, -1.757795, -3.157892, -2.719575, -0.549673, -3.117087, 4.374255, -1.175794, 4.229956, 3.881426, 4.456473, 2.378381, -0.983765, 3.800552],
    discSuit: [0.621236, -5.589212, -5.282684, 2.303158, 2.569497, -0.386087],
    discGrand: [-1.030075, -4.553247, -5.370312, 0.107808, 1.80254, 1.886982],
    discNull: [3.768238, 0.733511, 0.279117, -0.419056],
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
