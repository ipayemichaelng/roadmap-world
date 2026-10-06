// Example screen: the map fills the screen, the app owns progress.
// In the real app, `completed` would come from your backend / store, and you'd
// increase it by 1 when the user actually finishes a step (not from a button on the map).
import React, { useRef, useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { RoadmapWorld, RoadmapWorldHandle, RoadmapStep } from '../RoadmapWorld';

const STEPS: RoadmapStep[] = [
  { title: 'Eden Garden', subtitle: 'Genesis 2' },
  { title: "Jacob's Well", subtitle: 'John 4' },
  { title: 'Shepherd Hills', subtitle: 'Psalm 23' },
  { title: 'Bethlehem', subtitle: 'Luke 2' },
  { title: 'Galilee Shore', subtitle: 'John 21' },
  { title: 'City Gate', subtitle: 'Nehemiah 2' },
  { title: 'New Jerusalem', subtitle: 'Revelation 21' },
];

export default function RoadmapScreen() {
  const [completed, setCompleted] = useState(0);
  const [night, setNight] = useState(false);
  const map = useRef<RoadmapWorldHandle>(null);
  const finished = completed >= STEPS.length;

  return (
    <SafeAreaView style={styles.screen}>
      <RoadmapWorld
        ref={map}
        steps={STEPS}
        progress={completed}
        night={night}
        theme={{ accent: '#2f9e6b', gold: '#f2c14e' }}
        onRegionUnlocked={(i) => console.log('unlocked region', i)}
        onFinish={() => console.log('journey complete')}
        onError={(m) => console.warn('RoadmapWorld:', m)}
      />
      <View style={styles.bar}>
        <Pressable style={[styles.btn, finished && styles.off]} disabled={finished} onPress={() => setCompleted((c) => c + 1)}>
          <Text style={styles.btnText}>{finished ? 'All done' : 'Complete reading'}</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.ghost]} onPress={() => setNight((n) => !n)}>
          <Text style={[styles.btnText, styles.ghostText]}>{night ? 'Day' : 'Night'}</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.ghost]} onPress={() => setCompleted(0)}>
          <Text style={[styles.btnText, styles.ghostText]}>Reset</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#9fd6f5' },
  bar: { position: 'absolute', left: 16, right: 16, bottom: 32, flexDirection: 'row', gap: 8 },
  btn: { backgroundColor: '#2f9e6b', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14 },
  off: { opacity: 0.55 },
  ghost: { backgroundColor: 'rgba(255,255,255,0.9)' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  ghostText: { color: '#16231d' },
});
