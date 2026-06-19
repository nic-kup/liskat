<script lang="ts">
  import { conn, bid, hold, pass, takeSkat, playHand, discard, declareContract, playCard, leaveTable } from './ws.ts';
  import { cardId, nextBid, sortHand } from '@liskat/engine';
  import type { Card, Contract, TableView } from './types.ts';
  import CardView from './Card.svelte';
  import Chat from './Chat.svelte';
  import History from './History.svelte';

  let hintsOpen = $state(localStorage.getItem('liskat.hints') !== 'closed');
  function toggleHints() {
    hintsOpen = !hintsOpen;
    localStorage.setItem('liskat.hints', hintsOpen ? 'open' : 'closed');
  }

  const view = $derived($conn.view as TableView);
  const round = $derived(view?.round);
  const mySlot = $derived(view?.youSlot ?? -1);
  const me = $derived(view?.players.find((p) => p.you));
  const opponents = $derived(view ? view.players.filter((p) => p.slot !== mySlot) : []);
  const hand = $derived(round ? sortHand(round.yourHand, round.contract ?? undefined) : []);

  let selected = $state<string[]>([]);
  let annSchneider = $state(false);
  let annSchwarz = $state(false);
  let annOuvert = $state(false);

  $effect(() => {
    view?.dealIndex;
    selected = [];
    annSchneider = annSchwarz = annOuvert = false;
  });

  const shareLink = $derived(view ? `${location.origin}/?table=${view.id}` : '');

  function isMyTurn(): boolean {
    if (!round) return false;
    if (round.phase === 'playing') return round.turnSlot === mySlot && !round.trickComplete;
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

{#snippet hints()}
  <div class="hints">
    <button class="hint-toggle" onclick={toggleHints}>{hintsOpen ? '▾' : '▸'} Game hints</button>
    {#if hintsOpen}
      <div class="hint-body">
        <div class="hline"><b>Game values:</b> ♦ 9 · ♥ 10 · ♠ 11 · ♣ 12 · Grand 24 · Null 23</div>
        <ul>
          <li><b>Suit</b> — that suit plus all four Jacks are trumps</li>
          <li><b>Grand</b> — only the four Jacks are trumps</li>
          <li><b>Null</b> — no trumps; you win by losing every trick</li>
          <li><b>Ouvert</b> — play with your hand face-up for a higher value. Null Ouvert is common; a suit/grand Ouvert must also be played (and announced) for Schwarz.</li>
        </ul>
        <div class="hline muted">Your bid = base × (matadors + game + extras). A bid only promises a value — you choose the actual game after winning.</div>
      </div>
    {/if}
  </div>
{/snippet}

{#if view}
  <div class="table">
    <div class="topbar">
      <button class="ghost" onclick={leaveTable}>← Leave</button>
      <span class="wordmark">liskat</span>
      <div class="info">
        {view.format.kind === 'deals' ? `${view.format.deals} deals` : `Race to ${view.format.target}`}
        · deal {view.dealIndex + 1}
        {#if round && view.status !== 'waiting'}· <strong class="bidtag">bid {round.phase === 'bidding' ? round.bidding!.currentBid || '—' : round.bid}</strong>{/if}
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
          <div class="seat" class:turn={round?.phase === 'playing' && round.turnSlot === p.slot}>
            <div class="who">
              <strong>{p.nick}</strong>
              <span class="score">{view.match?.scores[p.slot] ?? 0}</span>
              {#if round?.declarerSlot === p.slot}<span class="badge">Declarer · {round.bid}</span>{/if}
            </div>
            <div class="backs">
              {#each Array(round?.handCounts[p.role] ?? 0) as _, i}
                <div class="backwrap" style="margin-left:{i === 0 ? 0 : -42}px"><CardView back width={48} /></div>
              {/each}
            </div>
          </div>
        {/each}
      </div>

      <!-- Center stage -->
      <div class="center">
        {#if round?.phase === 'finished' || view.status === 'between'}
          <div class="panel result">
            {#if round?.passedIn}
              <h3>Deal passed — no game.</h3>
            {:else if round?.result}
              <h3 class:won={round.result.won} class:lost={!round.result.won}>
                {slotName(round.declarerSlot ?? 0)} {round.result.won ? 'won' : 'lost'}
                {contractLabel(round.contract)} for {round.result.value}
                {round.result.schneider ? '· Schneider' : ''}{round.result.schwarz ? '· Schwarz' : ''}
              </h3>
            {/if}
            <p class="muted">next deal shortly…</p>
          </div>
        {:else if round?.phase === 'bidding'}
          <div class="panel bidding">
            {#if round.bidding!.currentBid > 0}
              <div class="bidphrase">{slotName(round.bidding!.lastBidderSlot ?? 0)} bid <span class="bignum">{round.bidding!.currentBid}</span></div>
            {:else}
              <div class="caption">no bid yet</div>
            {/if}

            {#if isMyTurn()}
              {#if round.bidding!.awaiting === 'response'}
                <p class="prompt">Hold {round.bidding!.currentBid}, or pass?</p>
                <div class="bigactions">
                  <button class="primary" onclick={hold}>Hold {round.bidding!.currentBid}</button>
                  <button onclick={pass}>Pass</button>
                </div>
              {:else if round.bidding!.awaiting === 'forehand-decision'}
                <p class="prompt">Everyone passed — play the hand yourself?</p>
                <div class="bigactions">
                  {#each nextBids() as v}<button class="primary" onclick={() => bid(v)}>Play {v}</button>{/each}
                  <button onclick={pass}>Pass</button>
                </div>
              {:else}
                <p class="prompt">Your call:</p>
                <div class="bigactions">
                  {#each nextBids() as v}<button class="primary" onclick={() => bid(v)}>{v}</button>{/each}
                  <button onclick={pass}>Pass</button>
                </div>
              {/if}
            {:else}
              <p class="prompt muted">Bidding — {slotName(round.bidding!.askerSlot)} to call…</p>
            {/if}
            {@render hints()}
          </div>
        {:else if round?.phase === 'declaring'}
          {#if round.declarerSlot === mySlot}
            <div class="panel declaring">
              {#if round.declareStep === 'choose'}
                <h3>You won the bid at {round.bid}</h3>
                <div class="bigactions">
                  <button class="primary" onclick={takeSkat}>Pick up Skat</button>
                  <button onclick={playHand}>Play hand</button>
                </div>
                {@render hints()}
              {:else if round.declareStep === 'discard'}
                <h3>Pick two cards for the Skat ({selected.length}/2)</h3>
                <p class="muted">Click cards in your hand below.</p>
                <button class="primary" onclick={doDiscard} disabled={selected.length !== 2}>Put in Skat</button>
              {:else if round.declareStep === 'contract'}
                <h3>Choose your game</h3>
                <div class="contracts">
                  <button class="game" onclick={() => declare({ type: 'null' })} title="Lose every trick — value 23">Null</button>
                  <button class="suit" style="color:#e6820a" onclick={() => declare({ type: 'suit', suit: 'D' })} title="Diamonds — base 9">♦</button>
                  <button class="suit" style="color:#d11" onclick={() => declare({ type: 'suit', suit: 'H' })} title="Hearts — base 10">♥</button>
                  <button class="suit" style="color:#1f7a1f" onclick={() => declare({ type: 'suit', suit: 'S' })} title="Spades — base 11">♠</button>
                  <button class="suit" style="color:#1a1a1a" onclick={() => declare({ type: 'suit', suit: 'C' })} title="Clubs — base 12">♣</button>
                  <button class="game" onclick={() => declare({ type: 'grand' })} title="Only Jacks are trumps — base 24">Grand</button>
                </div>
                <div class="anns">
                  {#if round.tookSkat === false}
                    <label><input type="checkbox" bind:checked={annSchneider} /> Schneider</label>
                    <label><input type="checkbox" bind:checked={annSchwarz} /> Schwarz</label>
                  {/if}
                  <label><input type="checkbox" bind:checked={annOuvert} /> Ouvert</label>
                </div>
                {@render hints()}
              {/if}
            </div>
          {:else}
            <div class="panel"><p class="prompt muted">{slotName(round.declarerSlot ?? 0)} is choosing the game…</p></div>
          {/if}
        {:else if round?.phase === 'playing'}
          <div class="trick">
            {#each round.trick as t}<div class="played"><CardView card={t.card} width={88} /></div>{/each}
            {#if round.trick.length === 0}<p class="muted">{slotName(round.turnSlot)} leads…</p>{/if}
          </div>
        {/if}
      </div>

      <!-- My hand -->
      <div class="myseat" class:turn={isMyTurn()}>
        <div class="who">
          <strong>{me?.nick}</strong>
          <span class="score">{view.match?.scores[mySlot] ?? 0}</span>
          {#if round?.declarerSlot === mySlot}<span class="badge">Declarer · {round.bid}</span>{/if}
          {#if round?.phase === 'playing'}
            <span class="turnhint" class:active={isMyTurn()}>{isMyTurn() ? 'your turn' : `${slotName(round.turnSlot)}'s turn`}</span>
          {/if}
        </div>
        <div class="hand">
          {#each hand as card (cardId(card))}
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
          <p>{view.players.map((p) => `${p.nick}: ${view.match!.scores[p.slot]}`).join(' · ')}</p>
          <button class="primary" onclick={leaveTable}>Back to lobby</button>
        </div>
      {/if}

      {#if round && round.lastTrick.length === 3}
        <div class="lasttrick">
          <div class="lt-label">last trick</div>
          <div class="lt-cards">
            {#each round.lastTrick as t}<CardView card={t.card} width={46} />{/each}
          </div>
          {#if round.lastTrickWinnerSlot !== null}
            <div class="lt-won">won by {slotName(round.lastTrickWinnerSlot)}</div>
          {/if}
        </div>
      {/if}

      <History history={view.history} players={view.players} />
      <Chat messages={view.chat} />
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
    padding: 12px 12px 6px;
    box-sizing: border-box;
  }
  .bidtag {
    color: #ffd54a;
  }
  .topbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    font-size: 14px;
    color: var(--muted);
  }
  .wordmark {
    font-weight: 800;
    font-size: 18px;
    color: #f2f5f3;
    text-align: center;
  }
  .info {
    text-align: right;
  }
  .ghost {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 14px;
    justify-self: start;
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
  .turnhint {
    color: var(--muted);
    font-size: 12px;
  }
  .turnhint.active {
    color: #ffd54a;
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
    min-height: 200px;
    padding: 12px 0;
  }
  .panel {
    text-align: center;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    padding: 22px 28px;
    max-width: 520px;
  }
  .bidphrase {
    font-size: 28px;
    font-weight: 600;
    margin-bottom: 12px;
  }
  .bignum {
    font-size: 52px;
    font-weight: 800;
    line-height: 1;
    color: #ffd54a;
    vertical-align: -8px;
    margin-left: 6px;
  }
  .caption {
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 2px;
    font-size: 13px;
    margin-bottom: 12px;
  }
  .prompt {
    font-size: 17px;
    margin: 6px 0 12px;
  }
  .bigactions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: center;
  }
  .bigactions button {
    padding: 12px 18px;
    font-size: 17px;
    font-weight: 600;
    min-width: 64px;
  }
  .contracts {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: center;
    margin-bottom: 8px;
  }
  .contracts button {
    font-size: 22px;
    padding: 10px 16px;
    min-width: 60px;
  }
  .contracts .suit {
    background: #fffdf7;
    font-size: 26px;
    line-height: 1;
  }
  .contracts .suit:hover {
    background: #fff;
    transform: translateY(-2px);
  }
  .anns {
    display: flex;
    gap: 14px;
    justify-content: center;
    margin: 8px 0;
  }
  .hints {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 13px;
    color: var(--muted);
    text-align: left;
  }
  .hint-toggle {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 13px;
    padding: 0;
  }
  .hint-body {
    margin-top: 6px;
  }
  .hints ul {
    margin: 6px 0;
    padding-left: 18px;
  }
  .hints li {
    margin: 3px 0;
  }
  .lasttrick {
    position: fixed;
    right: 16px;
    top: 50%;
    transform: translateY(-50%);
    text-align: center;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 10px;
    backdrop-filter: blur(6px);
  }
  .lt-label,
  .lt-won {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .lt-cards {
    display: flex;
    gap: 3px;
    margin: 6px 0;
  }
  .hline {
    margin: 3px 0;
  }
  .trick {
    display: flex;
    gap: 10px;
  }
  .myseat {
    margin-top: auto;
    padding: 0 12px;
  }
  .hand {
    display: flex;
    justify-content: center;
    align-items: flex-end;
    gap: 4px;
    padding: 0;
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
  .waiting {
    margin-top: 8vh;
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
