// Entry for the single-file player (dist/roadmap-world.html).
// Inside React Native it waits for an `init` message from <RoadmapWorld>.
// Opened in a normal browser it runs a sample journey with demo buttons.
import { createRoadmapWorld } from './engine.js';

const SAMPLE_STEPS = [
  { title: 'Eden Garden', subtitle: 'Genesis 2' },
  { title: "Jacob's Well", subtitle: 'John 4' },
  { title: 'Shepherd Hills', subtitle: 'Psalm 23' },
  { title: 'Bethlehem', subtitle: 'Luke 2' },
  { title: 'Galilee Shore', subtitle: 'John 21' },
  { title: 'City Gate', subtitle: 'Nehemiah 2' },
  { title: 'New Jerusalem', subtitle: 'Revelation 21' },
];

const mount = document.getElementById('app');
const native = window.ReactNativeWebView;
const post = (msg) => native && native.postMessage(JSON.stringify(msg));
let world = null;

function start(config) {
  if (world) world.destroy();
  world = createRoadmapWorld(mount, {
    steps: config.steps,
    progress: config.progress || 0,
    hud: config.hud !== false,
    controls: !!config.controls,
    night: !!config.night,
    theme: config.theme || {},
    touchAction: native ? 'none' : 'pan-y',
    rewardText: config.rewardText === null ? () => null : (i) => (config.rewardText || '+10 XP').replace('{n}', String(i + 1)),
    onStepComplete: (index) => post({ type: 'stepComplete', index }),
    onRegionUnlocked: (index) => post({ type: 'regionUnlocked', index }),
    onFinish: () => post({ type: 'finish' }),
  });
}

// Messages from React Native arrive through injectJavaScript -> window.roadmapWorld.handle(msg)
window.roadmapWorld = {
  handle(msg) {
    try {
      if (msg.type === 'init') start(msg.config);
      else if (!world) return;
      else if (msg.type === 'completeStep') world.completeStep();
      else if (msg.type === 'setProgress') world.setProgress(msg.completed);
      else if (msg.type === 'setNight') world.setNight(!!msg.on);
      else if (msg.type === 'setOverview') world.setOverview(!!msg.on);
      else if (msg.type === 'reset') world.reset();
    } catch (e) {
      post({ type: 'error', message: String(e && e.message) });
    }
  },
  get world() { return world; },
};

window.addEventListener('error', (e) => post({ type: 'error', message: e.message }));

if (native) post({ type: 'ready' });
else start({ steps: SAMPLE_STEPS, controls: true });
