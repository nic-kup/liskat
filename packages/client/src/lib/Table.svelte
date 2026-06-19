<script lang="ts">
  import { conn, bid, hold, pass, takeSkat, playHand, discard, declareContract, playCard, leaveTable } from './ws.ts';
  import { cardId, nextBid, BID_VALUES } from '@liskat/engine';
  import type { Card, Contract, TableView } from './types.ts';
  import CardView from './Card.svelte';

  const view = $derived($conn.view as TableView);
  const round = $derived(view?.round);
  const mySlot = $derived(view?.youSlot ?? -1);
  const me = $derived(view?.players.find((p) => p.you));
  const myRole = $derived(me?.role ?? null);

  // Opponents, ordered for display (left, right).
  const opponents = $derived(view ? view.players.filter((p) => p.slot !== mySlot) : []);

  // Selection state for discarding two skat cards.
  let selected = $state<string[]>([]);
  // Announcement toggles for hand games.
  let annSchneider = $state(false);
  let annSchwarz = $state(false);
  let annOuvert = $state(false);

  $effect(() => {
    // Reset transient UI when the deal advances.
    view?.dealIndex;
    selected = [];
    annSchneider = annSchwarz = annOuvert = false;
  });

  const shareLink = $derived(view ? `${location.origin}/?table=${view.id}` : '');

  function isMyTurn(): boolean {
    if (!round) return false;
    if (round.phase === 'playing') return round.turnSlot === mySlot;
    if (round.phase === 'bidding') {
      const b = round.bidding!;
      return b.awaiting === 'response' ? b.responderSlot === mySlot : b.askerSlot === mySlot;
    }
    if (round.phase === 'declaring') return round.declarerSlot === mySlot;
    return false;
  }

  function legalNow(card: Card): boolean {
    return !!round?.legal.some((c) => cardId(c) === cardId(card));
  }

  function nextBids(): number[] {
    const cur = round?.bidding?.currentBid ?? 0;
    const out: number[] = [];
    let v = nextBid(cur);
    while (v !== null && out.length < 4) {
      out.push(v);
      v = nextBid(v);
    }
    return out;
  }

  function toggleSelect(card: Card) {
    const id = cardId(card);
    if (selected.includes(id)) selected = selected.filter((x) => x !== id);
    else if (selected.length < 2) selected = [...selected, id];
  }

  function doDiscard() {
    if (!round || selected.length !== 2) return;
    const cards = round.yourHand.filter((c) => selected.includes(cardId(c))) as [Card, Card];
    discard(cards);
  }

  function declare(contract: Contract) {
    const ann =
      contract.type === 'null'
        ? { ouvert: annOuvert }
        : { schneiderAnnounced: annSchneider, schwarzAnnounced: annSchwarz, ouvert: annOuvert };
    declareContract(contract, ann);
  }

  function onCardClick(card: Card) {
    if (round?.phase === 'declaring' && round.declareStep === 'discard') toggleSelect(card);
    else if (round?.phase === 'playing' && isMyTurn() && legalNow(card)) playCard(card);
  }

  function slotName(slot: number): string {
    return view?.players[slot]?.nick ?? '—';
  }

  function contractLabel(c: Contract | null): string {
    if (!c) return '';
    if (c.type === 'grand') return 'Grand';
    if (c.type === 'null') return 'Null';
    return { C: '♣ Clubs', S: '♠ Spades', H: '♥ Hearts', D: '♦ Diamonds' }[c.suit];
  }
</script>

