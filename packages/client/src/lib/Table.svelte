<script lang="ts">
  import { conn, bid, hold, pass, takeSkat, playHand, discard, declareContract, playCard, leaveTable, addBot } from './ws.ts';
  import { cardId, nextBid, sortHand, countMatadors, previewGameValue, baseValue, leadSuit } from '@liskat/engine';
  import type { Card, Contract, TableView } from './types.ts';
  import CardView from './Card.svelte';
  import SuitPip from './SuitPip.svelte';
  import Chat from './Chat.svelte';
  import History from './History.svelte';
  import { identityForSlot } from './players.ts';
  import { crossfade } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { settings, toggle } from './settings.ts';
  import { playCardSound } from './sound.ts';

  // A played card flies from its place in the hand to its slot on the trick board:
  // the hand card (out:sendCard) and the board card (in:receiveCard) share a key
  // (the card id), so Svelte animates one into the other. Opponents' cards have no
  // hand counterpart, so they use the fallback (a quick scale-and-fade in).
  const [sendCard, receiveCard] = crossfade({
    duration: 230,
    easing: cubicOut,
    fallback: () => ({ duration: 170, easing: cubicOut, css: (t) => `opacity:${t}; transform: scale(${0.82 + 0.18 * t})` }),
  });

  const view = $derived($conn.view as TableView);
  let confirmLeave = $state(false);
  // Leaving forfeits rating only in a ranked game in progress, i.e. a rated
  // game where every player has an account (view.ranked already encodes that).
  const willForfeit = $derived((view?.ranked ?? false) && (view?.status === 'playing' || view?.status === 'between'));
  function onLeave() {
    if (view?.status === 'over' || view?.status === 'waiting') leaveTable();
    else confirmLeave = true;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && confirmLeave) confirmLeave = false;
    if (e.key === 'Escape' && settingsOpen) settingsOpen = false;
  }

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
  // A card the local player just clicked, shown as already played (pulled from
  // the hand and dropped into the trick) before the server confirms, so play
  // feels instant. Reconciled against the authoritative view below.
  let pending = $state<Card | null>(null);
  // Remaining clock (ms) captured the instant we optimistically played: while a
  // move is pending we've acted from our point of view, so the clock is frozen
  // here rather than ticking down on our own seat until the server confirms and
  // moves the turn on. Without this, a slow/half-open socket shows our timer
  // draining after we've already played ("I played a card but the timer keeps
  // going down"). Captured when we set `pending`, cleared when it reconciles.
  let frozenClockMs = $state<number | null>(null);
  const hand = $derived.by(() => {
    if (!round) return [];
    const cards = pending ? round.yourHand.filter((c) => cardId(c) !== cardId(pending!)) : round.yourHand;
    // While choosing a game, sort by the tentatively-picked contract so the hand
    // reorders the instant you tap a suit / Grand / Null (trumps grouped left).
    const sortBy = round.phase === 'declaring' && declContract ? declContract : (round.contract ?? undefined);
    const sorted = sortHand(cards, sortBy);
    return sortRev ? [...sorted].reverse() : sorted;
  });
  // Drop the optimistic card once the server view catches up: either it confirms
  // the play (the card has left our hand) or the turn moved on without it (e.g. a
  // clock timeout played something else), in which case we revert.
  $effect(() => {
    if (!pending) return;
    const inHand = round?.yourHand?.some((c) => cardId(c) === cardId(pending!));
    if (!inHand || !isMyTurn()) {
      pending = null;
      frozenClockMs = null;
    }
  });
  // A card the player queued to play before their turn ("pre-move"): shown greyed
  // in the hand and, when there's room on the board, as a faint ghost in their
  // trick slot. When the turn comes round it auto-plays after a short beat; if it
  // is no longer a legal move by then it's silently dropped.
  let premove = $state<Card | null>(null);
  $effect(() => {
    if (!premove) return;
    const pm = premove;
    if (round?.phase !== 'playing') {
      premove = null;
      return;
    }
    // The card left our hand somehow (shouldn't happen before it plays) — drop it.
    if (!round.yourHand.some((c) => cardId(c) === cardId(pm))) {
      premove = null;
      return;
    }
    if (!isMyTurn() || pending) return; // still not our turn: keep waiting
    const t = setTimeout(() => {
      if (round?.phase === 'playing' && isMyTurn() && !pending && legalNow(pm)) {
        pending = pm; // play it just like a normal click
        frozenClockMs = liveRemainingMs(); // freeze our clock; we've acted
        playCard(pm);
        playCardSound();
      }
      premove = null; // either it played, or it was illegal and is dropped
    }, 100);
    return () => clearTimeout(t);
  });
  // The trick we actually render. Normally this mirrors the server's trick, but a
  // completed (3-card) trick is HELD on the board for MIN_TRICK_HOLD_MS so it can't
  // flash past when the server sweeps it (the server only reveals it ~500ms before
  // collecting). The hold is keyed on `trickCount` (which increments on every
  // collect) and reconstructs the cards from `lastTrick`, so it works even when the
  // live 3-card state is never observed as its own update -- e.g. the 3-card view
  // and the swept view arrive coalesced into one reactive tick (a background-tab
  // throttle, a network burst, or queued messages flushing after a reconnect),
  // which is exactly when the trick used to vanish on us. Released early the moment
  // you play your own next card.
  const MIN_TRICK_HOLD_MS = 600;
  let displayTrick = $state<{ slot: number; card: Card }[]>([]);
  // Hold bookkeeping in plain (non-reactive) locals so the effect only ever *writes*
  // displayTrick; reading it back would make the effect depend on its own output.
  let heldCards: { slot: number; card: Card }[] | null = null; // a completed trick pinned on screen
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  let prevTrickCount = -1;
  let prevDealIndex = -1;
  const cancelHold = () => {
    if (releaseTimer) {
      clearTimeout(releaseTimer);
      releaseTimer = null;
    }
    heldCards = null;
  };
  $effect(() => {
    const r = round;
    const dealIndex = view?.dealIndex ?? -1;
    const tc = r?.trickCount ?? 0;
    const serverTrick = r && r.phase === 'playing' ? r.trick.map((x) => ({ slot: x.slot, card: x.card })) : [];
    const lastTrick = r ? r.lastTrick.map((x) => ({ slot: x.slot, card: x.card })) : [];

    // New deal: reset all hold bookkeeping (trickCount restarts at 0, so a stale
    // prevTrickCount from the previous deal must not suppress detection).
    if (dealIndex !== prevDealIndex) {
      cancelHold();
      prevDealIndex = dealIndex;
      prevTrickCount = tc;
      displayTrick = serverTrick;
      return;
    }
    // Not in trick play (bidding, declaring, between deals): nothing to pin.
    if (!r || r.phase !== 'playing') {
      cancelHold();
      prevTrickCount = tc;
      displayTrick = [];
      return;
    }
    // Your optimistic card is on the board: mirror the others and drop any hold so
    // your move shows instantly (the template overlays your pending card).
    if (pending) {
      cancelHold();
      prevTrickCount = tc;
      displayTrick = serverTrick;
      return;
    }
    // Already pinning a completed trick: keep it until the release timer fires.
    if (heldCards) {
      prevTrickCount = tc;
      return;
    }
    // A trick just completed -- either we still see it live (3 cards on the board)
    // or it was already swept (trickCount advanced) and only survives in lastTrick.
    // Either way, pin the completed trick for the grace window.
    let completed: { slot: number; card: Card }[] | null = null;
    if (serverTrick.length === 3) completed = serverTrick;
    else if (tc > prevTrickCount && lastTrick.length === 3) completed = lastTrick;
    prevTrickCount = tc;

    if (completed) {
      heldCards = completed;
      displayTrick = completed;
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        heldCards = null;
        // Snap to whatever the table shows now: the swept board, or the first card
        // of the next trick if a bot has already led.
        const cur = round && round.phase === 'playing' ? round.trick.map((x) => ({ slot: x.slot, card: x.card })) : [];
        displayTrick = cur;
        prevTrickCount = round?.trickCount ?? prevTrickCount;
      }, MIN_TRICK_HOLD_MS);
      return;
    }
    displayTrick = serverTrick;
  });
  // Clear a pending trick-release timer if the table is torn down mid-hold (e.g.
  // leaving the game) so it can't fire after the component is gone.
  $effect(() => () => {
    if (releaseTimer) clearTimeout(releaseTimer);
  });
  const timed = $derived(view?.timed ?? true);
  // The dealer is rearhand (role 2); a chip marks their seat.
  const dealerSlot = $derived(view?.players.find((p) => p.role === 2)?.slot ?? -1);

  // ---- Move clock ----------------------------------------------------------
  // The server sends the active player's remaining time once per update; we tick
  // locally so the countdown moves smoothly between updates.
  let clockTick = $state(0);
  // The server's last reported remaining time, stamped with when we observed it.
  // As a $derived this recomputes (capturing a fresh timestamp) exactly when the
  // server snapshot changes: no effect mirroring server state into plain locals,
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
  const clockParts = $derived.by(() => {
    if (round?.turnRemainingMs == null || clockSlot < 0) return null;
    void clockTick; // re-evaluate on each tick
    // Our move is in flight: freeze our clock at the moment we played instead of
    // letting it drain while we wait for the server to advance the turn.
    const frozen = pending && clockSlot === mySlot && frozenClockMs != null;
    const total = frozen ? frozenClockMs! : Math.max(0, clockBase.ms - (Date.now() - clockBase.at));
    const bank = round.banks?.[clockSlot] ?? 0;
    const base = total - bank;
    const inReserve = base <= 0;
    // Per-move time and reserve, shown side by side; once the per-move time is
    // gone it counts into the reserve and both turn red.
    return { base: clk(inReserve ? 0 : base), reserve: clk(inReserve ? total : bank), low: inReserve };
  });
  // Our clock's remaining time (ms) right now, for freezing on optimistic play.
  function liveRemainingMs(): number {
    return Math.max(0, clockBase.ms - (Date.now() - clockBase.at));
  }
  // mm-less "Xs" with a 2-digit pad so every clock is the same width.
  function clk(ms: number): string {
    return `${String(Math.ceil(Math.max(0, ms) / 1000)).padStart(2, '0')}s`;
  }
  // The clock for any seat: live for the player on the clock; for the others
  // their standard next-move base (10s) plus their bank, so the box is the same
  // width whoever's turn it is.
  function clockFor(slot: number): { base: string; reserve: string; low: boolean; active: boolean } {
    if (clockSlot === slot && clockParts) return { ...clockParts, active: true };
    return { base: '10s', reserve: clk(round?.banks?.[slot] ?? 0), low: false, active: false };
  }

  // Your matador count, shown during the auction so you can size your bid. Based
  // on the Jacks (Grand), the contract-independent "Spitzen" everyone references.
  const myBidMatadors = $derived.by(() => {
    if (!round || round.phase !== 'bidding' || mySlot < 0) return null;
    const n = countMatadors(round.yourHand, { type: 'grand' });
    const withTop = round.yourHand.some((c) => c.rank === 'J' && c.suit === 'C');
    return { n, withTop };
  });

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

  // Reset the discard/declare picks at the start of each new deal, but ONLY when
  // the deal actually changes. Keying off the whole view object would wipe the
  // player's in-progress selection on every unrelated update (e.g. the move-clock
  // tick or a bot's move elsewhere), which looked like the chosen Skat cards
  // unselecting themselves while declaring.
  let lastDeal = -1;
  $effect(() => {
    const d = view?.dealIndex ?? -1;
    if (d === lastDeal) return;
    lastDeal = d;
    selected = [];
    annSchneider = annSchwarz = annOpen = false;
    selGame = '';
    selSuit = 'C';
    premove = null;
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

  // Whether `card` is legal to FOLLOW the current trick, computed from the led suit
  // alone (Skat's follow rule depends only on the lead). This lets non-followable cards
  // grey out the instant another player leads -- before it's our turn, when the server
  // hasn't sent our `legal` list yet (it only populates that on our turn). On our turn it
  // agrees with `legalNow` exactly. Leading or a complete trick imposes no constraint.
  function followLegal(card: Card): boolean {
    if (!round || round.phase !== 'playing' || !round.contract) return true;
    const trick = round.trick;
    if (trick.length === 0 || trick.length >= 3) return true;
    const led = leadSuit(trick[0].card, round.contract);
    const haveFollow = round.yourHand.some((c) => leadSuit(c, round.contract!) === led);
    return !haveFollow || leadSuit(card, round.contract) === led;
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
      return annOpen ? 'A Null this size can’t be raised. Pick another game.' : 'A Null can’t be raised in play. Declare Open or pick another game.';
    }
    const base = baseValue(declContract);
    const gap = Math.ceil(round.bid / base) - Math.round(declValue / base);
    const schneiderOpen = !annSchneider; // making 90+ would add a multiplier
    const schwarzOpen = !annSchwarz; // taking every trick would add a multiplier
    if (gap <= 1 && schneiderOpen) return 'You need at least Schneider (90+ card points) to cover it.';
    if (gap <= 1 && schwarzOpen) return 'You need at least Schwarz (every trick) to cover it.';
    if (gap <= 2 && schneiderOpen && schwarzOpen) return 'You need Schwarz (every trick) to cover it.';
    return 'Even winning every trick won’t cover it. Pick a higher game.';
  });

  function confirmDeclare() {
    if (!declContract || !canDeclare) return;
    // Skat picked up: discard the two chosen cards first, then name the game.
    if (round?.declareStep === 'discard') doDiscard();
    declare(declContract);
  }

  function onCardClick(card: Card) {
    if (round?.phase === 'declaring' && round.declareStep === 'discard') toggleSelect(card);
    else if (round?.phase === 'playing' && isMyTurn() && !pending && legalNow(card)) {
      pending = card; // show it played at once; the next server view confirms
      frozenClockMs = liveRemainingMs(); // freeze our clock; we've acted
      playCard(card);
      playCardSound();
    } else if (round?.phase === 'playing' && !isMyTurn()) {
      // Not our turn yet — queue this as a pre-move (tap again to cancel).
      premove = premove && cardId(premove) === cardId(card) ? null : card;
    }
  }

  // ---- Drag a card to the middle to play it (opt-in via settings) ----
  let settingsOpen = $state(false);
  let boardEl = $state<HTMLElement | undefined>(undefined);
  let dragCard = $state<Card | null>(null);
  let dragX = $state(0);
  let dragY = $state(0);
  let dragMoved = $state(false);
  let overBoard = $state(false);
  let dragStartX = 0;
  let dragStartY = 0;

  // Dragging is available throughout the play phase (never during bidding /
  // declaring): on your turn to play a legal card, off your turn to queue a
  // pre-move by dropping any card onto the board.
  function canDrag(card: Card): boolean {
    if (!$settings.dragToPlay || round?.phase !== 'playing') return false;
    if (isMyTurn()) return !pending && legalNow(card);
    return true;
  }
  // The trick board is the drop target, with a generous margin so you don't have
  // to be pixel-perfect.
  function overBoardAt(x: number, y: number): boolean {
    if (!boardEl) return false;
    const r = boardEl.getBoundingClientRect();
    const pad = 60;
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }
  function onCardPointerDown(e: PointerEvent, card: Card) {
    if (!canDrag(card)) return;
    // Picking up a different card cancels any queued pre-move (a new one may be set
    // on release if it's dropped onto the board).
    if (premove && cardId(premove) !== cardId(card)) premove = null;
    dragCard = card;
    dragStartX = dragX = e.clientX;
    dragStartY = dragY = e.clientY;
    dragMoved = false;
    overBoard = false;
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
  }
  function onDragMove(e: PointerEvent) {
    if (!dragCard) return;
    dragX = e.clientX;
    dragY = e.clientY;
    if (Math.abs(e.clientX - dragStartX) + Math.abs(e.clientY - dragStartY) > 6) dragMoved = true;
    overBoard = overBoardAt(e.clientX, e.clientY);
  }
  function onDragUp() {
    const card = dragCard;
    const wasDrag = dragMoved;
    const onBoard = overBoard;
    endDrag();
    if (!card || round?.phase !== 'playing') return;
    // A drag commits only when released over the board. A plain tap commits only
    // when click-to-play is enabled — with it off, the board is drag-only, so a
    // stray tap can't play (or pre-move) a card.
    if (wasDrag ? !onBoard : !$settings.clickToPlay) return;
    if (isMyTurn()) {
      if (!pending && legalNow(card)) onCardClick(card); // play it now
    } else if (wasDrag) {
      premove = card; // dragged onto the board → set the pre-move
    } else {
      onCardClick(card); // tapped → toggle the pre-move
    }
  }
  function endDrag() {
    dragCard = null;
    dragMoved = false;
    overBoard = false;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
  }
  $effect(() => () => endDrag()); // clean up listeners if the table unmounts mid-drag

  function slotName(slot: number): string {
    return view?.players[slot]?.nick ?? '-';
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

{#snippet seatCard(slot: number)}
  {@const id = identityForSlot(slot)}
  {@const decl = round?.declarerSlot === slot}
  <!-- Three lines on a shared 3-column grid (left | centre | right) so the
       centre divider lines up vertically: score⋯name, time|reserve, then
       dealer⋯bid|game with its divider directly under the clock's. -->
  <div class="cline l1">
    <span class="score">{view.match?.scores[slot] ?? 0}</span>
    <span class="cmid"></span>
    <span class="namecell"><span class="marker" style="color:{id.color}">{id.marker}</span> <strong>{slotName(slot)}</strong></span>
  </div>
  <div class="cline l2">
    {#if timed && round}
      {@const c = clockFor(slot)}
      <span class="time" class:low={c.low}>{c.base}</span>
      <span class="cmid vsep"></span>
      <span class="reserve" class:low={c.low}>{c.reserve}</span>
    {:else}
      <span class="time">-</span><span class="cmid vsep"></span><span class="reserve">-</span>
    {/if}
  </div>
  <div class="cline l3">
    <span class="l3left">
      <span class="dcell">{#if dealerSlot === slot}<span class="dealer-chip" title="dealer">D</span>{/if}</span>
      <span class="bid-cell">{#if decl}{round.bid}{/if}</span>
    </span>
    <span class="cmid" class:vsep={decl}></span>
    <span class="game-cell">{#if decl}{contractLabel(round.contract)}{/if}</span>
  </div>
  <div class="modline">{declarerMods(slot)}</div>
{/snippet}

<svelte:window onkeydown={onKey} />

{#if view}
  <div class="table">
    <div class="topbar">
      <button class="ghost" onclick={onLeave}>← Leave</button>
      <button class="wordmark" style="font-weight:800; font-size:18px; color:#f2f5f3; background:none; border:none; padding:0; cursor:pointer; font-family:inherit;" onclick={onLeave} title="Home">liskat</button>
      <div class="right">
        <div class="info">
          {view.format.kind === 'deals' ? `${view.format.deals} deals` : `Race to ${view.format.target}`}
        </div>
        <div class="settings-wrap">
          <button class="ghost gear" onclick={() => (settingsOpen = !settingsOpen)} title="Settings" aria-label="Settings">⚙</button>
          {#if settingsOpen}
            <div class="settings-pop" role="dialog" aria-label="Settings">
              <label class="setting">
                <input type="checkbox" checked={$settings.sound} onchange={() => toggle('sound')} />
                Sound effects
              </label>
              <label class="setting">
                <input type="checkbox" checked={$settings.dragToPlay} onchange={() => toggle('dragToPlay')} />
                Drag cards to play
              </label>
              {#if $settings.dragToPlay}
                <label class="setting sub">
                  <input type="checkbox" checked={$settings.clickToPlay} onchange={() => toggle('clickToPlay')} />
                  Click to play
                </label>
              {/if}
              <label class="setting">
                <input type="checkbox" checked={!sortRev} onchange={toggleSort} />
                Reverse card order
              </label>
            </div>
          {/if}
        </div>
      </div>
    </div>

    {#if dragCard && dragMoved}
      <div class="dragghost" class:over={overBoard} style="left:{dragX}px; top:{dragY}px">
        <CardView card={dragCard} width={92} />
      </div>
    {/if}

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
        {#if view.visibility === 'private' && view.youSlot != null && view.players.some((p) => !p.occupied)}
          <p class="muted">Or fill a seat with a practice bot:</p>
          <button class="primary" onclick={addBot}>+ Add a bot</button>
        {/if}
      </div>
    {:else}
      <!-- Opponents -->
      <div class="opponents">
        {#each opponents as p}
          {@const id = identityForSlot(p.slot)}
          {@const say = round?.phase === 'bidding' ? bidSay(p.role) : ''}
          <div class="seat" class:turn={(round?.phase === 'playing' && round.turnSlot === p.slot) || bidActiveSlot === p.slot} class:declarer={round?.declarerSlot === p.slot}>
            {@render seatCard(p.slot)}
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
              <h3>Deal passed: no game.</h3>
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
            {#if myBidMatadors}
              <p class="matador">Your hand: {myBidMatadors.withTop ? 'with' : 'without'} {myBidMatadors.n} matador{myBidMatadors.n === 1 ? '' : 's'}</p>
            {/if}

            {#if isMyTurn()}
              {#if round.bidding!.awaiting === 'response'}
                <p class="prompt">Hold {round.bidding!.currentBid}, or pass?</p>
                <div class="bigactions">
                  <button class="primary" onclick={hold}>Hold {round.bidding!.currentBid}</button>
                  <button onclick={pass}>Pass</button>
                </div>
              {:else if round.bidding!.awaiting === 'forehand-decision'}
                <p class="prompt">Everyone passed. Play at the minimum bid?</p>
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
              <p class="prompt muted">Bidding: {slotName(round.bidding!.askerSlot)} to call…</p>
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
          <!-- Trick board: each player's card lands in a fixed slot: the two
               opponents across the top, you at the bottom (inverted triangle).
               Empty slots show a faint outline so you can see where cards go. -->
          <div class="trickboard" class:dragover={overBoard} bind:this={boardEl}>
            {#each [{ pos: 'left', slot: opponents[0]?.slot }, { pos: 'right', slot: opponents[1]?.slot }, { pos: 'me', slot: mySlot }] as p}
              {@const id = identityForSlot(p.slot ?? 0)}
              {@const shown = p.slot != null ? displayTrick.find((x) => x.slot === p.slot) : undefined}
              {@const t = shown ?? (p.slot === mySlot && pending ? { slot: mySlot, card: pending } : undefined)}
              <!-- Our pending pre-move, shown faintly — but only when the slot is
                   free and the previous trick has cleared off the board. -->
              {@const ghost = p.slot === mySlot && !t && premove && displayTrick.length < 3 ? premove : undefined}
              <div class="slot {p.pos}" class:lead={!t && !ghost && displayTrick.length === 0 && round.turnSlot === p.slot}>
                <div class="slot-card" class:filled={!!t} style="--c:{id.color}">
                  {#if t}
                    <div class="flycard" in:receiveCard={{ key: cardId(t.card) }}>
                      <CardView card={t.card} fill />
                    </div>
                  {:else if ghost}
                    <div class="flycard premoveghost">
                      <CardView card={ghost} fill onclick={() => (premove = null)} />
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- My seat (de-stacked into a horizontal bar): score+name left, clock
           centred, dealer/bid/game right. Modifiers are dropped (you know your
           own game). -->
      <div class="myseat" class:turn={isMyTurn()} class:declarer={round?.declarerSlot === mySlot}>
        {#if round && round.lastTrick.length === 3}
          <div class="lasttrick">
            <div class="lt-label">last trick</div>
            <div class="lt-board">
              {#each [{ pos: 'left', slot: opponents[0]?.slot }, { pos: 'right', slot: opponents[1]?.slot }, { pos: 'me', slot: mySlot }] as p}
                {@const lc = p.slot != null ? round.lastTrick.find((x) => x.slot === p.slot) : undefined}
                <div class="lt-slot {p.pos}">
                  {#if lc}<CardView card={lc.card} width={40} />{/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
        <div class="mycard myrow">
          <div class="mc-left">
            <span class="score">{view.match?.scores[mySlot] ?? 0}</span>
            <span class="marker" style="color:{identityForSlot(mySlot).color}">{identityForSlot(mySlot).marker}</span>
            <strong>{slotName(mySlot)}</strong>
          </div>
          <div class="mc-center">
            {#if timed && round}
              {@const c = clockFor(mySlot)}
              <span class="time" class:low={c.low}>{c.base}</span>
              <span class="vsep"></span>
              <span class="reserve" class:low={c.low}>{c.reserve}</span>
            {:else}
              <span class="time">-</span>
            {/if}
          </div>
          <div class="mc-right">
            {#if dealerSlot === mySlot}<span class="dealer-chip" title="dealer">D</span>{/if}
            {#if round?.declarerSlot === mySlot}
              <span class="bid-cell">{round.bid}</span>
              <span class="game-cell">{contractLabel(round.contract)}</span>
            {/if}
          </div>
        </div>
        <div class="hand">
          {#each hand as card (cardId(card))}
            {@const selectable = round?.phase === 'declaring' && round.declareStep === 'discard'}
            {@const playable = round?.phase === 'playing' && isMyTurn() && !pending && legalNow(card)}
            {@const premovable = round?.phase === 'playing' && !isMyTurn() && followLegal(card)}
            {@const isPremove = !!premove && cardId(premove) === cardId(card)}
            {@const dragHere = $settings.dragToPlay && round?.phase === 'playing'}
            <!-- The wrapper only carries the drag gesture; the actual control is
                 the <button> inside CardView, so it needs no role of its own. -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="handcard"
              class:dragging={!!dragCard && cardId(dragCard) === cardId(card)}
              animate:flip={{ duration: 200, easing: cubicOut }}
              out:sendCard={{ key: cardId(card) }}
              onpointerdown={dragHere ? (e) => onCardPointerDown(e, card) : undefined}
            >
              <CardView
                {card}
                fill
                selected={selected.includes(cardId(card))}
                dim={isPremove || (round?.phase === 'playing' && !pending && !followLegal(card))}
                onclick={selectable || ((playable || premovable) && !$settings.dragToPlay) ? () => onCardClick(card) : undefined}
              />
            </div>
          {/each}
        </div>
      </div>

      {#if view.status === 'over' && view.match}
        {@const wid = identityForSlot(view.match.winner ?? 0)}
        <div class="gameover">
          <h2>Match over. Winner: <span class="marker" style="color:{wid.color}">{wid.marker}</span> {slotName(view.match.winner ?? 0)}</h2>
          <p>{view.players.map((p) => `${p.nick}: ${view.match!.scores[p.slot]}`).join(' · ')}</p>
          <button class="primary" onclick={leaveTable}>Back to lobby</button>
        </div>
      {/if}


      <History history={view.history} players={view.players} matchOver={view.status === 'over'} />
      <Chat messages={view.chat} />
    {/if}

    {#if $conn.error}<p class="error">{$conn.error}</p>{/if}

    {#if confirmLeave}
      <div class="overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) confirmLeave = false; }}>
        <div class="confirm" role="dialog" aria-modal="true" tabindex="-1">
          <h3>Leave the game?</h3>
          {#if willForfeit}<p class="warn">This is a ranked game. You will lose 50 rating if you leave.</p>{/if}
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
    height: 100vh;
    height: 100dvh;
    overflow: hidden; /* the play screen is sized to fit; never scrolls */
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
  .topbar .right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
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
    justify-content: center;
    gap: 40px;
    margin-top: 8px;
  }
  /* Seat card, shared by opponents and your own seat. Four fixed lines:
     score | name, time | reserve, dealer | bid | game, then modifiers. Every
     cell keeps its space (filled or blank) so nothing shifts between deals. */
  /* Your info card is styled exactly like an opponent's seat; .myseat just adds
     the surrounding white box that also holds your hand. */
  .seat,
  .mycard {
    position: relative;
    min-width: 210px;
    border-radius: 12px;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.22);
    border: 1px solid transparent;
    transition: box-shadow 0.15s, background 0.15s;
  }
  .seat.turn,
  .myseat.turn .mycard {
    background: rgba(255, 255, 255, 0.22);
  }
  .seat.declarer,
  .myseat.declarer .mycard {
    border-color: rgba(255, 213, 74, 0.45);
    background: rgba(255, 213, 74, 0.06);
  }
  .myseat.turn.declarer .mycard {
    background: rgba(255, 255, 255, 0.18);
  }
  /* Each line shares a left | centre | right grid so the centre divider lines
     up vertically across all three lines (the clock's separator and the
     bid/game separator sit on the same axis). */
  .cline {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    column-gap: 8px;
  }
  .cline.l2 {
    margin-top: 5px;
  }
  .cline.l3 {
    margin-top: 5px;
    min-height: 22px;
    font-size: 15px;
  }
  .cmid {
    width: 1px;
  }
  .score {
    justify-self: start;
    font-size: 22px;
    font-weight: 700;
    color: #f2f5f3;
    font-variant-numeric: tabular-nums;
  }
  .namecell {
    justify-self: end;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .time,
  .reserve {
    font-size: 22px;
    font-variant-numeric: tabular-nums;
    color: #f2f5f3;
  }
  .time {
    justify-self: end;
  }
  .reserve {
    justify-self: start;
    color: var(--muted);
  }
  .time.low,
  .reserve.low {
    color: #ff5252;
    font-weight: 700;
  }
  /* Left half of line 3: dealer puck pinned left, bid pinned to the centre. */
  .l3left {
    justify-self: stretch;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .dcell {
    display: inline-flex;
    align-items: center;
  }
  .bid-cell {
    font-weight: 700;
    color: #ffd54a;
  }
  .game-cell {
    justify-self: start;
    color: #f2f5f3;
  }
  .modline {
    min-height: 15px;
    margin-top: 3px;
    font-size: 12px;
    color: var(--muted);
    text-align: center;
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
  .marker {
    font-size: 13px;
    line-height: 1;
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
  .vsep {
    width: 1px;
    align-self: stretch;
    background: rgba(255, 255, 255, 0.18);
  }
  .matador {
    color: var(--muted);
    font-size: 14px;
    margin: 0 0 10px;
  }
  .center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
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
  /* Anchored just above the seat box (its parent), hugging the right edge, so
     it tracks the board's height instead of a magic offset. */
  .lasttrick {
    position: absolute;
    right: 4px;
    bottom: calc(100% + 8px);
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
  /* Mini inverted triangle, mirroring the main trick board. */
  .lt-board {
    display: grid;
    grid-template-columns: auto auto;
    column-gap: 8px;
    row-gap: 3px;
    margin: 5px 0 0;
  }
  .lt-slot.left {
    grid-column: 1;
    grid-row: 1;
  }
  .lt-slot.right {
    grid-column: 2;
    grid-row: 1;
  }
  .lt-slot.me {
    grid-column: 1 / 3;
    grid-row: 2;
    justify-self: center;
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
  /* Inverted-triangle trick board: opponents across the top, you at the bottom,
     each card landing in a fixed slot. Empty slots show a faint coloured
     outline marking where that player's card goes. */
  .trickboard {
    display: grid;
    grid-template-columns: auto auto;
    column-gap: 56px;
    row-gap: 10px;
    justify-content: center;
    align-items: start;
    /* 10px buffer so the drag-over highlight sits clear of the cards; the
       negative margin cancels it so the board's resting layout is unchanged. */
    padding: 10px;
    margin: -10px;
  }
  .slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
  }
  .slot.left {
    grid-column: 1;
    grid-row: 1;
  }
  .slot.right {
    grid-column: 2;
    grid-row: 1;
  }
  .slot.me {
    grid-column: 1 / 3;
    grid-row: 2;
    justify-self: center;
  }
  .slot-card {
    --sw: 88px;
    width: var(--sw);
    /* The card's true 250:350 height, minus 1px so the dashed box hugs the
       card's bottom edge a hair more snugly. */
    height: calc(var(--sw) * 350 / 250 - 1px);
    border-radius: 8%;
    /* An outline (not a border) for the dashed frame: a border would shrink the
       content box, so the card — sized by its own 250:350 ratio — would leave a
       sliver of gap at the bottom. The outline sits on the edge and takes no
       layout space, so the card fills the box exactly. */
    outline: 2px dashed var(--c);
    outline-offset: -2px;
    opacity: 0.35;
  }
  .slot-card.filled {
    outline-color: transparent;
    opacity: 1;
  }
  /* Highlight the slot whose player is on lead. */
  .slot.lead .slot-card {
    opacity: 0.85;
    box-shadow: 0 0 12px var(--c);
  }
  /* A subtle white box around your own cards: dark info card on top, hand
     below. Extra bottom padding lets the box sit a little lower than the cards.
     (Turn/declarer highlighting lives on the .mycard so it matches opponents.) */
  .myseat {
    position: relative;
    margin-top: auto;
    width: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px 12px 22px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.05);
  }
  /* The player's card is a horizontal bar rather than four stacked lines. */
  .mycard.myrow {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 12px;
    width: min(680px, 100%);
  }
  .mc-left {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .mc-center {
    justify-self: center;
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .mc-right {
    justify-self: end;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
  }
  .hand {
    width: 100%;
    box-sizing: border-box;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    gap: 4px;
    padding: 0;
  }
  /* Each hand card is a flex item up to 92px that shrinks on narrow screens; the
     CardView fills it. The wrapper carries the play/reflow animations. */
  .handcard {
    flex: 0 1 92px;
    max-width: 92px;
    min-width: 0;
    line-height: 0;
  }
  /* Wrapper for a card on the trick board, so the fly-in transition has an element
     to animate without disturbing the CardView. */
  .flycard {
    width: 100%;
    height: 100%;
  }
  /* A queued pre-move sitting in our trick slot before it actually plays. */
  .premoveghost {
    opacity: 0.4;
    filter: grayscale(0.7);
  }
  /* The card being dragged: dim the original in the hand, no scrolling hijack. */
  .handcard {
    touch-action: none;
  }
  .handcard.dragging {
    opacity: 0.3;
  }
  /* Floating card following the pointer during a drag. */
  .dragghost {
    position: fixed;
    transform: translate(-50%, -55%) rotate(-3deg);
    width: 92px;
    pointer-events: none;
    z-index: 1000;
    filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.5));
    transition: transform 0.08s ease;
  }
  .dragghost.over {
    transform: translate(-50%, -55%) scale(1.06);
  }
  /* The trick board lights up as a drop target while dragging over it. */
  .trickboard.dragover {
    background: rgba(255, 213, 74, 0.08);
    border-radius: 12px;
    box-shadow: 0 0 0 2px rgba(255, 213, 74, 0.35) inset;
  }
  /* Settings gear + popover in the top bar. */
  .settings-wrap {
    position: relative;
  }
  .gear {
    font-size: 18px;
    line-height: 1;
  }
  .settings-pop {
    position: absolute;
    top: 110%;
    right: 0;
    z-index: 1100;
    background: #1f2a24;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
    white-space: nowrap;
  }
  .setting {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    cursor: pointer;
  }
  .setting input {
    cursor: pointer;
  }
  /* A sub-option that depends on the setting above it. */
  .setting.sub {
    margin-left: 22px;
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
  /* Phone/tablet: lift the hand clear of the browser's bottom bar (a little —
     the seat box otherwise floats too high). */
  @media (max-width: 980px) {
    .table {
      padding-bottom: 3.5vh;
    }
  }
  /* Phones: shrink the seat cards so two opponents fit side by side, and the
     trick cards so the triangle fits the narrow screen. */
  @media (max-width: 600px) {
    .opponents {
      gap: 8px;
    }
    .slot-card {
      --sw: 58px;
    }
    .trickboard {
      column-gap: 36px;
    }
    .seat {
      min-width: 0;
      flex: 1 1 0;
      padding: 6px 6px;
    }
    .cline {
      gap: 6px;
    }
    .score,
    .time,
    .reserve {
      font-size: 17px;
      min-width: 0;
    }
    .namecell,
    .game-cell {
      min-width: 0;
    }
    .cline.l1,
    .cline.l3 {
      font-size: 13px;
    }
    .mycard.myrow {
      gap: 6px;
    }
    .mc-left,
    .mc-center,
    .mc-right {
      gap: 5px;
    }
    /* Cap the hand cards so they stop growing as the hand empties; without this
       a short hand blew the cards up to their 92px base. They still shrink below
       this when the hand is full. (Targets the .handcard wrapper, the direct
       flex child — the .card lives one level deeper.) */
    .handcard {
      flex-basis: 50px;
      max-width: 50px;
    }
  }
</style>
