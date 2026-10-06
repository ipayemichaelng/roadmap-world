import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { ROADMAP_WORLD_HTML } from './roadmapWorldHtml';

export type RegionKind = 'garden' | 'well' | 'hills' | 'village' | 'shore' | 'gate' | 'summit';

export type RoadmapStep = {
  /** Region name shown on the map label and the quest card, e.g. "Bethlehem". */
  title: string;
  /** Second line on the quest card, e.g. "Luke 2". */
  subtitle?: string;
  /** Scenery for this region. Defaults cycle garden → well → hills → village → shore → gate, last step = summit. */
  kind?: RegionKind;
};

export type RoadmapWorldTheme = {
  accent?: string;
  accentDeep?: string;
  gold?: string;
  hero?: string;
  heroHat?: string;
};

export type RoadmapWorldProps = {
  /** 2–12 steps. The island layout adapts to the count. */
  steps: RoadmapStep[];
  /**
   * Number of steps the user has completed (0…steps.length).
   * Increase it by exactly 1 to play the walk + unlock animation; any other change jumps without animation.
   */
  progress: number;
  /** Show the built-in quest card and region counter. Default true. */
  hud?: boolean;
  /** Show the built-in demo buttons (Complete / Night / Overview / Reset). Default false. */
  controls?: boolean;
  night?: boolean;
  theme?: RoadmapWorldTheme;
  /** Floating text when a step completes. "{n}" becomes the step number. null hides it. Default "+10 XP". */
  rewardText?: string | null;
  style?: StyleProp<ViewStyle>;
  onReady?: () => void;
  onStepComplete?: (index: number) => void;
  onRegionUnlocked?: (index: number) => void;
  onFinish?: () => void;
  onError?: (message: string) => void;
};

export type RoadmapWorldHandle = {
  completeStep(): void;
  setProgress(completed: number): void;
  setNight(on: boolean): void;
  setOverview(on: boolean): void;
  reset(): void;
};

type OutMsg =
  | { type: 'ready' }
  | { type: 'stepComplete'; index: number }
  | { type: 'regionUnlocked'; index: number }
  | { type: 'finish' }
  | { type: 'error'; message: string };

export const RoadmapWorld = forwardRef<RoadmapWorldHandle, RoadmapWorldProps>(function RoadmapWorld(props, ref) {
  const { steps, progress, hud = true, controls = false, night = false, theme, rewardText = '+10 XP', style } = props;
  const web = useRef<React.ElementRef<typeof WebView>>(null);
  const ready = useRef(false);
  const shownProgress = useRef(progress);
  const cb = useRef(props);
  cb.current = props;

  const send = useCallback((msg: object) => {
    if (!ready.current) return;
    web.current?.injectJavaScript(`window.roadmapWorld&&window.roadmapWorld.handle(${JSON.stringify(msg)});true;`);
  }, []);

  const init = useCallback(() => {
    shownProgress.current = progress;
    send({ type: 'init', config: { steps, progress, hud, controls, night, theme, rewardText } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send, JSON.stringify(steps), hud, controls, JSON.stringify(theme), rewardText]);

  // Rebuild the world when the steps or look change.
  useEffect(() => {
    if (ready.current) init();
  }, [init]);

  // Progress changes: +1 animates, anything else jumps.
  useEffect(() => {
    if (!ready.current || progress === shownProgress.current) return;
    if (progress === shownProgress.current + 1) send({ type: 'completeStep' });
    else send({ type: 'setProgress', completed: progress });
    shownProgress.current = progress;
  }, [progress, send]);

  useEffect(() => {
    send({ type: 'setNight', on: night });
  }, [night, send]);

  useImperativeHandle(ref, () => ({
    completeStep: () => send({ type: 'completeStep' }),
    setProgress: (completed: number) => send({ type: 'setProgress', completed }),
    setNight: (on: boolean) => send({ type: 'setNight', on }),
    setOverview: (on: boolean) => send({ type: 'setOverview', on }),
    reset: () => send({ type: 'reset' }),
  }), [send]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: OutMsg;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    const p = cb.current;
    switch (msg.type) {
      case 'ready':
        ready.current = true;
        init();
        p.onReady?.();
        break;
      case 'stepComplete': p.onStepComplete?.(msg.index); break;
      case 'regionUnlocked': p.onRegionUnlocked?.(msg.index); break;
      case 'finish': p.onFinish?.(); break;
      case 'error': p.onError?.(msg.message); break;
    }
  }, [init]);

  return (
    <WebView
      ref={web}
      style={[{ flex: 1, backgroundColor: '#9fd6f5' }, style]}
      source={{ html: ROADMAP_WORLD_HTML }}
      originWhitelist={['*']}
      onMessage={onMessage}
      onLoadStart={() => { ready.current = false; }}
      javaScriptEnabled
      scrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      setSupportMultipleWindows={false}
      allowsInlineMediaPlayback
      androidLayerType="hardware"
    />
  );
});

export default RoadmapWorld;
