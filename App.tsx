import React, { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, TouchableHighlight } from "react-native";
import MapView, { MapPressEvent, Marker, Polyline } from "react-native-maps";
import * as Location from "expo-location";
import { io, Socket } from "socket.io-client";

const SOCKET_SERVER_URL = "https://server-production-3f37.up.railway.app/"; 
const GOMAPS_API_KEY = "AlzaSyBKZA6yQUH-VnRU6njitb5EZetnUOB93Wi"; 

type Coordinate = {
  latitude: number;
  longitude: number;
};

export default function App() {
  const [location, setLocation] = useState<Coordinate | null>(null);
  const [startPoint, setStartPoint] = useState<Coordinate | null>(null);
  const [stopPoint, setStopPoint] = useState<Coordinate | null>(null);
  const [routeCoords, setRouteCoords] = useState<Coordinate[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [destinationQuery, setDestinationQuery] = useState(""); // Recherche de destination
  const [currentLocationInput, setCurrentLocationInput] = useState(""); // Localisation actuelle
  const [suggestions, setSuggestions] = useState<any[]>([]); // Suggestions d'adresses
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const newSocket = io(SOCKET_SERVER_URL, { transports: ["websocket"] });

    newSocket.on("connect", () => {
      console.log("✅ Connecté au serveur WebSocket !");
    });

    newSocket.on("connect_error", (err) => {
      console.error("❌ Erreur de connexion WebSocket :", err);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
      console.log("❌ Déconnecté du serveur WebSocket");
    };
  }, []);

  const startSharingLocation = async () => {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      console.log("❌ Permission de localisation refusée");
      return;
    }

    let loc = await Location.getCurrentPositionAsync({});
    setLocation(loc.coords);
    setStartPoint(loc.coords);
    const newCoords1: Coordinate = {
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude
    };
    // setStartPoint(newCoords);
    setCurrentLocationInput(`Lat: ${newCoords1.latitude}, Lng: ${newCoords1.longitude}`); // Afficher la position actuelle dans l'input
    console.log("📍 Localisation initiale :", newCoords1);
    setIsSharing(true);
   
    console.log("📡 Début du partage de localisation...",newCoords1);

    intervalRef.current = setInterval(async () => {
      let newLocation = await Location.getCurrentPositionAsync({});
      const newCoords: Coordinate = {
        latitude: newLocation.coords.latitude,
        longitude: newLocation.coords.longitude,
      };
      setLocation(newCoords);
      if (socket) {
        socket.emit("busLocationUpdate", newCoords);
        console.log("📡 Localisation envoyée :", newCoords);
        socket.emit("busLocationStart&&StopPoint", { newCoords1, stopPoint });
        console.log("📍 Départ et arrivée envoyés au serveur." );
      }
    }, 30000); // ✅ Envoi toutes les 30 secondes
  };

  const stopSharingLocation = () => {
    setIsSharing(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    console.log("🛑 Arrêt du partage de localisation.");
  };

  const handleMapPress = async (event: MapPressEvent) => {
    const newStopPoint = event.nativeEvent.coordinate;
    setStopPoint(newStopPoint);

    if (socket && startPoint) {
      socket.emit("busLocationStart&&StopPoint", { startPoint, stopPoint: newStopPoint });
      console.log("📍 Départ et arrivée envoyés au serveur.");
    }

    if (startPoint) {
      await fetchRouteFromGoMaps(startPoint, newStopPoint);
    }
  };

  const fetchRouteFromGoMaps = async (start: Coordinate, stop: Coordinate) => {
    const url = `https://maps.gomaps.pro/maps/api/directions/json?origin=${start.latitude},${start.longitude}&destination=${stop.latitude},${stop.longitude}&key=${GOMAPS_API_KEY}`;

    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data.routes && data.routes.length > 0) {
        const points = data.routes[0].overview_polyline.points;
        const decodedCoords = decodePolyline(points);
        setRouteCoords(decodedCoords);
        console.log("✅ Itinéraire trouvé :", decodedCoords);
      } else {
        console.error("❌ Aucune route trouvée :", data);
      }
    } catch (error) {
      console.error("❌ Erreur lors de la récupération de l'itinéraire :", error);
    }
  };

  const fetchSuggestions = async (query: string) => {
    if (query.length < 3) {
      setSuggestions([]); // N'affiche pas de suggestions si la requête est trop courte
      return;
    }

    const url = `https://maps.gomaps.pro/maps/api/place/autocomplete/json?input=${query}&key=${GOMAPS_API_KEY}`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      setSuggestions(data.predictions || []);
    } catch (error) {
      console.error("❌ Erreur de recherche d'adresses :", error);
    }
  };

  const selectAddress = (address: any) => {
    const placeId = address.place_id;
    const url = `https://maps.gomaps.pro/maps/api/place/details/json?placeid=${placeId}&key=${GOMAPS_API_KEY}`;

    fetch(url)
      .then((response) => response.json())
      .then((data) => {
        const location = data.result.geometry.location;
        console.log("✅ Adresse choisie :", location);
        const stopCoord: Coordinate = {
          latitude: location.lat,
          longitude: location.lng,
        };
        setStopPoint(stopCoord);
        setDestinationQuery(address.description);
        setSuggestions([]);
        fetchRouteFromGoMaps(startPoint!, stopCoord);
      })
      .catch((error) => {
        console.error("❌ Erreur lors de la sélection de l'adresse :", error);
      });
  };

  const decodePolyline = (encoded: string) => {
    let points: Coordinate[] = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;

    while (index < len) {
      let b, shift = 0, result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      let dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      let dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
      lng += dlng;

      points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
    }

    return points;
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>🚍 Bus Tracker</Text>

      {/* Champ de saisie pour la localisation actuelle */}
      <TextInput
       style={styles.searchInput}
       placeholder="Your current location"
       value={currentLocationInput}
       onChangeText={(text) => setCurrentLocationInput(text)}
        editable={false}  // Ne pas permettre la modification
      />
     
      {/* Champ de recherche de destination */}
      <TextInput
        style={styles.searchInput}
        placeholder="Enter destination"
        value={destinationQuery}
        onChangeText={(text) => {
          setDestinationQuery(text);
          fetchSuggestions(text);
        }}
      />

      {/* Liste des suggestions d'adresses */}
      {suggestions.length > 0 && (
        <FlatList
          data={suggestions}
          keyExtractor={(item) => item.place_id}
          renderItem={({ item }) => (
            <TouchableHighlight
              onPress={() => selectAddress(item)}
              underlayColor="#cecece" 
              style={styles.suggestionItem}
            >
              <Text>{item.description}</Text>
            </TouchableHighlight>
          )}
        />
      )}

      <TouchableOpacity
        style={styles.shareButton}
        onPress={isSharing ? stopSharingLocation : startSharingLocation}
      >
        <Text style={styles.shareButtonText}>
          {isSharing ? "🛑 Stop Sharing" : "📡 Start Sharing"}
        </Text>
      </TouchableOpacity>

      {location ? (
        <MapView 
          initialRegion={{
            latitude: location.latitude,
            longitude: location.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }} 
          style={styles.map}
          onPress={handleMapPress}
        >
          {startPoint && <Marker coordinate={startPoint} title="Start Location" pinColor="blue" />}
          {stopPoint && <Marker coordinate={stopPoint} title="Stop Location" pinColor="green" />}
          <Marker coordinate={location} title="Bus Location" pinColor="purple" />
          
          {routeCoords.length > 0 && (
            
  <Polyline coordinates={routeCoords} strokeWidth={4} strokeColor="red" />
)}


        </MapView>
      ) : (
        <Text style={styles.infoText}>Press "Start Sharing" to begin tracking.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 40, backgroundColor: "#f8f9fa" },
  header: { textAlign: "center", fontSize: 24, fontWeight: "bold", color: "#333", marginBottom: 10 },
  map: { flex: 1, margin: 10, borderRadius: 15 },
  shareButton: {
    backgroundColor: "#007bff",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 25,
    alignSelf: "center",
    marginBottom: 15,
    elevation: 19,
  },
  shareButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  searchInput: {
    height: 40,
    borderColor: "#ddd",
    borderWidth: 1,
    borderRadius: 5,
    margin: 10,
    paddingLeft: 10,
  },
  suggestionItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
  },
 
  infoText: {
    textAlign: "center",
    fontSize: 16,
    color: "#555",
    marginTop: 20,
  },
});
