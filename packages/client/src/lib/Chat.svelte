<script lang="ts">
  import { CHAT_PRESETS } from '@liskat/engine';
  import { sendChat } from './ws.ts';
  import { identityForSlot } from './players.ts';

  interface Props {
    messages: { nick: string; slot: number; text: string }[];
  }
  let { messages }: Props = $props();
  let open = $state(true);
</script>

<div class="chat" class:open>
  <button class="toggle" onclick={() => (open = !open)}>{open ? '▾' : '▸'} Chat</button>
  {#if open}
    <div class="log">
      {#each messages.slice(-8) as m}
        {@const id = identityForSlot(m.slot)}
        <div class="msg"><span class="marker" style="color:{id.color}">{id.marker}</span> <strong>{m.nick}:</strong> {m.text}</div>
      {/each}
      {#if messages.length === 0}<div class="empty">Say hi 👋</div>{/if}
    </div>
    <div class="presets">
      {#each CHAT_PRESETS as p}
        <button onclick={() => sendChat(p)}>{p}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .chat {
    position: fixed;
    left: 16px;
    top: 50%;
    transform: translateY(-50%);
    width: 220px;
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
  .log {
    max-height: 140px;
    overflow-y: auto;
    padding: 0 12px 6px;
  }
  .msg {
    padding: 2px 0;
  }
  .marker {
    font-size: 11px;
  }
  .empty {
    color: var(--muted);
    padding: 2px 0;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
  .presets button {
    padding: 5px 9px;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    cursor: pointer;
    font-size: 12px;
  }
  .presets button:hover {
    background: var(--accent);
  }
</style>
