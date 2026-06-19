<script lang="ts">
  import { conn, setNick, quickMatch, createTable, joinTable, listTables } from './ws.ts';
  import type { MatchFormat } from './types.ts';

  let nick = $state(localStorage.getItem('liskat.nick') ?? '');
  let joinId = $state('');
  let formatKey = $state('deals12');

  const FORMATS: Record<string, { label: string; format: MatchFormat }> = {
    deals6: { label: '6 deals (quick)', format: { kind: 'deals', deals: 6 } },
    deals12: { label: '12 deals', format: { kind: 'deals', deals: 12 } },
    deals36: { label: '36 deals (long)', format: { kind: 'deals', deals: 36 } },
    race250: { label: 'Race to 250', format: { kind: 'race', target: 250 } },
    race1000: { label: 'Race to 1000', format: { kind: 'race', target: 1000 } },
  };

  function ensureNick(): boolean {
    const n = nick.trim();
    if (!n) return false;
    localStorage.setItem('liskat.nick', n);
    setNick(n);
    return true;
  }

  const fmt = $derived(FORMATS[formatKey].format);

  function onQuick() {
    if (ensureNick()) quickMatch(fmt);
  }
  function onCreate(visibility: 'private' | 'public') {
    if (ensureNick()) createTable(visibility, fmt);
  }
  function onJoin() {
    const id = joinId.trim().replace(/.*\//, ''); // accept a full link or bare id
    if (id && ensureNick()) joinTable(id);
  }

  function fmtLabel(f: MatchFormat): string {
    return f.kind === 'deals' ? `${f.deals} deals` : `race to ${f.target}`;
  }

  listTables();
</script>

<div class="lobby">
  <header>
    <h1>Liskat</h1>
    <p class="tag">Play Skat online — free, no ads, no bots.</p>
  </header>

  <label class="field">
    <span>Your nickname</span>
    <input bind:value={nick} maxlength="24" placeholder="e.g. Skatmeister" />
  </label>

  <label class="field">
    <span>Game format</span>
    <select bind:value={formatKey}>
      {#each Object.entries(FORMATS) as [key, f]}
        <option value={key}>{f.label}</option>
      {/each}
    </select>
  </label>

  <div class="actions">
    <button class="primary" onclick={onQuick} disabled={!nick.trim()}>Quick match</button>
    <button onclick={() => onCreate('private')} disabled={!nick.trim()}>Create private table</button>
    <button onclick={() => onCreate('public')} disabled={!nick.trim()}>Create public table</button>
  </div>

  <div class="join">
    <input bind:value={joinId} placeholder="Paste a table link or id" />
    <button onclick={onJoin} disabled={!nick.trim() || !joinId.trim()}>Join</button>
  </div>

  {#if $conn.error}
    <p class="error">{$conn.error}</p>
  {/if}

  <section class="public">
    <h2>Open public tables</h2>
    {#if $conn.tables.length === 0}
      <p class="muted">No open tables right now — start one above.</p>
    {:else}
      <ul>
        {#each $conn.tables as t}
          <li>
            <span><strong>{t.hostNick}</strong> · {fmtLabel(t.format)} · {t.seated}/3 seated</span>
            <button onclick={() => ensureNick() && joinTable(t.id)} disabled={!nick.trim()}>Join</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <footer>
    <span class:on={$conn.connected}>{$conn.connected ? 'connected' : 'connecting…'}</span>
  </footer>
</div>

<style>
  .lobby {
    max-width: 460px;
    margin: 6vh auto;
    padding: 28px;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 16px;
    backdrop-filter: blur(4px);
  }
  header h1 {
    margin: 0;
    font-size: 44px;
    letter-spacing: 1px;
  }
  .tag {
    margin: 4px 0 22px;
    color: var(--muted);
  }
  .field {
    display: block;
    margin-bottom: 14px;
  }
  .field span {
    display: block;
    font-size: 13px;
    color: var(--muted);
    margin-bottom: 4px;
  }
  input,
  select {
    width: 100%;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    font-size: 15px;
    box-sizing: border-box;
  }
  .actions {
    display: grid;
    gap: 8px;
    margin: 18px 0;
  }
  .join {
    display: flex;
    gap: 8px;
  }
  .join input {
    flex: 1;
  }
  button {
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    font-size: 15px;
    cursor: pointer;
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
  .public {
    margin-top: 22px;
  }
  .public h2 {
    font-size: 15px;
    color: var(--muted);
  }
  .public ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .public li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 14px;
  }
  .muted {
    color: var(--muted);
  }
  .error {
    color: #ff8a80;
  }
  footer {
    margin-top: 18px;
    font-size: 12px;
    color: var(--muted);
  }
  footer .on {
    color: #7fe3a3;
  }
</style>
