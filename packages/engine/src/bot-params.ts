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
  // so it is reproducible and replay-safe. NOT applied inside MC rollouts (the EV
  // estimate must stay low-variance): bot-mc plays its playouts greedy unless
  // mcRolloutTemp (below) asks for a tempered rollout policy.
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

  // --- Temperature the MC playouts (bot-mc.ts) run ALL THREE seats at. By default the
  // rollouts strip playTemp and play greedy (a low-variance EV estimate for the shipped
  // near-argmax bot). A deliberately-weakened bot (the easy/medium difficulty presets
  // below) plays at a real temperature, so greedy rollouts would systematically
  // over-estimate its EV -- it would bid games its sloppy play can't land, and credit its
  // opponents with mistakes they may not make. Setting mcRolloutTemp to the bot's own
  // playTemp makes it model itself AND its tablemates as playing the way it does.
  // 0/undefined = greedy rollouts (unchanged production behaviour).
  mcRolloutTemp?: number;

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
  // softmax(score / T) instead of the strict argmax, so the bot varies its card play only
  // among the closest near-ties -- less predictable / more human-like, with no measurable
  // strength cost. Characterized twice (experiments/ab-softmax.ts, paired vs greedy):
  // N=12000 put T=0.01 at +0.10 +/- 0.17; the finer N=18000 sweep (2026-07) put T=0.01/
  // 0.02/0.03/0.05 at +0.02/-0.10/-0.05/-0.12 +/- ~0.12-0.16 -- i.e. everything up to
  // ~0.05 is statistically zero and there is NO hidden optimum above 0 (vs fixed
  // opponents mixing can't gain: POMDP). Real costs start around T=0.10 (-0.39) and grow
  // ~linearly in the deviation rate; banding/phase/role-gating did not discount that
  // (ab-softmax-cfg.ts). Shipped at 0.02 (raised from 0.01, 2026-07-02): still free
  // within resolution, ~3.8% non-greedy decisions (vs 2.9%) for a bit more table
  // variety, and the GA training harnesses now train under the same T=0.02 policy.
  // Rollouts force greedy (bot-mc strips playTemp unless mcRolloutTemp is set), so the
  // MC bidder/declarer EV estimates are unaffected. 0/undefined would restore argmax.
  playTemp: 0.02,

  // ARCHIVE-HARDENED (Hall of Fame): the suit/grand DECLARER (suitDecl, grandDecl, discSuit) and the
  // four PER-SEAT DEFENDERS below are the ARCHIVE-trained vectors, which SUPERSEDE the single-opponent
  // co-evo best-responses documented in the bullets that follow. WHY: alternating best-response
  // (declarer<->defender) turned out to CYCLE -- a "ladder" test (experiments/ladder.ts: the newest
  // bot vs a pool of historical champions, [new, old, old], 1002 deals each) showed the co-evo bot
  // only TIED its strongest ancestor (287b289) and LOST to 337ff64 (-3.03 Seeger/deal): the big
  // per-step gate numbers (+3.7, +6.2) were mostly co-adaptation, not absolute strength. FIX: train
  // fitness as the AVERAGE over a POOL of historical opponents (train-play2 ARCHIVE=..., temp 0.01),
  // so the bot must be robust across styles rather than exploit one reflection of itself.
  // Round 1 (WSTEP=0.2, 5-era pool): margins rose vs EVERY era but still lost to 337ff64 (-1.54).
  // Round 2 (these vectors; WSTEP=0.1, pop 600 x 100 gen, seeded from round 1, 7-era pool
  // {current, 287b289, 337ff64, 50b36d1, d64e6b9, 5fdf597, 9c57714}; every genome scored vs ALL
  // eras -- sampling one opponent would let lineages dodge the hard era and re-open cycling):
  // held-out decl +1.70, defpair +1.18 over the pool; ladder POSITIVE vs every era incl. 337ff64
  // -1.54 -> +1.74 (decl win 80%), and +2.63/deal head-to-head vs the round-1 deployed bot.
  // (The 337ff64 gap once blamed on the MC bidder closed via play weights alone.)
  // NULL vectors kept (trained apart in the forced-null arena; this arena rarely bids null).
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
    suitDecl: [1.359998, -2.157995, -5.592371, 5.421086, 2.599565, 2.362868, 5.688593, 1.320774, 1.701907, 3.284116, -0.453595, 1.972225, -0.649723, -0.811322, 0.040196, -2.389538, 0.607265, 3.346646, -5.628961, -0.60802, -0.520829, 1.783727, -1.769606, 2.844005, 2.601466, -0.846286, -2.613318, 1.323621, -2.263798, 0.963128, 0.075212, 0.181172, -1.864991, 1.841213, -0.880085, -1.256496, -0.076915, -0.977184, -1.505116, 0.80611, 2.622631, -1.02731, 0.098845, -0.603329, 0.53137, -1.519908, -0.498159, -1.253012, 0.257956, -3.618319, 0.163054, 1.157144, 0.530004, 0.674199, -0.808282, 1.010799, 1.888228, -2.403612, -3.008303, 0.831794, -1.113194, -0.05099, -0.615594, 0.354548, 1.086857, 2.36801, -3.707502, -2.141739, -0.385153, -0.888553, -2.098454, -2.186655, 0.465667, 0.554526, -1.383878, -1.074104, 3.6572, -0.909854, -0.320924, 1.291474, -0.782288, 1.633935, -3.161546, 0.173383, 0.040415, -2.372637, 0.712267, -3.430113, -0.343848, -0.97246, 2.671153, -0.537384, -1.073496, 0.952968, 0.179724, -0.256619, 0.881147, 0.268376, 0.383897, -1.700191, -1.135681, -0.676804, 1.430528, 1.528756, 2.555264, 2.060388],
    suitDef: [0.487751, -2.929059, -4.843112, 0.045809, 3.734863, 1.758428, -0.393533, 2.356083, 3.496064, 1.72923, -2.521181, -0.76086, 3.451897, 2.18019, -2.193521, 4.296792, -1.873368, 1.763556, -3.16899, 1.072616, 0.321555, 2.853362, 0.191685, -0.28744, -1.860952, 1.716749, -3.150405, 0, 0, 0, 0, -2.5, -6, -6],
    // PER-SEAT suit-defender vectors (GA search, experiments/train-defseat.ts: candidate
    // plays BOTH defenders vs a frozen prod declarer in the defender-PAIR arena). The two
    // defender seats want different play -- "before" sits just before the declarer (declarer+2),
    // "after" just after (declarer+1). Out-of-sample: +1.378 def-pts/deal in the pair arena
    // (both seats contribute, mildly super-additive) and +0.331 pts/defended-game in the solo
    // arena (bot + prod partner, no regression). chooseCardScored picks by seat; suitDef remains
    // the fallback (grand defence still uses grandDef->suitDef, unchanged).
    suitDefBefore: [-1.790988, -2.909057, -2.876478, 3.80835, 5.799563, 2.528712, 0.896095, 0.793498, 3.791985, -1.989376, -1.932755, -1.005959, 3.2838, 0.604241, 1.169186, 0.196633, -2.465689, 4.892018, -4.316538, 2.492704, 3.336591, 1.930446, 2.350285, -2.090049, -4.32143, 2.312964, -1.068676, -0.278379, 2.369864, -0.456628, -1.674933, -2.849599, -5.329371, -2.279241, -2.166187, 0.368037, -1.885195, -0.633659, -1.511353, 1.020214, -0.425842, -0.446913, -0.843872, 0.948923, -0.610446, 2.036269, 0.380986, -1.491556, 0.276107, 3.726517, 0.199084, 2.393057, 1.583377, 1.544068, -1.058222, -0.541336, -0.011444, 0.40548, 2.133112, -2.559787, -0.257373, -2.642019, -1.136167, -0.534013, 0.531872, 0.551198, -1.759848, -0.454612, -4.169164, -1.278468, -0.297657, 1.101191, 0.866747, -3.491976, -4.77131, -1.065096, -0.738826, 0.029114, -1.619226, 2.40754, 0.734189, -2.724344, 0.229529, 1.553789, -1.553796, -0.913189, -1.774611, -1.371089, -0.452028, 1.393463, -2.32899, -0.773587, -2.161015, -2.381865, 0.692888, 2.539339, -0.436445, -1.110805, -0.076744, 0.323537, 0.726202, -1.465979, 0.503042, 2.347725, 0.353008, -1.74137],
    suitDefAfter: [-0.030511, -2.606683, -3.427154, 0.182856, 1.543794, 2.436369, -2.457125, 4.546582, 6, 3.059957, -3.864949, 0.147746, 1.35971, 0.958518, -2.259024, 3.23909, -1.671967, 4.04162, -6, -2.702604, -2.140774, 5.833063, 0.351065, -3.500206, -3.87388, -0.173071, -3.069634, 0.406299, 0.333787, 0.922641, 1.503187, 1.252998, -4.720776, -1.649118, -0.732272, 0.676247, -1.694835, -0.279158, 0.769831, -1.47216, 1.023231, -0.731339, -0.468547, -1.458612, -1.502033, 1.642946, 0.505841, -2.454911, 0.404579, 1.359575, -0.688519, 0.227235, -4.149151, -0.142222, -1.299067, -0.535857, 1.807568, -0.496871, -0.746718, -1.352417, -1.586988, 0.287502, -0.170792, -1.250944, 3.104494, 1.018298, 1.629924, -0.61857, -0.414962, -4.004823, 1.040312, -1.558698, -0.190688, -0.327059, -1.773151, -1.134068, -1.439055, 0.236009, -1.407035, -0.006536, -0.815445, 0.422932, -1.942299, 0.159697, 0.145029, 1.983117, -1.08527, -2.647554, 2.056101, -0.100194, 0.485122, 1.759021, 0.262939, 0.463958, -0.371346, 1.570657, 0.121537, 1.483629, -0.608636, 0.771798, 3.253688, 1.571117, -1.57648, 0.032149, 1.116323, -0.457605],
    grandDecl: [1.551901, -3.979111, -5.431349, 5.065448, 1.752932, -0.032531, 3.013744, 0.325165, 1.228613, 5.079888, -4.524926, 2.202003, -1.376641, 1.464641, 1.434179, -1.672097, 0.430775, 4.956553, -5.110076, 0.506012, -3.561548, 2.695149, -1.25078, 4.525444, -0.349147, -0.152631, -1.25281, 0.498389, 1.158238, 0.828004, 1.348883, -2.7467, 0.2439, 2.900837, -2.087705, 2.309563, 0.728289, 1.426975, -0.276752, 2.031115, 1.548574, -2.354242, -0.088097, -1.108497, 0.901548, 0.649001, -1.516925, -1.13142, 1.203131, -0.760597, -1.353876, 0.182606, 1.20373, 1.276138, -0.849476, -0.253568, 1.340664, -1.594222, -0.71711, -0.665125, -1.182078, 1.659735, -0.921139, 1.209321, 2.221868, -1.269511, 0.06992, -1.162444, -2.942377, 1.424066, -1.440308, -2.047996, -0.207628, -0.439133, 2.312506, -0.863352, -2.783452, -1.255974, -0.334141, 2.929129, 1.1054, 0.405835, 0.125589, -1.619958, 0.930034, 0.646095, -2.496848, -0.36824, -2.898379, -1.565636, 1.445425, 0.104113, -1.109035, 1.785478, 1.20467, 1.471054, 1.073137, 1.618542, -0.331331, 0.94253, 1.357225, 1.030863, 0.995488, 1.242035, 0.253939, 0.487994],
    grandDef: [0.487751, -2.929059, -4.843112, 0.045809, 3.734863, 1.758428, -0.393533, 2.356083, 3.496064, 1.72923, -2.521181, -0.76086, 3.451897, 2.18019, -2.193521, 4.296792, -1.873368, 1.763556, -3.16899, 1.072616, 0.321555, 2.853362, 0.191685, -0.28744, -1.860952, 1.716749, -3.150405, 0, 0, 0, 0, -2.5, -6, -6],
    // PER-SEAT GRAND defenders (GA search, experiments/train-defseat-grand.ts -- same
    // defender-pair arena, suit defenders frozen). Out-of-sample: +0.524 def-pts/deal pair
    // (mostly the after-seat) and +0.179 pts/defended-game solo, no regression. Selected by
    // seat in chooseCardScored; grandDef -> suitDef remains the fallback when absent.
    grandDefBefore: [1.932502, -1.158226, -4.876837, -0.948506, 3.460034, 0.4939, 0.214717, 3.116092, 5.710023, 3.510701, -4.825628, -0.058432, 5.658016, 0.919759, -4.456199, 4.35088, -0.206168, 6, -5.171122, 0.470057, -1.500992, 0.640159, -1.140085, 3.078162, -5.314838, 6, 0.579899, -2.219502, 0.277909, -3.19505, -0.941073, -0.548767, -3.260767, -1.963843, -1.066471, 0.083218, 2.114345, -1.821209, 2.585707, -0.85425, 0.588584, -2.27742, 1.692999, -2.246285, -0.588833, 0.284498, -1.522161, -1.036734, -0.691655, -1.353746, 1.73187, -2.712363, -1.191542, -0.629164, -2.752585, 1.069172, 2.123246, 1.326196, -1.644051, -1.444601, -0.607689, 0.224318, -0.013888, 0.808144, 0.685487, -0.155733, 2.155397, 1.467411, -0.444856, -1.673605, -0.755922, 1.532919, -0.756024, -0.785734, -1.135932, -0.868668, 1.428613, -0.602209, -1.539972, 1.666719, 1.863595, -0.536955, 2.043447, 1.687475, -0.243493, 0.971643, 1.293434, -0.185231, -1.312789, 0.34322, 4.109084, -1.489413, -1.753021, -2.784455, 1.569437, -0.473955, 1.101135, 0.134062, 1.292296, 0.037775, -1.071656, -1.490881, -1.219972, 0.310498, 1.244142, 0.454396],
    grandDefAfter: [-0.777463, -1.799586, -5.187348, -3.691812, 0.811607, 0.66426, -2.221366, 4.837419, 4.672161, 2.181913, -3.679781, 2.274499, 2.956763, 1.621636, -4.084197, 4.687456, -2.277158, 4.787939, -4.362024, 2.282824, -0.698677, 5.422786, 3.578643, 0.960734, -3.170771, 4.763186, -2.625844, 3.536213, 0.351064, -2.142437, 0.361349, -3.638007, -5.019852, -2.642729, 0.542815, -0.530963, 0.571222, 1.039233, -0.637433, -1.707316, 0.950196, 1.491687, 0.050621, -0.674915, 0.63889, -2.100918, -0.476237, -0.946328, 1.65557, -1.383921, 0.649918, 0.651741, 0.923796, 0.752197, -0.931973, -1.52852, -1.328293, 2.246455, -0.6685, -0.979841, -0.799894, 0.832468, -0.175141, 0.351553, 2.029108, 0.0407, 1.261895, 2.946036, 2.833311, 0.353248, 0.555401, -1.501357, 0.011891, -1.432552, -0.922256, -0.022718, -0.656283, -0.571503, -1.81802, -1.378398, 1.396984, 1.085545, 0.064822, -0.631417, -0.248407, 0.741382, -1.600998, -1.464353, 0.994533, 2.995202, 1.899905, 1.445292, 0.627537, 0.173188, -0.854124, 1.046376, -0.021687, 2.09469, 1.649392, 1.81324, 1.31453, 0.320299, 1.397066, -1.355239, -0.111787, -1.762187],
    nullDecl: [0.703165, -3.430267, 3.769294, -1.866907, 2.578254, 2.572871, 0.559568, -2.451844, -0.723535, 2.716346, -2.690995, -1.652783, -1.814313, -2.051776, -3.272948, 1.865333, -2.997651, -0.920161, 0.313246, -2.625638, -0.462236, -2.88522, -1.764468],
    nullDef: [-3.994283, 2.306601, -2.85402, -1.307771, 0.722734, 3.330167, -3.08712, -3.060082, 2.339836, -2.302893, 2.524426, 3.52464, -2.744202, 0.531925, -3.675218, -2.146856, 2.382364, 2.299613, -3.181212, 2.967828, 2.004113, 2.733868, 1.488852],
    nullDefBefore: [-5.206794, -2.7404, -0.273122, -2.924566, 1.783727, -1.629523, -3.908306, 1.576887, -2.940898, -2.033988, 0.660685, -2.217852, 0.613548, 1.001257, -1.126525, -4.8063, -4.518528, -3.12563, -1.31536, 1.304824, 4.142075, 4.545604, 1.0036],
    nullDefAfter: [-2.660726, -1.976887, 0.482839, -4.991716, -0.778491, 1.390346, 1.892568, -2.00125, -3.172803, 1.715332, -1.757795, -3.157892, -2.719575, -0.549673, -3.117087, 4.374255, -1.175794, 4.229956, 3.881426, 4.456473, 2.378381, -0.983765, 3.800552],
    discSuit: [0.770131, -5.901567, -4.905993, 1.923928, 3.307987, -0.002791],
    discGrand: [-1.030075, -4.553247, -5.370312, 0.107808, 1.80254, 1.886982],
    discNull: [3.768238, 0.733511, 0.279117, -0.419056],
  },
};

