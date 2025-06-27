import React, { useEffect, useState, useRef  } from "react";
import { View, Text, Button, StyleSheet, Dimensions, Alert, TouchableOpacity } from "react-native";
import MapView, { Marker, Circle, Polygon } from "react-native-maps";
import Slider from "@react-native-community/slider";
import * as Location from "expo-location";
import axios from "axios";
import { debounce } from "lodash";

const TEST_LAT = 53.467;
const TEST_LON = 9.837;

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => deg * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export default function MapScreen() {
  const [region, setRegion] = useState({
    latitude: TEST_LAT,
    longitude: TEST_LON,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });

  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [manualMarker, setManualMarker] = useState({ latitude: TEST_LAT, longitude: TEST_LON });
  const [radius, setRadius] = useState(5000);

  const [mode, setMode] = useState("wc");
  const [markers, setMarkers] = useState([]);
  const [greenPolygons, setGreenPolygons] = useState([]);
  const [showGreens, setShowGreens] = useState(true);
  const locationWatcher = useRef(null);
  const fetchIntervalRef = useRef(null);
  const watcherRef = useRef(null);
  

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Denied", "Location access required.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      setRegion({
        ...region,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    } catch (err) {
      console.error("Location Error", err);
    }
  };



  useEffect(() => {
  if (gpsEnabled) {
    // ✅ Clear existing interval if already running
    if (fetchIntervalRef.current) {
      clearInterval(fetchIntervalRef.current);
    }

    // ✅ Set a new interval to fetch data every 60 seconds
    fetchIntervalRef.current = setInterval(() => {
      console.log("[GPS] Performing scheduled fetch");

      if (mode === "wc") {
        fetchWCMarkers();
      } else if (mode === "gas") {
        fetchGasStations();
      } else if (mode === "food") {
        fetchFoodSpots();
      }

      if (showGreens) {
        fetchGreenAreas();
      }
    }, 60000); // 60,000 ms = 60 seconds
  } else {
    // ❌ Clear interval if GPS is turned off
    if (fetchIntervalRef.current) {
      clearInterval(fetchIntervalRef.current);
      fetchIntervalRef.current = null;
    }
  }

  // 🔄 Cleanup on unmount or change
  return () => {
    if (fetchIntervalRef.current) {
      clearInterval(fetchIntervalRef.current);
      fetchIntervalRef.current = null;
    }
  };
}, [gpsEnabled, mode, showGreens, radius]);

useEffect(() => {
  const setupGPS = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Denied", "Location access required.");
      return;
    }

    const loc = await Location.getCurrentPositionAsync({});
    setRegion((prev) => ({
      ...prev,
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    }));

    if (locationWatcher.current) {
      await locationWatcher.current.remove();
    }

    locationWatcher.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 30000,
        distanceInterval: 50,
      },
      (loc) => {
        setRegion((prev) => ({
          ...prev,
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        }));
      }
    );
  };

  if (gpsEnabled) {
    setupGPS();
  } else {
    if (locationWatcher.current) {
      locationWatcher.current.remove();
      locationWatcher.current = null;
    }
  }

  return () => {
    if (locationWatcher.current) {
      locationWatcher.current.remove();
      locationWatcher.current = null;
    }
  };
}, [gpsEnabled]);

  const fetchWCMarkers = async () => {
    const query = `[out:json];node["amenity"="toilets"](around:${radius},${region.latitude},${region.longitude});out;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

    try {
      const response = await axios.get(url);
      const data = response.data.elements.map((el) => {
        const tags = el.tags || {};
        const fee = tags.fee?.toLowerCase() || "unknown";
        const opening = tags.opening_hours || "Unknown";
        let color = fee === "no" || fee === "free" ? "blue" : "red";
        return {
          id: el.id,
          lat: el.lat,
          lon: el.lon,
          name: tags.name || "Public Toilet",
          description: `Fee: ${fee} | Hours: ${opening}`,
          color,
        };
      });
      setMarkers(data);
    } catch (err) {
      console.error("Overpass API error (WC):", err?.response?.status || err.message);
    }
  };
  const fetchGasStations = async () => {
    const center = gpsEnabled ? region : manualMarker; // ✅ NEW
    const query = `[out:json];node["amenity"="toilets"](around:${radius},${center.latitude},${center.longitude});out;`; // ✅ UPDATED
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    try {
      const response = await axios.get(url);
      const data = response.data.elements.map((el) => ({
        id: el.id,
        lat: el.lat,
        lon: el.lon,
        name: el.tags?.name || "Gas Station",
        color: "orange",
        description: "Fuel Station"
      }));
      setMarkers(data);
    } catch (err) {
      console.error("Overpass API error (Gas):", err);
    }
  };

  const fetchFoodSpots = async () => {
    const center = gpsEnabled ? region : manualMarker;

    const query = `
    [out:json];
    (
        node["amenity"="fast_food"](around:${radius},${center.latitude},${center.longitude});
        node["amenity"="restaurant"]["cuisine"~"pizza|burger|chinese|mexican|asian|kebab"](around:${radius},${center.latitude},${center.longitude});
        node["amenity"="restaurant"]["name"~"McDonald|KFC|Subway|Domino|Burger King|Pizza Hut"](around:${radius},${center.latitude},${center.longitude});
    );
    out;
    `;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    try {
      const response = await axios.get(url);
      const data = response.data.elements.map((el) => {
        const name = el.tags?.name || "";
        const cuisine = el.tags?.cuisine || "";
        const brand = el.tags?.brand || "";
        const takeaway = el.tags?.takeaway || "";
        const opening = el.tags?.opening_hours || "";

        let color = "gray";
        const nameLower = name.toLowerCase();
        const cuisineLower = cuisine.toLowerCase();
        if (nameLower.includes("mcdonald")) color = "green";
        else if (["asian", "chinese", "thai"].some((c) => cuisineLower.includes(c))) color = "blue";
        else if (cuisineLower.includes("pizza")) color = "orange";

        return {
          id: el.id,
          lat: el.lat,
          lon: el.lon,
          name: name || cuisine.toUpperCase() || "Food Place",
          color,
          description: [
            opening ? `Open: ${opening}` : "",
            cuisine ? `Cousine: ${cuisine}` : "",
            brand ? `Brand: ${brand}` : "",
            takeaway ? `Takeaway: ${takeaway}` : "",
          ].filter(Boolean).join(" | ")
        };
      });
      setMarkers(data);
    } catch (err) {
      console.error("Overpass API error (Food):", err?.response?.status || err.message);
    }
  };

  const fetchGreenAreas = async () => {
    const center = gpsEnabled ? region : manualMarker;

    const query = `
    [out:json];
    (
        way["leisure"="park"](around:${radius},${center.latitude},${center.longitude});
        way["leisure"="playground"](around:${radius},${center.latitude},${center.longitude});
        way["leisure"="fitness_station"](around:${radius},${center.latitude},${center.longitude});
        way["leisure"="nature_reserve"](around:${radius},${center.latitude},${center.longitude});
    );
    (._;>;);
    out;
    `;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

    try {
      const response = await axios.get(url);
      const nodes = {};
      const polygons = [];

      for (const el of response.data.elements) {
        if (el.type === "node") nodes[el.id] = { latitude: el.lat, longitude: el.lon };
      }

      for (const el of response.data.elements) {
        if (el.type === "way" && el.nodes?.length >= 3) {
          const coords = el.nodes.map((id) => nodes[id]).filter(Boolean);
          const leisure = el.tags?.leisure || "";

          let strokeColor = "#008000";
          let fillColor = "rgba(0,255,0,0.2)";
          if (leisure === "nature_reserve") {
            strokeColor = "#006400";
            fillColor = "rgba(0,100,0,0.05)";
          } else if (leisure === "park") {
            strokeColor = "#004d00";
            fillColor = "rgba(0,128,0,0.2)";
          } else if (leisure === "playground") {
            strokeColor = "#cccc00";
            fillColor = "rgba(255,255,0,0.3)";
          } else if (leisure === "fitness_station") {
            strokeColor = "#0000cc";
            fillColor = "rgba(0,0,255,0.2)";
          }

          polygons.push({ id: el.id, coordinates: coords, strokeColor, fillColor });
        }
      }
      setGreenPolygons(polygons);
    } catch (err) {
      console.error("Overpass API error (Green):", err.message);
    }
  };

useEffect(() => {
  const debouncedFetch = debounce(() => {
    if (mode === "wc") fetchWCMarkers();
    else if (mode === "gas") fetchGasStations();
    else if (mode === "food") fetchFoodSpots();
    if (showGreens) fetchGreenAreas();
  }, 800);

  debouncedFetch();

  return () => debouncedFetch.cancel();
}, [radius, region, mode, showGreens]);

  return (
    <View style={styles.container}>
      <MapView
  style={styles.map}
  region={region}
  onLongPress={(e) => {
    if (!gpsEnabled) {
      const { latitude, longitude } = e.nativeEvent.coordinate;
      setManualMarker({ latitude, longitude });
      setRegion({ ...region, latitude, longitude });
    }
  }}
>
  {/* 🟩 Green Area Polygons */}
  {showGreens && greenPolygons.map((poly) => (
    <Polygon
      key={poly.id}
      coordinates={poly.coordinates}
      strokeColor={poly.strokeColor}
      fillColor={poly.fillColor}
      strokeWidth={2}
    />
  ))}

  {/* 🟡 Radius Circle */}
  <Circle
    center={{ latitude: region.latitude, longitude: region.longitude }}
    radius={radius}
    strokeColor="rgba(255, 200, 0, 0.8)"
    fillColor="rgba(0,144, 255, 0.1)"
  />

  {/* 📍 Manual Pin Marker (when GPS is off) */}
  {!gpsEnabled && manualMarker && (
    <Marker
      coordinate={manualMarker}
      title="Custom Location"
      description="Manual pin location"
      pinColor="purple"
    />
  )}

  {/* 📌 POI Markers (toilets, food, gas) */}
  {markers.map((marker) => {
    const dist = haversineDistance(
      region.latitude,
      region.longitude,
      marker.lat,
      marker.lon
    );

    let opacity = 1.0;
    if (dist > radius * 0.6 && dist <= radius * 0.85) opacity = 0.5;
    else if (dist > radius * 0.85) opacity = 0.25;

    return (
      <Marker
        key={marker.id}
        coordinate={{ latitude: marker.lat, longitude: marker.lon }}
        title={marker.name}
        description={marker.description}
        pinColor={marker.color || "gray"}
        opacity={opacity}
      />
    );
  })}
</MapView>

      <View style={styles.buttonWrapper}>
        <Button title="WC" onPress={() => setMode("wc")} />
        <Button title="Gas" onPress={() => setMode("gas")} />
        <Button title="Food" onPress={() => setMode("food")} />
        <Button title="Green" onPress={() => setShowGreens(!showGreens)} />
        <Button title={gpsEnabled ? "📍 Manual" : "📡 Live"} onPress={() => setGpsEnabled(!gpsEnabled)} />
      </View>

      <View style={styles.sliderWrapper}>
        <Slider
          style={{ width: 200, height: 40 }}
          minimumValue={5000}
          maximumValue={20000}
          step={100}
          value={radius}
          onValueChange={(val) => setRadius(val)}
          minimumTrackTintColor="#007AFF"
          maximumTrackTintColor="#ccc"
          thumbTintColor="#007AFF"
        />
        <View style={styles.radiusLabel}>
          <Text style={styles.radiusLabelText}>KM: {(radius / 1000).toFixed(1)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: {
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height,
  },
  buttonWrapper: {
    position: "absolute",
    bottom: 50,
    left: 20,
    right: 20,
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    padding: 10,
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "space-around",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  sliderWrapper: {
    position: "absolute",
    top: 350,
    left: -80,
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    transform: [{ rotate: "-90deg" }],
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3.84,
  },
  radiusLabel: {
    marginTop: 6,
    alignItems: "center",
    opacity: 0.6,
  },
  radiusLabelText: {
    fontSize: 10,
    color: "#333",
    fontWeight: "600",
  },
});
