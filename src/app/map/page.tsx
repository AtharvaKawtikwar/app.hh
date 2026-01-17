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

interface MarkerWithId { marker: google.maps.Marker; userId: string; }

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
  
  // Logic Refs
  const mapRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const myMarker = useRef<google.maps.Marker | null>(null);
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
  const [price, setPrice] = useState("150"); 
  
  // --- POOLING STATES ---
  const [seats, setSeats] = useState("3");       // Driver: Total Capacity
  const [passengers, setPassengers] = useState("1"); // Rider: Seats Needed

  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  
  // Marketplace States
  const [myDrives, setMyDrives] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[]>([]); 
  const [riderRequestId, setRiderRequestId] = useState<string>(""); 
  const [incomingOffer, setIncomingOffer] = useState<any | null>(null);

  // ----------------------------------------------------------------
  // 2. MOUNT & INIT
  // ----------------------------------------------------------------
  useEffect(() => {
    setIsMounted(true);
    const storedUserId = localStorage.getItem("userId");
    const storedRole = localStorage.getItem("role") as "driver" | "rider";
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
        (err) => { setError("GPS Error: " + err.message); },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    }
    return () => { if (watchId !== undefined) navigator.geolocation.clearWatch(watchId); };
  }, [isMounted]);

  // ----------------------------------------------------------------
  // 4. MAP & GOOGLE SCRIPT
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!isMounted) return;
    if (window.google && window.google.maps) { initMap(); return; }
    const existingScript = document.querySelector('script[src^="https://maps.googleapis.com/maps/api/js"]');
    if (existingScript) { existingScript.addEventListener('load', initMap); return () => existingScript.removeEventListener('load', initMap); }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`;
    script.async = true; script.defer = true;
    document.head.appendChild(script); script.onload = () => initMap();
  }, [isMounted]);

  const initMap = () => {
    if (!mapRef.current || !window.google) return;
    if (!mapInstance.current) {
      mapInstance.current = new google.maps.Map(mapRef.current, { center: location || { lat: 19.0760, lng: 72.8777 }, zoom: 12, disableDefaultUI: true });
      directionsRenderer.current = new google.maps.DirectionsRenderer({ map: mapInstance.current, suppressMarkers: false, polylineOptions: { strokeColor: "#22c55e", strokeWeight: 5 }});
      myMarker.current = new google.maps.Marker({ position: location || { lat: 19.0760, lng: 72.8777 }, map: mapInstance.current, title: "You", icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#4285F4", fillOpacity: 1, strokeWeight: 2, strokeColor: "white" }});
    }
    initAutocomplete();
  };

  const initAutocomplete = () => {
    if (pickupRef.current && !pickupAutocompleteRef.current) {
        pickupAutocompleteRef.current = new google.maps.places.Autocomplete(pickupRef.current, { fields: ["formatted_address", "geometry"], types: ["address"] });
        pickupAutocompleteRef.current.addListener("place_changed", () => {
            const place = pickupAutocompleteRef.current?.getPlace();
            if (place?.geometry?.location) { setPickupAddr(place.formatted_address || ""); setPickupLL({ lat: place.geometry.location.lat(), lng: place.geometry.location.lng() }); }
        });
    }
    if (dropoffRef.current && !dropoffAutocompleteRef.current) {
        dropoffAutocompleteRef.current = new google.maps.places.Autocomplete(dropoffRef.current, { fields: ["formatted_address", "geometry"], types: ["address"] });
        dropoffAutocompleteRef.current.addListener("place_changed", () => {
            const place = dropoffAutocompleteRef.current?.getPlace();
            if (place?.geometry?.location) { setDropoffAddr(place.formatted_address || ""); setDropoffLL({ lat: place.geometry.location.lat(), lng: place.geometry.location.lng() }); }
        });
    }
  };

  useEffect(() => {
    if (!mapInstance.current || !location || !window.google) return;
    mapInstance.current.setCenter(location);
    if (myMarker.current) myMarker.current.setPosition(location);
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
      setSocketStatus("connected");
      setSocketDetails(`ID: ${s.id}`);
      s.emit("register", { userId, role }); // Immediate Register
      if (locationRef.current) registerUser(s, userId, role, locationRef.current.lat, locationRef.current.lng);
    });
    s.on("disconnect", (reason) => { setSocketStatus("disconnected"); setSocketDetails(reason); });

    // DRIVER: Receive Offer
    s.on("negotiate:offer", (data: any) => {
      console.log("💰 Offer Received:", data);
      setIncomingOffer(data);
      try { new Audio('/notification.mp3').play().catch(()=>{}); } catch(e){}
    });

    // RIDER: Receive Acceptance
    s.on("negotiate:accept", (data: any) => {
      alert(`🎉 Driver Accepted! Booking Confirmed for ₹${data.finalPrice}`);
      setMatches([]); 
      setSuccess("Ride Confirmed! Proceed to pickup.");
    });
    return () => { s.disconnect(); socketRef.current = null; };
  }, [isMounted, userId, role]);

  // Connection Doctor & Fetch Drives (Driver Only)
  useEffect(() => {
    if (!userId || !role) return;
    connectionCheckInterval.current = setInterval(() => { if (socketRef.current && !socketRef.current.connected) socketRef.current.connect(); }, 5000);
    return () => { if (connectionCheckInterval.current) clearInterval(connectionCheckInterval.current); };
  }, [userId, role]);

  useEffect(() => {
    if (!userId || role !== "driver") return;
    const fetchDrives = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/drives`, { headers: { "x-user-id": userId } });
        if (res.ok) { const data = await res.json(); if (Array.isArray(data)) setMyDrives(data); }
      } catch (err) { console.error(err); }
    };
    fetchDrives();
  }, [userId, role, success]);

  // ----------------------------------------------------------------
  // 7. HANDLERS (SUBMIT & NEGOTIATE)
  // ----------------------------------------------------------------
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setFormError(""); setSuccess(""); setMatches([]);
    if (!userId) return;

    const getCoords = async (ll: any, addr: string, uLoc: any) => {
        if (ll) return ll;
        if (addr && window.google) {
            const geocoder = new google.maps.Geocoder();
            try { const res = await geocoder.geocode({ address: addr }); if (res.results[0]) return { lat: res.results[0].geometry.location.lat(), lng: res.results[0].geometry.location.lng() }; } catch (e) {}
        }
        if (!addr && uLoc) return uLoc; return null;
    };

    setLoading(true);
    try {
      const finalPickup = await getCoords(pickupLL, pickupAddr, location);
      const finalDropoff = await getCoords(dropoffLL, dropoffAddr, location);
      if (!finalPickup || !finalDropoff) throw new Error("Could not find coordinates.");

      let overviewPolyline = "";
      if (role === "driver") {
         const ds = new google.maps.DirectionsService();
         try { const result = await ds.route({ origin: finalPickup, destination: finalDropoff, travelMode: google.maps.TravelMode.DRIVING }); if (result.routes[0]) { overviewPolyline = result.routes[0].overview_polyline; directionsRenderer.current?.setDirections(result); } } catch (e: any) { throw new Error("Route failed."); }
      }

      const offset = date ? date.getTimezoneOffset() * 60000 : 0;
      const dateStr = date ? new Date(date.getTime() - offset).toISOString().split('T')[0] : "";
      
      const endpoint = role === "driver" ? "/api/drives" : "/api/requests";
      
      const body = {
        pickup: { lat: finalPickup.lat, lng: finalPickup.lng, address: pickupAddr },
        dropoff: { lat: finalDropoff.lat, lng: finalDropoff.lng, address: dropoffAddr },
        date: dateStr, 
        time, 
        overview_polyline: overviewPolyline, // <--- FIXED HERE
        price: role === "driver" ? price : undefined,
        seats: role === "driver" ? seats : undefined,       // Driver sends Total
        passengers: role === "rider" ? passengers : undefined // Rider sends Need
      };
      
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-user-id": userId }, body: JSON.stringify(body),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed.");
      
      if (role === "driver") { setSuccess("Route Published!"); } 
      else {
        setRiderRequestId(data.requestId);
        if (data.matches?.length > 0) { setMatches(data.matches); setSuccess(`Found ${data.matches.length} matches!`); }
        else { setSuccess("No matches found."); }
      }
    } catch (err: any) { setFormError(err.message); } finally { setLoading(false); }
  }

  // --- RIDER START NEGOTIATION ---
  const handleNegotiate = (match: any) => {
      const offerPrice = prompt(`Driver has ${match.seats} seats. Price ₹${match.price}/seat. Offer:`, match.price);
      if (!offerPrice || !socketRef.current) return;
      socketRef.current.emit("negotiate:start", {
          targetDriverId: match.driverId,
          riderId: userId,
          requestId: riderRequestId,
          driveId: match.driveId,
          seatsNeeded: Number(passengers), // Tell driver how many we need
          pickup: match.pickup,
          dropoff: match.dropoff,
          originalPrice: match.price,
          offeredPrice: offerPrice
      });
      alert("Offer Sent!");
  };

  // --- DRIVER ACCEPT OFFER (CALLS API NOW) ---
  const handleAcceptOffer = async () => {
    if (!incomingOffer) return;
    try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/drives/book`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-user-id": userId! },
            body: JSON.stringify({
                driveId: incomingOffer.driveId,
                requestId: incomingOffer.requestId,
                riderId: incomingOffer.riderId,
                seatsNeeded: incomingOffer.seatsNeeded,
                priceOffered: incomingOffer.offeredPrice
            })
        });
        if (!res.ok) throw new Error("Booking Failed (Seats might be full)");
        
        setIncomingOffer(null);
        alert("Ride Accepted & Seats Deducted!");
        setSuccess("Booking Confirmed.");
    } catch (err: any) {
        alert(err.message);
    }
  };

  if (!isMounted) return null;

  return (
    <div className="fixed inset-0 w-full h-full m-0 p-0">
      <div ref={mapRef} className="w-full h-full" />
      {error && <div className="absolute top-2 left-2 bg-white p-2 rounded text-red-600 z-50 shadow">{error}</div>}
      <SocketStatusCard status={socketStatus} userId={userId ?? undefined} details={socketDetails} />

      {/* --- DRIVER POPUP --- */}
      {incomingOffer && role === "driver" && (
        <div className="absolute top-24 left-0 right-0 mx-auto w-11/12 md:w-96 z-50">
          <Card className="border-4 border-green-500 shadow-2xl bg-white animate-in slide-in-from-top">
            <CardHeader className="bg-green-50 py-3"><CardTitle className="text-green-700">💰 Offer Received</CardTitle></CardHeader>
            <CardContent className="pt-4 space-y-3">
              <div className="flex justify-between">
                <div><p className="text-xs text-gray-500">Rider Wants</p><p className="font-bold">{incomingOffer.seatsNeeded} Seat(s)</p></div>
                <div className="text-right"><p className="text-xs text-gray-500">Total Offer</p><p className="text-xl font-bold text-green-700">₹{incomingOffer.offeredPrice}</p></div>
              </div>
              <div className="flex gap-3 mt-4">
                <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={handleAcceptOffer}>Accept (Book)</Button>
                <Button className="flex-1" variant="destructive" onClick={() => setIncomingOffer(null)}>Decline</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* --- RIDER MATCH LIST --- */}
      {role === "rider" && matches.length > 0 && (
          <div className="absolute top-20 left-4 w-80 max-h-[60vh] overflow-y-auto z-40 space-y-3 pr-2">
              {matches.map((m) => (
                  <Card key={m.driveId} className="shadow-lg border-l-4 border-blue-500 bg-white">
                      <CardContent className="p-4">
                          <div className="flex justify-between items-center mb-1">
                              <span className="font-bold text-xl text-blue-700">₹{m.price}</span>
                              <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded font-bold">{m.seats} Seats Left</span>
                          </div>
                          <p className="text-xs text-gray-500 mb-3">Time: {m.time}</p>
                          <Button size="sm" className="w-full bg-blue-600" onClick={() => handleNegotiate(m)}>Book / Negotiate</Button>
                      </CardContent>
                  </Card>
              ))}
          </div>
      )}

      {/* --- BOTTOM FORM --- */}
      <div className="absolute bottom-0 left-0 right-0 w-full px-4 pb-4 z-40">
        <Card className="shadow-2xl bg-white/95 backdrop-blur max-h-[60vh] overflow-y-auto">
          <CardHeader><CardTitle>{role === "driver" ? "Publish Route" : "Find a Ride"}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="space-y-1"><Label>Pickup</Label><Input ref={pickupRef} value={pickupAddr} onChange={e => { setPickupAddr(e.target.value); setPickupLL(null); }} required /></div>
                  <div className="space-y-1"><Label>Dropoff</Label><Input ref={dropoffRef} value={dropoffAddr} onChange={e => { setDropoffAddr(e.target.value); setDropoffLL(null); }} required /></div>
              </div>
              
              <div className="flex flex-wrap gap-2 items-end">
                  <div className="flex-1 min-w-[120px] space-y-1"><Label>Date</Label><Popover><PopoverTrigger asChild><Button variant="outline" className="w-full text-left font-normal">{date ? date.toLocaleDateString() : "Pick date"}</Button></PopoverTrigger><PopoverContent className="p-0"><Calendar mode="single" selected={date} onSelect={setDate} initialFocus /></PopoverContent></Popover></div>
                  <div className="w-[100px] space-y-1"><Label>Time</Label><TimePicker value={time} onChange={setTime} /></div>
                  
                  {/* SEATS INPUT */}
                  <div className="w-[70px] space-y-1">
                      <Label>{role === "driver" ? "Seats" : "Pasngr"}</Label>
                      <Input type="number" className="text-center font-bold" value={role === "driver" ? seats : passengers} onChange={e => role === "driver" ? setSeats(e.target.value) : setPassengers(e.target.value)} />
                  </div>

                  {role === "driver" && (<div className="w-[80px] space-y-1"><Label>₹ Price</Label><Input type="number" value={price} onChange={e => setPrice(e.target.value)} /></div>)}
              </div>
              
              {formError && <div className="text-red-500 text-sm">{formError}</div>}
              {success && <div className="text-green-600 text-sm">{success}</div>}
              <Button type="submit" className="w-full" disabled={loading}>{loading ? "Processing..." : (role === "driver" ? "Publish Route" : "Search Rides")}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}