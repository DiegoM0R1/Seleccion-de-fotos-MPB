// CONFIGURACIÓN DE SUPABASE
const SUPABASE_URL = "https://svdfdahvhdmxzyknmicz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2ZGZkYWh2aGRteHp5a25taWN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5Mjk1NDQsImV4cCI6MjEwMTUwNTU0NH0.c7OLeFnZQYSYmJtWsmdYry22sEPtPUw2DsEiJPLx_Vk";

// Inicialización segura sin colisión de nombres
if (!window.dbClient) {
  window.dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
var supabase = window.dbClient;
// ESTADO GLOBAL
let photosState = [];
let eventId = null;
let currentFilter = "all";

// ELEMENTOS DOM
const adminGalleryGrid = document.getElementById("admin-gallery-grid");
const adminEventTitle = document.getElementById("admin-event-title");
const realtimeBadge = document.getElementById("realtime-badge");

// Métricas
const metricTotal = document.getElementById("metric-total");
const metricSelected = document.getElementById("metric-selected");
const metricPublished = document.getElementById("metric-published");
const btnSelectedCount = document.getElementById("btn-selected-count");

// Filtros
const filterTabs = document.querySelectorAll(".filter-tab");
const filterCountAll = document.getElementById("filter-count-all");
const filterCountSelected = document.getElementById("filter-count-selected");
const filterCountUnselected = document.getElementById("filter-count-unselected");
const filterCountPublished = document.getElementById("filter-count-published");

// Acciones y Modales
const downloadSelectedBtn = document.getElementById("download-selected-btn");
const finalizeEventBtn = document.getElementById("finalize-event-btn");
const finalizeModal = document.getElementById("finalize-modal");
const cancelFinalizeBtn = document.getElementById("cancel-finalize-btn");
const confirmArchiveBtn = document.getElementById("confirm-archive-btn");
const confirmDeleteBtn = document.getElementById("confirm-delete-btn");

const createModal = document.getElementById("create-event-modal");
const openModalBtn = document.getElementById("open-create-modal-btn");
const closeModalBtn = document.getElementById("close-create-modal-btn");
const startUploadBtn = document.getElementById("start-upload-btn");

// INICIALIZACIÓN
document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();

  const urlParams = new URLSearchParams(window.location.search);
  eventId = urlParams.get("evento");

  if (!eventId) {
    adminEventTitle.textContent = "Crea un nuevo evento con el botón superior";
    return;
  }

  await fetchEventData();
  await fetchPhotos();
  setupRealtimeSubscription();
});

// 1. Cargar datos del evento y fotos
async function fetchEventData() {
  const { data } = await supabase.from("eventos").select("nombre").eq("id", eventId).single();
  if (data) adminEventTitle.textContent = `Panel: ${data.nombre}`;
}

async function fetchPhotos() {
  const { data, error } = await supabase
    .from("fotografias")
    .select("*")
    .eq("evento_id", eventId)
    .order("numero", { ascending: true });

  if (!error && data) {
    photosState = data;
    updateUI();
  }
}

// 2. Generador de miniaturas en memoria usando Canvas
function generateThumbnail(file, maxWidth = 600) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = maxWidth / img.width;
        
        canvas.width = scale < 1 ? maxWidth : img.width;
        canvas.height = scale < 1 ? img.height * scale : img.height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8);
      };
    };
  });
}

// 3. Proceso de creación de evento y subida
startUploadBtn?.addEventListener("click", async () => {
  const nameInput = document.getElementById("new-event-name");
  const filesInput = document.getElementById("event-photos-input");
  const progressContainer = document.getElementById("upload-progress-container");
  const progressBar = document.getElementById("upload-progress-bar");
  const statusText = document.getElementById("upload-status-text");

  const eventName = nameInput.value.trim();
  const files = Array.from(filesInput.files).sort((a, b) => a.name.localeCompare(b.name));

  if (!eventName) return alert("Ingresa un nombre para el evento");
  if (files.length === 0) return alert("Selecciona al menos una fotografía");

  startUploadBtn.disabled = true;
  progressContainer.classList.remove("hidden");

  try {
    const { data: eventData, error: eventError } = await supabase
      .from("eventos")
      .insert([{ nombre: eventName, estado: "activo" }])
      .select()
      .single();

    if (eventError) throw eventError;

    const newEventId = eventData.id;
    const total = files.length;

    for (let i = 0; i < total; i++) {
      const file = files[i];
      const photoNum = i + 1;
      
      statusText.textContent = `Procesando Foto ${photoNum} de ${total}...`;

      const thumbBlob = await generateThumbnail(file);

      const origPath = `eventos/${newEventId}/orig_${file.name}`;
      const thumbPath = `eventos/${newEventId}/thumb_${file.name}`;

      await supabase.storage.from("fotografias").upload(origPath, file);
      await supabase.storage.from("fotografias").upload(thumbPath, thumbBlob);

      const { data: origUrl } = supabase.storage.from("fotografias").getPublicUrl(origPath);
      const { data: thumbUrl } = supabase.storage.from("fotografias").getPublicUrl(thumbPath);

      await supabase.from("fotografias").insert([{
        evento_id: newEventId,
        nombre_original: file.name,
        numero: photoNum,
        thumbnail_url: thumbUrl.publicUrl,
        original_url: origUrl.publicUrl,
        seleccionada: false,
        publicada: false
      }]);

      const percent = Math.round(((i + 1) / total) * 100);
      progressBar.style.width = `${percent}%`;
    }

    alert("¡Evento y fotografías creados con éxito!");
    window.location.href = `admin.html?evento=${newEventId}`;

  } catch (err) {
    console.error(err);
    alert("Error al procesar la carga: " + err.message);
  } finally {
    startUploadBtn.disabled = false;
  }
});

