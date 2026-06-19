<script lang="ts">
  import type { HistoryEntry, PlayerView } from './types.ts';
  import { identityForSlot } from './players.ts';

  interface Props {
    history: HistoryEntry[];
    players: PlayerView[];
  }
  let { history, players }: Props = $props();
  let open = $state(false);

  const youSlot = $derived(players.find((p) => p.you)?.slot ?? null);
</script>

<div class="history">
  <button class="toggle" onclick={() => (open = !open)}>{open ? '▾' : '▸'} History ({history.length})</button>
  {#if open}
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>#</th>
            {#each players as p}
              {@const id = identityForSlot(p.slot, youSlot)}
              <th><span class="marker" style="color:{id.color}">{id.marker}</span> {p.nick}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each history as h}
            <tr>
              <td class="deal">{h.deal}</td>
              {#each [0, 1, 2] as slot}
                <td class:declarer={h.declarerSlot === slot}>
                  {h.scores[slot]}
                  {#if h.declarerSlot === slot}<span class="tag" class:won={h.won} class:lost={!h.won}>{h.short}{h.won ? '✓' : '✗'}</span>{/if}
                </td>
              {/each}
            </tr>
          {/each}
          {#if history.length === 0}
            <tr><td colspan="4" class="empty">No deals played yet.</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .history {
    position: fixed;
    left: 16px;
    top: 70px;
    width: 230px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    backdrop-filter: blur(6px);
    font-size: 13px;
    overflow: hidden;
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
    max-height: 30vh;
    overflow-y: auto;
    padding: 0 8px 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 3px 5px;
    text-align: right;
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
  .marker {
    font-size: 10px;
  }
  .empty {
    text-align: center;
    color: var(--muted);
  }
</style>
