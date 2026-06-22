<script lang="ts">
  import { conn, logout, fetchProfile, fetchMatch, type Profile, type MatchRecord, type MatchPlayerResult, type MatchDetail, type DealReplay } from './ws.ts';
  import { page } from './ui.ts';
  import { identityForSlot } from './players.ts';

  const TYPE_LABELS: Record<string, string> = {
    'deals-6': '6 deals',
    'deals-12': '12 deals',
    'deals-36': '36 deals',
    'race-250': 'Race to 250',
    'race-1000': 'Race to 1000',
  };
  const TYPE_ORDER = ['deals-6', 'deals-12', 'deals-36', 'race-250', 'race-1000'];

  let profile = $state<Profile | null>(null);
  let loading = $state(true);
  let detail = $state<MatchDetail | null>(null);
  let dealIdx = $state<number | null>(null);
  let loadingMatch = $state(false);

  $effect(() => {
    loading = true;
    fetchProfile().then((p) => {
      profile = p;
      loading = false;
    });
  });

  const me = $derived(profile?.username ?? $conn.account ?? '');

  async function openMatch(id: string) {
    loadingMatch = true;
    dealIdx = null;
    const d = await fetchMatch(id);
    detail = d;
    loadingMatch = false;
  }

  function placeLabel(p: number): string {
    return p === 1 ? '1st' : p === 2 ? '2nd' : '3rd';
  }
  function fmtDate(ts: string): string {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function myResult(m: MatchRecord): MatchPlayerResult {
    return m.results.find((r) => r.username === me) ?? m.results[0];
  }
  function others(m: MatchRecord): MatchPlayerResult[] {
    return m.results.filter((r) => r.username !== me);
  }
  function nameOf(slot: number): string {
    return detail?.players.find((p) => p.slot === slot)?.username ?? '—';
  }
  function contractLabel(c: DealReplay['contract']): string {
    if (!c) return 'Passed in';
    if (c.type === 'grand') return 'Grand';
    if (c.type === 'null') return 'Null';
    return { C: '♣ Clubs', S: '♠ Spades', H: '♥ Hearts', D: '♦ Diamonds' }[c.suit ?? 'C'];
  }
  // Within a trick, card k was played by slot (leader + k) % 3 (turn order maps
  // to consecutive slots mod 3); the winning card is at (winner - leader) % 3.
  const SUIT_O: Record<string, number> = { C: 0, S: 1, H: 2, D: 3 };
  const RANK_O: Record<string, number> = { A: 0, K: 1, Q: 2, J: 3, '10': 4, '9': 5, '8': 6, '7': 7 };
  function sortIds(ids: string[]): string[] {
    return [...ids].sort((a, b) => (SUIT_O[a[0]] - SUIT_O[b[0]]) || (RANK_O[a.slice(1)] - RANK_O[b.slice(1)]));
  }
</script>

{#snippet cardImg(id: string, w: number)}
  <img class="gcard" style="width:{w}px" src="/cards/french/{id}.svg" alt={id} />
{/snippet}
{#snippet mk(slot: number)}
  <span class="marker" style="color:{identityForSlot(slot).color}">{identityForSlot(slot).marker}</span>
{/snippet}

<button class="brand" style="position:fixed; top:16px; left:20px; font-size:26px; font-weight:800; letter-spacing:0.5px; color:#f2f5f3; background:none; border:none; padding:0; cursor:pointer; font-family:inherit;" onclick={() => ($page = 'lobby')} title="Home">liskat</button>
<div class="topright">
  <button class="link" onclick={() => ($page = 'lobby')}>← Lobby</button>
  <button class="link" onclick={logout}>Log out</button>
</div>

<div class="account">
  {#if loading}
    <h1>{me}</h1>
    <p class="muted">Loading…</p>
  {:else if !profile?.ok}
    <h1>{me}</h1>
    <p class="error">{profile?.error ?? 'Could not load your profile.'}</p>
  {:else if detail && dealIdx !== null}
    {@const d = detail.deals[dealIdx]}
    <button class="back" onclick={() => (dealIdx = null)}>← Deal list</button>
    <h1>Deal {d.deal}</h1>
    {#if d.passedIn}
      <p class="muted">Everyone passed — no game was played.</p>
    {:else}
      <p class="lead">
        {@render mk(d.declarerSlot ?? 0)} <strong>{nameOf(d.declarerSlot ?? 0)}</strong> played {contractLabel(d.contract)}{d.ouvert ? ' Open' : ''}
        {#if d.result}
          <span class:win={d.result.won} class:lose={!d.result.won}> · {d.result.won ? 'won' : 'lost'} for {d.result.value}{d.contract?.type !== 'null' && d.result.cardPoints != null ? ` (${d.result.cardPoints} eyes)` : ''}{d.result.schneider ? ' · Schneider' : ''}{d.result.schwarz ? ' · Schwarz' : ''}</span>
        {/if}
      </p>
    {/if}

    <h2>Bidding</h2>
    {#if d.bids.length === 0}
      <p class="muted">No bids.</p>
    {:else}
      <div class="bids">
        {#each d.bids as b}
          <span class="bid">{@render mk(b.slot)} {nameOf(b.slot)} {b.kind === 'bid' ? 'bid ' + b.value : b.kind === 'hold' ? 'held ' + b.value : 'passed'}</span>
        {/each}
      </div>
    {/if}

    <h2>Hands (as dealt)</h2>
    {#each [0, 1, 2] as slot}
      <div class="handblock">
        <div class="handname">{@render mk(slot)} {nameOf(slot)}{d.declarerSlot === slot ? ' · declarer' : ''}</div>
        <div class="cards">{#each sortIds(d.hands[slot]) as id}{@render cardImg(id, 38)}{/each}</div>
      </div>
    {/each}
    <div class="handblock">
      <div class="handname">Skat</div>
      <div class="cards">{#each d.skat as id}{@render cardImg(id, 38)}{/each}</div>
    </div>
    {#if d.tookSkat && d.discard}
      <div class="handblock">
        <div class="handname">Declarer discarded</div>
        <div class="cards">{#each d.discard as id}{@render cardImg(id, 38)}{/each}</div>
      </div>
    {/if}

    {#if d.tricks.length}
      <h2>Tricks</h2>
      <div class="tricks">
        {#each d.tricks as t, i}
          <div class="trick">
            <span class="tnum">{i + 1}</span>
            {#each t.cards as id, k}
              {@const slot = (t.leader + k) % 3}
              <div class="tcard" class:won={(t.winner - t.leader + 3) % 3 === k}>
                {@render mk(slot)}
                {@render cardImg(id, 34)}
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
  {:else if detail}
    <button class="back" onclick={() => (detail = null)}>← Matches</button>
    <h1>{TYPE_LABELS[detail.type] ?? detail.type}</h1>
    <p class="muted">{fmtDate(detail.ts)} · {detail.ranked ? 'ranked' : 'unranked'} · {detail.players.map((p) => p.username).join(', ')}</p>
    <table class="list">
      <thead><tr><th>Deal</th><th>Declarer</th><th>Game</th><th>Result</th><th>Scores</th></tr></thead>
      <tbody>
        {#each detail.deals as d, i}
          <tr class="clickable" onclick={() => (dealIdx = i)}>
            <td>{d.deal}</td>
            <td>{#if d.declarerSlot !== null}{@render mk(d.declarerSlot)} {nameOf(d.declarerSlot)}{:else}<span class="muted">—</span>{/if}</td>
            <td>{d.passedIn ? '—' : contractLabel(d.contract)}</td>
            <td>{#if d.passedIn}<span class="muted">passed</span>{:else if d.result}<span class:win={d.result.won} class:lose={!d.result.won}>{d.result.won ? 'won' : 'lost'} {d.result.value}</span>{/if}</td>
            <td class="muted">{d.scores.join(' / ')}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <h1>{me}</h1>
    <h2>Ratings</h2>
    <div class="ratings">
      {#each TYPE_ORDER as t}
        {@const r = profile.ratings?.[t]}
        <div class="rcard">
          <div class="rlabel">{TYPE_LABELS[t]}</div>
          <div class="rval">{r?.rating ?? 1500}</div>
          <div class="rgames">{r?.games ?? 0} {(r?.games ?? 0) === 1 ? 'match' : 'matches'}{(r?.games ?? 0) < 10 ? ' · provisional' : ''}</div>
        </div>
      {/each}
    </div>

    <h2>Match history</h2>
    {#if loadingMatch}<p class="muted">Loading match…</p>{/if}
    {#if (profile.history?.length ?? 0) === 0}
      <p class="muted">No matches yet. Play a full match while signed in and it will appear here.</p>
    {:else}
      <table class="list">
        <thead><tr><th>When</th><th>Type</th><th>Result</th><th>Score</th><th>Rating</th><th>Opponents</th></tr></thead>
        <tbody>
          {#each profile.history ?? [] as m}
            {@const mine = myResult(m)}
            <tr class="clickable" onclick={() => openMatch(m.id)}>
              <td class="muted">{fmtDate(m.ts)}</td>
              <td>{TYPE_LABELS[m.type] ?? m.type}</td>
              <td class:win={mine.place === 1}>{placeLabel(mine.place)}</td>
              <td>{mine.score}</td>
              <td>
                {#if m.ranked}{mine.ratingAfter}<span class="delta" class:up={mine.delta > 0} class:down={mine.delta < 0}>{mine.delta > 0 ? '+' : ''}{mine.delta}</span>{:else}<span class="muted">unranked</span>{/if}
              </td>
              <td class="muted">{others(m).map((o) => `${o.username} (${o.score})`).join(', ')}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
</div>

<style>
  .topright {
    position: fixed;
    top: 20px;
    right: 20px;
    display: flex;
    gap: 14px;
    align-items: center;
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
  .brand:hover {
    color: #ffa733 !important;
  }
  .account {
    max-width: 760px;
    margin: 84px auto 60px;
    padding: 0 24px;
  }
  .back {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 14px;
    padding: 0;
    margin-bottom: 8px;
  }
  .back:hover {
    color: #f2f5f3;
  }
  h1 {
    margin: 0 0 6px;
    font-size: 28px;
  }
  h2 {
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--muted);
    margin: 24px 0 10px;
  }
  .ratings {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 10px;
  }
  .rcard {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 12px 14px;
  }
  .rlabel {
    font-size: 12px;
    color: var(--muted);
  }
  .rval {
    font-size: 28px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .rgames {
    font-size: 11px;
    color: var(--muted);
  }
  table.list {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  .list th {
    text-align: left;
    color: var(--muted);
    font-weight: 600;
    border-bottom: 1px solid rgba(255, 255, 255, 0.14);
    padding: 6px 8px;
  }
  .list td {
    padding: 7px 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    font-variant-numeric: tabular-nums;
  }
  tr.clickable {
    cursor: pointer;
  }
  tr.clickable:hover td {
    background: rgba(255, 255, 255, 0.06);
  }
  .marker {
    font-size: 13px;
  }
  .lead {
    font-size: 15px;
  }
  .win {
    color: #7fe3a3;
    font-weight: 700;
  }
  .lose {
    color: #ff8a80;
  }
  .delta {
    margin-left: 4px;
    font-size: 12px;
  }
  .delta.up {
    color: #7fe3a3;
  }
  .delta.down {
    color: #ff8a80;
  }
  .bids {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    font-size: 14px;
  }
  .handblock {
    margin: 8px 0;
  }
  .handname {
    font-size: 13px;
    color: var(--muted);
    margin-bottom: 4px;
  }
  .cards {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .gcard {
    border-radius: 5px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    display: block;
  }
  .tricks {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .trick {
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 8px;
    padding: 6px 8px;
  }
  .tnum {
    color: var(--muted);
    font-size: 12px;
    width: 16px;
    text-align: right;
  }
  .tcard {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    border-radius: 6px;
    padding: 2px;
  }
  .tcard.won {
    background: rgba(127, 227, 163, 0.18);
    outline: 1px solid rgba(127, 227, 163, 0.5);
  }
  .muted {
    color: var(--muted);
  }
  .error {
    color: #ff8a80;
  }
</style>
