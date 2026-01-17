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
// We use 'any' for negotiation payloads to avoid type errors if you haven't updated types.ts yet
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
  const [price, setPrice] = useState("150"); // New Price State
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  
  // --- NEW MARKETPLACE STATES ---
  const [myDrives, setMyDrives] = useState<any[]>([]); // Driver: My Published Routes
  const [matches, setMatches] = useState<any[]>([]);   // Rider: List of Drivers found
  const [riderRequestId, setRiderRequestId] = useState<string>(""); // Rider: Current Request ID
  
  // Driver: Incoming Negotiation Popup
  const [incomingOffer, setIncomingOffer] = useState<any | null>(null);

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
  // 5. SOCKET CONNECTION & NEGOTIATION LOGIC
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
      
      // --- CRITICAL FIX: Register Immediately ---
      // We do NOT wait for 'locationRef.current' to exist.
      // This ensures the Driver joins their room instantly so they can receive offers.
      s.emit("register", { userId, role });

      // Update Location if available (for map markers)
      if (locationRef.current) {
        registerUser(s, userId, role, locationRef.current.lat, locationRef.current.lng);
      }
    });

    s.on("disconnect", (reason) => {
        setSocketStatus("disconnected");
        setSocketDetails(reason);
    });

    // --- DRIVER: Receive Offer from Rider ---
    s.on("negotiate:offer", (data: any) => {
      console.log("💰 Negotiation Received:", data);
      setIncomingOffer(data); // Show Popup
      try { new Audio('/notification.mp3').play().catch(()=>{}); } catch(e){}
    });

    // --- RIDER: Receive Acceptance from Driver ---
    s.on("negotiate:accept", (data: any) => {
      console.log("✅ Driver Accepted:", data);
      alert(`🎉 Driver Accepted! Ride Confirmed for ₹${data.finalPrice}`);
      setMatches([]); // Clear list as we are booked
      setSuccess("Ride Confirmed! Proceed to pickup.");
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

  // Fetch Published Drives (Driver Only)
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
    setMatches([]); // Clear previous matches
    if (!userId) { setFormError("Missing user session."); return; }

    // --- Geocoding Helper ---
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

      // Driver: Calculate Polyline
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
        overview_polyline: overviewPolyline,
        price: role === "driver" ? price : undefined // Send Price if Driver
      };
      
      const res = await fetch(`${backendUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": userId },
        body: JSON.stringify(body),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed.");
      
      if (role === "driver") {
        setSuccess("Route Published!");
      } else {
        // RIDER: Handle Matches List
        setRiderRequestId(data.requestId);
        if (data.matches && data.matches.length > 0) {
            setMatches(data.matches);
            setSuccess(`Found ${data.matches.length} matching drivers!`);
        } else {
            setSuccess("No matches found yet.");
        }
      }
    } catch (err: any) {
      setFormError(err.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  // --- RIDER: NEGOTIATE START ---
  const handleNegotiate = (match: any) => {
      const offerPrice = prompt(`Driver's Price is ₹${match.price}. Enter your offer:`, match.price);
      if (!offerPrice || !socketRef.current) return;

      console.log("📤 Sending Offer to Driver:", match.driverId);
      
      socketRef.current.emit("negotiate:start", {
          targetDriverId: match.driverId,
          riderId: userId,
          requestId: riderRequestId,
          driveId: match.driveId,
          pickup: match.pickup, // pass details for popup context
          dropoff: match.dropoff,
          originalPrice: match.price,
          offeredPrice: offerPrice
      });
      alert("Offer Sent! Waiting for driver response...");
  };

  // --- DRIVER: ACCEPT OFFER ---
  const handleAcceptOffer = () => {
    if (!incomingOffer || !socketRef.current) return;
    
    socketRef.current.emit("negotiate:respond", {
        targetRiderId: incomingOffer.riderId,
        status: "ACCEPTED",
        finalPrice: incomingOffer.offeredPrice
    });
    
    setIncomingOffer(null); // Close popup
    alert("You accepted the ride!");
  };

  if (!isMounted) return null;

  return (
    <div className="fixed inset-0 w-full h-full m-0 p-0">
      <div ref={mapRef} className="w-full h-full" />
      
      {error && <div className="absolute top-2 left-2 bg-white p-2 rounded text-red-600 z-50 shadow">{error}</div>}
      <SocketStatusCard status={socketStatus} userId={userId ?? undefined} details={socketDetails} />

      {/* --- DRIVER POPUP (NEGOTIATION) --- */}
      {incomingOffer && role === "driver" && (
        <div className="absolute top-24 left-0 right-0 mx-auto w-11/12 md:w-96 z-50">
          <Card className="border-4 border-green-500 shadow-2xl bg-white animate-in slide-in-from-top">
            <CardHeader className="bg-green-50 py-3">
              <CardTitle className="text-green-700">💰 New Offer Received</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              <div>
                <span className="text-xs font-bold text-gray-500 uppercase">From Rider</span>
                <p className="text-sm">They want to join your route.</p>
              </div>
              
              <div className="bg-gray-100 p-3 rounded flex justify-between items-center">
                  <div>
                      <p className="text-xs text-gray-500">Your Ask</p>
                      <p className="text-sm line-through text-gray-400">₹{incomingOffer.originalPrice}</p>
                  </div>
                  <div className="text-right">
                      <p className="text-xs text-gray-500">Rider Offers</p>
                      <p className="text-xl font-bold text-green-700">₹{incomingOffer.offeredPrice}</p>
                  </div>
              </div>

              <div className="flex gap-3 mt-4">
                <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={handleAcceptOffer}>Accept</Button>
                <Button className="flex-1" variant="destructive" onClick={() => setIncomingOffer(null)}>Decline</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* --- RIDER MATCH LIST (OVERLAY) --- */}
      {role === "rider" && matches.length > 0 && (
          <div className="absolute top-20 left-4 w-80 max-h-[60vh] overflow-y-auto z-40 space-y-3 pr-2">
              {matches.map((m) => (
                  <Card key={m.driveId} className="shadow-lg border-l-4 border-blue-500 bg-white hover:bg-blue-50 transition-colors">
                      <CardContent className="p-4">
                          <div className="flex justify-between items-center mb-1">
                              <span className="font-bold text-xl text-blue-700">₹{m.price}</span>
                              <span className="text-xs bg-gray-200 px-2 py-1 rounded font-mono">{m.time}</span>
                          </div>
                          <p className="text-xs text-gray-500 mb-3">Driver: {m.driverId.substring(0,8)}...</p>
                          <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => handleNegotiate(m)}>
                              Make Offer / Book
                          </Button>
                      </CardContent>
                  </Card>
              ))}
          </div>
      )}

      {/* --- MAIN FORM (BOTTOM) --- */}
      <div className="absolute bottom-0 left-0 right-0 w-full px-4 pb-4 z-40">
        <Card className="shadow-2xl bg-white/95 backdrop-blur max-h-[60vh] overflow-y-auto">
          <CardHeader>
            <CardTitle>{role === "driver" ? "Publish Route" : "Find a Ride"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="pickup">Pickup</Label>
                    <Input 
                      id="pickup" 
                      ref={pickupRef} 
                      placeholder="Enter location" 
                      required 
                      value={pickupAddr} 
                      onChange={e => { setPickupAddr(e.target.value); setPickupLL(null); }} 
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dropoff">Dropoff</Label>
                    <Input 
                      id="dropoff" 
                      ref={dropoffRef} 
                      placeholder="Enter location" 
                      required 
                      value={dropoffAddr} 
                      onChange={e => { setDropoffAddr(e.target.value); setDropoffLL(null); }} 
                    />
                  </div>
              </div>
              
              <div className="flex flex-wrap gap-2 items-end">
                  <div className="flex-1 min-w-[140px] space-y-1">
                      <Label>Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-start text-left font-normal">
                            {date ? date.toLocaleDateString() : <span>Pick date</span>}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
                        </PopoverContent>
                      </Popover>
                  </div>
                  <div className="w-[120px] space-y-1">
                      <Label>Time</Label>
                      <TimePicker value={time} onChange={setTime} disabled={loading} />
                  </div>
                  
                  {/* Price Input for Driver */}
                  {role === "driver" && (
                      <div className="w-[100px] space-y-1">
                          <Label>Price (₹)</Label>
                          <Input 
                            type="number" 
                            placeholder="150" 
                            value={price} 
                            onChange={e => setPrice(e.target.value)} 
                            className="font-bold"
                          />
                      </div>
                  )}
              </div>

              {formError && <div className="text-red-500 text-sm">{formError}</div>}
              {success && <div className="text-green-600 text-sm">{success}</div>}
              
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Processing..." : (role === "driver" ? "Publish Route" : "Search Available Rides")}
              </Button>
            </form>
            
            {/* Driver's Published List */}
            {role === "driver" && myDrives.length > 0 && (
              <div className="mt-8 border-t pt-4">
                <h3 className="font-semibold text-gray-700 mb-2">Your Active Routes</h3>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {myDrives.map((drive) => (
                    <div key={drive.id} className="p-3 bg-gray-50 rounded border text-sm flex justify-between items-center shadow-sm">
                      <div className="overflow-hidden">
                        <p className="font-bold text-gray-800">{drive.date} @ {drive.time}</p>
                        <p className="text-xs text-gray-500 truncate w-40">{drive.dropoff.address.split(',')[0]}...</p>
                      </div>
                      <div className="text-right">
                          <span className="block font-bold text-green-700">₹{drive.price}</span>
                          <span className="text-[10px] uppercase text-gray-400">{drive.status}</span>
                      </div>
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