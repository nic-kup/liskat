<script lang="ts">
  // Post-game deal review: step through a finished deal card by card with every
  // hand face-up, and see what the learned bot would have played each turn (its
  // pick ringed green, the card actually played ringed amber when they differ).
  import { cardFromId, cardId, cardPoints, sortHand, type Card as ECard, type Contract } from '@liskat/engine';
  import type { ReviewDeal, PlayerView } from './types.ts';
  import { identityForSlot } from './players.ts';
  import { whyForFeature } from './tutorialHints.ts';
  import Card from './Card.svelte';

  interface Props {
    review: ReviewDeal;
    players: PlayerView[];
    onClose: () => void;
  }
  let { review, players, onClose }: Props = $props();

  const total = $derived(review.plies.length);
  let k = $state(0); // number of plies already played (cursor sits before plies[k])

  const SUIT_GLYPH: Record<string, string> = { C: '♣', S: '♠', H: '♥', D: '♦' };
  const glyph = (id: string) => SUIT_GLYPH[id[0]] + id.slice(1);
  const nickOf = (slot: number) => players.find((p) => p.slot === slot)?.nick ?? null;
  const roleTag = (slot: number) =>
    review.declarerSlot === null ? '' : slot === review.declarerSlot ? 'Declarer' : 'Defender';

  // Each seat's 10-card PLAY hand, sorted by the game's order for readability. The
  // declarer who took the skat plays their dealt ten plus the skat minus what they buried.
  const startHands = $derived.by(() => {
    const contract = (review.contract ?? undefined) as Contract | undefined;
    const sortIds = (ids: string[]) => sortHand(ids.map(cardFromId), contract).map(cardId);
    return review.hands.map((h, slot) => {
      if (review.tookSkat && slot === review.declarerSlot && review.discard) {
        const buried = new Set(review.discard);
        return sortIds(h.concat(review.skat).filter((c) => !buried.has(c)));
      }
      return sortIds(h.slice());
    });
  });

  const played = $derived(review.plies.slice(0, k));
  const playedBySlot = $derived.by(() => {
    const m: Record<number, Set<string>> = { 0: new Set(), 1: new Set(), 2: new Set() };
    for (const p of played) m[p.slot].add(p.card);
    return m;
  });
  const remaining = (slot: number): string[] => startHands[slot].filter((c) => !playedBySlot[slot].has(c));

  // The trick currently shown on the board = the trick of the last card played.
  const dispTrick = $derived(k > 0 ? played[k - 1].trick : -1);
  const boardPlies = $derived(dispTrick < 0 ? [] : played.filter((p) => p.trick === dispTrick));
  const trickComplete = $derived(boardPlies.length === 3);
  const trickWinner = $derived(dispTrick >= 0 ? review.tricks[dispTrick].winner : -1);

  // The upcoming move (what pressing ▶ will play) — the teaching moment.
  const cur = $derived(k < total ? review.plies[k] : null);

  const eyes = $derived.by(() => {
    if (!review.contract || review.contract.type === 'null') return null;
    // Buried cards count for the declarer: the discard once they took the skat, else the dealt skat (hand game).
    const buried = review.tookSkat && review.discard ? review.discard : review.skat;
    let decl = buried.reduce((n, id) => n + cardPoints(cardFromId(id)), 0);
    let def = 0;
    const lastComplete = trickComplete ? dispTrick : dispTrick - 1;
    for (let t = 0; t <= lastComplete; t++) {
      const pts = review.tricks[t].cards.reduce((n, id) => n + cardPoints(cardFromId(id)), 0);
      if (review.tricks[t].winner === review.declarerSlot) decl += pts;
      else def += pts;
    }
    return { decl, def };
  });

  const opps = $derived([0, 1, 2].filter((s) => s !== review.viewerSlot));

  // Highlight state for one card in a hand: only the seat on turn shows rings.
  function hi(slot: number, id: string): 'bot' | 'actual' | '' {
    if (!cur || cur.slot !== slot) return '';
    if (cur.bestCard && id === cur.bestCard) return 'bot';
    if (id === cur.card) return 'actual';
    return '';
  }

  function ecard(id: string): ECard {
    return cardFromId(id);
  }

  // ---- stepping ----
  const nextCard = () => (k = Math.min(total, k + 1));
  const prevCard = () => (k = Math.max(0, k - 1));
  function nextTrick() {
    if (k >= total) return;
    const t = review.plies[k].trick;
    let j = k;
    while (j < total && review.plies[j].trick === t) j++;
    k = j; // board now shows trick t complete
  }
  function prevTrick() {
    if (k <= 0) return;
    const t = review.plies[k - 1].trick;
    let j = k;
    while (j > 0 && review.plies[j - 1].trick === t) j--;
    k = j; // peel back the current trick's cards
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') { e.preventDefault(); nextCard(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prevCard(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); nextTrick(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); prevTrick(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }
  $effect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Contract label for the header.
  const contractLabel = $derived.by(() => {
    const c = review.contract;
    if (!c) return 'Passed in';
    if (c.type === 'grand') return 'Grand';
    if (c.type === 'null') return 'Null';
    return { C: '♣ Clubs', S: '♠ Spades', H: '♥ Hearts', D: '♦ Diamonds' }[c.suit!] ?? c.suit!;
  });
  const mods = $derived.by(() => {
    const m: string[] = [];
    if (review.contract && !review.tookSkat) m.push('Hand');
    if (review.ouvert) m.push('Open');
    return m.join(' · ');
  });

  // Opponent-stack sizing is dynamic so the two stacks always stay on one row: as
  // the sheet narrows we first shrink the cards, then (only once they hit a floor)
  // overlap them more. Sized for a full 10-card hand so the layout stays put while
  // stepping. `oppsW` is the measured available width.
  let oppsW = $state(0);
  const oppSize = $derived.by(() => {
    const N = 10;
    const OCW_MAX = 46, OCW_MIN = 24, F0 = 0.2;
    const per = Math.max(48, (oppsW || 700) - 28) / 2; // budget per stack (minus gap + seat padding)
    let ocw = per / (N - (N - 1) * F0); // width at the default ~20% overlap
    let f = F0;
    if (ocw > OCW_MAX) ocw = OCW_MAX; // wide screen: cap card size, leave side space
    else if (ocw < OCW_MIN) {
      ocw = OCW_MIN; // floor the card size, then overlap harder to fit
      f = Math.max(F0, Math.min(0.55, (N - per / OCW_MIN) / (N - 1)));
    }
    return { ocw: Math.round(ocw), ov: Math.round(ocw * f) };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="sheet" onclick={(e) => e.stopPropagation()}>
    <header>
      <div class="htitle">
        <strong>Deal {review.deal}</strong>
        {#if review.declarerSlot !== null}
          <span class="dot" style="color:{identityForSlot(review.declarerSlot).color}">{identityForSlot(review.declarerSlot).marker}</span>
          <span>{nickOf(review.declarerSlot) ?? 'Declarer'} played <strong>{contractLabel}</strong>{#if mods} · {mods}{/if}</span>
        {:else}
          <span>Everyone passed — no game.</span>
        {/if}
      </div>
      {#if review.result}
        <div class="hresult" class:won={review.result.won} class:lost={!review.result.won}>
          {review.result.won ? 'Declarer won' : 'Declarer lost'} · {review.result.value}
          {#if review.result.cardPoints != null}· {review.result.cardPoints} eyes{/if}
        </div>
      {/if}
      <button class="close" onclick={onClose} aria-label="Close review">✕</button>
    </header>

    {#if review.passedIn || review.declarerSlot === null}
      <div class="empty">This deal was passed in, so there's nothing to play through.</div>
    {:else}
      <!-- Opponents: gently-overlapping stacks, face up. Card size + overlap are
           sized dynamically (oppSize) so both stacks always share one row. -->
      <div class="opps" bind:clientWidth={oppsW} style="--ocw:{oppSize.ocw}px; --ov:{oppSize.ov}px">
        {#each opps as slot}
          {@const id = identityForSlot(slot)}
          <div class="seat" class:onturn={cur?.slot === slot}>
            <div class="seatlabel">
              <span class="dot" style="color:{id.color}">{id.marker}</span>
              {nickOf(slot) ?? 'Bot'}{#if roleTag(slot)} · <span class="tag">{roleTag(slot)}</span>{/if}
            </div>
            <div class="stack">
              {#each remaining(slot) as cid (cid)}
                <div class="rcard oppcard {hi(slot, cid)}">
                  <Card card={ecard(cid)} fill />
                </div>
              {/each}
              {#if remaining(slot).length === 0}<span class="spent">— all played —</span>{/if}
            </div>
          </div>
        {/each}
      </div>

      <!-- Trick board -->
      <div class="board">
        {#if boardPlies.length === 0}
          <div class="boardhint">Trick {dispTrick + 2 > review.tricks.length ? review.tricks.length : dispTrick + 2} — press ▶ to play a card</div>
        {:else}
          {#each boardPlies as p (p.slot + ':' + p.card)}
            {@const id = identityForSlot(p.slot)}
            <div class="played" class:winner={trickComplete && p.slot === trickWinner}>
              <span class="dot" style="color:{id.color}">{id.marker}</span>
              <Card card={ecard(p.card)} width={70} />
            </div>
          {/each}
        {/if}
      </div>

      <!-- Bot-vs-actual caption for the upcoming move -->
      <div class="caption">
        {#if eyes}<span class="eyes">Declarer {eyes.decl} · Defenders {eyes.def}</span>{/if}
        {#if cur}
          {@const actor = cur.slot === review.viewerSlot ? 'You' : nickOf(cur.slot) ?? 'Bot'}
          {#if !cur.bestCard}
            <span class="why"><strong>{actor}</strong>: only one legal card.</span>
          {:else if cur.card === cur.bestCard}
            <span class="why"><strong>{actor}</strong> played {glyph(cur.card)} — <span class="chip bot">the bot's top pick</span>. {whyForFeature(cur.bestFeature ?? '')}</span>
          {:else}
            <span class="why"><span class="chip bot">Bot's top pick</span> {glyph(cur.bestCard)} — {whyForFeature(cur.bestFeature ?? '')} <span class="chip actual">{actor} played</span> {glyph(cur.card)}.</span>
          {/if}
        {:else}
          <span class="why">End of the deal.</span>
        {/if}
      </div>

      <!-- Viewer's own hand, normal size at the bottom -->
      <div class="you">
        <div class="seatlabel">
          <span class="dot" style="color:{identityForSlot(review.viewerSlot).color}">{identityForSlot(review.viewerSlot).marker}</span>
          You{#if roleTag(review.viewerSlot)} · <span class="tag">{roleTag(review.viewerSlot)}</span>{/if}
        </div>
        <div class="youhand">
          {#each remaining(review.viewerSlot) as cid (cid)}
            <div class="rcard youcard {hi(review.viewerSlot, cid)}">
              <Card card={ecard(cid)} fill />
            </div>
          {/each}
          {#if remaining(review.viewerSlot).length === 0}<span class="spent">— all played —</span>{/if}
        </div>
      </div>

      <!-- Step controls -->
      <footer class="controls">
        <button onclick={prevTrick} disabled={k === 0} title="Previous trick (↑)">⏮</button>
        <button onclick={prevCard} disabled={k === 0} title="Previous card (←)">◀</button>
        <span class="pos">{k} / {total}</span>
        <button onclick={nextCard} disabled={k === total} title="Next card (→)">▶</button>
        <button onclick={nextTrick} disabled={k === total} title="Next trick (↓)">⏭</button>
      </footer>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.62);
    backdrop-filter: blur(3px);
    z-index: 400;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .sheet {
    --ocw: 40px; /* opponent card width */
    --ov: 8px; /* how much each opponent card overlaps the previous (~20% of --ocw) */
    background: #14321f;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
    width: min(760px, 96vw);
    max-height: 94vh;
    overflow-y: auto;
    padding: 14px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .htitle {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
    font-size: 14px;
  }
  .hresult {
    font-size: 13px;
    font-weight: 700;
  }
  .hresult.won { color: #7fe3a3; }
  .hresult.lost { color: #ff8a80; }
  .close {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--muted);
    font-size: 18px;
    cursor: pointer;
    line-height: 1;
  }
  .dot { font-size: 13px; }
  .tag { color: var(--muted); font-size: 12px; }
  .empty { color: var(--muted); padding: 24px; text-align: center; }

  .opps {
    display: flex;
    gap: 12px;
    justify-content: center;
    flex-wrap: nowrap; /* both stacks always share one row */
    overflow: hidden;
  }
  .seat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px 3px;
    min-width: 0; /* let the seat shrink to its stack; the label truncates */
    border-radius: 12px;
    transition: background 0.15s ease;
  }
  .seat.onturn { background: rgba(255, 255, 255, 0.06); }
  .seatlabel {
    font-size: 12.5px;
    display: flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stack { display: flex; align-items: flex-end; min-height: 60px; }
  /* Opponent cards: fixed small width, gently overlapping (~20%). */
  .oppcard { flex: 0 0 auto; width: var(--ocw); }
  .stack .rcard + .rcard { margin-left: calc(-1 * var(--ov)); }
  .spent { color: var(--muted); font-size: 12px; font-style: italic; padding: 20px 4px; }

  .board {
    display: flex;
    gap: 14px;
    justify-content: center;
    align-items: flex-end;
    min-height: 108px;
    padding: 6px 0;
  }
  .boardhint { color: var(--muted); font-size: 13px; align-self: center; }
  .played {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    border-radius: 10px;
    padding: 4px;
  }
  .played.winner { background: rgba(95, 208, 122, 0.16); box-shadow: 0 0 0 1px rgba(95, 208, 122, 0.5); }

  .caption {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: center;
    text-align: center;
    font-size: 13px;
    min-height: 34px;
  }
  .eyes { color: var(--muted); font-size: 12px; }
  .why { line-height: 1.4; }
  .chip {
    display: inline-block;
    border-radius: 6px;
    padding: 0 6px;
    font-size: 11px;
    font-weight: 700;
  }
  .chip.bot { background: rgba(95, 208, 122, 0.25); color: #b8f0c8; }
  .chip.actual { background: rgba(255, 180, 84, 0.25); color: #ffd8a8; }

  .you { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%; }
  /* Your own hand is always a single row: cards shrink to fit rather than wrapping. */
  .youhand {
    display: flex;
    gap: 4px;
    align-items: flex-end;
    flex-wrap: nowrap;
    justify-content: center;
    width: 100%;
    min-height: 88px;
  }
  .youcard { flex: 0 1 62px; min-width: 0; max-width: 62px; }

  /* Bot-pick / actually-played rings. Applied to a wrapper so they sit behind the
     card's rounded art. */
  .rcard { border-radius: 8%; }
  .rcard.bot { box-shadow: 0 0 0 2px #5fd07a, 0 0 5px rgba(95, 208, 122, 0.55); }
  .rcard.actual { box-shadow: 0 0 0 2px #ffb454, 0 0 5px rgba(255, 180, 84, 0.5); }

  .controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding-top: 4px;
  }
  .controls button {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.16);
    color: var(--fg, #eaf6ee);
    border-radius: 9px;
    padding: 7px 13px;
    font-size: 15px;
    cursor: pointer;
  }
  .controls button:disabled { opacity: 0.35; cursor: default; }
  .pos { font-variant-numeric: tabular-nums; color: var(--muted); min-width: 58px; text-align: center; }

  /* Phone: just trim the sheet padding. Opponent card size + overlap and the own
     hand both size themselves to the width, so nothing needs to wrap. */
  @media (max-width: 620px) {
    .sheet { padding: 12px 10px 14px; }
  }
</style>
