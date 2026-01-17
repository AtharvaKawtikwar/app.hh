import { io, Socket } from "socket.io-client";

export function createSocket(userId: string, role: "rider" | "driver"): Socket {
  // Check if NEXT_PUBLIC_BACKEND_URL exists, otherwise fallback to localhost:4000
  // Note: We strip '/api' if your env var includes it, because socket.io needs the base URL
  const baseUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000";
  
  return io(baseUrl, {
    // 1. FORCE WEBSOCKETS (Fixes the disconnection loop)
    transports: ["websocket"], 
    
    // 2. CONNECTION CONFIG
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity, // Keep trying forever
    reconnectionDelay: 1000,       // Wait 1s between retries
    timeout: 20000,                // 20s before giving up
    
    // 3. AUTH QUERY
    query: {
      userId,
      role,
    },
  });
}