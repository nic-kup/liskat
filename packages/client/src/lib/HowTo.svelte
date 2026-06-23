<script lang="ts">
  import { page } from './ui.ts';
  import { previewGameValue, SUIT_BASE, GRAND_BASE, type Contract } from '@liskat/engine';
  import SuitPip from './SuitPip.svelte';

  // Card faces are served from /cards/french/<ID>.svg.
  const EYES = [
    { id: 'HA', v: '11' },
    { id: 'H10', v: '10' },
    { id: 'HK', v: '4' },
    { id: 'HQ', v: '3' },
    { id: 'HJ', v: '2' },
    { id: 'H9', v: '0' },
  ];
  const JACKS = ['CJ', 'SJ', 'HJ', 'DJ'];
  const SUIT_RANK = ['SA', 'S10', 'SK', 'SQ', 'S9', 'S8', 'S7'];
  const CLUB_TRUMPS = ['CJ', 'SJ', 'HJ', 'DJ', 'CA', 'C10', 'CK', 'CQ', 'C9', 'C8', 'C7'];
  const NULL_ORDER = ['HA', 'HK', 'HQ', 'HJ', 'H10', 'H9', 'H8', 'H7'];
  const SORTED_HAND = ['CJ', 'SJ', 'CA', 'C10', 'C7', 'SA', 'SK', 'HA', 'H9', 'DK'];

  // --- interactive score calculator ---
  // Base values come from the engine so they can't drift from real scoring.
  // Ordered high→low to mirror the Jacks (♣ ♠ ♥ ♦).
  const SUITS = [
    { key: 'C', label: 'Clubs', base: SUIT_BASE.C },
    { key: 'S', label: 'Spades', base: SUIT_BASE.S },
    { key: 'H', label: 'Hearts', base: SUIT_BASE.H },
    { key: 'D', label: 'Diamonds', base: SUIT_BASE.D },
  ];
  const JACK_IDS: Record<string, string> = { C: 'CJ', S: 'SJ', H: 'HJ', D: 'DJ' };
  const JORDER = ['C', 'S', 'H', 'D']; // matador order, top first (J♣)
  const JSYM: Record<string, string> = { C: '♣J', S: '♠J', H: '♥J', D: '♦J' };

  // --- interactive bidding-sequence demo (section 3) ---
  const BID_LADDER = [18, 20, 22, 23, 24, 27, 30, 33, 35, 36];
  // Null games are a set of fixed values; every suit/Grand value is base × mult.
  const NULL_BID_GAMES = [
    { value: 23, name: 'Null' },
    { value: 35, name: 'Null Hand' },
    { value: 46, name: 'Null Open' },
    { value: 59, name: 'Null Hand Open' },
  ];

  let game = $state<'suit' | 'grand' | 'null'>('suit');
  let suit = $state('C');
  let jacks = $state<Record<string, boolean>>({ C: true, S: true, H: false, D: false });
  // Separate Jack selection for the interactive matador demo in section 4.
  let demoJacks = $state<Record<string, boolean>>({ C: true, S: true, H: false, D: false });
  let hand = $state(false);
  let schneider = $state(false);
  let schneiderAnn = $state(false);
  let schwarz = $state(false);
  let schwarzAnn = $state(false);
  let ouvert = $state(false);
  let bidPick = $state(36);

  function toggleJack(s: string) {
    jacks = { ...jacks, [s]: !jacks[s] };
  }
  function toggleDemoJack(s: string) {
    demoJacks = { ...demoJacks, [s]: !demoJacks[s] };
  }

  // The matador run for the demo: count from J♣ down while each Jack matches
  // whether you hold the top one (held run if you have J♣, missing run if not).
  const demoMatadors = $derived.by(() => {
    const withTop = demoJacks.C;
    let n = 0;
    for (const s of JORDER) {
      if (demoJacks[s] === withTop) n++;
      else break;
    }
    return { n, withTop };
  });

  // A short sentence describing the current Jack selection (the badge already
  // shows "with/without N" and the multiplier, so this just names the cards).
  const demoDesc = $derived.by(() => {
    const { n, withTop } = demoMatadors;
    const run = JORDER.slice(0, n).map((s) => JSYM[s]).join(', ').replace(/, ([^,]*)$/, ' and $1');
    const next = n < 4 ? JSYM[JORDER[n]] : null;
    if (withTop) return n === 4 ? 'You hold all four Jacks.' : `You hold ${run}, but not ${next}.`;
    return n === 4 ? 'You hold no Jacks.' : `You’re missing ${run}, but hold ${next}.`;
  });

  // Every game whose value equals the selected bid. A single number can match
  // several games (e.g. 36 is a Clubs game ×3 or a Diamonds game ×4), which is
  // why bidders usually climb the ladder one step at a time.
  const bidGames = $derived.by(() => {
    const v = bidPick;
    const out: { name: string; detail: string }[] = [];
    for (const n of NULL_BID_GAMES) if (n.value === v) out.push({ name: n.name, detail: 'a fixed value' });
    if (v % GRAND_BASE === 0 && v / GRAND_BASE >= 2) out.push({ name: 'Grand', detail: `${GRAND_BASE} × ${v / GRAND_BASE}` });
    for (const s of SUITS) if (v % s.base === 0 && v / s.base >= 2) out.push({ name: s.label, detail: `${s.base} × ${v / s.base}` });
    return out;
  });

  // Keep the extras legal as you click them. Announcements need a Hand game;
  // announced Schwarz implies announced Schneider; Open (in a suit/Grand) needs
  // announced Schwarz. Null is exempt: Open works with or without Hand.
  function setGame(g: 'suit' | 'grand' | 'null') {
    game = g;
    if (g === 'null') schneider = schwarz = schneiderAnn = schwarzAnn = false;
  }
  function setHand(v: boolean) {
    hand = v;
    if (!v && game !== 'null') schneiderAnn = schwarzAnn = ouvert = false;
  }
  function setSchneiderAnn(v: boolean) {
    schneiderAnn = v;
    if (v) hand = true;
    else schwarzAnn = ouvert = false;
  }
  function setSchwarzAnn(v: boolean) {
    schwarzAnn = v;
    if (v) (schneiderAnn = true), (hand = true);
    else ouvert = false;
  }
  function setOpen(v: boolean) {
    ouvert = v;
    if (v && game !== 'null') (schwarzAnn = true), (schneiderAnn = true), (hand = true);
  }

  // Matadors from the run of Jacks held, counting from J♣ (the calculator
  // models the Jacks; in a full game the run can continue into the trump suit).
  const matadors = $derived.by(() => {
    const withTop = jacks.C;
    let n = 0;
    for (const s of JORDER) {
      if (jacks[s] === withTop) n++;
      else break;
    }
    return { n, withTop };
  });

  const calc = $derived.by(() => {
    if (game === 'null') {
      const value = previewGameValue({ type: 'null' }, 0, { hand, ouvert });
      return { isNull: true, value, label: 'Null' + (hand ? ' Hand' : '') + (ouvert ? ' Open' : '') };
    }
    const contract = (game === 'grand' ? { type: 'grand' } : { type: 'suit', suit }) as Contract;
    const base = game === 'grand' ? GRAND_BASE : (SUITS.find((s) => s.key === suit)?.base ?? SUIT_BASE.C);
    // The breakdown (for the explanatory line) mirrors the multiplier terms; the
    // numeric value itself comes from the shared engine helper.
    const parts = [{ label: 'matadors', n: matadors.n }, { label: 'game', n: 1 }];
    if (hand) parts.push({ label: 'hand', n: 1 });
    if (schneider) parts.push({ label: 'schneider', n: 1 });
    if (schneiderAnn) parts.push({ label: 'schneider announced', n: 1 });
    if (schwarz) parts.push({ label: 'schwarz', n: 1 });
    if (schwarzAnn) parts.push({ label: 'schwarz announced', n: 1 });
    if (ouvert) parts.push({ label: 'open', n: 1 });
    const mult = parts.reduce((a, p) => a + p.n, 0);
    const value = previewGameValue(contract, matadors.n, { hand, schneider, schneiderAnnounced: schneiderAnn, schwarz, schwarzAnnounced: schwarzAnn, ouvert });
    const name = game === 'grand' ? 'Grand' : (SUITS.find((s) => s.key === suit)?.label ?? '');
    // Announce a level and fail to make it → the game is lost, scored at −2× the
    // value. (Announced Schwarz also requires Schneider, so it covers both.)
    const failed = (schneiderAnn && !schneider) || (schwarzAnn && !schwarz);
    return { isNull: false, value, base, mult, name, parts, failed, withLabel: (matadors.withTop ? 'with ' : 'without ') + matadors.n };
  });
