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

  scorePlay: 1,
  playW: {
    suitDecl: [
      1.3085431951619018, -1.9267888661997805, -4.885637635440492, 5.312465699647187, 1.4367640819543472,
      0.8963894884408642, 4.562916374847021, 1.1217291366460285, 0.1001914478308864, 1.6548289662395663,
      -2.760466448837775, 1.1665052154573232, 0.2756020139619183, 1.621428257744532, -0.6725496083047564,
      -1.8916470868020616, -0.6073489905757306, 3.7950285287444707, -3.923666942587574, 0.549019545222805,
      -0.45479158368488676, 2.771156117377572, -0.9929575758013224, 0.5189654964774506, -0.29311621105731567,
      0.4514291791053511, -0.5483765327972963,
    ],
    suitDef: [
      0.487751375761592, -2.9290587588937766, -4.8431123140413375, 0.04580922085343578, 3.7348629054369646,
      1.758428332905364, -0.3935328306808904, 2.3560827066620282, 3.4960643644561373, 1.72923036809147,
      -2.5211808784652874, -0.7608597908083929, 3.4518967126228, 2.1801901720435444, -2.1935212901443575,
      4.296792424164944, -1.873368219179978, 1.763555985757881, -3.1689900781268867, 1.0726161299627845,
      0.32155471069471164, 2.8533616605635284, 0.19168482001074622, -0.28743961754104697, -1.8609522886516419,
      1.7167489779699594, -3.15040543413941,
      // idx 27-30 (iter-5 features def_secure30/decl_press90/win_late/ten_protect) stay
      // inert; idx 31 lead_ruff_highpts = -2.5: don't lead a side suit the declarer can
      // ruff when our A/10 are still out in it (the evolved lead_ruffrisk at idx 7 = +2.36
      // over-leads ruffable suits; this counters it ONLY when high cards would be donated).
      // ~neutral in self-play (the bot can't see the partner's A/10) but fixes a real
      // human-observed mistake; defender-role edge +0.034 across 3 seeds, scenario-verified.
      // idx 32 overtake_partner = -6: don't RUFF (spend a trump on) a side-suit trick my
      // partner already holds as the last hand -- pure trump waste (game-watcher found ~180
      // such blunders / 600 deals, e.g. ruffing partner's winning ace). Bidding-isolated
      // paired A/B (formula bidder, 1500 deals x3 seeds): -3 vs 0 = +0.062/+0.053/-0.009
      // aggregate, def-role +0.136/+0.115/-0.020. The MC-bidder A/B looked negative only
      // because the candidate's bid playouts simulate the new defenders while FACING old ones
      // -- an asymmetric-A/B artifact that vanishes in production (homogeneous weights).
      // STRENGTHENED -3 -> -6 (iter 14): -3 left ~13/600 residual ruff-partner-last (clinch
      // situations where win_clinch +2.85 overpowered it); -6 drops it to 9 (all FORCED:
      // single-card/all-trump hands that must ruff), and -8 gives no further reduction.
      // -6 vs -3 is FORMULA-neutral (+0.000 across seeds), so it strictly dominates -3.
      // idx 33 lead_dead_master = -6: don't "cash" a master that's DEAD (a master in a side
      // suit the declarer is shown void in + can ruff) -- leading it just donates the honour to
      // the declarer's ruff instead of keeping it to schmier onto the partner (game-watcher
      // found 233/600 such donations of K/10/A). Complement of lead_master_safe (idx 5); a
      // negative weight cancels the spurious lead_master+lead_ruffrisk pull. Bidding-isolated
      // A/B (formula bidder, 1500 deals x3): +0.107/+0.009/+0.000 aggregate, def-role
      // +0.233/+0.019/+0.000. Scenario-verified (scenario-deadmaster.ts).
      0, 0, 0, 0, -2.5, -6, -6,
    ],
    // Tuned by experiments/evolve-null.ts (forced-null arena): 37.6% forced-null win
    // rate vs the heuristic's 30.5% out-of-sample, and better in every hand-strength
    // bucket. nfollow_win is now strongly negative (never win a trick). Used for null
    // DECLARER play; null DEFENDER still routes to the heuristic (see bot.ts).
    nullDecl: [
      -1.6709907837212086, 3.954270238056779, -0.4434547573328018, -3.641405599191785, -0.7664509229362011,
      1.1660434026271105, -1.7166983261704445,
    ],
    // Tuned by experiments/evolve-nulldef.ts: sets a strong scored null declarer ~72%
    // vs the heuristic's ~62% (out-of-sample, two fresh seeds). It learned the core
    // null-defence rule -- nlead_declvoid strongly negative (never lead a suit the
    // declarer is void in) -- plus lead-from-short-suits. Used for null DEFENDER play.
    nullDef: [
      -0.15261148330688679, -4.254484866025763, -3.534733506438587, -2.6070902547099566, 3.369348128250137,
      -0.9696044106802282, -2.8794630630618467,
    ],
    // Learnable skat discard (bot-play-score.ts DISC_*_FEATURES), trained on the
    // real-game arena (experiments/train-realgame.ts) and validated by a variance-
    // reduced paired MC-bidder A/B vs the old heuristic discard: +5.3 pts/deal across
    // three seeds (4242/9999/31337: +5.48/+4.69/+5.83), the gain entirely in the
    // DECLARER role (+~24 pts/declared-game; defenders never discard, so their play is
    // byte-identical to before). The old heuristic buried the lowest-POINT cards and
    // so KEPT bare tens in hand where defenders' aces caught them; the learned policy
    // never buries trumps (-4.49) or aces (-4.88), buries a bare ten to bank the 10
    // safely (+1.04), and creates a ruffing void (+1.23) -- textbook druecken.
    // discSuit features: [d_pts, d_trump, d_ace, d_ten_bare, d_void, d_str].
    discSuit: [
      -0.25071009279202877, -4.492415500608839, -4.880599052216065, 1.040416379162799, 1.2283957985959226,
      0.4422676744831777,
    ],
    // discNull features: [dn_rank, dn_ace, dn_void, dn_low]. Bury the dangerous high
    // cards/aces and make voids; keep the low cards back for safe ducking.
    discNull: [2.8589344241275474, 1.3770521965608933, 1.8258151995518515, -1.5861749456878516],
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
