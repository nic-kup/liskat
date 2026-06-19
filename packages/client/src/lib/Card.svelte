<script lang="ts">
  import { cardId } from '@liskat/engine';
  import type { Card } from './types.ts';

  interface Props {
    card?: Card;
    back?: boolean;
    deck?: string;
    width?: number;
    selected?: boolean;
    dim?: boolean;
    onclick?: () => void;
  }

  let { card, back = false, deck = 'french', width = 92, selected = false, dim = false, onclick }: Props = $props();

  const src = $derived(back || !card ? `/cards/${deck}/back.svg` : `/cards/${deck}/${cardId(card)}.svg`);
</script>

<button
  class="card"
  class:selected
  class:dim
  class:clickable={!!onclick}
  style="width:{width}px;height:{width * 1.4}px"
  disabled={!onclick}
  onclick={onclick}
>
  <img {src} alt={card ? cardId(card) : 'card back'} draggable="false" />
</button>

<style>
  .card {
    padding: 0;
    border: none;
    background: none;
    border-radius: 8%;
    transition: transform 0.12s ease, box-shadow 0.12s ease;
    line-height: 0;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  }
  .card img {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    display: block;
  }
  .clickable {
    cursor: pointer;
  }
  .clickable:hover {
    transform: translateY(-10px);
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.45);
  }
  .selected {
    transform: translateY(-14px);
    box-shadow: 0 0 0 3px #ffd54a, 0 8px 16px rgba(0, 0, 0, 0.45);
  }
  .dim {
    opacity: 0.45;
    filter: grayscale(0.4);
  }
</style>
