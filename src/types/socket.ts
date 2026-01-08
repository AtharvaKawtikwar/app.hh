export interface OfferPayload {
  eventId: string;
  requestId: string;
  riderId: string;
  pickup: { lat: number; lng: number; address?: string };
  dropoff: { lat: number; lng: number; address?: string };
  distanceMeters: number;
}

export interface RideUpdatePayload {
  rideId: string;
  status: "ACCEPTED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  driverId: string;
  riderId: string;
}