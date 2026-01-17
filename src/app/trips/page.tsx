"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, MapPin, Clock, CalendarIcon, MessageSquare, Car } from "lucide-react"; 
import Link from "next/link";
import { createSocket } from "@/utils/socket"; 
import type { Socket } from "socket.io-client";
import ChatWindow from "@/components/ChatWindow"; 

export default function TripsPage() {
  const [trips, setTrips] = useState<any[]>([]);
  const [role, setRole] = useState<"driver" | "rider">("rider");
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // --- CHAT STATE ---
  const [socket, setSocket] = useState<Socket | null>(null);
  const [activeDriveId, setActiveDriveId] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);

  useEffect(() => {
    // 1. Get User Data
    const storedRole = localStorage.getItem("role") as any;
    const storedUserId = localStorage.getItem("userId");
    setRole(storedRole);
    setUserId(storedUserId);

    if (storedRole) fetchTrips(storedRole);

    // 2. Initialize Socket for Chat (Independent of Map)
    if (storedUserId && storedRole) {
        const s = createSocket(storedUserId, storedRole);
        setSocket(s);
        
        // Cleanup on unmount
        return () => {
            s.disconnect();
        };
    }
  }, []);

  const fetchTrips = async (currentRole: string) => {
    const uid = localStorage.getItem("userId");
    try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/drives/trips?role=${currentRole}`, {
            headers: { "x-user-id": uid! }
        });
        if (res.ok) {
            const data = await res.json();
            setTrips(data);
        }
    } catch (err) {
        console.error(err);
    } finally {
        setLoading(false);
    }
  };

  const updateStatus = async (driveId: string, newStatus: string) => {
     const uid = localStorage.getItem("userId");
     // Optimistic UI Update
     setTrips(prev => prev.map(t => t.id === driveId ? { ...t, status: newStatus } : t));

     await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/drives/${driveId}/status`, {
         method: "PATCH",
         headers: { "Content-Type": "application/json", "x-user-id": uid! },
         body: JSON.stringify({ status: newStatus })
     });
     
     // Refresh to be safe
     fetchTrips(role); 
  };

  const openChat = (driveId: string) => {
      setActiveDriveId(driveId);
      setIsChatOpen(true);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8 relative">
      <div className="max-w-2xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-800">My Trips</h1>
            <Link href="/map">
                <Button variant="outline" size="sm" className="gap-2">
                    <ArrowLeft className="h-4 w-4" /> Back to Map
                </Button>
            </Link>
        </div>
        
        {loading && (
            <div className="space-y-4">
                {[1,2].map(i => <div key={i} className="h-48 bg-gray-200 rounded-xl animate-pulse" />)}
            </div>
        )}

        {/* --- OPTION B: POLISHED EMPTY STATE --- */}
        {!loading && trips.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white border-2 border-dashed border-gray-200 rounded-xl">
                <div className="bg-blue-50 p-4 rounded-full mb-4 ring-8 ring-blue-50/50">
                     <Car className="h-10 w-10 text-blue-500" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">No trips found</h3>
                <p className="text-gray-500 max-w-sm mb-6">
                    {role === 'driver' 
                        ? "You haven't published any routes yet. Share your ride and start saving!" 
                        : "You haven't booked any rides. Search for a destination to get started."}
                </p>
                <Link href="/map">
                    <Button className="bg-blue-600 hover:bg-blue-700 px-8">
                        {role === 'driver' ? "Publish a Route" : "Find a Ride"}
                    </Button>
                </Link>
            </div>
        )}

        {/* Trip Cards */}
        <div className="space-y-4">
            {trips.map((trip) => (
                <Card key={trip.id} className="shadow-sm hover:shadow-md transition-all border-l-4 border-l-blue-500 bg-white">
                <CardHeader className="flex flex-row justify-between items-start pb-2">
                    <div>
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <CalendarIcon className="h-4 w-4 text-gray-400" />
                            {trip.date}
                        </CardTitle>
                        <p className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                            <Clock className="h-3 w-3" /> {trip.time}
                        </p>
                    </div>
                    <Badge variant={
                        trip.status === "completed" ? "secondary" : 
                        trip.status === "started" ? "destructive" : "default"
                    } className="capitalize px-3 py-1">
                        {trip.status === "active" ? "Scheduled" : trip.status}
                    </Badge>
                </CardHeader>
                
                <CardContent className="space-y-4">
                    <div className="relative pl-6 border-l-2 border-gray-200 ml-1 space-y-6">
                        {/* Pickup */}
                        <div className="relative">
                            <div className="absolute -left-[29px] top-1 h-3 w-3 rounded-full bg-blue-500 ring-4 ring-white" />
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Pickup</p>
                            <p className="text-sm font-medium text-gray-800 line-clamp-1">{trip.pickup?.address}</p>
                        </div>
                        {/* Dropoff */}
                        <div className="relative">
                            <div className="absolute -left-[29px] top-1 h-3 w-3 rounded-full bg-red-500 ring-4 ring-white" />
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Dropoff</p>
                            <p className="text-sm font-medium text-gray-800 line-clamp-1">{trip.dropoff?.address}</p>
                        </div>
                    </div>

                    {/* Stats Row */}
                    <div className="flex gap-4 mt-2 bg-gray-50 p-3 rounded-lg text-xs">
                         <div><span className="block font-bold text-gray-500">Price</span>₹{trip.price || 150}</div>
                         {role === "driver" && (
                            <div><span className="block font-bold text-gray-500">Seats</span>{trip.availableSeats}/{trip.totalSeats} Left</div>
                         )}
                    </div>
                </CardContent>
                
                <CardFooter className="flex justify-between items-center pt-0 pb-4 pr-6 pl-6">
                    {/* --- OPTION A: CHAT BUTTON (FIXED LOGIC) --- */}
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => openChat(trip.driveId || trip.id)} 
                        className="gap-2"
                    >
                        <MessageSquare className="h-4 w-4" /> Chat
                    </Button>

                    {role === "driver" && trip.status !== "completed" && (
                        <div className="flex gap-2">
                            {trip.status !== "started" && (
                                <Button size="sm" onClick={() => updateStatus(trip.id, "started")} className="bg-green-600 hover:bg-green-700 text-white">
                                    Start Trip
                                </Button>
                            )}
                            {trip.status === "started" && (
                                <Button size="sm" onClick={() => updateStatus(trip.id, "completed")} className="bg-gray-800 text-white">
                                    Complete Trip
                                </Button>
                            )}
                        </div>
                    )}
                </CardFooter>
                </Card>
            ))}
        </div>
      </div>

      {/* --- CHAT POPUP --- */}
      {isChatOpen && activeDriveId && socket && userId && role && (
          <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-10">
              <ChatWindow 
                socket={socket}
                driveId={activeDriveId}
                userId={userId}
                role={role}
                onClose={() => setIsChatOpen(false)}
              />
          </div>
      )}
    </div>
  );
}