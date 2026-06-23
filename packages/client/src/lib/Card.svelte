<script lang="ts">
  import { cardId } from '@liskat/engine';
  import type { Card } from './types.ts';

  interface Props {
    card?: Card;
    back?: boolean;
    deck?: string;
    width?: number;
    fill?: boolean; // size to the parent (width:100%) instead of a fixed px width
    selected?: boolean;
    dim?: boolean;
    onclick?: () => void;
  }

  let { card, back = false, deck = 'french', width = 92, fill = false, selected = false, dim = false, onclick }: Props = $props();

  const src = $derived(back || !card ? `/cards/${deck}/back.svg` : `/cards/${deck}/${cardId(card)}.svg`);
</script>

<button
  class="card"
  class:selected
  class:dim
  class:clickable={!!onclick}
  style={fill ? 'width:100%' : `width:${width}px`}
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
    cursor: default;
    transition: transform 0.12s ease, box-shadow 0.12s ease;
    line-height: 0;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    /* Keep card proportions even when a flex row squeezes the width (e.g. the
       12-card hand on a phone); otherwise the fixed height made them tall. */
    aspect-ratio: 250 / 350;
    min-width: 0;
    flex-shrink: 1;
  }
  .card img {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    display: block;
  }
  /* every card lifts a little on hover */
  .card:hover {
    transform: translateY(-4px);
    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.4);
  }
  .clickable {
    cursor: pointer;
  }
  .clickable:hover {
    transform: translateY(-10px);
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.45);
  }
  .selected {
    transform: translateY(-16px);
    outline: 3px solid #ffd54a;
    outline-offset: 2px;
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.45);
  }
  /* keep a hovered-selected card lifted and ringed */
  .clickable.selected:hover {
    transform: translateY(-18px);
  }
  .dim {
    opacity: 0.45;
    filter: grayscale(0.4);
  }
</style>
