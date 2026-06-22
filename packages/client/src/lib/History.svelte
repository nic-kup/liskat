<script lang="ts">
  import type { HistoryEntry, PlayerView } from './types.ts';
  import { identityForSlot } from './players.ts';

  interface Props {
    history: HistoryEntry[];
    players: PlayerView[];
    matchOver?: boolean;
  }
  let { history, players, matchOver = false }: Props = $props();
  let open = $state(false);
  const mySlot = $derived(players.find((p) => p.you)?.slot ?? -1);
  // Once the match is over, open the panel — on a phone it's shown centered as
  // the post-match summary.
  $effect(() => {
    if (matchOver) open = true;
  });
</script>

<div class="history" class:over={matchOver}>
  <button class="toggle" onclick={() => (open = !open)}>{open ? '▾' : '▸'} History ({history.length})</button>
  {#if open}
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>#</th>
            {#each players as p}
              {@const id = identityForSlot(p.slot)}
              <th class:mine={p.slot === mySlot}>
                <span class="marker" style="color:{id.color}">{id.marker}</span>{#if matchOver}<span class="hname"> {p.nick}</span>{/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each history as h, i}
            {@const prev = i > 0 ? history[i - 1].scores : [0, 0, 0]}
            <tr>
              <td class="deal">{h.deal}</td>
              {#each players as p}
                {@const slot = p.slot}
                {@const d = h.scores[slot] - prev[slot]}
                <td class:declarer={h.declarerSlot === slot} class:mine={slot === mySlot}>
                  {#if matchOver && h.declarerSlot === slot}<span class="tag" class:won={h.won} class:lost={!h.won}>{h.short}{h.won ? '✓' : '✗'}</span>{/if}
                  {#if d !== 0}<span class="delta" class:won={d > 0} class:lost={d < 0}>{d > 0 ? '+' : ''}{d}</span>{/if}
                </td>
              {/each}
            </tr>
          {/each}
          {#if history.length === 0}
            <tr><td colspan="4" class="empty">No deals played yet.</td></tr>
          {/if}
        </tbody>
        {#if history.length > 0}
          <tfoot>
            <tr class="totals">
              <td class="deal">Σ</td>
              {#each players as p}
                <td class:mine={p.slot === mySlot}>{history[history.length - 1].scores[p.slot]}</td>
              {/each}
            </tr>
          </tfoot>
        {/if}
      </table>
    </div>
  {/if}
</div>

<style>
  /* Anchored below the opponent seats (with ~50px buffer); the scroll is capped
     so the panel never reaches the last-trick box hugging the bottom-right. */
  .history {
    position: fixed;
    right: 16px;
    top: 205px;
    width: 230px;
    z-index: 6;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    backdrop-filter: blur(6px);
    font-size: 13px;
    overflow: hidden;
  }
  /* After the match it's the full summary (names along the top), so give it room
     to breathe and let it grow taller. */
  .history.over {
    width: auto;
    min-width: 240px;
    max-width: 380px;
  }
  .history.over .scroll {
    max-height: 70vh;
  }
  .hname {
    font-weight: 600;
  }
  /* No room for the history panel on a phone — the seats and hand take it all.
     The exception is after the match, when it's the summary: show it centered. */
  @media (max-width: 980px) {
    .history {
      display: none;
    }
    .history.over {
      display: block;
      top: 50%;
      left: 50%;
      right: auto;
      transform: translate(-50%, -50%);
      width: min(92vw, 320px);
      z-index: 200;
    }
    .history.over .scroll {
      max-height: 60vh;
    }
  }
  .toggle {
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--muted);
    padding: 8px 12px;
    cursor: pointer;
    font-size: 13px;
  }
  .scroll {
    /* Cap so the panel's bottom stays clear of the last-trick box plus a
       buffer. */
    max-height: calc(100vh - 700px);
    overflow-y: auto;
    padding: 0 8px 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    /* Monospace + tabular figures so a row's width is predictable (≤2ch game,
       ≤3ch score) and its contents never wrap to a second line. */
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 3px 4px;
    text-align: right;
    white-space: nowrap;
  }
  th:first-child,
  td.deal {
    text-align: left;
    color: var(--muted);
  }
  thead th {
    color: var(--muted);
    font-weight: 600;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  }
  td.declarer {
    font-weight: 700;
  }
  .tag {
    display: inline-block;
    margin-left: 3px;
    font-size: 11px;
  }
  .tag.won {
    color: #7fe3a3;
  }
  .tag.lost {
    color: #ff8a80;
  }
  .delta {
    margin-left: 4px;
    font-variant-numeric: tabular-nums;
  }
  .delta.won {
    color: #7fe3a3;
  }
  .delta.lost {
    color: #ff8a80;
  }
  tfoot td {
    border-top: 1px solid rgba(255, 255, 255, 0.18);
    font-weight: 700;
    padding-top: 5px;
  }
  tfoot .deal {
    color: var(--muted);
  }
  .marker {
    font-size: 13px;
  }
  th.mine,
  td.mine {
    background: rgba(255, 255, 255, 0.1);
  }
  .empty {
    text-align: center;
    color: var(--muted);
  }
</style>