// 4. Configuración de Realtime
function setupRealtimeSubscription() {
  supabase
    .channel(`admin-event-${eventId}`)
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
          updateUI();
          flashCard(payload.new.id);
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        realtimeBadge.textContent = "● En Vivo";
        realtimeBadge.className = "status-badge connected";
      }
    });
}

function flashCard(photoId) {
  const card = document.querySelector(`[data-photo-id="${photoId}"]`);
  if (card) {
    card.style.transition = "transform 0.2s, box-shadow 0.2s";
    card.style.transform = "scale(1.05)";
    setTimeout(() => { card.style.transform = "scale(1)"; }, 300);
  }
}

// 5. Renderizado y Métricas
function updateUI() {
  updateMetricsAndCounts();
  renderAdminGallery();
}

function updateMetricsAndCounts() {
  const total = photosState.length;
  const selected = photosState.filter(p => p.seleccionada).length;
  const unselected = total - selected;
  const published = photosState.filter(p => p.publicada).length;

  metricTotal.textContent = total;
  metricSelected.textContent = selected;
  metricPublished.textContent = published;
  btnSelectedCount.textContent = selected;

  filterCountAll.textContent = total;
  filterCountSelected.textContent = selected;
  filterCountUnselected.textContent = unselected;
  filterCountPublished.textContent = published;
}

function renderAdminGallery() {
  adminGalleryGrid.innerHTML = "";

  const filteredPhotos = photosState.filter(photo => {
    if (currentFilter === "selected") return photo.seleccionada;
    if (currentFilter === "unselected") return !photo.seleccionada;
    if (currentFilter === "published") return photo.publicada;
    return true;
  });

  filteredPhotos.forEach(photo => {
    const card = document.createElement("div");
    card.className = `photo-card ${photo.seleccionada ? "selected" : ""}`;
    card.setAttribute("data-photo-id", photo.id);
    const formattedNum = String(photo.numero).padStart(3, "0");

    card.innerHTML = `
      <div class="admin-card-actions">
        <button class="tag-btn ${photo.publicada ? 'is-published' : ''}" onclick="togglePublished('${photo.id}')">
          ${photo.publicada ? '✓ Publicada' : 'Marcar Publicada'}
        </button>
      </div>
      <img src="${photo.thumbnail_url}" alt="Foto ${formattedNum}" loading="lazy">
      <div class="check-indicator">${photo.seleccionada ? "✓" : ""}</div>
      <div class="photo-badge">Foto ${formattedNum}</div>
    `;

    adminGalleryGrid.appendChild(card);
  });
}

// 6. Marcar Estado: Publicada
async function togglePublished(photoId) {
  const photo = photosState.find(p => p.id === photoId);
  if (!photo) return;

  const newStatus = !photo.publicada;
  photo.publicada = newStatus;
  updateUI();

  await supabase.from("fotografias").update({ publicada: newStatus }).eq("id", photoId);
}

// 7. Descarga y Modales
downloadSelectedBtn?.addEventListener("click", () => {
  const selectedPhotos = photosState.filter(p => p.seleccionada);
  
  if (selectedPhotos.length === 0) {
    alert("No hay fotografías seleccionadas para descargar.");
    return;
  }

  const downloadList = selectedPhotos
    .map(p => `Foto ${String(p.numero).padStart(3, "0")}: ${p.original_url}`)
    .join("\n");

  const blob = new Blob([downloadList], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `seleccion_evento_${eventId.substring(0, 8)}.txt`;
  a.click();

  if (selectedPhotos.length <= 10) {
    selectedPhotos.forEach(p => window.open(p.original_url, "_blank"));
  }
});

finalizeEventBtn?.addEventListener("click", () => finalizeModal.classList.remove("hidden"));
cancelFinalizeBtn?.addEventListener("click", () => finalizeModal.classList.add("hidden"));

confirmArchiveBtn?.addEventListener("click", async () => {
  await supabase.from("eventos").update({ estado: "archivado" }).eq("id", eventId);
  alert("Evento archivado correctamente.");
  window.location.reload();
});

confirmDeleteBtn?.addEventListener("click", async () => {
  if (confirm("⚠️ ¿Estás seguro de eliminar permanentemente el evento y todos sus registros?")) {
    await supabase.from("eventos").delete().eq("id", eventId);
    alert("Evento eliminado.");
    window.location.href = "index.html";
  }
});

function setupEventListeners() {
  openModalBtn?.addEventListener("click", () => createModal.classList.remove("hidden"));
  closeModalBtn?.addEventListener("click", () => createModal.classList.add("hidden"));

  filterTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      filterTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.dataset.filter;
      renderAdminGallery();
    });
  });
}