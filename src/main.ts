import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { conn } from './lib/connection.svelte';
import { locale } from './lib/locale.svelte';

locale.start();
mount(App, { target: document.getElementById('app')! });
conn.start();
