(() => {
  "use strict";

  const config = window.JOIE_CONFIG || {};
  const CURRENT_LANG = config.lang || "nl";
  const TEXT = config.text || {};
  const STORES_JSON_URL = config.storesJsonUrl || "./stores.json";
  const LOCALE = config.locale || (CURRENT_LANG === "fr" ? "fr-BE" : "nl-BE");
  const GOOGLE_MAPS_HL = config.googleMapsHl || CURRENT_LANG;
  const NOMINATIM_COUNTRYCODES = "be,lu";
  const DEFAULT_VIEW = config.defaultView || {
    center: CURRENT_LANG === "fr" ? [50.42, 5.12] : [51.05, 4.45],
    zoom: 8
  };

  const PIN_ICON = "<svg class=\"pin-icon\" viewBox=\"0 0 48 48\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M24 4C15.7 4 9 10.7 9 19c0 10.2 12.5 23.2 13.7 24.4.7.7 1.9.7 2.6 0C26.5 42.2 39 29.2 39 19 39 10.7 32.3 4 24 4Zm0 22.2A7.2 7.2 0 1 1 24 11.8a7.2 7.2 0 0 1 0 14.4Z\"/><circle cx=\"24\" cy=\"19\" r=\"4.2\" fill=\"#fff\"/></svg>";

  let stores = [];
  let userLocation = null;
  let lastSortedStores = null;
  let map = null;
  let markerCluster = null;
  let referenceMarker = null;
  let markersByStoreId = new Map();
  let activeStoreId = null;
  let mapCollapsed = false;
  let mapResizeTimer = null;

  try {
    window.localStorage.setItem("joie_language", CURRENT_LANG);
  } catch (error) {
    // Local storage can be blocked by browser settings. The store locator still works without it.
  }

  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#039;",
      '"': "&quot;"
    }[char]));
  }

  function normalizeText(value) {
    return String(value ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toFiniteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
    return Number.isFinite(number) ? number : null;
  }

  function hasValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== "";
  }

  function safeExternalUrl(value) {
    if (!hasValue(value)) return "";

    try {
      const url = new URL(String(value).trim(), window.location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch (error) {
      return "";
    }
  }

  function hasCoordinates(store) {
    return toFiniteNumber(store.lat) !== null && toFiniteNumber(store.lng) !== null;
  }

  function localizedStore(store) {
    if (CURRENT_LANG === "fr") {
      return {
        name: store.name_fr || store.name || "",
        address: store.address_fr || store.address || "",
        city: store.city_fr || store.city || "",
        country: store.country_fr || store.country || "",
        category: store.category_fr || store.category || "",
        website: store.website_fr || store.website || store.website_nl || "",
        googleMapsUrl: store.google_maps_url_fr || store.google_maps_url || store.google_maps_url_nl || ""
      };
    }

    return {
      name: store.name || store.name_fr || "",
      address: store.address || store.address_fr || "",
      city: store.city || store.city_fr || "",
      country: store.country || store.country_fr || "",
      category: store.category || store.category_fr || "",
      website: store.website_nl || store.website || store.website_fr || "",
      googleMapsUrl: store.google_maps_url_nl || store.google_maps_url || store.google_maps_url_fr || ""
    };
  }

  function getGoogleMapsUrl(store) {
    const local = localizedStore(store);
    const lat = toFiniteNumber(store.lat);
    const lng = toFiniteNumber(store.lng);
    const destination = lat !== null && lng !== null
      ? `${lat},${lng}`
      : [local.name, local.address, local.city, local.country].filter(hasValue).join(", ");

    if (destination) {
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving&hl=${GOOGLE_MAPS_HL}`;
    }

    return hasValue(local.googleMapsUrl) ? String(local.googleMapsUrl).trim() : "";
  }

  function getStoreSearchFields(store) {
    const local = localizedStore(store);
    return [
      store.name,
      store.name_fr,
      local.name,
      store.address,
      store.address_fr,
      local.address,
      store.postalCode,
      store.postcode,
      store.city,
      store.city_fr,
      local.city,
      store.country,
      store.country_fr,
      local.country,
      store.category,
      store.category_fr,
      local.category
    ].filter(hasValue).join(" ");
  }

  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function showStatus(message, type = "info") {
    const statusDiv = qs("#statusMessage");
    if (!statusDiv) return;

    statusDiv.innerHTML = `<div class="status-message status-${type}">${escapeHtml(message)}</div>`;

    if (type === "success" || type === "error") {
      window.setTimeout(() => {
        statusDiv.innerHTML = "";
      }, 5500);
    }
  }

  function clearStatus() {
    const statusDiv = qs("#statusMessage");
    if (statusDiv) statusDiv.innerHTML = "";
  }

  function createMarkerIcon(active = false) {
    return L.divIcon({
      className: active ? "joie-map-marker is-active" : "joie-map-marker",
      html: "<span class=\"joie-map-marker-pin\"></span>",
      iconSize: [34, 42],
      iconAnchor: [17, 40],
      popupAnchor: [0, -34]
    });
  }

  function createReferenceIcon() {
    return L.divIcon({
      className: "joie-reference-marker",
      html: "<span></span>",
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
  }

  function configureMapInteractions() {
    if (!map) return;

    const container = map.getContainer();
    map.dragging.enable();
    map.touchZoom.enable();
    map.doubleClickZoom.enable();
    if (map.tap) map.tap.enable();
    container.style.touchAction = "";
  }

  function handleMapResize() {
    window.clearTimeout(mapResizeTimer);
    mapResizeTimer = window.setTimeout(() => {
      configureMapInteractions();
      if (map) map.invalidateSize();
    }, 120);
  }

  function getPopupHtml(store) {
    const local = localizedStore(store);
    const mapsUrl = safeExternalUrl(getGoogleMapsUrl(store));
    const website = safeExternalUrl(local.website);

    return `
      <div class="map-popup">
        <strong>${escapeHtml(local.name)}</strong>
        ${hasValue(local.address) ? `<span>${escapeHtml(local.address)}</span>` : ""}
        <div class="map-popup-actions">
          ${mapsUrl ? `<a class="btn-maps" href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener">${TEXT.maps}</a>` : ""}
          ${website ? `<a class="btn-website" href="${escapeHtml(website)}" target="_blank" rel="noopener">${TEXT.webshop}</a>` : ""}
        </div>
      </div>`;
  }

  function initMap() {
    const mapEl = qs("#storeMap");
    if (!mapEl || typeof L === "undefined") return;

    map = L.map(mapEl, {
      center: DEFAULT_VIEW.center,
      zoom: DEFAULT_VIEW.zoom,
      zoomSnap: 0.25,
      scrollWheelZoom: false,
      tap: true,
      touchZoom: true,
      dragging: true,
      attributionControl: false,
      zoomControl: false
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.attribution({
      prefix: false,
      position: "bottomright"
    }).addTo(map);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      subdomains: "abcd",
      referrerPolicy: "strict-origin-when-cross-origin",
      r: L.Browser.retina ? "@2x" : "",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> &middot; &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
    }).addTo(map);

    configureMapInteractions();
    window.addEventListener("resize", handleMapResize);

    markerCluster = typeof L.markerClusterGroup === "function"
      ? L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 14,
        maxClusterRadius: 46,
        removeOutsideVisibleBounds: true
      })
      : L.featureGroup();

    map.addLayer(markerCluster);

    window.setTimeout(() => map.invalidateSize(), 120);
  }

  function setDefaultMapView() {
    if (map) map.flyTo(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom, { duration: 0.65 });
  }

  function updateMapCounter(count) {
    const fitButton = qs("#mapFitButton");
    if (!fitButton) return;

    const template = count === 0
      ? (TEXT.map_show_all_empty || TEXT.map_show_all || "{count}")
      : count === 1
        ? (TEXT.map_show_all_single || TEXT.map_show_all || "{count}")
        : (TEXT.map_show_all || "{count}");

    fitButton.textContent = String(template).replace("{count}", count);
    fitButton.disabled = count === 0;
  }

  function setMapCollapsed(collapsed) {
    mapCollapsed = Boolean(collapsed);

    const shell = qs("#mapShell");
    const panel = qs("#mapPanel");
    const toggle = qs("#mapToggleButton");
    const label = qs("#mapToggleLabel");

    if (shell) shell.classList.toggle("is-collapsed", mapCollapsed);
    if (panel) {
      panel.setAttribute("aria-hidden", mapCollapsed ? "true" : "false");
      if ("inert" in panel) panel.inert = mapCollapsed;
    }
    if (toggle) toggle.setAttribute("aria-expanded", String(!mapCollapsed));
    if (label) label.textContent = mapCollapsed
      ? (TEXT.map_expand || (CURRENT_LANG === "fr" ? "Déplier la carte" : "Kaart uitklappen"))
      : (TEXT.map_collapse || (CURRENT_LANG === "fr" ? "Replier la carte" : "Kaart inklappen"));

    if (!mapCollapsed && map) {
      window.setTimeout(() => map.invalidateSize(), 240);
    }
  }

  function toggleMap() {
    setMapCollapsed(!mapCollapsed);
  }

  function setReferenceMarker(lat, lng, label) {
    if (!map) return;

    if (referenceMarker) {
      map.removeLayer(referenceMarker);
      referenceMarker = null;
    }

    referenceMarker = L.marker([lat, lng], {
      icon: createReferenceIcon(),
      keyboard: false,
      title: label || ""
    }).addTo(map);
  }

  function clearReferenceMarker() {
    if (map && referenceMarker) map.removeLayer(referenceMarker);
    referenceMarker = null;
  }

  function renderMapMarkers(source = null) {
    if (!map || !markerCluster) return;

    markerCluster.clearLayers();
    markersByStoreId = new Map();

    const storesToShow = source || lastSortedStores || stores;

    storesToShow.forEach(store => {
      const lat = toFiniteNumber(store.lat);
      const lng = toFiniteNumber(store.lng);
      if (lat === null || lng === null) return;

      const local = localizedStore(store);
      const marker = L.marker([lat, lng], {
        icon: createMarkerIcon(activeStoreId === store.__joieId),
        title: local.name,
        keyboard: true,
        riseOnHover: true
      });

      marker.bindPopup(getPopupHtml(store), {
        closeButton: true,
        autoPan: true,
        maxWidth: 280
      });

      marker.on("click", () => setActiveStore(store.__joieId, { scrollCard: false }));

      markersByStoreId.set(store.__joieId, marker);
      markerCluster.addLayer(marker);
    });
  }

  function fitAllStores() {
    if (!map || !markerCluster || !markerCluster.getLayers().length) return;

    if (mapCollapsed) {
      setMapCollapsed(false);
      window.setTimeout(fitAllStores, 260);
      return;
    }

    map.fitBounds(markerCluster.getBounds(), {
      padding: [38, 38],
      maxZoom: 13
    });
  }

  function openNearestMarker(sortedStores) {
    if (!sortedStores || !sortedStores.length) return;
    const nearest = sortedStores.find(hasCoordinates);
    if (nearest) focusStoreOnMap(nearest.__joieId, { scrollMap: false, scrollCard: false });
  }

  function focusStoreOnMap(storeId, options = {}) {
    if (!map || !markerCluster) return;

    const marker = markersByStoreId.get(storeId);
    if (!marker) return;

    setActiveStore(storeId, { scrollCard: Boolean(options.scrollCard) });

    const showMarker = () => {
      const openMarker = () => {
        marker.openPopup();
        if (map.getZoom() < 12) map.flyTo(marker.getLatLng(), 12, { duration: 0.65 });
      };

      if (typeof markerCluster.zoomToShowLayer === "function") {
        markerCluster.zoomToShowLayer(marker, openMarker);
      } else {
        map.flyTo(marker.getLatLng(), 12, { duration: 0.65 });
        window.setTimeout(openMarker, 220);
      }
    };

    if (mapCollapsed) {
      if (!options.expandMap) return;
      setMapCollapsed(false);
      window.setTimeout(showMarker, 260);
    } else {
      showMarker();
    }

    if (options.scrollMap) {
      const shell = qs("#mapShell");
      if (shell) shell.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function setActiveStore(storeId, options = {}) {
    activeStoreId = storeId;

    markersByStoreId.forEach((marker, id) => {
      marker.setIcon(createMarkerIcon(id === storeId));
    });

    document.querySelectorAll(".store-card.is-active").forEach(card => card.classList.remove("is-active"));

    const card = qs(`[data-store-id="${storeId}"]`);
    if (card) {
      card.classList.add("is-active");
      if (options.scrollCard) {
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }

  function renderStoreCard(store, distance = null) {
    const local = localizedStore(store);
    const mapsUrl = safeExternalUrl(getGoogleMapsUrl(store));
    const website = safeExternalUrl(local.website);
    const distanceLabel = distance !== null
      ? `<div class="store-distance">${distance.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} ${TEXT.distance_suffix}</div>`
      : "";

    const actionButtons = [
      mapsUrl ? `<a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener" class="btn-maps">${TEXT.maps}</a>` : "",
      website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener" class="btn-website">${TEXT.webshop}</a>` : ""
    ].join("");

    return `<article class="store-card" tabindex="0" data-store-id="${store.__joieId}">
      <div class="store-header">
        <div class="store-title-row">
          ${PIN_ICON}
          <div><h2 class="store-name">${escapeHtml(local.name)}</h2></div>
        </div>
        ${distanceLabel}
      </div>
      ${hasValue(local.address) ? `<p class="store-address">${escapeHtml(local.address)}</p>` : ""}
      ${actionButtons ? `<div class="store-actions">${actionButtons}</div>` : ""}
    </article>`;
  }

  function sortByDistance(lat, lng) {
    const withCoordinates = stores
      .filter(hasCoordinates)
      .map(store => {
        const storeLat = toFiniteNumber(store.lat);
        const storeLng = toFiniteNumber(store.lng);
        return {
          ...store,
          distance: calculateDistance(lat, lng, storeLat, storeLng)
        };
      })
      .sort((a, b) => a.distance - b.distance);

    const withoutCoordinates = stores.filter(store => !hasCoordinates(store));
    return [...withCoordinates, ...withoutCoordinates];
  }

  function renderStores(sortedStores = null) {
    const list = qs("#storeList");
    if (!list) return;

    const source = sortedStores || lastSortedStores || stores;
    updateMapCounter(source.length);

    if (!source.length) {
      list.innerHTML = `<div class="no-results">${TEXT.no_results}</div>`;
      renderMapMarkers([]);
      return;
    }

    list.innerHTML = source.map(store => {
      const storeLat = toFiniteNumber(store.lat);
      const storeLng = toFiniteNumber(store.lng);
      const distance = typeof store.distance === "number"
        ? store.distance
        : (
          userLocation && storeLat !== null && storeLng !== null
            ? calculateDistance(userLocation.lat, userLocation.lng, storeLat, storeLng)
            : null
        );
      return renderStoreCard(store, distance);
    }).join("");

    renderMapMarkers(source);
  }

  function findLocalSearchMatch(query) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return null;

    const exactPostal = stores.find(store => {
      const postalCode = normalizeText(store.postalCode || store.postcode || "");
      return postalCode && postalCode === normalizedQuery && hasCoordinates(store);
    });
    if (exactPostal) return exactPostal;

    const exactCity = stores.find(store => {
      const fields = [store.city, store.city_fr].map(normalizeText).filter(Boolean);
      return fields.includes(normalizedQuery) && hasCoordinates(store);
    });
    if (exactCity) return exactCity;

    return stores.find(store => normalizeText(getStoreSearchFields(store)).includes(normalizedQuery) && hasCoordinates(store)) || null;
  }

  async function geocodeAddress(query) {
    const endpoint = new URL("https://nominatim.openstreetmap.org/search");
    endpoint.searchParams.set("format", "jsonv2");
    endpoint.searchParams.set("limit", "1");
    endpoint.searchParams.set("addressdetails", "1");
    endpoint.searchParams.set("countrycodes", NOMINATIM_COUNTRYCODES);
    endpoint.searchParams.set("accept-language", CURRENT_LANG);
    endpoint.searchParams.set("q", query);

    const response = await fetch(endpoint.toString());
    if (!response.ok) throw new Error("Nominatim request failed");

    const results = await response.json();
    if (!Array.isArray(results) || !results.length) return null;

    const lat = toFiniteNumber(results[0].lat);
    const lng = toFiniteNumber(results[0].lon);
    if (lat === null || lng === null) return null;

    return { lat, lng };
  }

  function applyReferenceLocation(lat, lng, successMessage, referenceLabel, query = "") {
    userLocation = { lat, lng };
    lastSortedStores = sortByDistance(lat, lng);
    activeStoreId = null;

    renderStores(lastSortedStores);
    setReferenceMarker(lat, lng, referenceLabel);

    if (map) map.flyTo([lat, lng], 11, { duration: 0.75 });
    openNearestMarker(lastSortedStores);

    showStatus(successMessage.replace("{query}", query), "success");
  }

  async function searchByAddress() {
    const input = qs("#locationInput");
    const query = input ? input.value.trim() : "";

    if (!query) {
      showStatus(TEXT.enter_address, "error");
      return;
    }

    showStatus(TEXT.searching, "info");

    try {
      const localMatch = findLocalSearchMatch(query);
      if (localMatch) {
        const lat = toFiniteNumber(localMatch.lat);
        const lng = toFiniteNumber(localMatch.lng);
        applyReferenceLocation(lat, lng, TEXT.local_match_success, query, query);
        return;
      }

      const coordinates = await geocodeAddress(query);
      if (!coordinates) {
        showStatus(TEXT.search_error, "error");
        return;
      }

      applyReferenceLocation(coordinates.lat, coordinates.lng, TEXT.search_success, query, query);
    } catch (error) {
      console.error(error);
      showStatus(TEXT.search_failed, "error");
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      showStatus(TEXT.geo_not_supported, "error");
      return;
    }

    const button = qs("#useLocationBtn");
    if (button) button.disabled = true;
    showStatus(TEXT.getting_location, "info");

    navigator.geolocation.getCurrentPosition(
      position => {
        const { latitude, longitude } = position.coords;
        applyReferenceLocation(latitude, longitude, TEXT.location_success, TEXT.current_location_label || "");
        if (button) button.disabled = false;
      },
      error => {
        if (button) button.disabled = false;
        let message = TEXT.location_error;
        if (error.code === error.POSITION_UNAVAILABLE) message = TEXT.location_unavailable;
        if (error.code === error.TIMEOUT) message = TEXT.location_timeout;
        showStatus(message, "error");
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000
      }
    );
  }

  function resetSearch() {
    const input = qs("#locationInput");
    if (input) input.value = "";

    userLocation = null;
    lastSortedStores = null;
    activeStoreId = null;

    clearStatus();
    clearReferenceMarker();
    renderStores(stores);
    setDefaultMapView();
  }

  async function loadStores() {
    try {
      const response = await fetch(STORES_JSON_URL, { cache: "no-store" });
      if (!response.ok) throw new Error("Stores could not be loaded");

      const data = await response.json();
      stores = Array.isArray(data)
        ? data.map((store, index) => ({ ...store, __joieId: String(index) }))
        : [];

      renderStores();
    } catch (error) {
      console.error(error);
      const list = qs("#storeList");
      if (list) list.innerHTML = `<div class="no-results">${TEXT.load_error}</div>`;
      updateMapCounter(0);
    }
  }

  function bindEvents() {
    const input = qs("#locationInput");
    if (input) {
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") searchByAddress();
      });
    }

    const searchButton = qs("#searchButton");
    if (searchButton) searchButton.addEventListener("click", searchByAddress);

    const resetButton = qs("#resetSearchButton");
    if (resetButton) resetButton.addEventListener("click", resetSearch);

    const locationButton = qs("#useLocationBtn");
    if (locationButton) locationButton.addEventListener("click", useMyLocation);

    const mapToggleButton = qs("#mapToggleButton");
    if (mapToggleButton) mapToggleButton.addEventListener("click", toggleMap);

    const mapFitButton = qs("#mapFitButton");
    if (mapFitButton) mapFitButton.addEventListener("click", fitAllStores);

    const list = qs("#storeList");
    if (list) {
      list.addEventListener("click", event => {
        if (event.target.closest("a")) return;
        const card = event.target.closest(".store-card");
        if (card) focusStoreOnMap(card.dataset.storeId, { scrollMap: true, scrollCard: false, expandMap: true });
      });

      list.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.target.closest("a")) return;
        const card = event.target.closest(".store-card");
        if (!card) return;
        event.preventDefault();
        focusStoreOnMap(card.dataset.storeId, { scrollMap: true, scrollCard: false, expandMap: true });
      });
    }
  }

  window.resetSearch = resetSearch;
  window.searchByAddress = searchByAddress;
  window.useMyLocation = useMyLocation;
  window.fitAllStores = fitAllStores;
  window.toggleMap = toggleMap;

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    initMap();
    setMapCollapsed(false);
    loadStores();
  });
})();
