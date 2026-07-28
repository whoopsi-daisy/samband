'use client';

import { useEffect, useRef, useCallback } from 'react';
import 'leaflet/dist/leaflet.css';

interface MapModalProps {
  isOpen: boolean;
  lat: number;
  lng: number;
  location: string;
  onClose: () => void;
}

export default function MapModal({ isOpen, lat, lng, location, onClose }: MapModalProps) {
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const initMap = async () => {
      const L = await import('leaflet');
      // Note: Leaflet CSS is loaded via CDN in layout.tsx to avoid webpack issues

      if (!mapContainerRef.current) return;

      // Always create a fresh map instance since the DOM container is recreated each time
      mapRef.current = L.map(mapContainerRef.current).setView([lat, lng], 14);
      const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 18,
      }).addTo(mapRef.current);

      // Fallback: if primary tiles fail, switch to OSM
      let hasFallback = false;
      const mapInstance = mapRef.current;
      tileLayer.on('tileerror', () => {
        if (hasFallback) return;
        hasFallback = true;
        mapInstance.removeLayer(tileLayer);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap',
          maxZoom: 19,
        }).addTo(mapInstance);
      });

      const accent =
        getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#165a9b';
      markerRef.current = L.circleMarker([lat, lng], {
        radius: 11,
        fillColor: accent,
        color: '#fff',
        weight: 3,
        opacity: 1,
        fillOpacity: 0.9,
      }).addTo(mapRef.current);

      setTimeout(() => {
        mapRef.current?.invalidateSize();
      }, 100);
      setTimeout(() => {
        mapRef.current?.invalidateSize();
      }, 400);
    };

    initMap();

    // Cleanup: destroy map when modal closes
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markerRef.current = null;
    };
  }, [isOpen, lat, lng]);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleEscape]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mapModalTitle"
    >
      <div className="modal">
        <div className="modal-header">
          <h2 id="mapModalTitle" className="modal-title">{location || 'Plats'}</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Stäng karta">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <div id="modalMap" ref={mapContainerRef} style={{ height: '100%' }} />
        </div>
        <div className="modal-footer">
          <span className="modal-coords">
            {lat}, {lng}
          </span>
          <a
            id="mapModalGoogleLink"
            href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Maps
          </a>
          <a
            id="mapModalAppleLink"
            href={`https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(location || 'Plats')}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Apple Maps
          </a>
        </div>
      </div>
    </div>
  );
}
