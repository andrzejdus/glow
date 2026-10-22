import { conn } from './connection.svelte';
import { volcanoWorkflows, type VolcanoWorkflow, type VolcanoWorkflowStep } from './devices/volcano';

// Runs a VOLCANO workflow from the phone, the way the official app does:
// heat waits until the measured temperature is within 1 °C of the target,
// hold keeps the pump off, pump runs it for the given time, and the end
// switches heater and pump off.

export type RunStatus = 'idle' | 'running' | 'paused' | 'done';

const TICK_MS = 250;
/** Rough heating speed for the time-left estimate, °C per second. */
const HEAT_RATE = 1.2;

class WorkflowRunner {
  readonly flows = volcanoWorkflows;
  flowId = $state<string>(volcanoWorkflows[0]?.id ?? '');
  status = $state<RunStatus>('idle');
  stepIndex = $state(0);
  stepElapsed = $state(0);
  elapsed = $state(0);

  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTick = 0;

  get flow(): VolcanoWorkflow | undefined {
    return this.flows.find((f) => f.id === this.flowId);
  }

  get step(): VolcanoWorkflowStep | undefined {
    return this.flow?.steps[this.stepIndex];
  }

  start(id: string) {
    this.halt(false);
    this.flowId = id;
    this.stepIndex = 0;
    this.stepElapsed = 0;
    this.elapsed = 0;
    this.status = 'running';
    if (!conn.device?.heaterOn) conn.setHeater(true);
    this.enter();
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  pause() {
    if (this.status !== 'running') return;
    this.status = 'paused';
    conn.setPump(false);
  }

  resume() {
    if (this.status !== 'paused') return;
    this.status = 'running';
    this.lastTick = performance.now();
    if (this.step?.kind === 'pump') conn.setPump(true);
  }

  stop() {
    this.halt(true);
    this.status = 'idle';
  }

  /** Seconds a step is expected to take, for progress and time left. */
  estimate(index: number): number {
    const steps = this.flow?.steps ?? [];
    const s = steps[index];
    if (!s) return 0;
    if (s.kind !== 'heat') return s.seconds;
    const before = steps.slice(0, index).reverse().find((x) => x.kind === 'heat');
    const from = before && before.kind === 'heat' ? before.celsius : conn.device?.currentTemp ?? s.celsius;
    return Math.max(3, Math.abs(s.celsius - from) / HEAT_RATE);
  }

  get total(): number {
    return (this.flow?.steps ?? []).reduce((sum, _s, i) => sum + this.estimate(i), 0);
  }

  get remaining(): number {
    if (this.status === 'idle') return this.total;
    if (this.status === 'done') return 0;
    const steps = this.flow?.steps ?? [];
    let left = Math.max(0, this.estimate(this.stepIndex) - this.stepElapsed);
    for (let i = this.stepIndex + 1; i < steps.length; i++) left += this.estimate(i);
    return left;
  }

  get progress(): number {
    if (this.status === 'done') return 1;
    const total = this.total;
    return total > 0 ? Math.min(1, 1 - this.remaining / total) : 0;
  }

  private enter() {
    const s = this.step;
    if (!s) return;
    if (s.kind === 'heat') {
      conn.setPump(false);
      conn.setTarget(s.celsius, true);
    } else if (s.kind === 'pump') {
      conn.setPump(true);
    } else {
      conn.setPump(false);
    }
  }

  private tick() {
    const now = performance.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (this.status !== 'running') return;
    if (!conn.device || conn.phase !== 'connected') return;
    this.elapsed += dt;
    this.stepElapsed += dt;
    const s = this.step;
    if (!s) return this.finish();
    const current = conn.device.currentTemp;
    const reached =
      s.kind === 'heat'
        ? current !== undefined && Math.round(current) >= s.celsius - 1 && Math.round(current) < s.celsius + 1
        : this.stepElapsed >= s.seconds;
    if (!reached) return;
    this.stepIndex += 1;
    this.stepElapsed = 0;
    if (this.stepIndex >= (this.flow?.steps.length ?? 0)) return this.finish();
    this.enter();
  }

  private finish() {
    this.halt(true);
    this.stepIndex = Math.max(0, (this.flow?.steps.length ?? 1) - 1);
    this.status = 'done';
  }

  private halt(switchOff: boolean) {
    clearInterval(this.timer);
    this.timer = undefined;
    if (switchOff && this.status !== 'idle' && conn.device) {
      conn.setPump(false);
      conn.setHeater(false);
    }
  }
}

export const runner = new WorkflowRunner();
