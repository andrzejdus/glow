import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { conn } from './lib/connection.svelte';

mount(App, { target: document.getElementById('app')! });
conn.start();
