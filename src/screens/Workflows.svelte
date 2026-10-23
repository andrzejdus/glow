<script lang="ts">
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import Warmth from '../components/Warmth.svelte';
  import { conn, tap } from '../lib/connection.svelte';
  import type { DeviceState } from '../lib/devices/types';
  import type { VolcanoWorkflowStep } from '../lib/devices/volcano';
  import { mmss, toUnit } from '../lib/format';
  import { runner } from '../lib/workflow.svelte';

  const d = $derived(conn.device as DeviceState);
  const unit = $derived(d.unit ?? 'C');
  const flow = $derived(runner.flow);
  const steps = $derived(flow?.steps ?? []);
  const step = $derived(runner.step);
  const active = $derived(runner.status === 'running' || runner.status === 'paused');
  const warmth = $derived(d.heaterOn && d.currentTemp !== undefined ? Math.max(0, Math.min(1, (d.currentTemp - 40) / 190)) : 0);

  const badge = $derived(
    runner.status === 'running' ? 'Workflow running' : runner.status === 'paused' ? 'Paused' : runner.status === 'done' ? 'Completed' : 'Ready to start',
  );
  const title = $derived.by(() => {
    if (runner.status === 'done') return 'Done';
    if (!active || !step) return flow?.name ?? '';
    return step.kind === 'heat' ? `Heat to ${toUnit(step.celsius, unit)}°` : step.kind === 'pump' ? 'Pump' : 'Hold';
  });
  const meta = $derived.by(() => {
    if (runner.status === 'done') return `all ${steps.length} steps`;
    if (!active || !step) return `${steps.length} steps · ≈ ${mmss(runner.total)}`;
    if (step.kind === 'heat') return `${d.currentTemp === undefined ? '–' : toUnit(d.currentTemp, unit)}° now`;
    return `${Math.max(0, Math.ceil(step.seconds - runner.stepElapsed))} s`;
  });

  const label = (s: VolcanoWorkflowStep) =>
    s.kind === 'heat' ? `${toUnit(s.celsius, unit)}°` : `${s.kind === 'pump' ? 'Pump' : 'Hold'} ${s.seconds}s`;
  const chipFill = (i: number) => {
    if (runner.status === 'done' || i < runner.stepIndex) return 100;
    if (i > runner.stepIndex || !active) return 0;
    return Math.min(100, Math.round((runner.stepElapsed / runner.estimate(i)) * 100));
  };

  let chipRow: HTMLDivElement | undefined = $state();
  $effect(() => {
    const el = chipRow?.children[runner.stepIndex] as HTMLElement | undefined;
    if (el && active) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  });

  function playPause() {
    tap();
    if (runner.status === 'running') runner.pause();
    else if (runner.status === 'paused') runner.resume();
    else runner.start(runner.flowId);
  }
</script>

