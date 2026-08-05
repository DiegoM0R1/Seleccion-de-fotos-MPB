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

// ELEMENTOS DEL DOM
const galleryGrid = document.getElementById("gallery-grid");
const eventTitle = document.getElementById("event-title");
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

  const urlParams = new URLSearchParams(window.location.search);
  eventId = urlParams.get("evento");

  // Si no hay parámetro en la URL, busca automáticamente el evento activo más reciente
  if (!eventId) {
    const { data: latestEvent } = await supabase
      .from("eventos")
      .select("id")
      .eq("estado", "activo")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestEvent) {
      eventId = latestEvent.id;
    } else {
      if (eventTitle) eventTitle.textContent = "No hay ningún evento activo disponible.";
      return;
    }
  }

  await fetchEventDetails();
  await fetchPhotos();
  setupRealtimeSubscription();
});

// Cargar detalles del Evento
async function fetchEventDetails() {
  const { data, error } = await supabase
    .from("eventos")
    .select("nombre")
    .eq("id", eventId)
    .single();

  if (error || !data) {
    if (eventTitle) eventTitle.textContent = "Evento no encontrado";
    return;
  }
  if (eventTitle) eventTitle.textContent = data.nombre;
}

// Cargar lista de fotografías
async function fetchPhotos() {
  const { data, error } = await supabase
    .from("fotografias")
    .select("*")
    .eq("evento_id", eventId)
    .order("numero", { ascending: true });

  if (error) {
    console.error("Error al cargar fotos:", error);
    return;
  }

  photosState = data || [];
  renderGallery();
  updateCounter();
}

// Renderizar la Cuadrícula
function renderGallery() {
  if (!galleryGrid) return;
  galleryGrid.innerHTML = "";

  photosState.forEach((photo, index) => {
    const card = document.createElement("div");
    card.className = `photo-card ${photo.seleccionada ? "selected" : ""}`;
    card.setAttribute("data-index", index);

    const formattedNum = String(photo.numero).padStart(3, "0");

    card.innerHTML = `
      <img src="${photo.thumbnail_url}" alt="Foto ${formattedNum}" loading="lazy">
      <div class="check-indicator">${photo.seleccionada ? "✓" : ""}</div>
      <div class="photo-badge">Foto ${formattedNum}</div>
    `;

    card.addEventListener("click", () => openModal(index));
    galleryGrid.appendChild(card);
  });
}

// Actualizar Contador de Seleccionadas
function updateCounter() {
  if (!selectionCounter) return;
  const selectedCount = photosState.filter(p => p.seleccionada).length;
  selectionCounter.textContent = `${selectedCount} de ${photosState.length} seleccionadas`;
}

// LÓGICA DEL MODAL / VISOR
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

// Alternar Selección (Guardado Automático)
async function togglePhotoSelection() {
  const photo = photosState[currentPhotoIndex];
  if (!photo) return;

  const newSelectionState = !photo.seleccionada;

  // Actualización optimista en memoria y UI
  photo.seleccionada = newSelectionState;
  updateModalContent();
  renderGallery();
  updateCounter();

  // Guardar en Supabase
  const { error } = await supabase
    .from("fotografias")
    .update({ seleccionada: newSelectionState })
    .eq("id", photo.id);

  if (error) {
    console.error("Error al actualizar la selección:", error);
    // Revertir cambio si falla la red
    photo.seleccionada = !newSelectionState;
    updateModalContent();
    renderGallery();
    updateCounter();
  }
}

// Navegación en el Visor
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

// Event Listeners
function setupEventListeners() {
  if (closeModalBtn) closeModalBtn.addEventListener("click", closeModal);
  if (toggleSelectBtn) toggleSelectBtn.addEventListener("click", togglePhotoSelection);
  if (nextPhotoBtn) nextPhotoBtn.addEventListener("click", nextPhoto);
  if (prevPhotoBtn) prevPhotoBtn.addEventListener("click", prevPhoto);

  // Soporte de Teclado
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
  supabase
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

// REGISTRO DEL SERVICE WORKER
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .catch(err => console.error("Error al registrar Service Worker:", err));
  }
}