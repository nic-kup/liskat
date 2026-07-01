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
  //    DECLARER win-rate 36% -> 73%; DEFENDER set-rate 28% -> 72%, +1.5pp more from the seat split
  //    (nullDefBefore/After, mirroring suit/grand). Because the MC bidder rolls null out with this
  //    play, stronger null play RAISES the bid rate: self-play null share 0.8% -> 1.7% at equilibrium
  //    (was 10.5% vs the OLD weak defence), win-rate 55% -> 78%. nullDef stays as the shared fallback.
  //  * KEPT from prior production: suitDef/grandDef (inert fallbacks) and discNull (null discard, still
  //    ~never exercised in training -> noise; the dedicated-run value stays).
  playW: {
    suitDecl: [1.910275, -2.687387, -5.430136, 5.238467, 2.690149, 2.589857, 5.814407, 0.946417, 1.109622, 2.082267, -0.928081, 0.965322, -0.265899, -0.184124, 0.303399, -1.207442, 1.096447, 3.089605, -5.907142, -0.107518, 0.05435, 1.688531, -1.547195, 2.223335, 1.361492, -1.656748, -3.222135, 1.564295, -1.710497, 1.096535, 0.090622, -0.443805, -1.502886, 2.226123, -0.61137, -1.062049, 0.210794, -0.936962, -1.034463, 0.92195, 1.571658, -0.961618, 0.441808, -0.358672, -0.39945, -1.905586, 0.143273, -0.240904, -0.594092, -2.843704, 1.111338, 1.703728, -0.063197, 0.874304, -0.473392, -0.137764, 1.625007, -1.38631, -2.425101, 0.97568, -1.492933, -0.012781, -1.132408, 0.318202, 0.933267, 2.007823, -2.34265, -0.824254, 0.667694, -1.323946, -2.239764, -1.772466, -0.249629, 0.35755, -0.762905, -0.623126, 2.053547, -1.196027, -0.960344, 0.630538, 0.203908, 1.25945, -1.398009, -0.412995, 0.18116, -2.12505, 0.193154, -2.563386, 0.2335, -0.12724, 3.364015, -0.819143, -0.998612, 1.320125, 0.709917, -0.128814, 1.270939, -0.879342, 0.140324, -1.127121, -0.35098, -0.347725, 2.06127, 1.38248, 1.872596, 1.865358],
    suitDef: [0.487751, -2.929059, -4.843112, 0.045809, 3.734863, 1.758428, -0.393533, 2.356083, 3.496064, 1.72923, -2.521181, -0.76086, 3.451897, 2.18019, -2.193521, 4.296792, -1.873368, 1.763556, -3.16899, 1.072616, 0.321555, 2.853362, 0.191685, -0.28744, -1.860952, 1.716749, -3.150405, 0, 0, 0, 0, -2.5, -6, -6],
    // PER-SEAT suit-defender vectors (GA search, experiments/train-defseat.ts: candidate
    // plays BOTH defenders vs a frozen prod declarer in the defender-PAIR arena). The two
    // defender seats want different play -- "before" sits just before the declarer (declarer+2),
    // "after" just after (declarer+1). Out-of-sample: +1.378 def-pts/deal in the pair arena
    // (both seats contribute, mildly super-additive) and +0.331 pts/defended-game in the solo
    // arena (bot + prod partner, no regression). chooseCardScored picks by seat; suitDef remains
    // the fallback (grand defence still uses grandDef->suitDef, unchanged).
    suitDefBefore: [-1.257506, -3.446871, -2.285317, 1.399056, 4.021862, 2.080827, 2.552229, 1.956158, 2.267335, 0.29362, -3.357423, -1.359731, 4.201624, 0.471398, 0.928275, 0.659265, -3.349138, 3.130812, -4.262549, 0.961524, 2.555515, 3.004347, 2.596505, -2.179976, -5.075601, 2.763964, -0.108049, -0.362121, 1.149235, -0.45894, -0.321538, -2.800563, -4.923777, -2.046548, -1.314553, 0.187548, -0.127956, 1.038179, -0.593052, 1.167419, -0.719538, -1.1763, -0.256197, 0.150574, -0.355767, 1.095667, 1.391956, -0.489179, -0.024548, 2.329474, 1.028915, 1.527733, 0.791719, 1.518486, -0.466222, -0.47117, -0.011112, -0.088775, 2.249355, -1.040312, -0.521223, -1.640683, -1.609997, 0.019529, 0.419796, 0.940291, -2.543447, -0.324909, -1.335199, -0.87331, -0.27909, 0.430451, 0.320453, -1.797867, -2.226847, -0.660053, -0.137369, 0.001014, -0.917637, 1.740818, -1.076893, -0.7498, 0.385574, 1.715498, 0.167436, -1.198639, -1.682474, -2.825361, -1.60243, 0.321938, -2.371598, -0.431002, -1.089178, -1.987844, -1.023049, 1.522367, 0.320128, -1.977119, 0.304268, 1.198803, 1.065143, -0.697877, 1.545779, 1.605466, 0.43613, -1.139668],
    suitDefAfter: [0.194647, -2.92072, -1.978856, 0.797338, 1.576714, 1.628805, -2.462403, 3.013963, 5.720357, 1.799942, -4.910288, 0.700536, 2.21698, 1.201462, -2.783258, 4.071823, -1.993701, 3.201254, -5.651593, -0.920536, -2.239793, 4.62522, 0.527241, -3.507947, -4.910401, 0.280025, -2.486546, 0.177708, 0.109615, 1.447305, -0.979259, 0.464296, -6, -5.380204, 0.058782, -0.075379, -1.842733, -0.684666, -0.111496, -1.357681, 0.821527, -0.901723, 1.162404, -0.877921, -0.303228, 1.251576, 0.088456, -1.73925, -0.369782, 1.047986, -0.276726, -0.525179, -1.894107, -0.562045, -0.071951, -0.582647, 0.820442, 0.483158, 0.756704, -0.305083, -0.136229, -0.326674, 0.121797, -0.361051, 1.81181, 0.127873, 0.48684, -0.266271, -1.397667, -2.466624, 0.733414, -0.651233, 0.614476, 1.296911, -0.218166, -1.187272, -0.570345, -0.599977, -0.566748, -0.778681, 0.676449, 0.569597, -0.099611, 0.709367, 0.426457, -0.175981, -0.225162, -1.758568, 1.518743, -0.868113, 0.603118, -0.171371, 0.100424, -0.074117, -1.10943, 1.087773, -0.165138, 1.535041, 0.29474, 0.255773, 1.28245, 2.057882, -1.082846, 0.244426, 0.020133, 1.010845],
    grandDecl: [1.951732, -3.675448, -5.628311, 5.929616, 2.139416, 0.045332, 2.905562, -0.403877, 1.268148, 4.484845, -3.45316, 3.077026, -0.776904, 1.586719, -0.567255, -1.611809, -0.498341, 4.081239, -4.952505, 0.790475, -2.17914, 2.282296, -0.978498, 4.984405, -0.806681, 0.14757, -1.094558, -0.551849, -0.052118, 0.501899, 1.147463, -3.188167, 0.117331, 2.414364, -1.482669, 1.887818, 1.503459, 1.499445, -0.292908, 1.469715, -0.16939, -1.659032, 0.79147, -0.773625, 0.223106, -0.293384, -0.936191, 0.819504, 0.918836, 1.056756, -0.525372, -0.379446, 1.12156, 0.659338, -0.940053, -0.823027, 1.155917, -0.897251, 0.709612, -0.198144, -1.85778, 2.156202, 0.436902, 0.989482, 0.113903, -0.350281, 0.278878, -0.164225, -2.386642, 1.516085, -1.422879, -4.107428, -0.696153, -0.156677, 1.662484, -0.800062, -1.005969, -0.863041, 0.850238, 2.819446, 0.605418, -0.058059, 0.292074, -1.777644, 0.753386, 0.777019, -1.699552, -0.095393, -1.341312, -1.003066, 0.701588, -0.937079, -1.875524, 1.462388, 0.13811, 0.977642, 0.588606, 1.162747, 0.014489, -0.249692, 0.902589, 0.667212, 0.987776, 1.557315, -0.254611, -0.528793],
    grandDef: [0.487751, -2.929059, -4.843112, 0.045809, 3.734863, 1.758428, -0.393533, 2.356083, 3.496064, 1.72923, -2.521181, -0.76086, 3.451897, 2.18019, -2.193521, 4.296792, -1.873368, 1.763556, -3.16899, 1.072616, 0.321555, 2.853362, 0.191685, -0.28744, -1.860952, 1.716749, -3.150405, 0, 0, 0, 0, -2.5, -6, -6],
    // PER-SEAT GRAND defenders (GA search, experiments/train-defseat-grand.ts -- same
    // defender-pair arena, suit defenders frozen). Out-of-sample: +0.524 def-pts/deal pair
    // (mostly the after-seat) and +0.179 pts/defended-game solo, no regression. Selected by
    // seat in chooseCardScored; grandDef -> suitDef remains the fallback when absent.
    grandDefBefore: [2.187609, -1.379556, -5.574565, -3.489082, 5.215265, 0.359261, 1.494469, 3.970668, 4.81566, 2.662746, -5.272379, 0.888126, 5.813603, 1.677908, -4.343324, 4.452445, -0.216447, 3.623426, -5.870937, -0.342233, -2.52533, 0.600094, -0.875863, 3.291416, -3.758837, 5.554539, 0.817732, -1.666412, -0.405837, 0.826859, -0.375318, -1.65198, -3.069284, -2.661549, 0.179061, 1.396572, 0.819881, -1.241394, 1.886679, -1.846846, -0.612122, -2.478183, -0.311661, -1.168377, -0.309972, 0.574376, -0.545505, -0.732652, -0.49067, -0.572016, 1.409512, -2.048798, -0.928468, 0.718672, -1.420147, 1.045308, 1.203217, 0.668516, 0.020285, -0.479517, -1.211081, -0.482494, 0.059427, 0.05544, -0.204768, 0.021896, 0.804988, 1.079521, -0.315349, -0.801458, -0.687985, 0.954902, 0.668515, -0.800949, -1.022833, -0.921667, 1.034364, -0.964141, -0.664561, -0.377499, 0.537378, -0.19122, 1.096058, 2.28416, 2.004615, 0.969045, 1.712905, -0.641428, 0.511084, -0.018374, 2.711382, -0.387162, -0.372555, -2.311668, 0.433672, -0.932716, 0.955256, 1.148919, 1.208119, 0.460733, -1.142143, 0.27781, -1.78567, 0.456268, 1.231358, -0.250242],
    grandDefAfter: [0.220288, -2.137836, -4.059229, -2.800887, 2.051117, 0.514396, -2.786876, 5.801709, 3.647027, 2.435352, -3.295668, 2.067374, 2.317938, 0.809503, -4.2548, 4.849825, -4.186067, 3.087141, -5.502987, 1.898802, -0.085881, 6, 2.24793, 1.700693, -2.487625, 4.005806, -2.239214, 2.893579, -1.295259, -0.949846, -0.532226, -2.782906, -5.134802, -4.320894, 0.852685, -0.271451, -1.242331, 1.186136, -1.88101, -0.658338, 0.647861, 1.492158, -0.811698, 0.226357, 1.617816, -0.899138, -0.517703, -0.117279, 1.703884, -0.819059, 0.999415, -0.560266, 1.583603, 1.160724, -0.695156, -0.907791, -1.71905, 0.091962, -0.463582, -0.666822, -0.389412, 0.584793, 1.094904, 0.06758, 0.851324, -0.610885, 1.261668, 0.744021, -0.496452, 0.428102, -0.113542, -1.078467, 0.351619, -2.781774, 0.083219, -0.028656, -0.152875, -0.39208, -1.373097, -0.786863, 0.960031, -0.092958, 1.967485, 0.920547, -0.513847, 0.261859, -1.989228, -1.201148, 2.072525, 0.515099, 1.190751, 1.99459, -0.281199, 0.430173, 0.085515, 0.170046, 0.226772, 1.970606, 1.095313, 1.836156, 0.383415, 0.462683, 0.140611, -0.588893, 1.301113, 0.110167],
    nullDecl: [0.912579, -3.334514, 0.544456, -3.436399, 1.900799, 2.304771, -4.800874, -2.323354, 4.323141, 1.994896, 0.23693, -1.84207, -2.574594, -6.225655, -3.756925, 3.465768, -2.338938, -0.003622, 1.92086, -1.091587, -0.577627, -2.366188, -1.341689],
    nullDef: [-3.994283, 2.306601, -2.85402, -1.307771, 0.722734, 3.330167, -3.08712, -3.060082, 2.339836, -2.302893, 2.524426, 3.52464, -2.744202, 0.531925, -3.675218, -2.146856, 2.382364, 2.299613, -3.181212, 2.967828, 2.004113, 2.733868, 1.488852],
    nullDefBefore: [-5.206794, -2.7404, -0.273122, -2.924566, 1.783727, -1.629523, -3.908306, 1.576887, -2.940898, -2.033988, 0.660685, -2.217852, 0.613548, 1.001257, -1.126525, -4.8063, -4.518528, -3.12563, -1.31536, 1.304824, 4.142075, 4.545604, 1.0036],
    nullDefAfter: [-2.660726, -1.976887, 0.482839, -4.991716, -0.778491, 1.390346, 1.892568, -2.00125, -3.172803, 1.715332, -1.757795, -3.157892, -2.719575, -0.549673, -3.117087, 4.374255, -1.175794, 4.229956, 3.881426, 4.456473, 2.378381, -0.983765, 3.800552],
    discSuit: [0.761563, -5.808448, -5.355957, 2.497659, 1.626462, -1.142997],
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