{#if view}
  <div class="table">
    <div class="topbar">
      <button class="ghost" onclick={leaveTable}>← Leave</button>
      <div class="info">
        {view.format.kind === 'deals' ? `${view.format.deals} deals` : `Race to ${view.format.target}`}
        · deal {view.dealIndex + 1}
        {#if round?.contract}· <strong>{contractLabel(round.contract)}</strong>{/if}
      </div>
    </div>

    {#if view.status === 'waiting'}
      <div class="waiting">
        <h2>Waiting for players… ({view.players.filter((p) => p.occupied).length}/3)</h2>
        <p class="muted">Share this link so friends can join:</p>
        <div class="link">
          <input readonly value={shareLink} onclick={(e) => (e.currentTarget as HTMLInputElement).select()} />
          <button onclick={() => navigator.clipboard?.writeText(shareLink)}>Copy</button>
        </div>
        <ul class="seats">
          {#each view.players as p}
            <li>{p.occupied ? p.nick : '· empty seat ·'}</li>
          {/each}
        </ul>
      </div>
    {:else}
      <!-- Opponents -->
      <div class="opponents">
        {#each opponents as p}
          <div class="seat" class:turn={round?.turnSlot === p.slot}>
            <div class="who">
              <strong>{p.nick}</strong>
              <span class="score">{view.match?.scores[p.slot] ?? 0}</span>
            </div>
            <div class="backs">
              {#each Array(round?.handCounts[p.role] ?? 0) as _, i}
                <div class="backwrap" style="margin-left:{i === 0 ? 0 : -42}px">
                  <CardView back width={48} />
                </div>
              {/each}
            </div>
            {#if round?.declarerSlot === p.slot}<span class="badge">Declarer · {round.bid}</span>{/if}
          </div>
        {/each}
      </div>

      <!-- Center: trick / result -->
      <div class="center">
        {#if round?.phase === 'finished' || view.status === 'between'}
          <div class="result">
            {#if round?.passedIn}
              <h3>Deal passed — no game.</h3>
            {:else if round?.result}
              <h3 class:won={round.result.won} class:lost={!round.result.won}>
                {slotName(round.declarerSlot ?? 0)}
                {round.result.won ? 'won' : 'lost'}
                {contractLabel(round.contract)} for {round.result.value}
                {round.result.schneider ? '· Schneider' : ''}{round.result.schwarz ? '· Schwarz' : ''}
              </h3>
            {/if}
            <p class="muted">next deal shortly…</p>
          </div>
        {:else if round}
          <div class="trick">
            {#each round.trick as t}
              <div class="played"><CardView card={t.card} width={84} /></div>
            {/each}
            {#if round.trick.length === 0 && round.phase === 'playing'}
              <p class="muted">{slotName(round.turnSlot)} leads…</p>
            {/if}
          </div>
        {/if}
      </div>

      <!-- My area: hand + contextual controls -->
      <div class="myseat" class:turn={isMyTurn()}>
        <div class="who">
          <strong>{me?.nick} (you)</strong>
          <span class="score">{view.match?.scores[mySlot] ?? 0}</span>
          {#if round?.declarerSlot === mySlot}<span class="badge">Declarer · {round.bid}</span>{/if}
        </div>

        <div class="controls">
          {#if round?.phase === 'bidding' && isMyTurn()}
            {#if round.bidding!.awaiting === 'response'}
              <span class="prompt">Hold {round.bidding!.currentBid}?</span>
              <button class="primary" onclick={hold}>Hold {round.bidding!.currentBid}</button>
              <button onclick={pass}>Pass</button>
            {:else if round.bidding!.awaiting === 'forehand-decision'}
              <span class="prompt">Play the hand?</span>
              {#each nextBids() as v}
                <button class="primary" onclick={() => bid(v)}>Play {v}</button>
              {/each}
              <button onclick={pass}>Pass</button>
            {:else}
              <span class="prompt">Your bid:</span>
              {#each nextBids() as v}
                <button class="primary" onclick={() => bid(v)}>{v}</button>
              {/each}
              <button onclick={pass}>Pass</button>
            {/if}
          {:else if round?.phase === 'bidding'}
            <span class="prompt muted">Bidding… {slotName(round.bidding!.askerSlot)} to call (at {round.bidding!.currentBid})</span>
          {/if}

          {#if round?.phase === 'declaring' && isMyTurn()}
            {#if round.declareStep === 'choose'}
              <span class="prompt">You won the bid at {round.bid}.</span>
              <button class="primary" onclick={takeSkat}>Pick up Skat</button>
              <button onclick={playHand}>Play hand</button>
            {:else if round.declareStep === 'discard'}
              <span class="prompt">Select two cards to put in the Skat ({selected.length}/2).</span>
              <button class="primary" onclick={doDiscard} disabled={selected.length !== 2}>Discard</button>
            {:else if round.declareStep === 'contract'}
              <span class="prompt">Choose your game:</span>
              <button onclick={() => declare({ type: 'suit', suit: 'C' })}>♣</button>
              <button onclick={() => declare({ type: 'suit', suit: 'S' })}>♠</button>
              <button onclick={() => declare({ type: 'suit', suit: 'H' })}>♥</button>
              <button onclick={() => declare({ type: 'suit', suit: 'D' })}>♦</button>
              <button onclick={() => declare({ type: 'grand' })}>Grand</button>
              <button onclick={() => declare({ type: 'null' })}>Null</button>
              {#if round.tookSkat === false}
                <label><input type="checkbox" bind:checked={annSchneider} /> Schneider</label>
                <label><input type="checkbox" bind:checked={annSchwarz} /> Schwarz</label>
              {/if}
              <label><input type="checkbox" bind:checked={annOuvert} /> Ouvert</label>
            {/if}
          {:else if round?.phase === 'declaring'}
            <span class="prompt muted">{slotName(round.declarerSlot ?? 0)} is choosing the game…</span>
          {/if}

          {#if round?.phase === 'playing'}
            <span class="prompt" class:muted={!isMyTurn()}>
              {isMyTurn() ? 'Your turn — play a card.' : `${slotName(round.turnSlot)}'s turn…`}
            </span>
          {/if}
        </div>

        <div class="hand">
          {#each round?.yourHand ?? [] as card (cardId(card))}
            {@const selectable = round?.phase === 'declaring' && round.declareStep === 'discard'}
            {@const playable = round?.phase === 'playing' && isMyTurn() && legalNow(card)}
            <CardView
              {card}
              width={92}
              selected={selected.includes(cardId(card))}
              dim={round?.phase === 'playing' && isMyTurn() && !playable}
              onclick={selectable || playable ? () => onCardClick(card) : undefined}
            />
          {/each}
        </div>
      </div>

      {#if view.status === 'over' && view.match}
        <div class="gameover">
          <h2>Match over — winner: {slotName(view.match.winner ?? 0)}</h2>
          <p>Scores: {view.players.map((p) => `${p.nick}: ${view.match!.scores[p.slot]}`).join(' · ')}</p>
          <button class="primary" onclick={leaveTable}>Back to lobby</button>
        </div>
      {/if}
    {/if}

    {#if $conn.error}<p class="error">{$conn.error}</p>{/if}
  </div>
{/if}

<style>
  .table {
    max-width: 1000px;
    margin: 0 auto;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    padding: 12px;
    box-sizing: border-box;
  }
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 14px;
    color: var(--muted);
  }
  .ghost {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 14px;
  }
  .opponents {
    display: flex;
    justify-content: space-around;
    margin-top: 8px;
  }
  .seat,
  .myseat {
    border-radius: 12px;
    padding: 8px 12px;
    transition: box-shadow 0.15s;
  }
  .seat.turn,
  .myseat.turn {
    box-shadow: 0 0 0 2px #ffd54a;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  .score {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    padding: 1px 8px;
    font-variant-numeric: tabular-nums;
  }
  .badge {
    background: var(--accent);
    border-radius: 10px;
    padding: 1px 8px;
    font-size: 12px;
  }
  .backs {
    display: flex;
    margin-top: 6px;
    height: 67px;
  }
  .center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 160px;
  }
  .trick {
    display: flex;
    gap: 10px;
  }
  .myseat {
    margin-top: auto;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin: 10px 0;
    min-height: 38px;
  }
  .prompt {
    font-size: 14px;
  }
  .hand {
    display: flex;
    justify-content: center;
    gap: 4px;
    padding-top: 6px;
  }
  button {
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    cursor: pointer;
    font-size: 15px;
  }
  button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.16);
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    font-weight: 600;
  }
  label {
    font-size: 14px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .waiting,
  .gameover,
  .result {
    text-align: center;
  }
  .link {
    display: flex;
    gap: 8px;
    max-width: 420px;
    margin: 8px auto;
  }
  .link input {
    flex: 1;
    padding: 8px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
  }
  .seats {
    list-style: none;
    padding: 0;
  }
  .muted {
    color: var(--muted);
  }
  .won {
    color: #7fe3a3;
  }
  .lost {
    color: #ff8a80;
  }
  .error {
    color: #ff8a80;
    text-align: center;
  }
</style>