</script>

{#snippet card(id: string)}
  <img class="gcard" src="/cards/french/{id}.svg" alt={id} />
{/snippet}

<div class="howto">
  <div class="pagehead">
    <button class="brand" onclick={() => ($page = 'lobby')} title="Home">liskat</button>
    <button class="link" onclick={() => ($page = 'lobby')}>← Lobby</button>
  </div>
  <h1>How to play Skat</h1>
  <p class="intro">Skat is a trick-taking card game for three players. One player (the declarer) plays alone against the other two, who form a team for that deal. Here is what you need to know to start.</p>

  <section>
    <h2>1. The cards: eyes and strength</h2>
    <p>Skat uses 32 cards: 7, 8, 9, 10, Jack, Queen, King and Ace in four suits. Each card has a value (called eyes) and a relative strength. These two values don't align.</p>

    <h3>Eyes (card points)</h3>
    <p>Each card is worth a number of "eyes". They add up to 120 in the whole deck. As the declarer you need 61 eyes to win the deal.</p>
    <div class="row">
      {#each EYES as e}
        <div class="eye">
          {@render card(e.id)}
          <span class="v">{e.v}</span>
        </div>
      {/each}
    </div>
    <p class="note">The 9, 8 and 7 are worth nothing. Notice the 10 is the second most valuable card, worth more than the King or Queen.</p>

    <h3>Strength (who wins a trick)</h3>
    <p>Strength is a different order. The four Jacks are always the strongest cards, ranked Clubs, Spades, Hearts, Diamonds.</p>
    <div class="row">{#each JACKS as id}{@render card(id)}{/each}</div>
    <p>After the Jacks, the cards of a suit rank like this, high to low:</p>
    <div class="row">{#each SUIT_RANK as id}{@render card(id)}{/each}</div>
    <p class="note">So the 10 sits just below the Ace in both eyes and strength, while the Jacks jump to the very top.</p>
    <p>The Jacks are the most powerful cards, yet each is worth only 2 eyes. That makes them safe to play early: you can win a trick or seize the lead without handing over many eyes.</p>
  </section>

  <section>
    <h2>2. Game types</h2>
    <p>When you win the auction you name one of three kinds of game.</p>

    <h3>Suit games</h3>
    <p>In a suit game you choose a trump suit. The trumps are that whole suit plus all four Jacks, so eleven cards are trumps. Any trump beats any non-trump.</p>
    <p>Here is a hand sorted for a Clubs game. Trumps are on the left (the Jacks first, then the clubs), followed by the side suits:</p>
    <div class="row hand">{#each SORTED_HAND as id}{@render card(id)}{/each}</div>
    <p>The full trump order in a Clubs game runs:</p>
    <div class="row">{#each CLUB_TRUMPS as id}{@render card(id)}{/each}</div>
    <p class="note">You win the deal by taking at least 61 eyes.</p>

    <h3>Grand</h3>
    <p>In a Grand only the four Jacks are trumps. Every other card simply follows its suit, ranking A, 10, K, Q, 9, 8, 7. The Jacks act as a suit of their own: if a Jack is led, you must play a Jack when you hold one. Grand has the highest base value of any game, and you still need 61 eyes to win.</p>

    <h3>Null</h3>
    <p>In a Null there are no trumps and the goal flips: you win only by losing every single trick. The cards rank plainly, so the Jack drops back into its normal place between Queen and 10:</p>
    <div class="row">{#each NULL_ORDER as id}{@render card(id)}{/each}</div>
    <p class="note">Null is worth a fixed value and does not use eyes at all.</p>
  </section>

  <section>
    <h2>3. Bidding</h2>
    <p>After the deal, the three players bid to decide who becomes the declarer. They call rising numbers: 18, 20, 22, 23, 24 and so on. Your number is a promise that your game will be worth at least that much. Below we explain where these numbers come from and what they mean.</p>

    <h3>How the auction runs</h3>
    <p>The three seats are Forehand (to the dealer's left), Middlehand and Rearhand. Middlehand calls the first number to Forehand, who either holds (accepts it) or passes; they trade rising calls until one drops out. Rearhand then bids the same way to whoever is left. The last player still in wins the auction and becomes the declarer.</p>
    <p>The declarer picks up the two Skat cards and discards two (or plays the hand as dealt), then names the game: a suit, Grand or Null. Only then does play begin, and <strong>Forehand always leads the first trick, whoever won the auction.</strong></p>

    <h3>Matadors (with or without)</h3>
    <p>The multiplier behind a game value starts from your "matadors": the run of top trumps you hold without a gap, counting down from the strongest card, the Jack of Clubs.</p>
    <p>If you hold the Jack of Clubs, you play "with" as many top trumps as you hold in an unbroken row. If you do not, you play "without" the top trumps you are missing in a row. The number is the same either way and is added to the multiplier. Click the Jacks below to try it:</p>

    <div class="matdemo">
      <div class="matdemo-top">
        <div class="jacks">
          {#each JORDER as s}
            <button class="jackbtn" class:off={!demoJacks[s]} onclick={() => toggleDemoJack(s)} aria-pressed={demoJacks[s]}>
              <img src="/cards/french/{JACK_IDS[s]}.svg" alt={JACK_IDS[s]} />
            </button>
          {/each}
        </div>
        <div class="matbadge">
          <span class="matwith">{demoMatadors.withTop ? 'with' : 'without'} {demoMatadors.n}</span>
          <span class="matadd">+{demoMatadors.n} to the multiplier</span>
        </div>
      </div>
      <p class="matdemo-desc">{demoDesc}</p>
    </div>

    <p class="note">We count the Jacks here; in a suit game the run can continue into the trump suit (A, 10, K and so on), so a matador count above 4 is possible.</p>

    <h3>Game value</h3>
    <p>Every game is built on a base value:</p>
    <ul>
      <li>Diamonds 9, Hearts 10, Spades 11, Clubs 12</li>
      <li>Grand 24</li>
      <li>Null is special: a fixed value (23, rising to 35, 46 or 59 for Hand and Open)</li>
    </ul>
    <p>For suit and Grand games the value is the base times one plus the multipliers: <strong>base × (1 + mults)</strong>. The mults are your matadors plus one for each extra (Hand, Schneider, Schwarz, Open). You win when you take 61 eyes and your game is worth at least your bid.</p>

    <h3>The bidding sequence</h3>
    <p>The usual bidding sequence climbs through these values. The lowest are just the cheapest games anyone could hold: base × 2, one matador plus the game itself. The same number can fit more than one game, and every call leaks a little about a hand, so players usually go up one step at a time rather than jumping. Tap a number to see which games are worth exactly that:</p>

    <div class="biddemo">
      <div class="bidladder">
        {#each BID_LADDER as v}
          <button class="bidbtn" class:sel={bidPick === v} onclick={() => (bidPick = v)}>{v}</button>
        {/each}
      </div>
      <div class="bidgames">
        <p class="bidgames-head">Games worth <strong>{bidPick}</strong>:</p>
        <ul>
          {#each bidGames as g}
            <li><strong>{g.name}</strong>: {g.detail}</li>
          {/each}
        </ul>
      </div>
    </div>
    <p class="note">Some numbers (like 36) fit several games at once; working up through each step is how players read what their opponents might be holding.</p>
  </section>

  <section>
    <h2>4. Score calculator</h2>
    <p>Pick a game, click the Jacks you hold, and toggle the extras to see the game value. <em>Announced</em> extras are committed before play (and lose the game if you fall short); <em>achieved</em> ones are simply what happened at the table. Unselected Jacks are greyed out.</p>

    <div class="calc">
      <div class="calc-row">
        <span class="calc-label">Skat</span>
        <div class="opts">
          <button class:sel={!hand} onclick={() => setHand(false)}>Pick up</button>
          <button class:sel={hand} onclick={() => setHand(true)}>Play hand</button>
        </div>
      </div>

      <div class="calc-row">
        <span class="calc-label">Game</span>
        <div class="opts">
          {#each SUITS as s}
            <button class="suitopt" class:sel={game === 'suit' && suit === s.key} onclick={() => { setGame('suit'); suit = s.key; }} aria-label={s.label}>
              <SuitPip suit={s.key as 'D' | 'H' | 'S' | 'C'} size={20} outline />
            </button>
          {/each}
          <button class:sel={game === 'grand'} onclick={() => setGame('grand')}>Grand</button>
          <button class:sel={game === 'null'} onclick={() => setGame('null')}>Null</button>
        </div>
      </div>

      <div class="calc-row">
        <span class="calc-label">Jacks</span>
        <div class="jacks">
          {#if game === 'null'}
            <span class="calc-na">No trumps in a Null game.</span>
          {:else}
            {#each JORDER as s}
              <button class="jackbtn" class:off={!jacks[s]} onclick={() => toggleJack(s)} aria-pressed={jacks[s]}>
                <img src="/cards/french/{JACK_IDS[s]}.svg" alt={JACK_IDS[s]} />
              </button>
            {/each}
          {/if}
        </div>
      </div>

      <div class="calc-row">
        <span class="calc-label">Announced</span>
        <div class="opts">
          {#if game !== 'null'}
            <button class:sel={schneiderAnn} disabled={!hand} onclick={() => setSchneiderAnn(!schneiderAnn)}>Schneider</button>
            <button class:sel={schwarzAnn} disabled={!hand} onclick={() => setSchwarzAnn(!schwarzAnn)}>Schwarz</button>
            <button class:sel={ouvert} disabled={!hand} onclick={() => setOpen(!ouvert)}>Open</button>
          {:else}
            <button class:sel={ouvert} onclick={() => setOpen(!ouvert)}>Open</button>
          {/if}
        </div>
      </div>

      <div class="calc-row">
        <span class="calc-label">Achieved</span>
        <div class="opts">
          {#if game !== 'null'}
            <button class:sel={schneider} onclick={() => (schneider = !schneider)}>Schneider</button>
            <button class:sel={schwarz} onclick={() => (schwarz = !schwarz)}>Schwarz</button>
          {:else}
            <span class="calc-na">Won or lost: nothing scored in play.</span>
          {/if}
        </div>
      </div>

      <div class="calc-out">
        {#if calc.isNull}
          <div class="calc-value">{calc.value}</div>
          <div class="calc-formula">{calc.label} = {calc.value}</div>
        {:else if calc.failed}
          <div class="calc-value loss">−{calc.value * 2}</div>
          <div class="calc-formula loss">Announced but not made: game lost</div>
          <div class="calc-formula">−2 × {calc.value} = −{calc.value * 2}</div>
        {:else}
          <div class="calc-value">{calc.value}</div>
          <div class="calc-formula"><strong>{calc.name}</strong> · {calc.withLabel} matador{matadors.n === 1 ? '' : 's'}</div>
          <div class="calc-formula">{calc.base} × {calc.mult} = {calc.value}</div>
          <div class="calc-parts">multiplier {calc.mult} = {calc.parts.map((p) => p.label + ' ' + p.n).join(' + ')}</div>
        {/if}
      </div>
    </div>
  </section>

  <section>
    <h2>5. A match</h2>
    <p>A match is several deals with the deal rotating each time, so everyone takes a turn in each seat. Scores add up across the deals. You can play a set number of deals (6, 12 or 36) or race to a target score (250 or 1000).</p>
  </section>

  <div class="cta">
    <button class="primary" onclick={() => ($page = 'lobby')}>Back to the lobby</button>
  </div>
</div>

<style>
  .calc {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 14px;
    padding: 16px 18px;
    margin-top: 12px;
  }
  .calc-row {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 10px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }
  .calc-label {
    flex: 0 0 72px;
    color: var(--muted);
    font-size: 13px;
    padding-top: 7px;
  }
  .calc-label small {
    display: block;
    font-size: 11px;
    opacity: 0.65;
    margin-top: 1px;
  }
  .opts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .opts button {
    padding: 7px 12px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    font-size: 14px;
    cursor: pointer;
  }
  .opts button:hover {
    background: rgba(255, 255, 255, 0.12);
  }
  .opts button.sel {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .opts button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .opts button:disabled:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  /* Suit options sit on the same green chips as Grand/Null; the white-outlined
     pip keeps every suit legible without a card-coloured tile. */
  .opts button.suitopt {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px 9px;
  }
  .calc-na {
    color: var(--muted);
    font-size: 13px;
    font-style: italic;
    /* Match a button row's height so swapping buttons for this note (Null game)
       doesn't change the box height. */
    display: flex;
    align-items: center;
    min-height: 34px;
  }
  .jacks {
    display: flex;
    gap: 8px;
    align-items: center;
    /* Match the Jack-card height so the row (and box) keeps a steady height even
       when a Null game replaces the cards with a short note. */
    min-height: 73px;
  }
  .jackbtn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    line-height: 0;
    border-radius: 6px;
  }
  .jackbtn img {
    width: 52px;
    border-radius: 6px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    transition: opacity 0.12s, filter 0.12s, transform 0.12s;
  }
  .jackbtn:hover img {
    transform: translateY(-3px);
  }
  .jackbtn.off img {
    opacity: 0.32;
    filter: grayscale(1);
  }
  .matdemo,
  .biddemo {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 14px;
    padding: 14px 16px;
    margin: 14px 0;
  }
  .bidladder {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .bidbtn {
    min-width: 46px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    font-size: 15px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .bidbtn:hover {
    background: rgba(255, 255, 255, 0.12);
  }
  .bidbtn.sel {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 700;
  }
  .bidgames {
    margin-top: 12px;
    /* Reserve room for the tallest result (two games) so the box doesn't jump. */
    min-height: 70px;
  }
  .bidgames-head {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
  }
  .bidgames ul {
    margin: 4px 0 0;
  }
  .matdemo-top {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
  }
  .matbadge {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .matwith {
    font-size: 22px;
    font-weight: 800;
    color: #ffd54a;
    line-height: 1.1;
  }
  .matadd {
    font-size: 13px;
    color: var(--muted);
  }
  .matdemo-desc {
    margin: 12px 0 0;
    line-height: 1.5;
    font-size: 15px;
  }
  .calc-out {
    margin-top: 14px;
    text-align: center;
    /* Reserve space for the tallest output (value + 3 breakdown lines) so the
       box doesn't jump when switching between Null and a suit/Grand game. */
    min-height: 118px;
  }
  .calc-value {
    font-size: 44px;
    font-weight: 800;
    line-height: 1;
    color: #ffd54a;
  }
  .calc-value.loss,
  .calc-formula.loss {
    color: #ff6b6b;
  }
  .calc-formula {
    margin-top: 6px;
    font-size: 15px;
  }
  .calc-parts {
    margin-top: 4px;
    font-size: 12px;
    color: var(--muted);
  }
  .pagehead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 18px;
  }
  .brand {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: 0.5px;
    color: #f2f5f3;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-family: inherit;
  }
  .brand:hover {
    color: #ffa733;
  }
  .link {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 14px;
    padding: 0;
  }
  .link:hover {
    color: #f2f5f3;
  }
  .howto {
    max-width: 720px;
    margin: 0 auto;
    padding: 22px 20px 60px;
  }
  h1 {
    font-size: 30px;
    margin: 0 0 10px;
  }
  .intro {
    color: var(--muted);
    margin: 0 0 8px;
  }
  section {
    margin-top: 30px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 18px;
  }
  h2 {
    font-size: 20px;
    margin: 0 0 8px;
  }
  h3 {
    font-size: 15px;
    margin: 18px 0 4px;
    color: #f2f5f3;
  }
  p {
    line-height: 1.5;
    margin: 8px 0;
  }
  ul {
    margin: 8px 0;
    padding-left: 22px;
    line-height: 1.6;
  }
  li {
    margin: 2px 0;
  }
  .note {
    color: var(--muted);
    font-size: 14px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: flex-end;
    margin: 10px 0;
  }
  .gcard {
    width: 50px;
    border-radius: 6px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    display: block;
  }
  .eye {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .eye .v {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: 15px;
  }
  .cta {
    margin-top: 34px;
    text-align: center;
  }
  .primary {
    padding: 11px 18px;
    border-radius: 8px;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    font-size: 15px;
    cursor: pointer;
  }
</style>
