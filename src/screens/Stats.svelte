<script lang="ts">
  import { fly } from 'svelte/transition';
  import Icon from '../components/Icon.svelte';
  import SessionChart from '../components/SessionChart.svelte';
  import { conn, tap } from '../lib/connection.svelte';
  import { mmss, splitHours, toUnit, usageTime } from '../lib/format';
  import { sessions, type SessionDetail, type SessionEvent, type SessionSummary } from '../lib/sessions.svelte';
  import { usage } from '../lib/usage.svelte';

  let { onclose }: { onclose: () => void } = $props();

  const unit = $derived(conn.device?.unit ?? 'C');
  const deg = (c: number | null | undefined) => (c === null || c === undefined ? '–' : `${toUnit(c, unit)}°`);
  const names = { normal: 'Base', boost: 'Booster', superboost: 'Superbooster' };

  // The running session by default; a tap in the history shows that one instead.
  let picked = $state<number | null>(null);
  const shown = $derived(
    (picked !== null ? sessions.list.find((s) => s.id === picked) : null) ?? sessions.active ?? sessions.list[0] ?? null,
  );
  const running = $derived(!!shown && shown.id === sessions.active?.id);
  let stored = $state<{ id: number; detail: SessionDetail | null } | null>(null);
  // The session that just ended keeps growing while its cool-down is recorded; it is read from
  // the log once that is over, or a copy taken during it would show without the rest.
  const cooling = $derived(!!shown && sessions.cooling?.id === shown.id);
  $effect(() => {
    const id = shown?.id;
    if (id === undefined || running || cooling) return;
    sessions.detail(id).then((d) => {
      if (shown?.id === id) stored = { id, detail: d };
    });
  });
  const detail = $derived(
    running ? sessions.activeDetail : cooling ? sessions.cooling!.detail : stored?.id === shown?.id ? stored!.detail : null,
  );

  const lengthOf = (s: SessionSummary, now: number) => Math.max(0, ((s.end ?? (s.id === sessions.active?.id ? now : s.seen)) - s.id) / 1000);
  const boostSec = (s: SessionSummary) => (s.modes.boost ?? 0) + (s.modes.superboost ?? 0);
  const used = (s: SessionSummary) =>
    s.batteryStart !== undefined && s.batteryEnd !== undefined ? Math.max(0, s.batteryStart - s.batteryEnd) : null;

  const when = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  function dayName(t: number) {
    const d = new Date(t);
    const today = new Date();
    const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return d.toLocaleDateString('en', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
    });
  }

  const status = $derived(
    !shown ? '' : running ? (conn.device && conn.phase === 'connected' ? (shown.readySec !== null ? 'Ready' : 'Heating') : 'Waiting for the device…') : '',
  );

  function eventText(e: SessionEvent) {
    switch (e.k) {
      case 'ready': return 'Ready';
      case 'mode': return names[e.v];
      case 'target': return `Target ${deg(e.v)}`;
      case 'air': return e.v ? 'Air on' : 'Air off';
      case 'lost': return 'Connection lost';
      case 'back': return 'Connected again';
    }
  }
  const events = $derived.by(() => {
    if (!shown) return [];
    const list: { t: number; text: string; tone?: string }[] = [
      { t: 0, text: shown.joined ? 'Heater on (seen from here)' : 'Heater on', tone: 'heat' },
      ...(detail?.events ?? []).map((e) => ({ t: e.t, text: eventText(e), tone: e.k === 'ready' ? 'ready' : e.k === 'mode' && e.v !== 'normal' ? 'boost' : undefined })),
    ];
    if (shown.end !== null) list.push({ t: (shown.end - shown.id) / 1000, text: 'Heater off' });
    return list;
  });

  // Hours of operation.
  let period = $state<'day' | 'week' | 'month'>('day');
  const counts = { day: 14, week: 8, month: 8 };
  const bars = $derived(usage.bars(period, counts[period], usage.now));
  const max = $derived(Math.max(period === 'day' ? 0.5 : 3.5, ...bars.map((b) => b.hours ?? 0)));
  const life = $derived(usage.lifetimeSec(usage.now));
  const parts = $derived(life === null ? null : splitHours(life));

  const done = $derived(sessions.list.filter((s) => s.end !== null));
  const avgLength = $derived(done.length ? done.reduce((a, s) => a + lengthOf(s, 0), 0) / done.length : null);
  const readyTimes = $derived(sessions.list.filter((s) => !s.joined && s.readySec !== null).map((s) => s.readySec!));
  const avgReady = $derived(readyTimes.length ? readyTimes.reduce((a, b) => a + b, 0) / readyTimes.length : null);
  const perWeek = $derived.by(() => {
    if (!sessions.list.length) return null;
    const since = sessions.list[sessions.list.length - 1].id;
    const weeks = Math.max(1, (usage.now - since) / (7 * 86_400_000));
    return sessions.list.length / weeks;
  });
  // The device counts every minute of heating; Glow sees only what happens while it is connected.
  const outside = $derived.by(() => {
    if (!sessions.list.length) return null;
    const since = sessions.list[sessions.list.length - 1].id;
    const counter = usage.hoursSince(since, usage.now);
    if (counter === null) return null;
    const seen = sessions.list.reduce((a, s) => a + lengthOf(s, usage.now), 0) / 3600;
    return Math.max(0, counter - seen);
  });

  // The history, by day, newest first; long ones load in pages.
  let pageSize = $state(30);
  const history = $derived.by(() => {
    const groups: { day: string; items: SessionSummary[] }[] = [];
    for (const s of sessions.list.slice(0, pageSize)) {
      const day = dayName(s.id);
      if (groups[groups.length - 1]?.day !== day) groups.push({ day, items: [] });
      groups[groups.length - 1].items.push(s);
    }
    return groups;
  });

  function sparkPath(values: number[], width = 64, height = 22) {
    if (values.length < 2) return '';
    const lo = Math.min(...values);
    const hi = Math.max(...values, lo + 1);
    return values
      .map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - lo) / (hi - lo)) * (height - 4)).toFixed(1)}`)
      .join('');
  }

  let top: HTMLElement | undefined = $state();
  function open(s: SessionSummary) {
    tap();
    picked = s.id === sessions.active?.id ? null : s.id;
    top?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

<div class="overlay" transition:fly={{ y: 16, duration: 300 }}>
  <div class="screen">
    <header bind:this={top}>
      <button type="button" class="round press" aria-label="Back to the dashboard" onclick={onclose}>
        <Icon name="back" size={20} color="var(--navy)" />
      </button>
      <h1>Stats</h1>
    </header>

    {#if shown}
      <section class="card session rise d1">
        <div class="s-head">
          <div>
            <div class="label">{running ? 'Current session' : shown.id === sessions.list[0]?.id ? 'Last session' : 'Session'}</div>
            <div class="s-when">{dayName(shown.id)}, {when(shown.id)}</div>
          </div>
          {#if picked !== null && sessions.active}
            <button type="button" class="pill press" onclick={() => { tap(); picked = null; }}>Current</button>
          {:else if status}
            <div class="chip" class:ready={status === 'Ready'}><span></span>{status}</div>
          {/if}
        </div>
        <div class="big num">{mmss(lengthOf(shown, usage.now))}</div>

        <SessionChart summary={shown} {detail} {unit} {running} />

        <div class="facts num">
          <div><span>Ready in</span><strong>{shown.readySec === null || shown.joined ? '–' : mmss(shown.readySec)}</strong></div>
          <div><span>Target</span><strong>{deg(shown.target)}</strong></div>
          {#if shown.live}<div><span>Peak</span><strong>{deg(shown.peak)}</strong></div>{/if}
          <div><span>Boost</span><strong>{boostSec(shown) >= 1 ? mmss(boostSec(shown)) : '–'}</strong></div>
          {#if used(shown) !== null}<div><span>Battery</span><strong>{used(shown) ? `−${used(shown)} %` : '–'}</strong></div>{/if}
          {#if shown.airSec}<div><span>Air</span><strong>{mmss(shown.airSec)}</strong></div>{/if}
        </div>

        <ol class="events num">
          {#each events as e, i (i)}
            <li class={e.tone}><span class="e-t">{mmss(e.t)}</span><span class="e-dot"></span>{e.text}</li>
          {/each}
        </ol>
      </section>
    {:else}
      <section class="card nothing rise d1">
        <Icon name="flame" size={28} color="var(--orange)" />
        <p>Turn the heater on and the session shows up here, with its temperature over time.</p>
      </section>
    {/if}

    <section class="card hours rise d2">
      <div class="label">Hours of operation</div>
      <div class="h-top">
        {#if parts}
          <div class="life num"><span class="h">{parts.h}</span><span class="u">h</span><span class="m">{parts.m}</span><span class="u">m</span></div>
        {:else}
          <div class="life num"><span class="h">–</span></div>
        {/if}
        <div class="seg" role="tablist" aria-label="Period">
          {#each ['day', 'week', 'month'] as const as p (p)}
            <button type="button" role="tab" aria-selected={period === p} class:on={period === p} onclick={() => { tap(); period = p; }}>
              {p === 'day' ? 'Days' : p === 'week' ? 'Weeks' : 'Months'}
            </button>
          {/each}
        </div>
      </div>
      <div class="bars" style:--n={bars.length} role="img" aria-label="Hours used per {period}">
        {#each bars as b, i (period + b.label + i)}
          <div class="col">
            <div class="val num" class:current={b.current}>{!b.hours || b.hours * 60 < 1 ? '' : b.hours < 1 ? `${Math.round(b.hours * 60)}m` : b.hours.toFixed(1)}</div>
            <div class="bar" class:current={b.current} class:empty={!b.hours}
              style:height="{!b.hours ? 4 : Math.max(6, Math.round((b.hours / max) * 64))}px" style:animation-delay="{i * 0.03}s"></div>
            <div class="wk" class:current={b.current}>{b.label}</div>
          </div>
        {/each}
      </div>
      <div class="grid num">
        <div><span>Sessions a week</span><strong>{perWeek === null ? '–' : perWeek.toFixed(1)}</strong></div>
        <div><span>Avg session</span><strong>{avgLength === null ? '–' : mmss(avgLength)}</strong></div>
        <div><span>Avg ready in</span><strong>{avgReady === null ? '–' : mmss(avgReady)}</strong></div>
        <div><span>Outside Glow</span><strong>{outside === null ? '–' : usageTime(outside)}</strong></div>
      </div>
    </section>

    {#if sessions.list.length}
      <section class="history rise d3">
        <h2 class="label">History</h2>
        <ol class="line">
          {#each history as g (g.day)}
            <li class="day">{g.day}</li>
            {#each g.items as s (s.id)}
              {@const isShown = s.id === shown?.id}
              {@const isRunning = s.id === sessions.active?.id}
              <li>
                <span class="node" class:boost={boostSec(s) >= 1} class:running={isRunning}></span>
                <button type="button" class="item card press" class:shown={isShown} onclick={() => open(s)}>
                  <div class="i-main">
                    <div class="i-top num"><strong>{when(s.id)}</strong><span>{mmss(lengthOf(s, usage.now))}</span>{#if isRunning}<em>now</em>{/if}</div>
                    <div class="i-sub num">
                      {[
                        deg(s.target),
                        s.readySec !== null && !s.joined ? `ready in ${mmss(s.readySec)}` : '',
                        boostSec(s) >= 1 ? (s.modes.superboost ? 'Superbooster' : 'Booster') : '',
                        used(s) ? `−${used(s)} %` : '',
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <svg class="spark" width="64" height="22" viewBox="0 0 64 22" aria-hidden="true"><path d={sparkPath(s.spark)} /></svg>
                </button>
              </li>
            {/each}
          {/each}
        </ol>
        {#if sessions.list.length > pageSize}
          <button type="button" class="more pill press" onclick={() => { tap(); pageSize += 30; }}>Show earlier sessions</button>
        {/if}
      </section>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 30;
    overflow-y: auto;
    background: var(--bg);
  }
  .screen {
    padding-bottom: calc(var(--sab) + 24px);
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 44px;
    scroll-margin-top: calc(var(--sat) + 12px);
  }
  h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 800;
    color: var(--navy);
  }
  .session {
    padding: 16px 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .s-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .s-when {
    margin-top: 2px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted-2);
  }
  .big {
    font-size: 40px;
    font-weight: 300;
    letter-spacing: -0.03em;
    line-height: 1;
    color: var(--navy);
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 800;
    color: var(--orange-ink);
  }
  .chip span {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--led-heat);
    animation: blink 1.4s ease-in-out infinite;
  }
  .chip.ready {
    color: var(--led-ready);
  }
  .chip.ready span {
    background: var(--led-ready);
    animation: none;
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px 8px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
  .facts div,
  .grid div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .facts span,
  .grid span {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
  }
  .facts strong {
    font-size: 16px;
    color: var(--navy);
  }
  .events {
    list-style: none;
    margin: 0;
    padding: 10px 0 0;
    border-top: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    color: var(--navy);
  }
  .events li {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .e-t {
    width: 38px;
    text-align: right;
    font-size: 12px;
    color: var(--muted);
  }
  .e-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--track);
  }
  .events li.heat .e-dot {
    background: var(--led-heat);
  }
  .events li.ready .e-dot {
    background: var(--led-ready);
  }
  .events li.boost .e-dot {
    background: var(--orange);
  }
  .nothing {
    padding: 28px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
  }
  .nothing p {
    margin: 0;
    font-size: 14px;
    line-height: 1.4;
    color: var(--muted-2);
  }
  .hours {
    padding: 16px 16px 14px;
  }
  .h-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .life {
    margin-top: 4px;
    color: var(--navy);
    display: flex;
    align-items: baseline;
    gap: 3px;
  }
  .life .h {
    font-size: 32px;
    font-weight: 300;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .life .m {
    font-size: 20px;
    margin-left: 6px;
  }
  .life .u {
    font-size: 14px;
    font-weight: 600;
    color: var(--muted);
  }
  .seg {
    display: flex;
    padding: 3px;
    border-radius: 999px;
    background: var(--card-2);
  }
  .seg button {
    border: 0;
    background: none;
    padding: 6px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    color: var(--muted-2);
    cursor: pointer;
  }
  .seg button.on {
    background: var(--orange);
    color: var(--navy-deep);
  }
  .bars {
    margin-top: 14px;
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
    gap: 5px;
    align-items: end;
  }
  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    height: 100px;
    min-width: 0;
  }
  .val {
    font-size: 9px;
    font-weight: 700;
    color: var(--muted);
    white-space: nowrap;
  }
  .val.current {
    color: var(--orange-ink);
  }
  .bar {
    width: 100%;
    border-radius: 4px;
    background: var(--orange-soft);
    transform-origin: bottom;
    animation: grow 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .bar.current {
    background: var(--orange);
  }
  .bar.empty {
    background: var(--card-2);
  }
  @keyframes grow {
    from { transform: scaleY(0); }
    to { transform: scaleY(1); }
  }
  .wk {
    font-size: 10px;
    font-weight: 700;
    color: var(--muted);
    white-space: nowrap;
  }
  .wk.current {
    color: var(--orange-ink);
  }
  .grid {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 8px;
  }
  .grid strong {
    font-size: 15px;
    color: var(--navy);
  }
  .history {
    display: flex;
    flex-direction: column;
  }
  .history h2 {
    margin: 8px 0 4px;
  }
  .line li.day {
    margin: 10px 0 -2px;
    font-size: 13px;
    font-weight: 800;
    color: var(--navy);
  }
  .line li.day:first-child {
    margin-top: 0;
  }
  /* The timeline: one vertical line, a node per session. */
  .line {
    list-style: none;
    margin: 0;
    padding: 0 0 0 22px;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .line::before {
    content: '';
    position: absolute;
    left: 6px;
    top: 4px;
    bottom: 4px;
    width: 2px;
    border-radius: 1px;
    background: var(--orange-soft);
  }
  .line li {
    position: relative;
  }
  .node {
    position: absolute;
    left: -21px;
    top: 50%;
    width: 12px;
    height: 12px;
    margin-top: -6px;
    border-radius: 50%;
    background: var(--card);
    border: 3px solid var(--orange-soft);
    box-sizing: border-box;
  }
  .node.boost {
    border-color: var(--orange);
  }
  .node.running {
    background: var(--orange);
    border-color: var(--orange);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--orange) 25%, transparent);
  }
  .item {
    width: 100%;
    border: 0;
    border-radius: 18px;
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    text-align: left;
    color: var(--navy);
    box-shadow: var(--shadow-sm);
    cursor: pointer;
  }
  .item.shown {
    box-shadow: 0 0 0 2px var(--orange), var(--shadow-sm);
  }
  .i-main {
    flex: 1;
    min-width: 0;
  }
  .i-top {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 15px;
  }
  .i-top span {
    font-size: 13px;
    font-weight: 600;
    color: var(--muted-2);
  }
  .i-top em {
    font-style: normal;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--orange-ink);
  }
  .i-sub {
    margin-top: 2px;
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .spark {
    flex-shrink: 0;
  }
  .spark path {
    fill: none;
    stroke: var(--orange);
    stroke-width: 1.8;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .more {
    align-self: center;
    margin-top: 14px;
  }
</style>
