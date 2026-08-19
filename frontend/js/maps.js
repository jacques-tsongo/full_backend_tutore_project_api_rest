/* LinkEmploi — cartes Leaflet (tuiles OpenStreetMap).
   Deux modes :
   - data-map-picker : sélecteur cliquable — le clic place/ajuste un marqueur
     et remplit les champs cachés latitude/longitude du formulaire parent ;
   - data-map-static  : affichage informatif d'une position (fiche publique,
     validation admin), sans interaction.
   Leaflet est servi localement (frontend/vendor/leaflet), ce qui ne
   transmet aucune donnée à des serveurs tiers : seules les tuiles OSM sont
   chargées (autorisées par la CSP de l'application). */
(() => {
  'use strict';
  const tiles = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  // Position par défaut : Kinshasa (RDC), domaine de la plateforme.
  const DEFAULT = [-4.325, 15.322];
  const hasPosition = (lat, lng) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));

  const options = () => ({ zoomControl: false, scrollWheelZoom: false });

  const layer = (map) => L.tileLayer(tiles, { maxZoom: 19, attribution }).addTo(map);

  /* Attends que Leaflet soit chargé (scripts defer). */
  const whenReady = (fn) => {
    if (window.L) return fn();
    document.addEventListener('DOMContentLoaded', () => { if (window.L) fn(); });
    // Repli : si Leaflet est déjà présent malgré l'ordre des scripts.
    setTimeout(() => { if (window.L) fn(); }, 300);
  };

  whenReady(() => {
    /* ------------------- Sélecteur de position (formulaire) --------------- */
    document.querySelectorAll('[data-map-picker]').forEach((picker) => {
      const latInput = picker.parentElement.querySelector('[data-map-lat]');
      const lngInput = picker.parentElement.querySelector('[data-map-lng]');
      const coords = picker.parentElement.querySelector('[data-map-coords]');
      if (!latInput || !lngInput) return;

      const start = hasPosition(picker.dataset.lat, picker.dataset.lng)
        ? [Number(picker.dataset.lat), Number(picker.dataset.lng)]
        : DEFAULT;

      const map = L.map(picker, { ...options(), center: start, zoom: hasPosition(picker.dataset.lat, picker.dataset.lng) ? 14 : 6 });
      layer(map);
      L.control.zoom({ position: 'topright' }).addTo(map);

      let marker = null;
      const setPosition = (lat, lng) => {
        if (marker) { marker.setLatLng([lat, lng]); } else { marker = L.marker([lat, lng]).addTo(map); }
        latInput.value = lat.toFixed(7);
        lngInput.value = lng.toFixed(7);
        if (coords) coords.textContent = `Position choisie : ${lat.toFixed(7)}, ${lng.toFixed(7)}`;
      };

      if (hasPosition(picker.dataset.lat, picker.dataset.lng)) setPosition(Number(picker.dataset.lat), Number(picker.dataset.lng));

      // Clic sur la carte → le marqueur suit le clic, les champs cachés
      // latitude/longitude sont synchronisés (envoyés avec le formulaire).
      picker.addEventListener('click', (event) => {
        const point = map.mouseEventToLatLng(event);
        if (point) setPosition(point.lat, point.lng);
      });

      // « Me localiser » : géolocalisation navigateur (avec consentement,
      // refus silencieux) — pratique quand l'entreprise est sur place.
      const locate = document.createElement('button');
      locate.type = 'button';
      locate.className = 'btn ghost map-locate';
      locate.textContent = 'Me localiser';
      locate.addEventListener('click', () => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
          (position) => {
            map.setView([position.coords.latitude, position.coords.longitude], 14);
            setPosition(position.coords.latitude, position.coords.longitude);
          },
          () => { /* autorisation refusée : on garde le comportement manuel */ }
        );
      });
      picker.parentElement.appendChild(locate);
    });

    /* ------------------- Carte statique (fiche / admin) ------------------- */
    document.querySelectorAll('[data-map-static]').forEach((node) => {
      const lat = Number(node.dataset.lat);
      const lng = Number(node.dataset.lng);
      if (!hasPosition(lat, lng)) return;
      const map = L.map(node, { ...options(), center: [lat, lng], zoom: 13, scrollWheelZoom: false });
      layer(map);
      L.marker([lat, lng]).addTo(map);
    });
  });
})();