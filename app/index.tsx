import { StyleSheet, Text, View } from 'react-native';

import { localReportDate } from '@/lib/reportDate';

export default function Index() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Crew Intake</Text>
      <Text style={styles.sub}>{localReportDate(new Date(), 'Europe/Vilnius')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  title: { color: '#fff', fontSize: 32, fontWeight: '700' },
  sub: { color: '#aaa', fontSize: 18, marginTop: 8 },
});
