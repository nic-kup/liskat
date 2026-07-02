<script lang="ts">
  import { conn, fetchLeaderboard, type LeaderboardRow } from './ws.ts';
  import { page } from './ui.ts';

  const TYPE_LABELS: Record<string, string> = {
    'deals-6': '6 deals',
    'deals-12': '12 deals',
    'deals-36': '36 deals',
    'race-250': 'Race to 250',
    'race-1000': 'Race to 1000',
  };
  const TYPE_ORDER = ['deals-6', 'deals-12', 'deals-36', 'race-250', 'race-1000'];

  let board = $state<Record<string, LeaderboardRow[]> | null>(null);
  let loading = $state(true);
  let type = $state('deals-12'); // the standard format is the default tab

  $effect(() => {
    loading = true;
    fetchLeaderboard().then((b) => {
      board = b;
      loading = false;
    });
  });

  const rows = $derived(board?.[type] ?? []);
  const me = $derived($conn.account);
</script>

<button class="brand" style="position:fixed; top:16px; left:20px; font-size:26px; font-weight:800; letter-spacing:0.5px; color:#f2f5f3; background:none; border:none; padding:0; cursor:pointer; font-family:inherit;" onclick={() => ($page = 'lobby')} title="Home">liskat</button>
<div class="topright">
  <button class="link" onclick={() => ($page = 'lobby')}>← Lobby</button>
</div>

<div class="board">
  <h1>Leaderboard</h1>
  <div class="tabs">
    {#each TYPE_ORDER as t}
      <button class="tab" class:active={type === t} onclick={() => (type = t)}>{TYPE_LABELS[t]}</button>
    {/each}
  </div>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if !board}
    <p class="error">Could not load the leaderboard.</p>
  {:else if rows.length === 0}
    <p class="muted">No rated matches of this type yet. Win a quick match while signed in to appear here.</p>
  {:else}
    <table class="list">
      <thead><tr><th class="rank">#</th><th>Player</th><th class="num">Rating</th><th class="num">Matches</th></tr></thead>
      <tbody>
        {#each rows as r, i}
          <tr class:me={r.username === me}>
            <td class="rank">{i + 1}</td>
            <td>{r.username}{#if r.games < 10}<span class="prov" title="Fewer than 10 rated matches: the rating is still settling">?</span>{/if}</td>
            <td class="num">{r.rating}</td>
            <td class="num muted">{r.games}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="note">Only rated quick matches between signed-in players count. <span class="prov">?</span> marks a provisional rating (under 10 matches).</p>
  {/if}
</div>

<style>
  .topright {
    position: fixed;
    top: 20px;
    right: 20px;
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
  .board {
    max-width: 560px;
    margin: 84px auto 60px;
    padding: 0 24px;
  }
  h1 {
    margin: 0 0 14px;
    font-size: 28px;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
  }
  .tab {
    padding: 7px 12px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.06);
    color: var(--muted);
    font-size: 13px;
    cursor: pointer;
  }
  .tab:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #f2f5f3;
  }
  .tab.active {
    background: var(--accent);
    border-color: transparent;
    color: #0a2d1c;
    font-weight: 700;
  }
  table.list {
    width: 100%;
    border-collapse: collapse;
    font-size: 15px;
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
  th.rank,
  td.rank {
    width: 34px;
    color: var(--muted);
  }
  th.num,
  td.num {
    text-align: right;
  }
  tr.me td {
    background: rgba(255, 213, 74, 0.1);
    font-weight: 700;
  }
  .prov {
    margin-left: 4px;
    color: var(--muted);
    font-size: 12px;
    cursor: help;
  }
  .note {
    margin-top: 12px;
    font-size: 12px;
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
  }
  .error {
    color: #ff8a80;
  }
</style>
