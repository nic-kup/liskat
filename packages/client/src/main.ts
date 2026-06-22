import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { preloadCards } from './lib/preload.ts';

// Fetch the deck into cache immediately so cards never load in one-by-one.
preloadCards();

const app = mount(App, { target: document.getElementById('app')! });

export default app;
