function mapTruckTrackingStatus(status) {
  if (status === 'InUse') return 'active';
  if (status === 'Available') return 'idle';
  return 'delayed';
}

function normalizeTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function buildTruckUpdatePayload(truck, location = truck?.currentLocation) {
  if (!truck || !location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
    return null;
  }

  return {
    id: truck._id.toString(),
    lat: location.lat,
    lng: location.lng,
    status: mapTruckTrackingStatus(truck.status),
    lastUpdated: normalizeTimestamp(location.updatedAt),
  };
}

function emitTruckTrackingUpdate(namespace, truck, location = truck?.currentLocation) {
  const payload = buildTruckUpdatePayload(truck, location);
  if (!namespace || !payload) return;

  const legacyLocation = {
    lat: payload.lat,
    lng: payload.lng,
    address: location?.address,
    updatedAt: payload.lastUpdated,
  };

  namespace.to(`truck:${payload.id}`).emit('truck_update', payload);
  namespace.to(`truck:${payload.id}`).emit('locationUpdate', {
    truckId: payload.id,
    location: legacyLocation,
  });

  if (truck.activeBooking) {
    const bookingId = truck.activeBooking.toString();
    namespace.to(`booking:${bookingId}`).emit('truck_update', payload);
    namespace.to(`booking:${bookingId}`).emit('locationUpdate', {
      bookingId,
      truckId: payload.id,
      location: legacyLocation,
    });
  }
}

module.exports = {
  buildTruckUpdatePayload,
  emitTruckTrackingUpdate,
  mapTruckTrackingStatus,
};