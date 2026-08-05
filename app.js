// CONFIGURACIÓN DE SUPABASE
const SUPABASE_URL = "https://supabase.com/dashboard/project/svdfdahvhdmxzyknmicz";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2ZGZkYWh2aGRteHp5a25taWN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5Mjk1NDQsImV4cCI6MjEwMTUwNTU0NH0.c7OLeFnZQYSYmJtWsmdYry22sEPtPUw2DsEiJPLx_Vk";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
  const urlParams = new URLSearchParams(window.location.search);
  eventId = urlParams.get("evento");

  if (!eventId) {
    eventTitle.textContent = "Error: Enlace de evento inválido";
    return;
  }

  await fetchEventDetails();
  await fetchPhotos();
  setupEventListeners();
  registerServiceWorker();
});

// Cargar detalles del Evento
async function fetchEventDetails() {
  const { data, error } = await supabase
    .from("eventos")
    .select("nombre")
    .eq("id", eventId)
    .single();

  if (error || !data) {
    eventTitle.textContent = "Evento no encontrado";
    return;
  }
  eventTitle.textContent = data.nombre;
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

  photosState = data;
  renderGallery();
  updateCounter();
}

// Renderizar la Cuadrícula
function renderGallery() {
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
  const selectedCount = photosState.filter(p => p.seleccionada).length;
  selectionCounter.textContent = `${selectedCount} de ${photosState.length} seleccionadas`;
}

// LÓGICA DEL MODAL / VISOR
function openModal(index) {
  currentPhotoIndex = index;
  updateModalContent();
  photoModal.classList.remove("hidden");
}

function closeModal() {
  photoModal.classList.add("hidden");
}

function updateModalContent() {
  const photo = photosState[currentPhotoIndex];
  const formattedNum = String(photo.numero).padStart(3, "0");

  modalImage.src = photo.original_url;
  modalPhotoNumber.textContent = `Foto ${formattedNum}`;

  if (photo.seleccionada) {
    toggleSelectBtn.classList.add("is-selected");
    selectBtnText.textContent = "✓ Seleccionada";
  } else {
    toggleSelectBtn.classList.remove("is-selected");
    selectBtnText.textContent = "Seleccionar fotografía";
  }
}

// Alternar Selección (Guardado Automático)
async function togglePhotoSelection() {
  const photo = photosState[currentPhotoIndex];
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
  closeModalBtn.addEventListener("click", closeModal);
  toggleSelectBtn.addEventListener("click", togglePhotoSelection);
  nextPhotoBtn.addEventListener("click", nextPhoto);
  prevPhotoBtn.addEventListener("click", prevPhoto);

  // Soporte de Teclado
  document.addEventListener("keydown", (e) => {
    if (photoModal.classList.contains("hidden")) return;
    if (e.key === "Escape") closeModal();
    if (e.key === "ArrowRight") nextPhoto();
    if (e.key === "ArrowLeft") prevPhoto();
    if (e.key === " ") togglePhotoSelection();
  });
}

// REGISTRO DEL SERVICE WORKER
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .catch(err => console.error("Error al registrar Service Worker:", err));
  }
}