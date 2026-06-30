// Friendly one-line explanations for the tutorial coach's "why this card" bubble, keyed by the
// engine's play-feature names (SUIT_FEATURES / NULL_FEATURES). The server sends the dominant
// feature name for each suggested card; this maps it to learner-facing wording. Only positive
// reasons are mapped; the "following + lose" features describe shedding a cheap card honestly
// (no invented plan).
export const FEATURE_WHY: Record<string, string> = {
  lead_str: 'Leads a strong card to grab the trick.',
  lead_pts: 'Leads a high-value card.',
  lead_trump: 'Leads a trump to take control.',
  lead_trump_pull: "Leads a trump to draw out the opponents' trumps.",
  lead_trump_pull_graded: "Leads a trump to strip the opponents' remaining trumps.",
  lead_master: 'Cashes a card that beats everything left in its suit.',
  lead_master_safe: 'Cashes a sure winner no one can trump.',
  lead_len: 'Leads from a long suit to establish it.',
  lead_len_trump: 'Leads from your trump length to keep control.',
  lead_len_side: 'Leads from your longest side suit to set it up.',
  win: 'Takes the trick.',
  win_val: 'Takes the trick along with the points in it.',
  win_str: 'Wins the trick without spending a high card.',
  win_ruff: 'Trumps in to win a side-suit trick.',
  win_ruff_last: 'Trumps in last to win safely, with no over-ruff.',
  win_last: 'Wins safely as the last to play.',
  win_clinch: 'Wins the trick that clinches the game.',
  win_press: 'Presses for extra points toward a schneider.',
  decl_press90: 'Pushes the defenders toward schneider for a bigger game.',
  def_secure30: "Locks in 30 points so the declarer can't schneider your side.",
  friend_pts: "Hands points to your partner's winning trick (schmiert).",
  win_late: 'Cashes a winner late, when few tricks remain.',
  lose_pts: "Throws a low-value card into a trick you likely won't win.",
  lose_str: 'Sheds a weak card and keeps your strong ones for later.',
  lose_len: 'Gives up a card you can spare on this trick.',
  lead_partner_ruff: 'Leads a suit your partner can trump for your side.',
  nlead_rank: 'Leads a low card so you can duck under the trick.',
  nlead_len: 'Leads from a long suit to shed cards safely.',
  nlead_declvoid: "Leads a suit the declarer can't follow.",
  nfollow_rank: 'Plays a low card to stay under the trick.',
  nfollow_voidrank: 'Sheds a dangerous high card while you can.',
  nfollow_voidlen: 'Discards to shorten a suit safely.',
};

export function whyForFeature(feature: string): string {
  return FEATURE_WHY[feature] ?? 'The bot rates this the strongest play here.';
}
