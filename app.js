// CONFIGURACIÓN DE SUPABASE
const SUPABASE_URL = "https://svdfdahvhdmxzyknmicz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2ZGZkYWh2aGRteHp5a25taWN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5Mjk1NDQsImV4cCI6MjEwMTUwNTU0NH0.c7OLeFnZQYSYmJtWsmdYry22sEPtPUw2DsEiJPLx_Vk";

// Inicialización segura
if (!window.dbClient) {
  window.dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
var supabase = window.dbClient;

// ESTADO DE LA APLICACIÓN
let photosState = [];
let currentPhotoIndex = 0;
let eventId = null;
let realtimeChannel = null;

// ELEMENTOS DEL DOM
const galleryGrid = document.getElementById("gallery-grid");
const eventSelector = document.getElementById("event-selector");
const selectionCounter = document.getElementById("selection-counter");

// Modal Elements
const photoModal = document.getElementById("photo-modal");
const modalImage = document.getElementById("modal-image");
const modalPhotoNumber = document.getElementById("modal-photo-number");
const toggleSelectBtn = document.getElementById("toggle-select-btn");
const selectBtnText = document.getElementById("select-btn-text");
const closeModalBtn = document.getElementById("close-modal-btn");
const prevPhotoBtn = document.getElementById("prev-photo-btn");
const nextPhotoBtn = document.getElementById("next-photo-btn");

// INICIALIZACIÓN
document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  registerServiceWorker();

  const eventsAvailable = await fetchActiveEvents();
  if (eventsAvailable) {
    await fetchPhotos();
    setupRealtimeSubscription();
  }
});

// 1. Obtener todos los eventos activos y llenar el selector
async function fetchActiveEvents() {
  const { data: events, error } = await supabase
    .from("eventos")
    .select("id, nombre")
    .eq("estado", "activo")
    .order("created_at", { ascending: false });

  if (error || !events || events.length === 0) {
    if (eventSelector) {
      eventSelector.innerHTML = '<option value="">No hay eventos activos</option>';
    }
    return false;
  }

  // Poblar el menú desplegable
  if (eventSelector) {
    eventSelector.innerHTML = events.map(ev => 
      `<option value="${ev.id}">${ev.nombre}</option>`
    ).join("");
  }

  // Comprobar si hay un ID específico en la URL
  const urlParams = new URLSearchParams(window.location.search);
  const urlEventId = urlParams.get("evento");

  if (urlEventId && events.some(e => e.id === urlEventId)) {
    eventId = urlEventId;
  } else {
    eventId = events[0].id; // Evento más reciente por defecto
  }

  if (eventSelector) {
    eventSelector.value = eventId;
  }

  return true;
}

// 2. Cargar fotografías del evento activo
function showSkeletons(count = 12) {
  if (!galleryGrid) return;
  galleryGrid.innerHTML = Array.from({ length: count })
    .map(() => `<div class="photo-card skeleton"></div>`)
    .join("");
}

async function fetchPhotos() {
  if (!eventId) return;
  showSkeletons(); // ← agregar esta línea

  const { data, error } = await supabase
    .from("fotografias")
    .select("*")
    .eq("evento_id", eventId)
    .order("numero", { ascending: true });

  if (error) { console.error("Error al cargar fotos:", error); return; }
  photosState = data || [];
  renderGallery();
  updateCounter();
}

