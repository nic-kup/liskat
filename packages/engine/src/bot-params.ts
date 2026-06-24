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

  // Null bidding is kept tight (this bot plays null poorly, so loose nulls are a
  // money-loser against real defence): no ace and effectively ten low cards.
  nullHandMinLows: 9.777,
  nullMinLows: 9.159,

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
  // weighted feature vector and the best is played; suitDecl/suitDef are used for
  // suit & grand play (declarer / defender). Evolved by experiments/evolve-play.ts
  // with the bidding frozen. This is the iteration-3 genome (the feature set gained
  // partner-can-ruff, point-count clinch/press, and graded trump-pull); validated
  // head-to-head against the original heuristic play across four 30k-deal seeds at
  // +2.0..+2.7 pts/deal, declarer win rate ~74% -> ~78%, and +0.4 over the prior
  // (iteration-1) scored genome. Null play is NOT scored (see bot.ts decidePlay) --
  // the bot never bids null, so the nullDecl/nullDef vectors below got no evolution
  // signal and are inert; null routes to the hand-tuned heuristic instead. They are
  // kept here as the literal evolved genome for the record / a future null arena.
  scorePlay: 1,
  playW: {
    suitDecl: [
      0.9330323715955103, -1.449637321811447, -4.721353658935217, 4.861533013011258, 1.160590449285917,
      0.29267311004447777, 5.75820057287312, 1.261248115374525, 4.039248437620387, 0.7992909703715289,
      -2.3398627726971344, 2.574329516393262, 0.9071803545510322, -2.1059053993074337, -1.5953321709521278,
      -0.5371410630113218, 0.38952803977216, 3.644065804128857, -2.231852001448767, 1.1817431083772794,
      -0.4486565275279636, 1.9665103104497486, -0.3090322884318595, 0.4257685364077681,
    ],
    suitDef: [
      -0.010659711590045001, -1.0295946414535164, -3.869104043797315, -0.32708446808263525, 3.363910387206098,
      1.219306703566128, -3.4838679984533867, 0.9283996445629197, 2.7942902740161535, 0.7299814635885865,
      -1.6053380149512366, 4.925304010593967, 4.178700605697056, 1.4379756947312798, -0.8999475672022483,
      4.2326868283327945, -0.003604340136893612, 3.8969985946331946, -2.3205920702020832, 0.5775815045946551,
      0.23297448589392467, 1.1488110563928453, 0.38799706834907094, -0.4095952532231303,
    ],
    nullDecl: [
      -1.3648679294110204, -0.2244717642912319, -0.05873313817944814, 0.31931018029820973, 3.113562216841169,
      4.118556640958311, -1.8006491313180075,
    ],
    nullDef: [
      -0.9047475709026015, -0.8140666776308066, 0.7965834869698251, 1.4662814466963203, 1.1340262510225498,
      -1.9582468731985243, 0.14070423483527592,
    ],
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
