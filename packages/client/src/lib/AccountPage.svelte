<script lang="ts">
  import { conn, logout, fetchProfile, type Profile, type MatchRecord, type MatchPlayerResult } from './ws.ts';
  import { page } from './ui.ts';

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

  $effect(() => {
    loading = true;
    fetchProfile().then((p) => {
      profile = p;
      loading = false;
    });
  });

  const me = $derived(profile?.username ?? $conn.account ?? '');

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
</script>

<button class="brand" style="position:fixed; top:16px; left:20px; font-size:26px; font-weight:800; letter-spacing:0.5px; color:#f2f5f3; background:none; border:none; padding:0; cursor:pointer; font-family:inherit;" onclick={() => ($page = 'lobby')} title="Home">liskat</button>
<div class="topright">
  <button class="link" onclick={() => ($page = 'lobby')}>← Lobby</button>
  <button class="link" onclick={logout}>Log out</button>
</div>

<div class="account">
  <h1>{me}</h1>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if !profile?.ok}
    <p class="error">{profile?.error ?? 'Could not load your profile.'}</p>
  {:else}
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
    {#if (profile.history?.length ?? 0) === 0}
      <p class="muted">No rated matches yet. Play a match where everyone is signed in.</p>
    {:else}
      <table class="history">
        <thead>
          <tr><th>When</th><th>Type</th><th>Result</th><th>Score</th><th>Rating</th><th>Opponents</th></tr>
        </thead>
        <tbody>
          {#each profile.history ?? [] as m}
            {@const mine = myResult(m)}
            <tr>
              <td class="muted">{fmtDate(m.ts)}</td>
              <td>{TYPE_LABELS[m.type] ?? m.type}</td>
              <td class:win={mine.place === 1}>{placeLabel(mine.place)}</td>
              <td>{mine.score}</td>
              <td>
                {mine.ratingAfter}
                <span class="delta" class:up={mine.delta > 0} class:down={mine.delta < 0}>{mine.delta > 0 ? '+' : ''}{mine.delta}</span>
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
    margin: 12vh auto 0;
    padding: 24px;
  }
  h1 {
    margin: 0 0 18px;
    font-size: 30px;
  }
  h2 {
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--muted);
    margin: 26px 0 10px;
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
  table.history {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  .history th {
    text-align: left;
    color: var(--muted);
    font-weight: 600;
    border-bottom: 1px solid rgba(255, 255, 255, 0.14);
    padding: 6px 8px;
  }
  .history td {
    padding: 6px 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    font-variant-numeric: tabular-nums;
  }
  .win {
    color: #7fe3a3;
    font-weight: 700;
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
  .muted {
    color: var(--muted);
  }
  .error {
    color: #ff8a80;
  }
</style>
