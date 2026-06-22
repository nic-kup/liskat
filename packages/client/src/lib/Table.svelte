<script lang="ts">
  import { conn, bid, hold, pass, takeSkat, playHand, discard, declareContract, playCard, leaveTable } from './ws.ts';
  import { cardId, nextBid, sortHand, countMatadors, previewGameValue } from '@liskat/engine';
  import type { Card, Contract, TableView } from './types.ts';
  import CardView from './Card.svelte';
  import Chat from './Chat.svelte';
  import History from './History.svelte';
  import { identityForSlot } from './players.ts';

  let hintsOpen = $state(localStorage.getItem('liskat.hints') !== 'closed');
  function toggleHints() {
    hintsOpen = !hintsOpen;
    localStorage.setItem('liskat.hints', hintsOpen ? 'open' : 'closed');
  }

  let confirmLeave = $state(false);
  // Leaving forfeits rating only in a ranked game in progress — i.e. a rated
  // game where every player has an account (view.ranked already encodes that).
  const willForfeit = $derived((view?.ranked ?? false) && (view?.status === 'playing' || view?.status === 'between'));
  function onLeave() {
    if (view?.status === 'over' || view?.status === 'waiting') leaveTable();
    else confirmLeave = true;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && confirmLeave) confirmLeave = false;
  }

  const view = $derived($conn.view as TableView);
  const round = $derived(view?.round);
  const mySlot = $derived(view?.youSlot ?? -1);
  const me = $derived(view?.players.find((p) => p.you));
  const myRole = $derived(me?.role ?? 0);
  // Seat the opponents so the order of play always reads clockwise from my
  // point of view: the player who acts right after me sits on the left, the
  // next one on the right. (Sort by how far each is after me in turn order.)
  const opponents = $derived.by(() => {
    if (!view) return [];
    return view.players
      .filter((p) => p.slot !== mySlot)
      .sort((a, b) => ((a.role - myRole + 3) % 3) - ((b.role - myRole + 3) % 3));
  });
  const hand = $derived.by(() => {
    if (!round) return [];
    const sorted = sortHand(round.yourHand, round.contract ?? undefined);
    return sortRev ? [...sorted].reverse() : sorted;
  });
  const myIdentity = $derived(identityForSlot(mySlot));
  const timed = $derived(view?.timed ?? true);
  // The dealer is rearhand (role 2); a chip marks their seat.
  const dealerSlot = $derived(view?.players.find((p) => p.role === 2)?.slot ?? -1);

  // ---- Move clock ----------------------------------------------------------
  // The server sends the active player's remaining time once per update; we tick
  // locally so the countdown moves smoothly between updates.
  let clockTick = $state(0);
  // The server's last reported remaining time, stamped with when we observed it.
  // As a $derived this recomputes (capturing a fresh timestamp) exactly when the
  // server snapshot changes — no effect mirroring server state into plain locals,
  // so the countdown can't read a stale base for a tick after an update.
  const clockBase = $derived({ ms: round?.turnRemainingMs ?? 0, at: Date.now() });
  // The seat whose live countdown we show.
  const clockSlot = $derived.by(() => {
    if (!round || round.turnRemainingMs == null) return -1;
    if (round.phase === 'playing') return round.trickComplete ? -1 : round.turnSlot;
    if (round.phase === 'bidding') return bidActiveSlot;
    if (round.phase === 'declaring') return round.declarerSlot ?? -1;
    return -1;
  });
  // Tick only while there's a live countdown to animate. An idle table (waiting
  // room, game over, an untimed game) doesn't wake up 4x/second for nothing.
  $effect(() => {
    if (!timed || clockSlot < 0 || round?.turnRemainingMs == null) return;
    const iv = setInterval(() => (clockTick = Date.now()), 250);
    return () => clearInterval(iv);
  });
  // The active player's clock, split into the per-move 10s and the reserve.
  // While base time remains it shows "Xs + Ys"; once it's eating into the
  // reserve it shows just the reserve, in red.
  const clockDisplay = $derived.by(() => {
    if (round?.turnRemainingMs == null || clockSlot < 0) return null;
    void clockTick; // re-evaluate on each tick
    const total = Math.max(0, clockBase.ms - (Date.now() - clockBase.at));
    const reserve = round.banks?.[clockSlot] ?? 0;
    const base = total - reserve;
    if (base > 0) return { text: `${Math.ceil(base / 1000)}s + ${Math.ceil(reserve / 1000)}s`, reserve: false };
    return { text: `${Math.ceil(total / 1000)}s`, reserve: true };
  });
  function bankSeconds(slot: number): number {
    return Math.ceil((round?.banks?.[slot] ?? 0) / 1000);
  }

  // The seat currently "speaking" during the auction (for highlighting).
  const bidActiveSlot = $derived.by(() => {
    if (round?.phase !== 'bidding' || !round.bidding) return -1;
    const b = round.bidding;
    return b.awaiting === 'response' ? b.responderSlot ?? -1 : b.askerSlot;
  });

  let selected = $state<string[]>([]);
  let annSchneider = $state(false);
  let annSchwarz = $state(false);
  let annOpen = $state(false);
  // The game the declarer is trying out before committing with [Declare].
  let selGame = $state<'' | 'suit' | 'grand' | 'null'>('');
  let selSuit = $state<'C' | 'S' | 'H' | 'D'>('C');

  $effect(() => {
    view?.dealIndex;
    selected = [];
    annSchneider = annSchwarz = annOpen = false;
    selGame = '';
    selSuit = 'C';
  });

  // Keep announcements legal as they're toggled (mirrors the engine rules):
  // announced Schwarz implies Schneider; Open in a suit/Grand implies both.
  function annSetSchneider(v: boolean) {
    annSchneider = v;
    if (!v) annSchwarz = annOpen = false;
  }
  function annSetSchwarz(v: boolean) {
    annSchwarz = v;
    if (v) annSchneider = true;
    else annOpen = false;
  }
  function annSetOpen(v: boolean) {
    annOpen = v;
    if (v && selGame !== 'null') (annSchwarz = true), (annSchneider = true);
  }

  // Hand display order. Default puts the strongest cards (Jacks/trumps) on the
  // left, the common convention; the toggle flips it. Persisted.
  let sortRev = $state(localStorage.getItem('liskat.sortrev') !== '0');
  function toggleSort() {
    sortRev = !sortRev;
    localStorage.setItem('liskat.sortrev', sortRev ? '1' : '0');
  }

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
    // Null: Open is allowed with or without picking up the Skat.
    if (contract.type === 'null') {
      declareContract(contract, { ouvert: annOpen });
      return;
    }
    // Suit/Grand: announcements are only possible in a Hand game (no Skat
    // pickup). Open requires announced Schwarz, which requires announced
    // Schneider, so fill the chain in.
    if (round?.tookSkat) {
      declareContract(contract, {});
      return;
    }
    let sch = annSchneider;
    let schw = annSchwarz;
    if (annOpen) schw = true;
    if (schw) sch = true;
    declareContract(contract, { schneiderAnnounced: sch, schwarzAnnounced: schw, ouvert: annOpen });
  }

  // The contract object for the current selection (null when nothing picked).
  const declContract = $derived.by<Contract | null>(() => {
    if (!selGame) return null;
    return (selGame === 'null' ? { type: 'null' } : selGame === 'grand' ? { type: 'grand' } : { type: 'suit', suit: selSuit }) as Contract;
  });

  // Matadors estimated from the declarer's own cards (exact once the Skat is
  // taken; an estimate for a Hand game, where the Skat is unseen).
  const declMatadors = $derived.by(() => {
    if (!round || !declContract || declContract.type === 'null') return { n: 0, withTop: false };
    const n = countMatadors(round.yourHand, declContract);
    const withTop = round.yourHand.some((c) => c.rank === 'J' && c.suit === 'C');
    return { n, withTop };
  });

  // The game value for the current selection, via the engine's shared preview so
  // it can never drift from how the server actually scores the game.
  const declValue = $derived.by(() => {
    if (!round || !declContract) return 0;
    const isHand = !round.tookSkat;
    // On a Hand game the chain Open ⇒ Schwarz ⇒ Schneider is announced; after
    // taking the Skat none of those announcements apply.
    const schw = isHand && (annSchwarz || annOpen);
    const sch = isHand && (annSchneider || schw);
    return previewGameValue(declContract, declMatadors.n, {
      hand: isHand,
      schneiderAnnounced: sch,
      schwarzAnnounced: schw,
      ouvert: annOpen,
    });
  });

  const canDeclare = $derived(!!selGame);

  function confirmDeclare() {
    if (declContract) declare(declContract);
  }

  function onCardClick(card: Card) {
    if (round?.phase === 'declaring' && round.declareStep === 'discard') toggleSelect(card);
    else if (round?.phase === 'playing' && isMyTurn() && legalNow(card)) playCard(card);
  }

  function slotName(slot: number): string {
    return view?.players[slot]?.nick ?? '—';
  }

  // What a given player most recently said in the auction, e.g. "bids 18".
  function bidSay(role: number): string {
    const a = round?.bidding?.lastActions?.[role];
    if (!a) return '';
    if (a.kind === 'bid') return `bids ${a.value}`;
    if (a.kind === 'hold') return `holds ${a.value}`;
    return 'passed';
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
          <li><b>Open</b> — play with your hand face-up for a higher value. Null Open is common; a suit/Grand Open also needs a Hand game with announced Schwarz.</li>
        </ul>
        <div class="hline"><b>Clock (⏱):</b> 10 seconds per move plus a personal time bank<br>30s to start, +10s each deal.</div>
        <div class="hline muted">Your bid = base × (matadors + game + extras). A bid only promises a value — you choose the actual game after winning.</div>
      </div>
    {/if}
  </div>
{/snippet}

<svelte:window onkeydown={onKey} />

{#if view}
  <div class="table">
    <div class="topbar">
      <button class="ghost" onclick={onLeave}>← Leave</button>
      <button class="wordmark" style="font-weight:800; font-size:18px; color:#f2f5f3; background:none; border:none; padding:0; cursor:pointer; font-family:inherit;" onclick={onLeave} title="Home">liskat</button>
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
          {@const id = identityForSlot(p.slot)}
          {@const say = round?.phase === 'bidding' ? bidSay(p.role) : ''}
          <div class="seat" class:turn={(round?.phase === 'playing' && round.turnSlot === p.slot) || bidActiveSlot === p.slot}>
            <div class="who">
              {#if dealerSlot === p.slot}<span class="dealer-chip" title="dealer">D</span>{/if}
              <span class="marker" style="color:{id.color}">{id.marker}</span>
              <strong>{p.nick}</strong>
              <span class="score">{view.match?.scores[p.slot] ?? 0}</span>
              {#if timed}{#if clockSlot === p.slot && clockDisplay}<span class="clock" class:low={clockDisplay.reserve}>⏱ {clockDisplay.text}</span>{:else if round}<span class="clock bank" title="time bank">⏱ {bankSeconds(p.slot)}s</span>{/if}{/if}
              {#if round?.declarerSlot === p.slot}<span class="badge">Declarer · {round.bid}</span>{/if}
            </div>
            <div class="backs">
              {#each Array(round?.handCounts[p.role] ?? 0) as _, i}
                <div class="backwrap" style="margin-left:{i === 0 ? 0 : -42}px"><CardView back width={48} /></div>
              {/each}
            </div>
            {#key say}
              {#if say}<div class="bidbubble" style="background:{id.color}">{say}</div>{/if}
            {/key}
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
              {@const did = identityForSlot(round.declarerSlot ?? 0)}
              <h3 class:won={round.result.won} class:lost={!round.result.won}>
                <span class="marker" style="color:{did.color}">{did.marker}</span>
                {slotName(round.declarerSlot ?? 0)} {round.result.won ? 'won' : 'lost'}
                {contractLabel(round.contract)} for {round.result.value}{#if round.contract?.type !== 'null' && round.result.cardPoints != null}<br />with {round.result.cardPoints} eyes{/if}
                {round.result.schneider ? '· Schneider' : ''}{round.result.schwarz ? '· Schwarz' : ''}
              </h3>
            {/if}
            {#if round?.skat}
              <div class="skatreveal">
                <span class="skat-label">Skat</span>
                <div class="skat-cards">
                  {#each round.skat as c}<CardView card={c} width={54} />{/each}
                </div>
              </div>
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
                <div class="dchoose">
                  <div class="drow">
                    <button class:dsel={selGame === 'suit'} onclick={() => (selGame = 'suit')}>Suit</button>
                    <button class:dsel={selGame === 'grand'} onclick={() => (selGame = 'grand')}>Grand</button>
                    <button class:dsel={selGame === 'null'} onclick={() => (selGame = 'null')}>Null</button>
                  </div>
                  {#if selGame === 'suit'}
                    <div class="drow">
                      <button class:dsel={selSuit === 'D'} onclick={() => (selSuit = 'D')}>Diamonds · 9</button>
                      <button class:dsel={selSuit === 'H'} onclick={() => (selSuit = 'H')}>Hearts · 10</button>
                      <button class:dsel={selSuit === 'S'} onclick={() => (selSuit = 'S')}>Spades · 11</button>
                      <button class:dsel={selSuit === 'C'} onclick={() => (selSuit = 'C')}>Clubs · 12</button>
                    </div>
                  {/if}
                  {#if selGame === 'null'}
                    <div class="drow">
                      <button class:dsel={annOpen} onclick={() => annSetOpen(!annOpen)}>Open</button>
                    </div>
                  {:else if selGame && round.tookSkat === false}
                    <div class="drow">
                      <button class:dsel={annSchneider} onclick={() => annSetSchneider(!annSchneider)}>Schneider</button>
                      <button class:dsel={annSchwarz} onclick={() => annSetSchwarz(!annSchwarz)}>Schwarz</button>
                      <button class:dsel={annOpen} onclick={() => annSetOpen(!annOpen)}>Open</button>
                    </div>
                  {/if}

                  {#if canDeclare}
                    <div class="dvalue">
                      <span class="dval">{declValue}</span>
                      {#if selGame !== 'null'}<span class="dmeta">{declMatadors.withTop ? 'with' : 'without'} {declMatadors.n} matador{declMatadors.n === 1 ? '' : 's'}</span>{/if}
                    </div>
                    {#if declValue < round.bid}<p class="annnote warn">Below your bid of {round.bid} — you would need the Skat or Schneider/Schwarz to cover it.</p>{/if}
                    <button class="primary declare" onclick={confirmDeclare}>Declare</button>
                  {:else}
                    <p class="prompt muted">Pick a game to see its value.</p>
                  {/if}
                </div>
                {@render hints()}
              {/if}
            </div>
          {:else}
            <div class="panel"><p class="prompt muted">{slotName(round.declarerSlot ?? 0)} is choosing the game…</p></div>
          {/if}
        {:else if round?.phase === 'playing'}
          <div class="trick">
            {#each round.trick as t}
              {@const id = identityForSlot(t.slot)}
              <div class="played">
                <span class="marker" style="color:{id.color}">{id.marker}</span>
                <CardView card={t.card} width={88} />
              </div>
            {/each}
            {#if round.trick.length === 0}
              {@const lid = identityForSlot(round.turnSlot)}
              <p class="muted"><span class="marker" style="color:{lid.color}">{lid.marker}</span> {slotName(round.turnSlot)} leads…</p>
            {/if}
          </div>
        {/if}
      </div>

      <!-- My hand -->
      <div class="myseat" class:turn={isMyTurn()}>
        <div class="who">
          {#if dealerSlot === mySlot}<span class="dealer-chip" title="dealer">D</span>{/if}
          <span class="marker" style="color:{myIdentity.color}">{myIdentity.marker}</span>
          {#if timed && clockSlot === mySlot && clockDisplay}<span class="clock big" class:low={clockDisplay.reserve}>⏱ {clockDisplay.text}</span>{:else if timed && round}<span class="clock big bank" title="time bank">⏱ {bankSeconds(mySlot)}s</span>{:else}<strong>{me?.nick}</strong>{/if}
          {#if round?.declarerSlot === mySlot}<span class="badge">Declarer · {round.bid}</span>{/if}
          {#if round?.phase === 'playing' && isMyTurn()}
            <span class="turnhint active">your turn</span>
          {/if}
          <button class="sortbtn" onclick={toggleSort} title="Reverse card order">⇄</button>
          <span class="score">{view.match?.scores[mySlot] ?? 0}</span>
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
        {@const wid = identityForSlot(view.match.winner ?? 0)}
        <div class="gameover">
          <h2>Match over — winner: <span class="marker" style="color:{wid.color}">{wid.marker}</span> {slotName(view.match.winner ?? 0)}</h2>
          <p>{view.players.map((p) => `${p.nick}: ${view.match!.scores[p.slot]}`).join(' · ')}</p>
          <button class="primary" onclick={leaveTable}>Back to lobby</button>
        </div>
      {/if}

      {#if round && round.lastTrick.length === 3}
        <div class="lasttrick">
          <div class="lt-label">last trick</div>
          <div class="lt-cards">
            {#each round.lastTrick as t}
              {@const id = identityForSlot(t.slot)}
              <div class="lt-card">
                <span class="marker" style="color:{id.color}">{id.marker}</span>
                <CardView card={t.card} width={46} />
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <History history={view.history} players={view.players} />
      <Chat messages={view.chat} />
    {/if}

    {#if $conn.error}<p class="error">{$conn.error}</p>{/if}

    {#if confirmLeave}
      <div class="overlay" role="presentation" onclick={() => (confirmLeave = false)}>
        <div class="confirm" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
          <h3>Leave the game?</h3>
          {#if willForfeit}<p class="warn">This is a ranked game — you will lose 50 rating if you leave.</p>{/if}
          <div class="confirm-actions">
            <button onclick={() => (confirmLeave = false)}>Stay</button>
            <button class="danger" onclick={leaveTable}>Leave</button>
          </div>
        </div>
      </div>
    {/if}
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
  .wordmark:hover {
    color: #ffa733 !important;
  }
  .topbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    font-size: 14px;
    color: var(--muted);
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
  .seat,
  .myseat {
    position: relative;
  }
  .seat.turn,
  .myseat.turn {
    background: rgba(255, 255, 255, 0.22);
  }
  .clock {
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    border-radius: 10px;
    padding: 1px 7px;
    background: rgba(255, 255, 255, 0.12);
    color: #f2f5f3;
  }
  .clock.bank {
    background: none;
    color: var(--muted);
  }
  .clock.low {
    background: none;
    color: #ff5252;
    font-weight: 700;
  }
  .clock.big {
    font-size: 24px;
    padding: 2px 12px;
  }
  .dealer-chip {
    background: #fff;
    color: #1a1a1a;
    border-radius: 50%;
    width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 800;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
  }
  .marker {
    font-size: 13px;
    line-height: 1;
  }
  .score {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    padding: 1px 8px;
    font-variant-numeric: tabular-nums;
  }
  .myseat .score {
    margin-left: auto;
  }
  .badge {
    background: var(--accent);
    border-radius: 10px;
    padding: 1px 8px;
    font-size: 12px;
  }
  /* a transient speech bubble under a player's cards when they bid/hold/pass */
  .bidbubble {
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-top: 6px;
    white-space: nowrap;
    color: #1a1a1a;
    font-weight: 700;
    font-size: 13px;
    border-radius: 12px;
    padding: 3px 12px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    animation: bidbubble 3s ease forwards;
  }
  @keyframes bidbubble {
    0% {
      opacity: 0;
    }
    4% {
      opacity: 1;
    }
    66.6% {
      opacity: 1;
    } /* solid for ~2s */
    100% {
      opacity: 0;
    } /* fade over the last ~1s */
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
  .dchoose {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .drow {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  }
  .drow button {
    padding: 8px 14px;
    font-size: 15px;
  }
  .drow button.dsel {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .dvalue {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-top: 4px;
  }
  .dval {
    font-size: 40px;
    font-weight: 800;
    line-height: 1;
    color: #ffd54a;
  }
  .dmeta {
    color: var(--muted);
    font-size: 14px;
  }
  .declare {
    padding: 12px 26px;
    font-size: 17px;
  }
  .annnote {
    font-size: 12px;
    color: var(--muted);
    margin: 0 0 4px;
  }
  .annnote.warn {
    color: #ffb74d;
  }
  .sortbtn {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: var(--muted);
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 4px 8px;
  }
  .sortbtn:hover {
    background: rgba(255, 255, 255, 0.16);
    color: #f2f5f3;
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
  .lt-label {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .lt-cards {
    display: flex;
    gap: 6px;
    margin: 6px 0;
  }
  .lt-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .lt-card .marker {
    font-size: 12px;
    line-height: 1;
  }
  .skatreveal {
    margin: 10px 0 4px;
  }
  .skat-label {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .skat-cards {
    display: flex;
    gap: 8px;
    justify-content: center;
    margin-top: 6px;
  }
  .hline {
    margin: 3px 0;
  }
  .trick {
    display: flex;
    gap: 14px;
  }
  .played {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .played .marker {
    font-size: 18px;
    line-height: 1;
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
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 300;
  }
  .confirm {
    background: #18382a;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 16px;
    padding: 22px 24px;
    width: min(360px, 92vw);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
    text-align: center;
  }
  .confirm h3 {
    margin: 0 0 8px;
  }
  .warn {
    color: #ffb74d;
    font-size: 14px;
    margin: 0 0 6px;
  }
  .confirm-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
    margin-top: 14px;
  }
  .danger {
    background: #b00020;
    border-color: #b00020;
    color: #fff;
    font-weight: 600;
  }
</style>
