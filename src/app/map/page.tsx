"use client";

import { useEffect, useRef, useState } from "react";
import { createSocket } from "@/utils/socket";
import type { Socket } from "socket.io-client";
import { registerUser, UserLocation } from "./socket-map-helpers";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { TimePicker } from "@/components/ui/time-picker";
import { SocketStatusCard } from "@/components/ui/socket-status-card";
import { OfferPayload, RideUpdatePayload } from "@/types/socket";

interface MarkerWithId {
  marker: google.maps.Marker;
  userId: string;
}

export default function MapPage() {
  // ----------------------------------------------------------------
  // 1. STATE & REFS
  // ----------------------------------------------------------------
  const [isMounted, setIsMounted] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<"driver" | "rider" | null>(null);

  // Socket & Map
  const [socketStatus, setSocketStatus] = useState<"connected" | "connecting" | "disconnected">("disconnected");
  const [socketDetails, setSocketDetails] = useState<string>("");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState("");
  const [otherUsers, setOtherUsers] = useState<UserLocation[]>([]);
  
  // Logic Refs
  const mapRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const myMarker = useRef<google.maps.Marker | null>(null);
  const otherMarkers = useRef<MarkerWithId[]>([]);
  const directionsRenderer = useRef<google.maps.DirectionsRenderer | null>(null);
  const locationRef = useRef<{ lat: number; lng: number } | null>(null);

  // Autocomplete Refs
  const pickupRef = useRef<HTMLInputElement>(null);
  const dropoffRef = useRef<HTMLInputElement>(null);
  const pickupAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const dropoffAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  // Form State
  const [pickupAddr, setPickupAddr] = useState("");
  const [dropoffAddr, setDropoffAddr] = useState("");
  const [pickupLL, setPickupLL] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoffLL, setDropoffLL] = useState<{ lat: number; lng: number } | null>(null);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [time, setTime] = useState("12:00");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [incomingOffer, setIncomingOffer] = useState<OfferPayload | null>(null);

  // ----------------------------------------------------------------
  // 2. MOUNT & INIT
  // ----------------------------------------------------------------
  useEffect(() => {
    setIsMounted(true);
    const storedUserId = localStorage.getItem("userId");
    const storedRole = localStorage.getItem("role") as "driver" | "rider";
    if (!storedUserId || !storedRole) setError("Missing User ID/Role. Relogin required.");
    setUserId(storedUserId);
    setRole(storedRole);
  }, []);

  // ----------------------------------------------------------------
  // 3. GEOLOCATION
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!isMounted) return;
    let watchId: number | undefined;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
            const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setLocation(newLoc);
            locationRef.current = newLoc;
        },
        (err) => console.warn("GPS Error:", err.message),
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
      );
    } else {
      setError("Geolocation not supported");
    }
    return () => { if (watchId !== undefined) navigator.geolocation.clearWatch(watchId); };
  }, [isMounted]);

  // ----------------------------------------------------------------
  // 4. SOCKET LOGIC
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!isMounted || !userId || !role) return;
    if (socketRef.current) return;

    setSocketStatus("connecting");
    const s = createSocket(userId, role);
    socketRef.current = s;

    s.on("connect", () => {
      if (socketRef.current === s) {
        setSocketStatus("connected");
        setSocketDetails(`ID: ${s.id}`);
        // Auto-register if location known
        if (locationRef.current) {
          registerUser(s, userId, role, locationRef.current.lat, locationRef.current.lng);
        }
      }
    });

    s.on("disconnect", (reason) => {
        if (socketRef.current === s) {
            setSocketStatus("disconnected");
            setSocketDetails(reason);
        }
    });

    // Handle "Ride Offers" (Driver Only)
    s.on("request:offer", (offer: OfferPayload) => {
      console.log("🔔 NEW OFFER:", offer);
      setIncomingOffer(offer);
      drawRoute(offer.pickup, offer.dropoff); // <--- VISUALIZE THE ROUTE
      try { new Audio('/notification.mp3').play().catch(()=>{}); } catch(e){}
    });

    // Handle "Ride Updates" (Both)
    s.on("ride:update", (update: RideUpdatePayload) => {
      if (update.status === "ACCEPTED") {
        setSuccess("Ride Matched! Navigation starting...");
        setIncomingOffer(null);
        if (directionsRenderer.current) directionsRenderer.current.setMap(null); // Clear preview
      }
    });

    return () => { s.disconnect(); socketRef.current = null; };
  }, [isMounted, userId, role]);

  // Keep location sync alive
  useEffect(() => {
    if (!location || !userId || !role || !socketRef.current) return;
    if (socketRef.current.connected) {
        registerUser(socketRef.current, userId, role, location.lat, location.lng);
    }
  }, [location, userId, role]);

  // ----------------------------------------------------------------
  // 5. MAP & ROUTING
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!isMounted) return;
    if (window.google && window.google.maps) { initMap(); return; }
    
    const existingScript = document.querySelector('script[src^="https://maps.googleapis.com/maps/api/js"]');
    if (existingScript) {
      existingScript.addEventListener('load', initMap);
      return () => existingScript.removeEventListener('load', initMap);
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
    script.onload = () => initMap();
  }, [isMounted]);

  const initMap = () => {
    if (!mapRef.current || !window.google) return;
    if (!mapInstance.current) {
      mapInstance.current = new google.maps.Map(mapRef.current, { 
        center: location || { lat: 42.350876, lng: -71.106918 }, 
        zoom: 15,
        disableDefaultUI: true, 
      });
      directionsRenderer.current = new google.maps.DirectionsRenderer({
        map: mapInstance.current,
        suppressMarkers: false,
        polylineOptions: { strokeColor: "#22c55e", strokeWeight: 5 }
      });
    }
    // Init Autocomplete (pickup/dropoff) ...
    initAutocomplete();
  };

  const initAutocomplete = () => {
    if (pickupRef.current && !pickupAutocompleteRef.current) {
        pickupAutocompleteRef.current = new google.maps.places.Autocomplete(pickupRef.current, { fields: ["formatted_address", "geometry"], types: ["address"] });
        pickupAutocompleteRef.current.addListener("place_changed", () => {
            const place = pickupAutocompleteRef.current?.getPlace();
            if (place?.geometry?.location) {
                setPickupAddr(place.formatted_address || "");
                setPickupLL({ lat: place.geometry.location.lat(), lng: place.geometry.location.lng() });
            }
        });
    }
    if (dropoffRef.current && !dropoffAutocompleteRef.current) {
        dropoffAutocompleteRef.current = new google.maps.places.Autocomplete(dropoffRef.current, { fields: ["formatted_address", "geometry"], types: ["address"] });
        dropoffAutocompleteRef.current.addListener("place_changed", () => {
            const place = dropoffAutocompleteRef.current?.getPlace();
            if (place?.geometry?.location) {
                setDropoffAddr(place.formatted_address || "");
                setDropoffLL({ lat: place.geometry.location.lat(), lng: place.geometry.location.lng() });
            }
        });
    }
  };

  // Helper to draw route for incoming offers
  const drawRoute = (start: {lat:number, lng:number}, end: {lat:number, lng:number}) => {
    if (!mapInstance.current || !window.google) return;
    const ds = new google.maps.DirectionsService();
    ds.route({
        origin: start,
        destination: end,
        travelMode: google.maps.TravelMode.DRIVING
    }, (result, status) => {
        if (status === "OK" && directionsRenderer.current) {
            directionsRenderer.current.setDirections(result);
            directionsRenderer.current.setMap(mapInstance.current); // Show it
        }
    });
  };

  // ----------------------------------------------------------------
  // 6. HANDLERS
  // ----------------------------------------------------------------
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(""); setSuccess("");
    if (!userId) { setFormError("No user session."); return; }
    
    // Resolve locations
    const pickup = pickupLL ?? location;
    const dropoff = dropoffLL ?? location;
    if (!pickup || !dropoff) { setFormError("Invalid locations."); return; }

    setLoading(true);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
      const endpoint = role === "driver" ? "/api/drives" : "/api/requests"; // <--- DYNAMIC ENDPOINT

      const body = {
        pickup: { lat: pickup.lat, lng: pickup.lng, address: pickupAddr },
        dropoff: { lat: dropoff.lat, lng: dropoff.lng, address: dropoffAddr },
        time: `${date?.toISOString().split('T')[0]} ${time}` // Simple time format
      };

      const res = await fetch(`${backendUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": userId },
        body: JSON.stringify(body),
      });
      
      if (!res.ok) throw new Error("Request failed.");
      
      if (role === "driver") {
        setSuccess("Drive Published! Riders can now find you.");
      } else {
        setSuccess("Request sent! Searching for drivers...");
      }
    } catch (err: any) {
      setFormError(err.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  const handleAcceptRide = () => {
    if (!incomingOffer || !socketRef.current) return;
    socketRef.current.emit("request:accept", { 
      requestId: incomingOffer.requestId, 
      eventId: incomingOffer.eventId 
    });
  };

  if (!isMounted) return null;

  return (
    <div className="fixed inset-0 w-full h-full m-0 p-0">
      <div ref={mapRef} className="w-full h-full" />
      <SocketStatusCard status={socketStatus} userId={userId ?? undefined} details={socketDetails} />
      
      {/* GPS Status */}
      <div className="absolute top-4 right-4 bg-white/90 p-2 rounded text-xs z-40 shadow font-mono">
         GPS: {location ? "Active" : "Waiting..."} | Role: {role}
      </div>

      {/* DRIVER OFFER POPUP */}
      {incomingOffer && role === "driver" && (
        <div className="absolute top-24 left-0 right-0 mx-auto w-11/12 md:w-96 z-50">
          <Card className="border-4 border-green-500 shadow-2xl bg-white animate-in slide-in-from-top">
            <CardHeader className="bg-green-50 py-3">
              <CardTitle className="text-green-700">🔔 New Ride Request</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              <p className="text-sm"><strong>Pickup:</strong> {incomingOffer.pickup.address}</p>
              <p className="text-sm"><strong>Dropoff:</strong> {incomingOffer.dropoff.address}</p>
              <p className="text-sm"><strong>Distance:</strong> {(incomingOffer.distanceMeters / 1000).toFixed(1)} km</p>
              <div className="flex gap-3 mt-2">
                <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={handleAcceptRide}>Accept</Button>
                <Button className="flex-1" variant="destructive" onClick={() => {
                   setIncomingOffer(null);
                   if (directionsRenderer.current) directionsRenderer.current.setMap(null); // Clear route
                }}>Decline</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* BOTTOM FORM */}
      <div className="absolute bottom-0 left-0 right-0 w-full px-4 pb-4 z-40">
        <Card className="shadow-2xl bg-white/95 backdrop-blur">
          <CardHeader className="py-4">
            <CardTitle>{role === "driver" ? "Publish a Drive" : "Request a Ride"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                 <Input ref={pickupRef} placeholder="Pickup" value={pickupAddr} onChange={e => setPickupAddr(e.target.value)} />
              </div>
              <div className="space-y-1">
                 <Input ref={dropoffRef} placeholder="Dropoff" value={dropoffAddr} onChange={e => setDropoffAddr(e.target.value)} />
              </div>
              {/* Add Time Picker UI here if needed */}
              
              {formError && <div className="text-red-500 text-sm">{formError}</div>}
              {success && <div className="text-green-600 text-sm font-bold text-center">{success}</div>}
              
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Processing..." : (role === "driver" ? "Publish Drive" : "Find Driver")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}