<Warmth warmth={warmth * 0.9} />
<div class="screen">
  <Header />

  <section class="card temp rise d1">
    <div class="t-main">
      <div class="label">Temperature</div>
      <div class="t-now num">{d.currentTemp === undefined ? '–' : toUnit(d.currentTemp, unit)}<span>°{unit}</span></div>
      <div class="t-set">
        <button type="button" class="round flat press" aria-label="Lower target" onclick={() => conn.setTarget((d.targetTemp ?? 40) - 1)}>
          <Icon name="minus" size={18} color="var(--navy)" stroke={2.4} />
        </button>
        <div class="num">to <strong>{d.targetTemp === undefined ? '–' : toUnit(d.targetTemp, unit)}°</strong></div>
        <button type="button" class="round flat press" aria-label="Raise target" onclick={() => conn.setTarget((d.targetTemp ?? 40) + 1)}>
          <Icon name="plus" size={18} color="var(--navy)" stroke={2.4} />
        </button>
      </div>
    </div>
    <div class="t-tile-wrap">
      <div class="t-glow" style:opacity={d.heaterOn ? 0.3 + 0.7 * warmth : 0}></div>
      <button type="button" class="t-tile heat press" class:on={d.heaterOn} aria-pressed={d.heaterOn}
        onclick={() => conn.setHeater(!d.heaterOn)}>
        <Icon name="flame" size={30} class={d.heaterOn ? 'flicker' : ''} />HEAT
      </button>
    </div>
    <button type="button" class="t-tile air press" class:on={d.pumpOn} aria-pressed={!!d.pumpOn}
      onclick={() => { tap(); conn.setPump(!d.pumpOn); }}>
      <Icon name="fan" size={30} class={d.pumpOn ? 'spinning' : ''} />AIR
    </button>
  </section>

  <section class="card run rise d2">
    <div class="r-head">
      <div class="r-title">
        <div class="badge">{badge}</div>
        <div class="name">{flow?.name ?? ''}</div>
      </div>
      <button type="button" class="round flat press" aria-label={runner.status === 'running' ? 'Pause workflow' : 'Start workflow'}
        onclick={playPause}>
        <Icon name={runner.status === 'running' ? 'pause' : 'play'} size={18} color="var(--navy)" stroke={2.8} />
      </button>
      <button type="button" class="round flat press" aria-label="Stop workflow" disabled={!active}
        onclick={() => { tap(); runner.stop(); }}>
        <Icon name="stop" size={16} color="var(--navy)" />
      </button>
    </div>
    <div class="r-step">
      <div class="big">{title}</div>
      <div class="num meta">{meta}</div>
    </div>
    <div class="track"><div class="fill" class:moving={runner.status === 'running'} style:width="{runner.progress * 100}%"></div></div>
    <div class="r-foot num">
      <span>Running <strong>{mmss(runner.elapsed)}</strong></span>
      <span>Step {Math.min(steps.length, runner.stepIndex + 1)} of {steps.length}</span>
      <span><strong>{mmss(runner.remaining)}</strong> left</span>
    </div>
    <div class="chips" bind:this={chipRow}>
      {#each steps as s, i (i)}
        <div class="chip" class:past={i < runner.stepIndex || runner.status === 'done'} class:now={active && i === runner.stepIndex}>
          <div class="chip-fill" style:width="{chipFill(i)}%"></div>
          <span>{label(s)}</span>
        </div>
      {/each}
    </div>
  </section>

  <div class="flows rise d3">
    {#each runner.flows as f (f.id)}
      {@const on = f.id === runner.flowId && active}
      <button type="button" class="flow press" class:on aria-label="Start {f.name}"
        onclick={() => { tap(); runner.start(f.id); }}>
        <span class="f-top">
          <span class="f-name">{f.name}</span>
          <span class="f-play"><Icon name="play" size={13} color={on ? 'var(--navy-deep)' : 'var(--navy)'} /></span>
        </span>
        <span class="f-meta num">{f.steps.length} steps</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .screen {
    position: relative;
    z-index: 1;
  }
  .flat {
    box-shadow: none;
    border: 1px solid var(--line);
  }
  .flat:disabled {
    opacity: 0.4;
  }
  .temp {
    padding: 18px;
    display: flex;
    gap: 12px;
    align-items: stretch;
  }
  .t-main {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 6px;
  }
  .t-now {
    font-size: 58px;
    line-height: 1;
    font-weight: 200;
    letter-spacing: -0.04em;
    color: var(--navy);
  }
  .t-now span {
    font-size: 22px;
    font-weight: 500;
    vertical-align: top;
    color: var(--orange-ink);
    margin-left: 2px;
    letter-spacing: 0;
  }
  .t-set {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--muted);
  }
  .t-set div {
    min-width: 58px;
    text-align: center;
  }
  .t-set strong {
    color: var(--navy);
  }
  .t-tile-wrap {
    position: relative;
    width: 84px;
  }
  .t-glow {
    position: absolute;
    inset: -18px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 102, 0, 0.55) 0%, rgba(255, 102, 0, 0) 68%);
    animation: blink 2.4s ease-in-out infinite;
    transition: opacity 1s;
  }
  .t-tile {
    position: relative;
    width: 84px;
    height: 100%;
    min-height: 120px;
    border-radius: 20px;
    border: 0;
    cursor: pointer;
    background: var(--bg);
    color: var(--navy);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.04em;
  }
  .t-tile.heat.on {
    background: var(--orange);
    color: var(--navy-deep);
    box-shadow: 0 10px 26px rgba(255, 102, 0, 0.45);
  }
  .t-tile.air.on {
    background: var(--navy-fill);
    color: #fff;
    box-shadow: 0 10px 24px rgba(0, 40, 125, 0.25);
  }
  .run {
    padding: 18px;
    color: var(--navy);
  }
  .r-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .r-title {
    flex-grow: 1;
  }
  .badge {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--orange-ink);
  }
  .name {
    font-size: 20px;
    font-weight: 800;
    margin-top: 2px;
  }
  .r-step {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-top: 12px;
  }
  .big {
    font-size: 36px;
    font-weight: 300;
    letter-spacing: -0.03em;
  }
  .meta {
    font-size: 14px;
    font-weight: 600;
    color: var(--muted);
  }
  .track {
    margin-top: 12px;
    height: 8px;
    border-radius: 999px;
    background: var(--card-2);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: 999px;
    background-color: var(--orange);
    transition: width 0.4s linear;
  }
  .fill.moving {
    background-image: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.22) 0 7px, rgba(255, 255, 255, 0) 7px 14px);
    background-size: 28px 28px;
    animation: stripe 0.8s linear infinite;
  }
  @keyframes stripe {
    to { background-position: 28px 0; }
  }
  .r-foot {
    display: flex;
    justify-content: space-between;
    margin-top: 8px;
    font-size: 12px;
    color: var(--muted);
  }
  .r-foot strong {
    color: var(--navy);
  }
  .chips {
    margin-top: 14px;
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 2px 2px 4px;
  }
  .chip {
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
    height: 32px;
    padding: 0 11px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    font-size: 12px;
    font-weight: 700;
    background: var(--card-2);
    color: var(--muted);
    transition: background 0.3s, color 0.3s, transform 0.3s;
  }
  .chip.past {
    background: var(--orange-soft);
    color: var(--navy);
  }
  .chip.past .chip-fill {
    opacity: 0;
  }
  .chip.now {
    background: var(--orange-tint);
    color: var(--navy);
    transform: scale(1.06);
  }
  .chip-fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: var(--orange);
    transition: width 0.3s linear;
  }
  .chip span {
    position: relative;
  }
  .flows {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .flow {
    height: 92px;
    border-radius: 22px;
    border: 2px solid transparent;
    background: var(--card);
    box-shadow: var(--shadow);
    color: var(--navy);
    text-align: left;
    padding: 14px 16px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .flow.on {
    border-color: var(--orange);
    box-shadow: 0 10px 26px rgba(255, 102, 0, 0.2);
  }
  .f-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }
  .f-name {
    font-size: 17px;
    font-weight: 800;
  }
  .f-play {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.3s;
  }
  .flow.on .f-play {
    background: var(--orange);
  }
  .f-meta {
    font-size: 12px;
    color: var(--muted);
  }
</style>