function renderGallery() {
  if (!galleryGrid) return;
  galleryGrid.innerHTML = "";

  if (photosState.length === 0) {
    galleryGrid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:#64748b;">
        <div style="font-size:2rem;margin-bottom:8px;">📷</div>
        <p style="font-weight:500;">No hay fotografías en este evento</p>
      </div>`;
    return;
  }

  photosState.forEach((photo, index) => {
    const card = document.createElement("div");
    card.className = `photo-card ${photo.seleccionada ? "selected" : ""}`;
    card.setAttribute("data-index", index);
    const formattedNum = String(photo.numero).padStart(3, "0");

    card.innerHTML = `
      <img src="${photo.thumbnail_url}" alt="Foto ${formattedNum}" loading="lazy">
      <div class="check-indicator">${photo.seleccionada ? "✓" : ""}</div>
      <div class="photo-badge">${formattedNum}</div>
    `;

    card.addEventListener("click", () => openModal(index));
    galleryGrid.appendChild(card);
  });
}

// 4. Actualizar Contador
function updateCounter() {
  if (!selectionCounter) return;
  const selectedCount = photosState.filter(p => p.seleccionada).length;
  selectionCounter.textContent = `${selectedCount} de ${photosState.length} seleccionadas`;
}

// LÓGICA DEL VISOR / MODAL
function openModal(index) {
  currentPhotoIndex = index;
  updateModalContent();
  if (photoModal) photoModal.classList.remove("hidden");
}

function closeModal() {
  if (photoModal) photoModal.classList.add("hidden");
}

function updateModalContent() {
  const photo = photosState[currentPhotoIndex];
  if (!photo) return;
  const formattedNum = String(photo.numero).padStart(3, "0");

  if (modalImage) modalImage.src = photo.original_url || photo.thumbnail_url;
  if (modalPhotoNumber) modalPhotoNumber.textContent = `Foto ${formattedNum}`;

  if (photo.seleccionada) {
    if (toggleSelectBtn) toggleSelectBtn.classList.add("is-selected");
    if (selectBtnText) selectBtnText.textContent = "✓ Seleccionada";
  } else {
    if (toggleSelectBtn) toggleSelectBtn.classList.remove("is-selected");
    if (selectBtnText) selectBtnText.textContent = "Seleccionar fotografía";
  }
}

async function togglePhotoSelection() {
  const photo = photosState[currentPhotoIndex];
  if (!photo) return;

  const newSelectionState = !photo.seleccionada;
  photo.seleccionada = newSelectionState;

  updateModalContent();
  renderGallery();
  updateCounter();

  const { error } = await supabase
    .from("fotografias")
    .update({ seleccionada: newSelectionState })
    .eq("id", photo.id);

  if (error) {
    console.error("Error al actualizar la selección:", error);
    photo.seleccionada = !newSelectionState;
    updateModalContent();
    renderGallery();
    updateCounter();
  }
}

function nextPhoto() {
  if (currentPhotoIndex < photosState.length - 1) {
    currentPhotoIndex++;
    updateModalContent();
  }
}

function prevPhoto() {
  if (currentPhotoIndex > 0) {
    currentPhotoIndex--;
    updateModalContent();
  }
}

// LISTENERS Y CAMBIO DE EVENTO
function setupEventListeners() {
  
  if (closeModalBtn) closeModalBtn.addEventListener("click", closeModal);
  if (toggleSelectBtn) toggleSelectBtn.addEventListener("click", togglePhotoSelection);
  if (nextPhotoBtn) nextPhotoBtn.addEventListener("click", nextPhoto);
  if (prevPhotoBtn) prevPhotoBtn.addEventListener("click", prevPhoto);

  // Evento al cambiar de opción en el desplegable
  if (eventSelector) {
    eventSelector.addEventListener("change", async (e) => {
      eventId = e.target.value;
      if (!eventId) return;

      // Actualizar la URL sin recargar la página
      const newUrl = new URL(window.location);
      newUrl.searchParams.set("evento", eventId);
      window.history.pushState({}, "", newUrl);

      await fetchPhotos();
      setupRealtimeSubscription();
    });
    let touchStartX = 0;
const modalBody = document.querySelector(".modal-body");

if (modalBody) {
  modalBody.addEventListener("touchstart", e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  modalBody.addEventListener("touchend", e => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) { diff > 0 ? nextPhoto() : prevPhoto(); }
  });
    
  }

  document.addEventListener("keydown", (e) => {
    if (!photoModal || photoModal.classList.contains("hidden")) return;
    if (e.key === "Escape") closeModal();
    if (e.key === "ArrowRight") nextPhoto();
    if (e.key === "ArrowLeft") prevPhoto();
    if (e.key === " ") togglePhotoSelection();
  });
}

// SINCRONIZACIÓN EN TIEMPO REAL
function setupRealtimeSubscription() {
  if (!eventId) return;

  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabase
    .channel(`public-event-${eventId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "fotografias",
        filter: `evento_id=eq.${eventId}`
      },
      (payload) => {
        const index = photosState.findIndex(p => p.id === payload.new.id);
        if (index !== -1) {
          photosState[index] = payload.new;
          renderGallery();
          updateCounter();
          if (photoModal && !photoModal.classList.contains("hidden") && currentPhotoIndex === index) {
            updateModalContent();
          }
        }
      }
    )
    .subscribe();
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .catch(err => console.error("Error al registrar Service Worker:", err));
  }
}
}