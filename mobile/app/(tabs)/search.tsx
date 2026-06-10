import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Callout, Marker } from 'react-native-maps';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { colors, fonts } from '../../lib/theme';
import FilterChips, { CareTypeKey, CARE_TYPES } from '../../components/map/FilterChips';
import HostCard, { HostResult } from '../../components/map/HostCard';
import LegacyBanner from '../../components/map/LegacyBanner';

const PROVO_OREM_REGION = {
  latitude: 40.27,
  longitude: -111.68,
  latitudeDelta: 0.3,
  longitudeDelta: 0.3,
};

type HostPin = HostResult & { city_lat: number | null; city_lng: number | null };
type LegacyPin = { id: string; city: string; lat: number; lng: number; count: number };
type CirclePin = { id: string; name: string; lat: number | null; lng: number | null; schedule: string | null };

const VALID_TYPES = CARE_TYPES.map((t) => t.key);

export default function SearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ care_type?: string }>();
  const [filter, setFilter] = useState<CareTypeKey | null>(null);
  const [hosts, setHosts] = useState<HostPin[]>([]);
  const [legacyPins, setLegacyPins] = useState<LegacyPin[]>([]);
  const [circles, setCircles] = useState<CirclePin[]>([]);

  useEffect(() => {
    const t = params.care_type;
    if (t && (VALID_TYPES as string[]).includes(t)) setFilter(t as CareTypeKey);
  }, [params.care_type]);

  const loadHosts = useCallback(async (careType: CareTypeKey | null) => {
    let query = supabase
      .from('profiles_public')
      .select('id, name, city, care_types, hourly_rate_note, city_lat, city_lng, shared_items(count)')
      .in('role', ['host', 'both']);
    if (careType) query = query.contains('care_types', [careType]);
    const { data } = await query;
    setHosts(
      (data ?? []).map((h: any) => ({
        id: h.id,
        name: h.name,
        city: h.city,
        care_types: h.care_types,
        hourly_rate_note: h.hourly_rate_note,
        city_lat: h.city_lat,
        city_lng: h.city_lng,
        shared_count: h.shared_items?.[0]?.count ?? 0,
      })),
    );
  }, []);

  useEffect(() => {
    loadHosts(filter);
  }, [filter, loadHosts]);

  useEffect(() => {
    supabase
      .from('legacy_pins')
      .select('id, city, lat, lng, count')
      .then(({ data }) => setLegacyPins((data as LegacyPin[]) ?? []));
    supabase
      .from('circles')
      .select('id, name, lat, lng, schedule')
      .then(({ data }) => setCircles((data as CirclePin[]) ?? []));
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FilterChips selected={filter} onSelect={setFilter} />
      <MapView style={styles.map} initialRegion={PROVO_OREM_REGION}>
        {hosts
          .filter((h) => h.city_lat != null && h.city_lng != null)
          .map((h) => (
            <Marker
              key={`host-${h.id}`}
              coordinate={{ latitude: h.city_lat!, longitude: h.city_lng! }}
              pinColor={colors.teal}
            >
              <Callout onPress={() => router.push(`/request/${h.id}`)}>
                <View style={styles.callout}>
                  <Text style={styles.calloutTitle}>{h.name}</Text>
                  <Text style={styles.calloutBody}>{h.city ?? 'Nearby'}</Text>
                  {h.hourly_rate_note ? <Text style={styles.calloutBody}>{h.hourly_rate_note}</Text> : null}
                  <Text style={styles.calloutLink}>Request a Link →</Text>
                </View>
              </Callout>
            </Marker>
          ))}
        {legacyPins.map((p) => (
          <Marker key={`legacy-${p.id}`} coordinate={{ latitude: p.lat, longitude: p.lng }} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.legacyDot} />
            <Callout>
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>{p.city}</Text>
                <Text style={styles.calloutBody}>
                  {p.count} first mamas circled up here. Know one? Invite her back.
                </Text>
              </View>
            </Callout>
          </Marker>
        ))}
        {circles
          .filter((c) => c.lat != null && c.lng != null)
          .map((c) => (
            <Marker
              key={`circle-${c.id}`}
              coordinate={{ latitude: c.lat!, longitude: c.lng! }}
              pinColor={colors.purple}
            >
              <Callout>
                <View style={styles.callout}>
                  <Text style={styles.calloutTitle}>{c.name}</Text>
                  {c.schedule ? <Text style={styles.calloutBody}>{c.schedule}</Text> : null}
                </View>
              </Callout>
            </Marker>
          ))}
      </MapView>
      <ScrollView style={styles.list} contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}>
        <LegacyBanner />
        {hosts.length === 0 ? (
          <Text style={styles.empty}>No mamas match yet — try another care type, or invite one you know.</Text>
        ) : (
          hosts.map((h) => <HostCard key={h.id} host={h} onRequest={(id) => router.push(`/request/${id}`)} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  map: { height: 280 },
  list: { flex: 1 },
  callout: { maxWidth: 220, padding: 4 },
  calloutTitle: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink },
  calloutBody: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  calloutLink: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.teal, marginTop: 4 },
  legacyDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.clay, // clay reserved for legacy 1.0 dots only
    borderWidth: 2,
    borderColor: colors.white,
  },
  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 32,
  },
});
