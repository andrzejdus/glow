import type { DeviceDriver, DeviceKind, DeviceState, HeatMode, SettingDef } from './types';

// A simulated device: lets the app be tried, and checked, without hardware.

const portableSettings: SettingDef[] = [
  { key: 'permanentBluetooth', group: 'connection', label: 'Permanent Bluetooth', type: 'toggle',
    description: 'Keeps your device ready to connect at any time. Uses a small amount of battery, even when powered off.' },
  { key: 'chargeOptimization', group: 'battery', label: 'Charge current optimization', type: 'toggle',
    description: 'Slower charging to reduce battery aging.' },
  { key: 'chargeLimit', group: 'battery', label: 'Charge voltage limit', type: 'toggle',
    description: 'Stops at about 90% to reduce battery aging.' },
  { key: 'permanentBoost', group: 'boost', label: 'Permanent Boost', type: 'toggle',
    description: 'Turns off the 90 s timeout of Boost and Superboost.' },
  { key: 'vibration', group: 'device', label: 'Vibration', type: 'toggle' },
  { key: 'brightness', group: 'device', label: 'LED brightness', type: 'range', min: 10, max: 100, step: 10, unit: '%' },
  { key: 'autoShutoff', group: 'device', label: 'Automatic shutoff', type: 'range', min: 30, max: 300, step: 10, unit: 's' },
];

const volcanoSettings: SettingDef[] = [
  { key: 'vibration', group: 'device', label: 'Vibration', type: 'toggle' },
  { key: 'displayOnCooling', group: 'device', label: 'Display on cooling', type: 'toggle' },
  { key: 'brightness', group: 'device', label: 'LED brightness', type: 'range', min: 10, max: 100, step: 10, unit: '%' },
  { key: 'autoShutoff', group: 'device', label: 'Automatic shutoff', type: 'range', min: 60, max: 21600, step: 60, unit: 's' },
];

export function createDemoDriver(kind: DeviceKind): DeviceDriver {
  const isVolcano = kind === 'volcano';
  let emit: (patch: Partial<DeviceState>) => void = () => {};
  let timer: ReturnType<typeof setInterval> | undefined;
  const s = {
    current: isVolcano ? 168 : 142,
    target: isVolcano ? 185 : 180,
    mode: 'normal' as HeatMode,
    heater: true,
    pump: false,
    minutes: isVolcano ? 811 * 60 + 42 : 142 * 60 + 18,
    battery: 78,
  };
  const offsets = { boost: 10, superboost: 15 };
  const goal = () => Math.min(isVolcano ? 230 : 210, s.target + (s.mode === 'boost' ? offsets.boost : s.mode === 'superboost' ? offsets.superboost : 0));

  const tick = () => {
    const g = s.heater ? goal() : 24;
    const k = s.heater ? (s.current < g ? 0.06 : 0.2) : 0.01;
    s.current += (g - s.current) * k + (s.heater && s.current < g ? 0.08 : 0);
    if (s.heater) s.minutes += 0.5 / 60;
    emit({ currentTemp: Math.round(s.current * 10) / 10, operatingMinutes: s.minutes, tempReached: s.heater && Math.abs(goal() - s.current) < 1 });
  };

  return {
    kind,
    capabilities: {
      pump: isVolcano,
      battery: !isVolcano,
      boost: !isVolcano,
      superBoost: !isVolcano,
      findMy: !isVolcano,
      heaterToggle: true,
    },
    settingDefs: isVolcano ? volcanoSettings : portableSettings,

    async start(onChange) {
      emit = onChange;
      onChange({
        model: isVolcano ? 'VOLCANO HYBRID' : kind === 'crafty' ? 'CRAFTY+' : 'VENTY',
        serial: isVolcano ? 'VH 4C19E0' : 'VY 08A3F2',
        firmware: isVolcano ? '2.2.7' : '2.4.1',
        firmwareBle: isVolcano ? '1.4.0' : '1.9.0',
        currentTemp: s.current,
        targetTemp: s.target,
        minTemp: 40,
        maxTemp: isVolcano ? 230 : 210,
        boostOffset: isVolcano ? undefined : offsets.boost,
        superBoostOffset: isVolcano ? undefined : kind === 'crafty' ? offsets.boost + 15 : offsets.superboost,
        mode: s.mode,
        heaterOn: s.heater,
        pumpOn: isVolcano ? false : undefined,
        battery: isVolcano ? undefined : s.battery,
        charging: false,
        operatingMinutes: s.minutes,
        autoShutoffSec: isVolcano ? 1800 : 120,
        unit: 'C',
        settings: isVolcano
          ? { vibration: true, displayOnCooling: false, brightness: 70, autoShutoff: 1800 }
          : { permanentBluetooth: true, chargeOptimization: false, chargeLimit: true, permanentBoost: false,
              vibration: true, brightness: 70, autoShutoff: 120 },
      });
      timer = setInterval(tick, 500);
    },
    async stop() {
      clearInterval(timer);
    },
    async setTargetTemp(c) {
      s.target = c;
      emit({ targetTemp: c });
    },
    async setHeater(on) {
      s.heater = on;
      emit({ heaterOn: on });
    },
    async setMode(mode) {
      s.mode = mode;
      emit({ mode });
    },
    async setPump(on) {
      s.pump = on;
      emit({ pumpOn: on });
    },
    async setSetting(key, value) {
      emit({ settings: { [key]: value }, ...(key === 'autoShutoff' ? { autoShutoffSec: Number(value) } : {}) });
    },
    async findMyDevice() {},
  };
}
