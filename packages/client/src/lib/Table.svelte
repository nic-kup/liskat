<script lang="ts">
  import { conn, bid, hold, pass, takeSkat, playHand, discard, declareContract, playCard, leaveTable } from './ws.ts';
  import { cardId, nextBid, sortHand, countMatadors, previewGameValue, baseValue } from '@liskat/engine';
  import type { Card, Contract, TableView } from './types.ts';
  import CardView from './Card.svelte';
  import SuitPip from './SuitPip.svelte';
  import Chat from './Chat.svelte';
  import History from './History.svelte';
  import { identityForSlot } from './players.ts';

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

  // Suit options for the game chooser, ordered high→low to mirror the Jacks
  // (♣ ♠ ♥ ♦); the pip itself is drawn by SuitPip.
  const SUIT_GLYPHS: { k: 'D' | 'H' | 'S' | 'C'; name: string }[] = [
    { k: 'C', name: 'Clubs' },
    { k: 'S', name: 'Spades' },
    { k: 'H', name: 'Hearts' },
    { k: 'D', name: 'Diamonds' },
  ];

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
    // During the merged discard step the hand still holds the two picked-up Skat
    // cards; exclude the ones about to be discarded so matadors match the hand
    // that will actually be played (and update live as the discard changes).
    const hand = round.declareStep === 'discard' ? round.yourHand.filter((c) => !selected.includes(cardId(c))) : round.yourHand;
    const n = countMatadors(hand, declContract);
    const withTop = hand.some((c) => c.rank === 'J' && c.suit === 'C');
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

  // Need a game; and when the Skat was picked up, exactly two cards to discard.
  const canDeclare = $derived(!!selGame && (round?.declareStep !== 'discard' || selected.length === 2));

  // If the chosen game is worth less than the bid, the second line of the
  // warning: what the declarer must still achieve in play to cover the bid.
  // (Null can't be raised by play; suit/Grand can earn Schneider/Schwarz.)
  const bidWarning = $derived.by<string | null>(() => {
    if (!round || !declContract || declValue >= round.bid) return null;
    if (declContract.type === 'null') {
      return annOpen ? 'A Null this size can’t be raised — pick another game.' : 'A Null can’t be raised in play — declare Open or pick another game.';
    }
    const base = baseValue(declContract);
    const gap = Math.ceil(round.bid / base) - Math.round(declValue / base);
    const schneiderOpen = !annSchneider; // making 90+ would add a multiplier
    const schwarzOpen = !annSchwarz; // taking every trick would add a multiplier
    if (gap <= 1 && schneiderOpen) return 'You need at least Schneider (90+ card points) to cover it.';
    if (gap <= 1 && schwarzOpen) return 'You need at least Schwarz (every trick) to cover it.';
    if (gap <= 2 && schneiderOpen && schwarzOpen) return 'You need Schwarz (every trick) to cover it.';
    return 'Even winning every trick won’t cover it — pick a higher game.';
  });

  function confirmDeclare() {
    if (!declContract || !canDeclare) return;
    // Skat picked up: discard the two chosen cards first, then name the game.
    if (round?.declareStep === 'discard') doDiscard();
    declare(declContract);
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

  // The declarer's announced modifiers ("Hand · Schneider · Open"), or '' for a
  // defender or before a game is named. Hand = the Skat wasn't picked up.
  function declarerMods(slot: number): string {
    if (!round || round.declarerSlot !== slot || !round.contract) return '';
    const a = round.announcements;
    const m: string[] = [];
    if (!round.tookSkat) m.push('Hand');
    if (a.schneiderAnnounced) m.push('Schneider');
    if (a.schwarzAnnounced) m.push('Schwarz');
    if (a.ouvert) m.push('Open');
    return m.join(' · ');
  }
</script>

<svelte:window onkeydown={onKey} />

{#if view}
  <div class="table">
    <div class="topbar">
      <button class="ghost" onclick={onLeave}>← Leave</button>
      <button class="wordmark" style="font-weight:800; font-size:18px; color:#f2f5f3; background:none; border:none; padding:0; cursor:pointer; font-family:inherit;" onclick={onLeave} title="Home">liskat</button>
      <div class="info">
        {view.format.kind === 'deals' ? `${view.format.deals} deals` : `Race to ${view.format.target}`}
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
              <span class="marker" style="color:{id.color}">{id.marker}</span>
              <strong>{p.nick}</strong>
            </div>
            <div class="statline">
              {#if timed && clockSlot === p.slot && clockDisplay}
                <span class="clock big" class:low={clockDisplay.reserve}>⏱ {clockDisplay.text}</span>
              {:else if timed && round}
                <span class="clock big bank" title="time bank">⏱ {bankSeconds(p.slot)}s</span>
              {:else}
                <span class="clock big bank">⏱ —</span>
              {/if}
              <span class="vsep"></span>
              <span class="score">{view.match?.scores[p.slot] ?? 0}</span>
            </div>
            <div class="declline">
              <span class="dcell dealer-cell">{#if dealerSlot === p.slot}<span class="dealer-chip" title="dealer">D</span>{/if}</span>
              <span class="vsep"></span>
              <span class="dcell bid-cell">{#if round?.declarerSlot === p.slot}{round.bid}{/if}</span>
              <span class="vsep"></span>
              <span class="dcell game-cell">{#if round?.declarerSlot === p.slot}{contractLabel(round.contract)}{/if}</span>
            </div>
            <div class="modline">{declarerMods(p.slot)}</div>
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
            {#if round?.skatDealt}
              <div class="skatreveal">
                <div class="skat-group">
                  <span class="skat-label">Skat</span>
                  <div class="skat-cards">
                    {#each round.skatDealt as c}<CardView card={c} width={48} />{/each}
                  </div>
                </div>
                {#if round.tookSkat && round.skat}
                  <div class="skat-group">
                    <span class="skat-label">Discarded</span>
                    <div class="skat-cards">
                      {#each round.skat as c}<CardView card={c} width={48} />{/each}
                    </div>
                  </div>
                {/if}
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
                <p class="prompt">Everyone passed — play at the minimum bid?</p>
                <div class="bigactions">
                  <button class="primary" onclick={() => bid(18)}>Play for 18</button>
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
              {:else}
                {#if round.declareStep === 'discard'}
                  <h3>Name your game, and tap 2 cards below for the Skat ({selected.length}/2)</h3>
                {:else}
                  <h3>Choose your game</h3>
                {/if}
                <div class="dchoose">
                  <div class="drow">
                    {#each SUIT_GLYPHS as s}
                      <button class="suitbtn" class:dsel={selGame === 'suit' && selSuit === s.k} onclick={() => { selGame = 'suit'; selSuit = s.k; }} aria-label={s.name}>
                        <SuitPip suit={s.k} size={22} outline />
                      </button>
                    {/each}
                    <button class:dsel={selGame === 'grand'} onclick={() => (selGame = 'grand')}>Grand</button>
                    <button class:dsel={selGame === 'null'} onclick={() => (selGame = 'null')}>Null</button>
                  </div>
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

                  {#if selGame}
                    <div class="dvalue">
                      <span class="dval">{declValue}</span>
                      {#if selGame !== 'null'}<span class="dmeta">{declMatadors.withTop ? 'with' : 'without'} {declMatadors.n} matador{declMatadors.n === 1 ? '' : 's'}</span>{/if}
                    </div>
                    <div class="dwarn">
                      {#if bidWarning}<p class="annnote warn"><b>Below your bid {round.bid}</b><br />{bidWarning}</p>{/if}
                    </div>
                    <button class="primary declare" onclick={confirmDeclare} disabled={!canDeclare}>
                      {round.declareStep === 'discard' && selected.length !== 2 ? `Pick ${2 - selected.length} more for the Skat` : 'Declare'}
                    </button>
                  {:else}
                    <p class="prompt muted">Pick a game to see its value.</p>
                  {/if}
                </div>
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
  /* Opponent seat: name, then fixed-slot lines for clock|score and
     dealer|bid|game, then the announced modifiers. Each slot is always present
     (filled or blank) so the layout never shifts. */
  .seat {
    min-width: 196px;
    text-align: center;
    background: rgba(0, 0, 0, 0.18);
  }
  .seat .who {
    justify-content: center;
  }
  .statline {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-top: 5px;
  }
  .declline {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-top: 6px;
    min-height: 22px;
    font-size: 14px;
    color: var(--muted);
  }
  .dcell {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .dealer-cell {
    min-width: 20px;
  }
  .bid-cell {
    min-width: 26px;
    font-weight: 700;
    color: #ffd54a;
  }
  .game-cell {
    min-width: 72px;
    color: #f2f5f3;
  }
  .vsep {
    width: 1px;
    align-self: stretch;
    background: rgba(255, 255, 255, 0.18);
  }
  .modline {
    min-height: 15px;
    margin-top: 3px;
    font-size: 12px;
    color: var(--muted);
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
    /* Hold a steady height so picking a game / showing the bid warning doesn't
       make the panel jump. Covers suit row + announcements + value + warning. */
    min-height: 252px;
    justify-content: flex-start;
  }
  .dwarn {
    min-height: 44px; /* reserve two lines so the warning doesn't shift layout */
    align-self: stretch; /* full panel width → the warning wraps to a steady 2 lines */
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dwarn .annnote {
    margin: 0;
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
  /* Suit options sit on the same green chips as Grand/Null; the white-outlined
     pip keeps every suit legible without a card-coloured tile. */
  .drow button.suitbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 12px;
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
  /* Sits just above the player's hand, hugging the right edge. */
  .lasttrick {
    position: fixed;
    right: 16px;
    bottom: 150px;
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
    display: flex;
    gap: 22px;
    justify-content: center;
  }
  .skat-group {
    display: flex;
    flex-direction: column;
    align-items: center;
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
  /* Phone/tablet: lift the hand clear of the browser's bottom bar. */
  @media (max-width: 980px) {
    .table {
      padding-bottom: 7vh;
    }
  }
</style>
