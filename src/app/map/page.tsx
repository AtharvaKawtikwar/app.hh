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
// Ensure this path matches your project structure
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
  const locationRef = useRef<{ lat: number; lng: number } | null>(null);
  const connectionCheckInterval = useRef<NodeJS.Timeout | null>(null);
  const directionsRenderer = useRef<google.maps.DirectionsRenderer | null>(null); 

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
  const [time, setTime] = useState("09:00");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  
  // Driver: List of Published Drives
  const [myDrives, setMyDrives] = useState<any[]>([]);

  // Driver: Incoming Request Popup
  const [incomingOffer, setIncomingOffer] = useState<OfferPayload | null>(null);

  // ----------------------------------------------------------------
  // 2. MOUNT & INIT
  // ----------------------------------------------------------------
  useEffect(() => {
    setIsMounted(true);
    const storedUserId = localStorage.getItem("userId");
    const storedRole = localStorage.getItem("role") as "driver" | "rider";
    if (!storedUserId || !storedRole) {
       console.error("No User Found in LocalStorage");
    }
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
      console.log("📍 Starting GPS Watch...");
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
            const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setLocation(newLoc);
            locationRef.current = newLoc;
        },
        (err) => {
          console.warn("GPS Error:", err.message);
          setError("GPS Error: " + err.message);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    } else {
      setError("Geolocation not supported");
    }
    return () => { if (watchId !== undefined) navigator.geolocation.clearWatch(watchId); };
  }, [isMounted]);

  // ----------------------------------------------------------------
  // 4. MAP & GOOGLE SCRIPT
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!isMounted) return;
    
    if (window.google && window.google.maps) {
      initMap();
      return;
    }

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

      myMarker.current = new google.maps.Marker({
        position: location || { lat: 42.350876, lng: -71.106918 },
        map: mapInstance.current,
        title: "You are here",
        icon: { 
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#4285F4",
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: "white",
        },
      });
    }

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

  useEffect(() => {
    if (!mapInstance.current || !location || !window.google) return;
    mapInstance.current.setCenter(location);
    if (myMarker.current) {
      myMarker.current.setPosition(location);
    }
  }, [location]);


  // ----------------------------------------------------------------
  // 5. SOCKET CONNECTION
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!isMounted || !userId || !role) return;
    if (socketRef.current) return;

    setSocketStatus("connecting");
    const s = createSocket(userId, role);
    socketRef.current = s;

    s.on("connect", () => {
      console.log("🟢 Socket Connected:", s.id);
      setSocketStatus("connected");
      setSocketDetails(`ID: ${s.id}`);
      if (locationRef.current) {
        registerUser(s, userId, role, locationRef.current.lat, locationRef.current.lng);
      }
    });

    s.on("disconnect", (reason) => {
        setSocketStatus("disconnected");
        setSocketDetails(reason);
    });

    s.on("request:offer", (offer: OfferPayload) => {
      console.log("🔔🔔🔔 NEW OFFER RECEIVED:", offer);
      setIncomingOffer(offer); 
      try { new Audio('/notification.mp3').play().catch(()=>{}); } catch(e){}
    });

    s.on("ride:update", (update: RideUpdatePayload) => {
      if (update.status === "ACCEPTED") {
         setSuccess("Ride Matched!");
         setIncomingOffer(null);
         alert("Ride matched! Proceeding to pickup.");
      }
    });

    return () => { s.disconnect(); socketRef.current = null; };
  }, [isMounted, userId, role]);

  // Connection Doctor
  useEffect(() => {
    if (!userId || !role) return;
    connectionCheckInterval.current = setInterval(() => {
        if (socketRef.current) {
            if (!socketRef.current.connected) {
                socketRef.current.connect();
            } else if (locationRef.current) {
                registerUser(socketRef.current, userId, role, locationRef.current.lat, locationRef.current.lng);
            }
        }
    }, 5000); 
    return () => { if (connectionCheckInterval.current) clearInterval(connectionCheckInterval.current); };
  }, [userId, role]);

  // Fetch Published Drives
  useEffect(() => {
    if (!userId || role !== "driver") return;
    const fetchDrives = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/drives`, {
          headers: { "x-user-id": userId }
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setMyDrives(data);
        }
      } catch (err) { console.error(err); }
    };
    fetchDrives();
  }, [userId, role, success]);


  // ----------------------------------------------------------------
  // 7. HANDLERS
  // ----------------------------------------------------------------
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSuccess("");
    if (!userId) { setFormError("Missing user session."); return; }

    // Geocoding Helper for fallback
    const getCoords = async (latLng: {lat: number, lng: number} | null, address: string, userLoc: {lat: number, lng: number} | null) => {
        if (latLng) return latLng;
        if (address && window.google) {
            const geocoder = new google.maps.Geocoder();
            try {
                const res = await geocoder.geocode({ address: address });
                if (res.results[0]?.geometry?.location) {
                    return {
                        lat: res.results[0].geometry.location.lat(),
                        lng: res.results[0].geometry.location.lng()
                    };
                }
            } catch (err) { console.warn("Geocoding failed for:", address); }
        }
        if (!address && userLoc) return userLoc;
        return null;
    };

    setLoading(true);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
      const finalPickup = await getCoords(pickupLL, pickupAddr, location);
      const finalDropoff = await getCoords(dropoffLL, dropoffAddr, location);

      if (!finalPickup || !finalDropoff) throw new Error("Could not find coordinates.");

      let overviewPolyline = "";
      if (role === "driver") {
         const ds = new google.maps.DirectionsService();
         try {
             const result = await ds.route({
                origin: finalPickup,
                destination: finalDropoff,
                travelMode: google.maps.TravelMode.DRIVING
             });
             if (result.routes[0]?.overview_polyline) {
                overviewPolyline = result.routes[0].overview_polyline;
                directionsRenderer.current?.setDirections(result);
             }
         } catch (err: any) { throw new Error("Route calculation failed."); }
      }

      // Timezone Fix
      let dateStr = "";
      if (date) {
          const offset = date.getTimezoneOffset() * 60000;
          dateStr = new Date(date.getTime() - offset).toISOString().split('T')[0];
      } else {
          const now = new Date();
          const offset = now.getTimezoneOffset() * 60000;
          dateStr = new Date(now.getTime() - offset).toISOString().split('T')[0];
      }
      
      const endpoint = role === "driver" ? "/api/drives" : "/api/requests";
      
      const body = {
        pickup: { lat: finalPickup.lat, lng: finalPickup.lng, address: pickupAddr },
        dropoff: { lat: finalDropoff.lat, lng: finalDropoff.lng, address: dropoffAddr },
        date: dateStr,
        time: time,
        overview_polyline: overviewPolyline 
      };
      
      const res = await fetch(`${backendUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": userId },
        body: JSON.stringify(body),
      });
      
      if (!res.ok) throw new Error("Submission failed.");
      
      if (role === "driver") {
        setSuccess("Route Published!");
      } else {
        setSuccess("Request Sent! Searching...");
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
      
      {error && <div className="absolute top-2 left-2 bg-white p-2 rounded text-red-600 z-50 shadow">{error}</div>}
      <SocketStatusCard status={socketStatus} userId={userId ?? undefined} details={socketDetails} />

      {/* DRIVER POPUP */}
      {incomingOffer && role === "driver" && (
        <div className="absolute top-24 left-0 right-0 mx-auto w-11/12 md:w-96 z-50">
          <Card className="border-4 border-green-500 shadow-2xl bg-white animate-in slide-in-from-top">
            <CardHeader className="bg-green-50 py-3">
              <CardTitle className="text-green-700">🔔 New Ride Request</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              <div>
                <span className="text-xs font-bold text-gray-500 uppercase">Pickup</span>
                <p className="text-lg font-medium">{incomingOffer.pickup.address || "Location Pinned"}</p>
              </div>
              <div className="flex gap-3 mt-4">
                <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={handleAcceptRide}>Accept</Button>
                <Button className="flex-1" variant="destructive" onClick={() => setIncomingOffer(null)}>Decline</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Bottom Panel */}
      <div className="absolute bottom-0 left-0 right-0 w-full px-4 pb-4 z-40">
        <Card className="shadow-2xl bg-white/95 backdrop-blur max-h-[60vh] overflow-y-auto">
          <CardHeader>
            <CardTitle>{role === "driver" ? "Publish Your Route" : "Request a Ride"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pickup">{role === "driver" ? "Start Location" : "Pickup Location"}</Label>
                <Input 
                  id="pickup" 
                  ref={pickupRef} 
                  placeholder="Enter location" 
                  required 
                  value={pickupAddr} 
                  onChange={e => {
                    setPickupAddr(e.target.value);
                    setPickupLL(null); // <--- FIXED: Clears old specific coords
                  }} 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dropoff">{role === "driver" ? "Destination" : "Drop-off Location"}</Label>
                <Input 
                  id="dropoff" 
                  ref={dropoffRef} 
                  placeholder="Enter location" 
                  required 
                  value={dropoffAddr} 
                  onChange={e => {
                    setDropoffAddr(e.target.value);
                    setDropoffLL(null); // <--- FIXED
                  }} 
                />
              </div>
              
              <div className="space-y-2">
                <Label>Scheduled Date & Time</Label>
                <div className="flex space-x-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-[180px] justify-start text-left font-normal">
                        {date ? date.toLocaleDateString() : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
                    </PopoverContent>
                  </Popover>
                  <TimePicker value={time} onChange={setTime} disabled={loading} />
                </div>
              </div>

              {formError && <div className="text-red-500 text-sm">{formError}</div>}
              {success && <div className="text-green-600 text-sm">{success}</div>}
              
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Processing..." : (role === "driver" ? "Publish Route" : "Find Ride")}
              </Button>
            </form>
            
            {role === "driver" && myDrives.length > 0 && (
              <div className="mt-8 border-t pt-4">
                <h3 className="font-semibold text-gray-700 mb-2">Your Published Routes</h3>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {myDrives.map((drive) => (
                    <div key={drive.id} className="p-3 bg-gray-50 rounded border text-sm flex justify-between items-center shadow-sm">
                      <div className="overflow-hidden">
                        <p className="font-bold text-gray-800">{drive.date} <span className="text-gray-400 font-normal">at</span> {drive.time}</p>
                        <p className="text-xs text-gray-500 truncate w-48">{drive.dropoff.address.split(',')[0]}...</p>
                      </div>
                      <span className="px-2 py-1 rounded text-[10px] uppercase bg-green-100 text-green-700">{drive.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}