// Difficulty presets for the practice bots. Strength is controlled purely by the softmax
// play temperature: the same tuned weights, sampled more loosely. Hard IS the production
// bot (playTemp 0.02); easy/medium raise the temperature so the bot makes real, human-ish
// mistakes. They also set mcRolloutTemp to their own temperature, so the MC bidder
// simulates every seat playing that sloppily -- a weak bot must not bid on the assumption
// that it (or anyone) will play perfectly (in practice this makes it pass more marginal
// games, handing them to the human).
//
// CALIBRATED empirically (experiments/arena-difficulty.ts, [easy, medium, hard] at one
// table, 10k deals, full seat rotation): temperatures up to ~0.1 are indistinguishable
// from production (the paired A/B, ab-softmax.ts at 18k deals, puts T=0.02..0.05 at 0 to
// -0.12 +/- 0.15 pts/deal -- the tuned model is that robust to near-tie sampling), so a
// felt difficulty ladder needs an order of magnitude more: T=0.5 -> -2.9 pts/deal and
// T=1.0 -> -5.4 pts/deal vs production at the same table (which climbs to +24.9/deal
// exploiting them). Hard stays the exact DEFAULT_PARAMS object so it shares the
// production MC memo cache.
export type BotDifficulty = 'easy' | 'medium' | 'hard';
export const BOT_PARAMS_BY_DIFFICULTY: Record<BotDifficulty, BotParams> = {
  easy: { ...DEFAULT_PARAMS, playTemp: 1.0, mcRolloutTemp: 1.0 },
  medium: { ...DEFAULT_PARAMS, playTemp: 0.5, mcRolloutTemp: 0.5 },
  hard: DEFAULT_PARAMS,
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
